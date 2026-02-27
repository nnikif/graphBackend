import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";

const DEFAULT_FILE = "prometheus/web/api/v1/openapi_examples.go";
const API_BASE =
  window.location.hostname === "localhost" ? "http://localhost:3000" : "http://backend:3000";
const MAX_TRANSITIVE_DEPTH = 2;
const MAX_GRAPH_NODES = 60;

const GO_KEYWORDS = new Set([
  "break",
  "case",
  "chan",
  "const",
  "continue",
  "default",
  "defer",
  "else",
  "fallthrough",
  "for",
  "func",
  "go",
  "goto",
  "if",
  "import",
  "interface",
  "map",
  "package",
  "range",
  "return",
  "select",
  "struct",
  "switch",
  "type",
  "var",
]);

const GO_BUILTINS = new Set([
  "append",
  "cap",
  "close",
  "copy",
  "delete",
  "error",
  "false",
  "imag",
  "iota",
  "len",
  "make",
  "new",
  "nil",
  "panic",
  "print",
  "println",
  "real",
  "recover",
  "true",
]);

function requestJson(path) {
  return fetch(`${API_BASE}${path}`).then(async (response) => {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text}`);
    }

    return response.json();
  });
}

function getParentPath(path) {
  if (!path) {
    return "";
  }

  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightGoHtml(line) {
  const escaped = escapeHtml(line);
  const tokenPattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\/\/.*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

  return escaped.replace(tokenPattern, (token) => {
    if (token.startsWith("//")) {
      return `<span class="tok-comment">${token}</span>`;
    }
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      return `<span class="tok-string">${token}</span>`;
    }
    if (/^\d/.test(token)) {
      return `<span class="tok-number">${token}</span>`;
    }
    if (GO_KEYWORDS.has(token)) {
      return `<span class="tok-keyword">${token}</span>`;
    }
    if (GO_BUILTINS.has(token)) {
      return `<span class="tok-builtin">${token}</span>`;
    }
    return `<span class="tok-ident">${token}</span>`;
  });
}

function getFunctionNameCandidates(name) {
  const raw = String(name || "").trim();
  if (!raw) {
    return [];
  }

  const leaf = raw.split(".").pop() || raw;
  const cleanedLeaf = leaf.replace(/^[*(\s]+/, "").replace(/[)\s]+$/g, "");

  return Array.from(
    new Set(
      [cleanedLeaf, leaf, raw]
        .map((candidate) => candidate.trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length),
    ),
  );
}

function findIdentifierRange(line, candidate) {
  let start = line.indexOf(candidate);

  while (start !== -1) {
    const end = start + candidate.length;
    const before = start === 0 ? "" : line[start - 1];
    const after = end >= line.length ? "" : line[end];
    const beforeOk = !/[A-Za-z0-9_]/.test(before);
    const afterOk = !/[A-Za-z0-9_]/.test(after);

    if (beforeOk && afterOk) {
      return { start, end };
    }

    start = line.indexOf(candidate, start + 1);
  }

  return null;
}

function findFunctionMatches(line, functionsOnLine) {
  if (!functionsOnLine || functionsOnLine.length === 0) {
    return [];
  }

  return functionsOnLine
    .map((fn) => {
      const matchRange = getFunctionNameCandidates(fn.name)
        .map((candidate) => ({
          candidate,
          range: findIdentifierRange(line, candidate),
        }))
        .find((entry) => entry.range);

      if (!matchRange) {
        return null;
      }

      return {
        ...fn,
        displayName: matchRange.candidate,
        start: matchRange.range.start,
        end: matchRange.range.end,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start)
    .filter((match, index, all) => {
      if (index === 0) {
        return true;
      }

      return match.start >= all[index - 1].end;
    });
}

function rankTraversalNode(node, selectedFunction) {
  const depth = Number(node.depth || 0);
  const samePackage = node.package && node.package === selectedFunction?.package ? 1 : 0;
  const sameFile = node.file && node.file === selectedFunction?.file ? 1 : 0;
  const hasLocalSource = node.file ? 1 : 0;
  const externalPenalty = String(node.id || "").startsWith("ext::") ? 1 : 0;

  return (
    depth * 100 -
    samePackage * 20 -
    sameFile * 10 -
    hasLocalSource * 5 +
    externalPenalty * 15
  );
}

function takeMeaningfulNodes(nodes, budget, selectedFunction) {
  if (budget <= 0) {
    return [];
  }

  return [...nodes]
    .sort((left, right) => {
      const leftScore = rankTraversalNode(left, selectedFunction);
      const rightScore = rankTraversalNode(right, selectedFunction);

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return String(left.name || "").localeCompare(String(right.name || ""));
    })
    .slice(0, budget);
}

function isAllowedGraphNode(node) {
  if (!node || !node.id) {
    return false;
  }

  if (!node.file) {
    return true;
  }

  return String(node.file).toLowerCase().endsWith(".go");
}

function selectGraphData(graphData, graphView, selectedFunction) {
  const neighborhood = (Array.isArray(graphData.neighborhood) ? graphData.neighborhood : []).filter(
    isAllowedGraphNode,
  );
  const callChain = (Array.isArray(graphData.callChain) ? graphData.callChain : []).filter(
    isAllowedGraphNode,
  );
  const callers = (Array.isArray(graphData.callers) ? graphData.callers : []).filter(
    isAllowedGraphNode,
  );

  if (graphView === "neighbors") {
    return {
      neighborhood,
      callChain: [],
      callers: [],
    };
  }

  const directIds = new Set(neighborhood.map((node) => node.id));
  const remainingBudget = Math.max(MAX_GRAPH_NODES - 1 - directIds.size, 0);
  const filteredCallers = callers.filter((node) => !directIds.has(node.id));
  const filteredCallees = callChain.filter((node) => !directIds.has(node.id));

  const callerBudget = Math.floor(remainingBudget / 2);
  const calleeBudget = remainingBudget - callerBudget;
  let selectedCallers = takeMeaningfulNodes(filteredCallers, callerBudget, selectedFunction);
  let selectedCallees = takeMeaningfulNodes(filteredCallees, calleeBudget, selectedFunction);

  const leftoverBudget =
    remainingBudget - selectedCallers.length - selectedCallees.length;

  if (leftoverBudget > 0) {
    const selectedIds = new Set([
      ...selectedCallers.map((node) => node.id),
      ...selectedCallees.map((node) => node.id),
    ]);
    const remainingNodes = [...filteredCallers, ...filteredCallees].filter(
      (node) => !selectedIds.has(node.id),
    );
    const extras = takeMeaningfulNodes(remainingNodes, leftoverBudget, selectedFunction);

    for (const node of extras) {
      if (callers.some((candidate) => candidate.id === node.id)) {
        selectedCallers.push(node);
      } else {
        selectedCallees.push(node);
      }
    }
  }

  return {
    neighborhood,
    callers: selectedCallers,
    callChain: selectedCallees,
  };
}

function buildGraphElements(selectedFunction, graphData) {
  if (!selectedFunction) {
    return [];
  }

  const nodeMap = new Map();
  const edgeList = [];
  const { neighborhood = [], callChain = [], callers = [] } = graphData || {};

  function upsertNode(id, nextData, classes = []) {
    const existing = nodeMap.get(id);
    if (!existing) {
      nodeMap.set(id, {
        data: nextData,
        classes: Array.from(new Set(classes)).join(" "),
      });
      return;
    }

    existing.data = { ...existing.data, ...nextData };
    existing.classes = Array.from(
      new Set(`${existing.classes} ${classes.join(" ")}`.trim().split(/\s+/).filter(Boolean)),
    ).join(" ");
  }

  upsertNode(
    selectedFunction.function_id,
    {
      id: selectedFunction.function_id,
      label: selectedFunction.name,
      file: selectedFunction.file,
      line: selectedFunction.line,
      package: selectedFunction.package,
      relation: "focus",
      depth: 0,
    },
    ["focus"],
  );

  for (const node of neighborhood) {
    upsertNode(
      node.id,
      {
        id: node.id,
        label: node.name,
        file: node.file,
        line: node.line,
        package: node.package,
        relation: node.direction,
        depth: 1,
      },
      [node.direction, "direct"],
    );

    edgeList.push({
      data: {
        id: `${selectedFunction.function_id}:direct:${node.direction}:${node.id}`,
        source: node.direction === "caller" ? node.id : selectedFunction.function_id,
        target: node.direction === "caller" ? selectedFunction.function_id : node.id,
      },
      classes: `${node.direction} direct`,
    });
  }

  const callerDepths = new Map();
  for (const node of callers) {
    if (node.id === selectedFunction.function_id) {
      continue;
    }
    const depth = Number(node.depth || 0);
    const enrichedNode = {
      id: node.id,
      label: node.name,
      file: node.file || null,
      line: node.line || null,
      package: node.package,
      relation: "caller",
      depth,
    };
    upsertNode(node.id, enrichedNode, ["caller", "transitive", `depth-${depth}`]);

    const bucket = callerDepths.get(depth) || [];
    bucket.push(enrichedNode);
    callerDepths.set(depth, bucket);
  }

  const calleeDepths = new Map();
  for (const node of callChain) {
    if (node.id === selectedFunction.function_id) {
      continue;
    }
    const depth = Number(node.depth || 0);
    const enrichedNode = {
      id: node.id,
      label: node.name,
      file: node.file || null,
      line: node.line || null,
      package: node.package,
      relation: "callee",
      depth,
    };
    upsertNode(node.id, enrichedNode, ["callee", "transitive", `depth-${depth}`]);

    const bucket = calleeDepths.get(depth) || [];
    bucket.push(enrichedNode);
    calleeDepths.set(depth, bucket);
  }

  for (const [depth, nodes] of callerDepths.entries()) {
    const previousNodes =
      depth === 1
        ? [{ id: selectedFunction.function_id }]
        : callerDepths.get(depth - 1) || [{ id: selectedFunction.function_id }];

    for (const node of nodes) {
      for (const previousNode of previousNodes) {
        edgeList.push({
          data: {
            id: `caller:${depth}:${previousNode.id}:${node.id}`,
            source: node.id,
            target: previousNode.id,
          },
          classes: depth === 1 ? "caller direct" : "caller transitive",
        });
      }
    }
  }

  for (const [depth, nodes] of calleeDepths.entries()) {
    const previousNodes =
      depth === 1
        ? [{ id: selectedFunction.function_id }]
        : calleeDepths.get(depth - 1) || [{ id: selectedFunction.function_id }];

    for (const node of nodes) {
      for (const previousNode of previousNodes) {
        edgeList.push({
          data: {
            id: `callee:${depth}:${previousNode.id}:${node.id}`,
            source: previousNode.id,
            target: node.id,
          },
          classes: depth === 1 ? "callee direct" : "callee transitive",
        });
      }
    }
  }

  return [...nodeMap.values(), ...edgeList];
}

function CodeSegment({ html }) {
  if (!html) {
    return <span>&nbsp;</span>;
  }

  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function FunctionLine({
  line,
  functionsOnLine,
  selectedFunctionId,
  onFunctionClick,
}) {
  const matches = useMemo(() => findFunctionMatches(line, functionsOnLine), [line, functionsOnLine]);

  if (matches.length === 0) {
    return <CodeSegment html={highlightGoHtml(line)} />;
  }

  const pieces = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.start > cursor) {
      pieces.push(
        <CodeSegment
          key={`text:${cursor}:${match.start}`}
          html={highlightGoHtml(line.slice(cursor, match.start))}
        />,
      );
    }

    pieces.push(
      <button
        key={match.function_id}
        type="button"
        className={`function-chip ${
          selectedFunctionId === match.function_id ? "function-chip--selected" : ""
        }`}
        onClick={() => onFunctionClick(match)}
      >
        {match.displayName || match.name}
      </button>,
    );
    cursor = match.end;
  }

  if (cursor < line.length) {
    pieces.push(
      <CodeSegment
        key={`text:${cursor}:end`}
        html={highlightGoHtml(line.slice(cursor))}
      />,
    );
  }

  return pieces;
}

function SourceViewer({
  content,
  functions,
  selectedFunctionId,
  selectedLine,
  onFunctionClick,
}) {
  const containerRef = useRef(null);
  const lineRefs = useRef(new Map());
  const lines = useMemo(() => content.split("\n"), [content]);
  const functionsByLine = useMemo(() => {
    const nextMap = new Map();

    for (const fn of functions) {
      const current = nextMap.get(fn.line) || [];
      current.push(fn);
      nextMap.set(fn.line, current);
    }

    return nextMap;
  }, [functions]);

  useLayoutEffect(() => {
    if (!containerRef.current || !selectedLine) {
      return;
    }

    const targetLine = lineRefs.current.get(selectedLine);
    if (!targetLine) {
      return;
    }

    const container = containerRef.current;
    const nextTop =
      targetLine.offsetTop - container.clientHeight / 2 + targetLine.clientHeight / 2;

    container.scrollTo({
      top: Math.max(nextTop, 0),
      behavior: "smooth",
    });
  }, [selectedLine, content]);

  return (
    <div ref={containerRef} className="source-viewer" aria-live="polite">
      {lines.map((line, index) => {
        const lineNumber = index + 1;
        const lineFunctions = functionsByLine.get(index + 1) || [];
        const isSelected = lineFunctions.some((fn) => fn.function_id === selectedFunctionId);

        return (
          <div
            key={lineNumber}
            ref={(element) => {
              if (element) {
                lineRefs.current.set(lineNumber, element);
              } else {
                lineRefs.current.delete(lineNumber);
              }
            }}
            className={`source-line ${isSelected ? "source-line--selected" : ""}`}
            data-line={lineNumber}
          >
            <span className="line-number">{lineNumber}</span>
            <code className="line-code">
              <FunctionLine
                line={line}
                functionsOnLine={lineFunctions}
                selectedFunctionId={selectedFunctionId}
                onFunctionClick={onFunctionClick}
              />
            </code>
          </div>
        );
      })}
    </div>
  );
}

function FileBrowser({
  currentPath,
  entries,
  isLoading,
  selectedFile,
  onDirectoryOpen,
  onFileOpen,
}) {
  const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <section className="panel browser-panel">
      <div className="browser-topbar">
        <div className="breadcrumbs">
          <button type="button" className="breadcrumb" onClick={() => onDirectoryOpen("")}>
            root
          </button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join("/");
            return (
              <React.Fragment key={path}>
                <span className="breadcrumb-separator">/</span>
                <button type="button" className="breadcrumb" onClick={() => onDirectoryOpen(path)}>
                  {segment}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onDirectoryOpen(getParentPath(currentPath))}
          disabled={!currentPath || isLoading}
        >
          Up
        </button>
      </div>

      <div className="browser-grid">
        {entries.map((entry) => {
          const isSelected = entry.type === "file" && entry.path === selectedFile;
          return (
            <button
              key={`${entry.type}:${entry.path}`}
              type="button"
              className={`browser-entry ${isSelected ? "browser-entry--selected" : ""}`}
              onClick={() => {
                if (entry.type === "directory") {
                  onDirectoryOpen(entry.path);
                } else {
                  onFileOpen(entry.path, { mode: "browse" });
                }
              }}
              disabled={isLoading}
            >
              <span className="browser-entry__icon">
                {entry.type === "directory" ? "dir" : "go"}
              </span>
              <span className="browser-entry__name">{entry.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GraphPanel({
  elements,
  graphView,
  selectedFunction,
  onNodeSelect,
  onGraphViewChange,
  onBack,
  isLoading,
  error,
}) {
  const containerRef = useRef(null);
  const [hoveredNode, setHoveredNode] = useState(null);

  useEffect(() => {
    if (!containerRef.current || !selectedFunction) {
      return undefined;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: {
        name: "cose",
        animate: true,
        animationDuration: 900,
        fit: true,
        padding: 40,
        nodeRepulsion: 18000,
        idealEdgeLength: 150,
        edgeElasticity: 120,
        gravity: 0.3,
        numIter: 1500,
        randomize: false,
      },
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "#5b6c91",
            color: "#ffffff",
            "font-size": 9,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 72,
            width: 44,
            height: 44,
            "border-width": 2,
            "border-color": "#dbe4ff",
            "text-outline-width": 0,
            "overlay-opacity": 0,
            "transition-property":
              "width height background-color border-color font-size text-max-width",
            "transition-duration": "220ms",
          },
        },
        {
          selector: "node.focus",
          style: {
            "background-color": "#f97316",
            color: "#ffffff",
            "border-color": "#ffedd5",
            width: 72,
            height: 72,
            "font-size": 10,
            "font-weight": 700,
            "text-max-width": 88,
          },
        },
        {
          selector: "node.caller",
          style: {
            "background-color": "#d97706",
            "border-color": "#fed7aa",
          },
        },
        {
          selector: "node.callee",
          style: {
            "background-color": "#2563eb",
            "border-color": "#bfdbfe",
          },
        },
        {
          selector: "node.transitive",
          style: {
            opacity: 0.88,
          },
        },
        {
          selector: "node.hovered",
          style: {
            width: 112,
            height: 112,
            "font-size": 12,
            "text-max-width": 110,
            "border-width": 3,
            "z-index": 999,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.8,
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "rgba(226, 232, 240, 0.35)",
            "target-arrow-color": "rgba(226, 232, 240, 0.35)",
            opacity: 0.75,
            "arrow-scale": 0.8,
          },
        },
        {
          selector: "edge.caller",
          style: {
            "line-color": "rgba(249, 115, 22, 0.6)",
            "target-arrow-color": "rgba(249, 115, 22, 0.6)",
          },
        },
        {
          selector: "edge.callee",
          style: {
            "line-color": "rgba(59, 130, 246, 0.58)",
            "target-arrow-color": "rgba(59, 130, 246, 0.58)",
          },
        },
        {
          selector: "edge.transitive",
          style: {
            "line-style": "dashed",
            width: 1.4,
            opacity: 0.42,
          },
        },
        {
          selector: ".dimmed",
          style: {
            opacity: 0.18,
          },
        },
      ],
    });

    const layout = cy.layout({
      name: "cose",
      animate: true,
      animationDuration: 900,
      fit: true,
      padding: 40,
      nodeRepulsion: 18000,
      idealEdgeLength: 150,
      edgeElasticity: 120,
      gravity: 0.3,
      numIter: 1500,
      randomize: false,
    });
    layout.run();

    const basePositions = new Map();
    const startFloating = () => {
      cy.nodes().forEach((node) => {
        basePositions.set(node.id(), { ...node.position() });
      });
    };

    cy.once("layoutstop", startFloating);

    const floatTimer = window.setInterval(() => {
      const now = Date.now();
      cy.nodes().forEach((node, index) => {
        if (node.hasClass("focus") || node.hasClass("hovered") || node.grabbed()) {
          return;
        }

        const base = basePositions.get(node.id());
        if (!base) {
          return;
        }

        const xOffset = Math.sin(now / 1200 + index * 0.85) * 10;
        const yOffset = Math.cos(now / 1500 + index * 0.65) * 8;
        node.animate(
          {
            position: {
              x: base.x + xOffset,
              y: base.y + yOffset,
            },
          },
          {
            duration: 1400,
            queue: false,
            easing: "ease-in-out",
          },
        );
      });
    }, 1500);

    cy.on("tap", "node", (event) => {
      const data = event.target.data();
      onNodeSelect({
        function_id: data.id,
        name: data.label,
        file: data.file,
        line: data.line,
        package: data.package,
      });
    });

    cy.on("mouseover", "node", (event) => {
      const node = event.target;
      cy.elements().addClass("dimmed");
      node.removeClass("dimmed").addClass("hovered");
      node.connectedEdges().removeClass("dimmed");
      node.neighborhood().removeClass("dimmed");
      setHoveredNode(node.data());
    });

    cy.on("mouseout", "node", (event) => {
      event.target.removeClass("hovered");
      cy.elements().removeClass("dimmed");
      setHoveredNode(null);
    });

    return () => {
      window.clearInterval(floatTimer);
      cy.destroy();
    };
  }, [elements, onNodeSelect, selectedFunction]);

  return (
    <section className="panel graph-panel">
      <div className="graph-topbar">
        <div className="graph-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            Back
          </button>
          <div className="view-switch">
            <button
              type="button"
              className={`view-switch__button ${
                graphView === "neighbors" ? "view-switch__button--active" : ""
              }`}
              onClick={() => onGraphViewChange("neighbors")}
            >
              Neighbors
            </button>
            <button
              type="button"
              className={`view-switch__button ${
                graphView === "deep" ? "view-switch__button--active" : ""
              }`}
              onClick={() => onGraphViewChange("deep")}
            >
              Deep
            </button>
          </div>
        </div>
        <div className="graph-meta">
          <span className="meta-pill">{selectedFunction?.name || "-"}</span>
          <span className="meta-pill meta-pill--muted">{selectedFunction?.package || "-"}</span>
          <span className="meta-pill meta-pill--muted">{elements.length} elements</span>
        </div>
      </div>
      {hoveredNode ? (
        <div className="graph-hover-card">
          <div className="graph-hover-card__title">{hoveredNode.label}</div>
          <div className="graph-hover-card__meta">{hoveredNode.package || "unknown package"}</div>
          <div className="graph-hover-card__meta">
            {hoveredNode.file ? `${hoveredNode.file}${hoveredNode.line ? `:${hoveredNode.line}` : ""}` : hoveredNode.id}
          </div>
        </div>
      ) : null}
      {error ? <div className="graph-empty">{error}</div> : null}
      {!error && isLoading ? <div className="graph-empty">Loading graph...</div> : null}
      {!error && !isLoading ? <div ref={containerRef} className="graph-canvas" /> : null}
    </section>
  );
}

function App() {
  const [mode, setMode] = useState("browse");
  const [selectedFile, setSelectedFile] = useState(DEFAULT_FILE);
  const [resolvedFile, setResolvedFile] = useState("No file loaded");
  const [packageName, setPackageName] = useState("-");
  const [content, setContent] = useState("");
  const [functions, setFunctions] = useState([]);
  const [browserPath, setBrowserPath] = useState("");
  const [browserEntries, setBrowserEntries] = useState([]);
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);
  const [isSourceLoading, setIsSourceLoading] = useState(false);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [graphError, setGraphError] = useState("");
  const [selectedFunction, setSelectedFunction] = useState(null);
  const [graphView, setGraphView] = useState("neighbors");
  const [graphData, setGraphData] = useState({
    neighborhood: [],
    callChain: [],
    callers: [],
  });
  const activeGraphData = useMemo(
    () => selectGraphData(graphData, graphView, selectedFunction),
    [graphData, graphView, selectedFunction],
  );

  const graphElements = useMemo(
    () => buildGraphElements(selectedFunction, activeGraphData),
    [activeGraphData, selectedFunction],
  );

  const loadDirectory = useCallback(async (path) => {
    setIsBrowserLoading(true);

    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const payload = await requestJson(`/call-graph/files${query}`);
      setBrowserEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setBrowserPath(payload.path || "");
    } finally {
      setIsBrowserLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file, options = {}) => {
    const trimmedFile = file.trim();
    if (!trimmedFile) {
      return;
    }

    setIsSourceLoading(true);
    setSourceError("");

    try {
      const [filePayload, functionsPayload] = await Promise.all([
        requestJson(`/call-graph/file?file=${encodeURIComponent(trimmedFile)}`),
        requestJson(`/call-graph/file-functions?file=${encodeURIComponent(trimmedFile)}`),
      ]);

      const nextResolvedFile = filePayload.fileResolved || filePayload.fileRequested || trimmedFile;
      setSelectedFile(nextResolvedFile);
      setResolvedFile(nextResolvedFile);
      setPackageName(filePayload.package || "-");
      setContent(filePayload.content || "");
      setFunctions(Array.isArray(functionsPayload.functions) ? functionsPayload.functions : []);

      if (options.mode) {
        setMode(options.mode);
      }

      if (options.clearGraph) {
        setSelectedFunction(null);
        setGraphView("neighbors");
        setGraphData({ neighborhood: [], callChain: [], callers: [] });
        setGraphError("");
      }
    } catch (error) {
      setContent("");
      setFunctions([]);
      setSourceError(String(error.message || error));
    } finally {
      setIsSourceLoading(false);
    }
  }, []);

  const loadFunctionSource = useCallback(async (functionMeta) => {
    setIsSourceLoading(true);
    setSourceError("");

    try {
      const sourcePayload = await requestJson(
        `/call-graph/source?functionId=${encodeURIComponent(functionMeta.function_id)}`,
      );
      const functionsPayload = await requestJson(
        `/call-graph/file-functions?file=${encodeURIComponent(sourcePayload.file)}`,
      );

      setSelectedFile(sourcePayload.file);
      setResolvedFile(sourcePayload.file);
      setPackageName(sourcePayload.package || "-");
      setContent(sourcePayload.content || "");
      setFunctions(Array.isArray(functionsPayload.functions) ? functionsPayload.functions : []);
      setSelectedFunction({
        function_id: sourcePayload.functionId || functionMeta.function_id,
        name: sourcePayload.name || functionMeta.name,
        file: sourcePayload.file || functionMeta.file,
        line: sourcePayload.line || functionMeta.line,
        package: sourcePayload.package || functionMeta.package,
      });
      await loadDirectory(getParentPath(sourcePayload.file));
    } catch (error) {
      setSourceError(String(error.message || error));
    } finally {
      setIsSourceLoading(false);
    }
  }, [loadDirectory]);

  const loadGraph = useCallback(async (functionMeta) => {
    setIsGraphLoading(true);
    setGraphError("");

    try {
      const [neighborhoodPayload, callChainPayload, callersPayload] = await Promise.all([
        requestJson(`/call-graph/neighborhood?functionId=${encodeURIComponent(functionMeta.function_id)}`),
        requestJson(`/call-graph/call-chain?functionId=${encodeURIComponent(functionMeta.function_id)}`),
        requestJson(`/call-graph/callers?functionId=${encodeURIComponent(functionMeta.function_id)}`),
      ]);
      setGraphData({
        neighborhood: Array.isArray(neighborhoodPayload.nodes) ? neighborhoodPayload.nodes : [],
        callChain: Array.isArray(callChainPayload.nodes)
          ? callChainPayload.nodes.filter((node) => Number(node.depth || 0) <= MAX_TRANSITIVE_DEPTH)
          : [],
        callers: Array.isArray(callersPayload.nodes)
          ? callersPayload.nodes.filter((node) => Number(node.depth || 0) <= MAX_TRANSITIVE_DEPTH)
          : [],
      });
    } catch (error) {
      setGraphData({ neighborhood: [], callChain: [], callers: [] });
      setGraphError(String(error.message || error));
    } finally {
      setIsGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory("");
    loadFile(DEFAULT_FILE, { mode: "browse", clearGraph: true });
  }, [loadDirectory, loadFile]);

  async function handleFunctionClick(functionMeta) {
    setSelectedFunction(functionMeta);
    setGraphView("neighbors");
    setMode("graph");
    await loadGraph(functionMeta);
  }

  async function handleGraphNodeSelect(functionMeta) {
    await Promise.all([loadFunctionSource(functionMeta), loadGraph(functionMeta)]);
  }

  function handleBackToBrowse() {
    setMode("browse");
    setSelectedFunction(null);
    setGraphView("neighbors");
    setGraphData({ neighborhood: [], callChain: [], callers: [] });
    setGraphError("");
  }

  return (
    <main className="app-shell">
      <FileBrowser
        currentPath={browserPath}
        entries={browserEntries}
        isLoading={isBrowserLoading || isSourceLoading}
        selectedFile={selectedFile}
        onDirectoryOpen={loadDirectory}
        onFileOpen={(file, options) => loadFile(file, { ...options, clearGraph: true })}
      />

      {mode === "browse" ? (
        <section className="panel source-panel source-panel--browse">
          <p className="section-label">Source</p>
          <div className="file-strip">
            <span className="meta-pill">{resolvedFile}</span>
            <span className="meta-pill meta-pill--muted">{packageName}</span>
          </div>
        {sourceError ? (
          <div className="empty-state">{sourceError}</div>
        ) : isSourceLoading ? (
          <div className="empty-state">Loading source...</div>
        ) : (
          <SourceViewer
            content={content}
            functions={functions}
            selectedFunctionId={selectedFunction?.function_id || null}
            selectedLine={selectedFunction?.line || null}
            onFunctionClick={handleFunctionClick}
          />
        )}
      </section>
      ) : (
        <section className="graph-mode">
          <GraphPanel
            elements={graphElements}
            graphView={graphView}
            selectedFunction={selectedFunction}
            onNodeSelect={handleGraphNodeSelect}
            onGraphViewChange={setGraphView}
            onBack={handleBackToBrowse}
            isLoading={isGraphLoading}
            error={graphError}
          />
          <section className="panel source-panel source-panel--graph">
            <p className="section-label">Source</p>
            <div className="file-strip">
              <span className="meta-pill">{resolvedFile}</span>
              <span className="meta-pill meta-pill--muted">{packageName}</span>
            </div>
            {sourceError ? (
              <div className="empty-state">{sourceError}</div>
            ) : isSourceLoading ? (
              <div className="empty-state">Loading source...</div>
            ) : (
              <SourceViewer
                content={content}
                functions={functions}
                selectedFunctionId={selectedFunction?.function_id || null}
                selectedLine={selectedFunction?.line || null}
                onFunctionClick={handleFunctionClick}
              />
            )}
          </section>
        </section>
      )}
    </main>
  );
}

export default App;
