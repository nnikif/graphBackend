import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";

const DEFAULT_FILE = "prometheus/web/api/v1/openapi_examples.go";
const API_BASE =
  window.location.hostname === "localhost" ? "http://localhost:3000" : "http://backend:3000";

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

function findFunctionMatches(line, functionsOnLine) {
  if (!functionsOnLine || functionsOnLine.length === 0) {
    return [];
  }

  return functionsOnLine
    .map((fn) => {
      const start = line.indexOf(fn.name);
      if (start === -1) {
        return null;
      }

      return {
        ...fn,
        start,
        end: start + fn.name.length,
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

function buildGraphElements(selectedFunction, graphNodes) {
  if (!selectedFunction) {
    return [];
  }

  const nodeMap = new Map();
  const edgeList = [];

  nodeMap.set(selectedFunction.function_id, {
    data: {
      id: selectedFunction.function_id,
      label: selectedFunction.name,
      file: selectedFunction.file,
      line: selectedFunction.line,
      package: selectedFunction.package,
    },
    classes: "focus",
  });

  for (const node of graphNodes) {
    nodeMap.set(node.id, {
      data: {
        id: node.id,
        label: node.name,
        file: node.file,
        line: node.line,
        package: node.package,
      },
      classes: node.direction,
    });

    edgeList.push({
      data: {
        id: `${selectedFunction.function_id}:${node.direction}:${node.id}`,
        source: node.direction === "caller" ? node.id : selectedFunction.function_id,
        target: node.direction === "caller" ? selectedFunction.function_id : node.id,
      },
      classes: node.direction,
    });
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
        {match.name}
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
  onFunctionClick,
}) {
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

  return (
    <div className="source-viewer" aria-live="polite">
      {lines.map((line, index) => {
        const lineFunctions = functionsByLine.get(index + 1) || [];
        const isSelected = lineFunctions.some((fn) => fn.function_id === selectedFunctionId);

        return (
          <div
            key={index + 1}
            className={`source-line ${isSelected ? "source-line--selected" : ""}`}
            data-line={index + 1}
          >
            <span className="line-number">{index + 1}</span>
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
  selectedFunction,
  onNodeSelect,
  onBack,
  isLoading,
  error,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !selectedFunction) {
      return undefined;
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      layout: {
        name: "breadthfirst",
        directed: true,
        padding: 30,
        spacingFactor: 1.2,
      },
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "background-color": "#d6d3c9",
            color: "#101828",
            "font-size": 11,
            "text-valign": "center",
            "text-halign": "center",
            "text-wrap": "wrap",
            "text-max-width": 90,
            width: 52,
            height: 52,
            "border-width": 2,
            "border-color": "#63574a",
          },
        },
        {
          selector: "node.focus",
          style: {
            "background-color": "#0f766e",
            color: "#f8fafc",
            "border-color": "#134e4a",
            width: 68,
            height: 68,
            "font-size": 12,
            "font-weight": 700,
          },
        },
        {
          selector: "node.caller",
          style: {
            "background-color": "#fde68a",
            "border-color": "#d97706",
          },
        },
        {
          selector: "node.callee",
          style: {
            "background-color": "#bfdbfe",
            "border-color": "#2563eb",
          },
        },
        {
          selector: "edge",
          style: {
            width: 2.4,
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "#6b7280",
            "target-arrow-color": "#6b7280",
          },
        },
        {
          selector: "edge.caller",
          style: {
            "line-color": "#d97706",
            "target-arrow-color": "#d97706",
          },
        },
        {
          selector: "edge.callee",
          style: {
            "line-color": "#2563eb",
            "target-arrow-color": "#2563eb",
          },
        },
      ],
    });

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

    return () => {
      cy.destroy();
    };
  }, [elements, onNodeSelect, selectedFunction]);

  return (
    <section className="panel graph-panel">
      <div className="graph-topbar">
        <button type="button" className="ghost-button" onClick={onBack}>
          Back
        </button>
        <div className="graph-meta">
          <span className="meta-pill">{selectedFunction?.name || "-"}</span>
          <span className="meta-pill meta-pill--muted">{selectedFunction?.package || "-"}</span>
        </div>
      </div>
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
  const [graphNodes, setGraphNodes] = useState([]);

  const graphElements = useMemo(
    () => buildGraphElements(selectedFunction, graphNodes),
    [graphNodes, selectedFunction],
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
        setGraphNodes([]);
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
      const payload = await requestJson(
        `/call-graph/neighborhood?functionId=${encodeURIComponent(functionMeta.function_id)}`,
      );
      setGraphNodes(Array.isArray(payload.nodes) ? payload.nodes : []);
    } catch (error) {
      setGraphNodes([]);
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
    setMode("graph");
    await loadGraph(functionMeta);
  }

  async function handleGraphNodeSelect(functionMeta) {
    setSelectedFunction(functionMeta);
    await Promise.all([loadFunctionSource(functionMeta), loadGraph(functionMeta)]);
  }

  function handleBackToBrowse() {
    setMode("browse");
    setSelectedFunction(null);
    setGraphNodes([]);
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
              onFunctionClick={handleFunctionClick}
            />
          )}
        </section>
      ) : (
        <section className="graph-mode">
          <GraphPanel
            elements={graphElements}
            selectedFunction={selectedFunction}
            onNodeSelect={handleGraphNodeSelect}
            onBack={handleBackToBrowse}
            isLoading={isGraphLoading}
            error={graphError}
          />
          <section className="panel source-panel source-panel--graph">
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
