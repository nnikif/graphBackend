import React, { useCallback, useEffect, useMemo, useState } from "react";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightGoLine(line) {
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

function buildFunctionMarkup(line, functionsOnLine) {
  if (!functionsOnLine || functionsOnLine.length === 0) {
    return highlightGoLine(line);
  }

  let cursor = 0;
  let html = "";
  const matches = functionsOnLine
    .map((fn) => {
      const start = line.indexOf(fn.name);
      if (start === -1) {
        return null;
      }

      return {
        name: fn.name,
        start,
        end: start + fn.name.length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);

  if (matches.length === 0) {
    return highlightGoLine(line);
  }

  for (const match of matches) {
    if (match.start < cursor) {
      continue;
    }

    html += highlightGoLine(line.slice(cursor, match.start));
    html += `<span class="tok-function-name">${escapeHtml(match.name)}</span>`;
    cursor = match.end;
  }

  html += highlightGoLine(line.slice(cursor));
  return html;
}

function SourceViewer({ content, functions }) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const functionsByLine = useMemo(() => {
    const nextMap = new Map();

    for (const fn of functions) {
      const lineFunctions = nextMap.get(fn.line) || [];
      lineFunctions.push(fn);
      nextMap.set(fn.line, lineFunctions);
    }

    return nextMap;
  }, [functions]);

  return (
    <div className="source-viewer" aria-live="polite">
      {lines.map((line, index) => (
        <div key={index + 1} className="source-line" data-line={index + 1}>
          <span className="line-number">{index + 1}</span>
          <code
            className="line-code"
            dangerouslySetInnerHTML={{
              __html: buildFunctionMarkup(line, functionsByLine.get(index + 1)) || "&nbsp;",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function getParentPath(path) {
  if (!path) {
    return "";
  }

  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

function FileBrowser({
  currentPath,
  entries,
  browserError,
  isBrowserLoading,
  selectedFile,
  onDirectoryOpen,
  onFileOpen,
}) {
  const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <section className="panel browser-panel">
      <div className="browser-toolbar">
        <div>
          <p className="eyebrow eyebrow--panel">Files</p>
          <h2>Source Browser</h2>
        </div>
        <button
          type="button"
          className="ghost-button"
          onClick={() => onDirectoryOpen(getParentPath(currentPath))}
          disabled={!currentPath || isBrowserLoading}
        >
          Up
        </button>
      </div>

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

      {browserError ? <div className="browser-empty">{browserError}</div> : null}
      {!browserError && entries.length === 0 && !isBrowserLoading ? (
        <div className="browser-empty">No entries in this directory.</div>
      ) : null}

      <div className="browser-list">
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
                  onFileOpen(entry.path);
                }
              }}
              disabled={isBrowserLoading}
            >
              <span className="browser-entry__icon">
                {entry.type === "directory" ? "dir" : "go"}
              </span>
              <span className="browser-entry__text">
                <span className="browser-entry__name">{entry.name}</span>
                <span className="browser-entry__path">{entry.path}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function App() {
  const [selectedFile, setSelectedFile] = useState(DEFAULT_FILE);
  const [resolvedFile, setResolvedFile] = useState("No file loaded");
  const [packageName, setPackageName] = useState("-");
  const [status, setStatus] = useState("Ready");
  const [content, setContent] = useState("");
  const [functions, setFunctions] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [browserPath, setBrowserPath] = useState(getParentPath(DEFAULT_FILE));
  const [browserEntries, setBrowserEntries] = useState([]);
  const [browserError, setBrowserError] = useState("");
  const [isBrowserLoading, setIsBrowserLoading] = useState(false);

  const loadDirectory = useCallback(async (path) => {
    setIsBrowserLoading(true);
    setBrowserError("");

    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(`${API_BASE}/call-graph/files${query}`);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }

      const payload = await response.json();
      setBrowserEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setBrowserPath(payload.path || "");
    } catch (loadError) {
      setBrowserEntries([]);
      setBrowserError(String(loadError.message || loadError));
    } finally {
      setIsBrowserLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (file) => {
    const trimmedFile = file.trim();
    if (!trimmedFile) {
      setError("Enter a file path to load.");
      setContent("");
      setFunctions([]);
      setResolvedFile("No file loaded");
      setPackageName("-");
      setStatus("Error");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus("Loading...");

    try {
      const [fileResponse, functionsResponse] = await Promise.all([
        fetch(`${API_BASE}/call-graph/file?file=${encodeURIComponent(trimmedFile)}`),
        fetch(`${API_BASE}/call-graph/file-functions?file=${encodeURIComponent(trimmedFile)}`),
      ]);

      if (!fileResponse.ok) {
        const text = await fileResponse.text();
        throw new Error(`${fileResponse.status} ${fileResponse.statusText}: ${text}`);
      }

      if (!functionsResponse.ok) {
        const text = await functionsResponse.text();
        throw new Error(`${functionsResponse.status} ${functionsResponse.statusText}: ${text}`);
      }

      const [filePayload, functionsPayload] = await Promise.all([
        fileResponse.json(),
        functionsResponse.json(),
      ]);
      const nextContent = filePayload.content || "";

      setContent(nextContent);
      setFunctions(Array.isArray(functionsPayload.functions) ? functionsPayload.functions : []);
      setSelectedFile(filePayload.fileResolved || filePayload.fileRequested || trimmedFile);
      setResolvedFile(filePayload.fileResolved || filePayload.fileRequested || trimmedFile);
      setPackageName(filePayload.package || "-");
      setStatus(
        `${nextContent.split("\n").length} lines, ${
          Array.isArray(functionsPayload.functions) ? functionsPayload.functions.length : 0
        } functions`,
      );
    } catch (loadError) {
      setContent("");
      setFunctions([]);
      setResolvedFile("Load failed");
      setPackageName("-");
      setError(String(loadError.message || loadError));
      setStatus("Error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(getParentPath(DEFAULT_FILE));
  }, [loadDirectory]);

  useEffect(() => {
    loadFile(DEFAULT_FILE);
  }, [loadFile]);

  return (
    <main className="container">
      <header className="hero">
        <div>
          <p className="eyebrow">CallGraphExplorer</p>
          <h1>Go Source Viewer</h1>
          <p className="subtitle">
            Render a source file from the backend with line numbers and syntax highlighting.
          </p>
        </div>
      </header>

      <div className="workspace">
        <FileBrowser
          currentPath={browserPath}
          entries={browserEntries}
          browserError={browserError}
          isBrowserLoading={isBrowserLoading}
          selectedFile={selectedFile}
          onDirectoryOpen={loadDirectory}
          onFileOpen={loadFile}
        />

        <div className="viewer-column">
          <section className="panel panel--meta">
            <div>
              <p className="meta-label">Resolved file</p>
              <p className="meta-value">{resolvedFile}</p>
            </div>
            <div>
              <p className="meta-label">Package</p>
              <p className="meta-value">{packageName}</p>
            </div>
          </section>

          <section className="panel">
            <div className="viewer-toolbar">
              <h2>Source</h2>
              <p className="status">{isLoading ? "Loading..." : status}</p>
            </div>
            <p className="hint">
              Uses <code>GET /call-graph/file</code> and <code>GET /call-graph/file-functions</code>
            </p>
            {error ? (
              <div className="empty-state">{error}</div>
            ) : (
              <SourceViewer content={content} functions={functions} />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default App;
