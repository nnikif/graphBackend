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

function App() {
  const [fileInput, setFileInput] = useState(DEFAULT_FILE);
  const [resolvedFile, setResolvedFile] = useState("No file loaded");
  const [packageName, setPackageName] = useState("-");
  const [status, setStatus] = useState("Ready");
  const [content, setContent] = useState("");
  const [functions, setFunctions] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
    loadFile(DEFAULT_FILE);
  }, [loadFile]);

  function handleSubmit(event) {
    event.preventDefault();
    loadFile(fileInput);
  }

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

      <section className="panel">
        <form className="row" onSubmit={handleSubmit}>
          <label className="field">
            <span>Source file</span>
            <input
              type="text"
              value={fileInput}
              onChange={(event) => setFileInput(event.target.value)}
              placeholder="e.g. prometheus/web/api/v1/openapi_examples.go"
            />
          </label>
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Loading..." : "Load File"}
          </button>
        </form>
        <p className="hint">Uses <code>GET /call-graph/file?file=&lt;path&gt;</code></p>
      </section>

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
          <p className="status">{status}</p>
        </div>
        {error ? (
          <div className="empty-state">{error}</div>
        ) : (
          <SourceViewer content={content} functions={functions} />
        )}
      </section>
    </main>
  );
}

export default App;
