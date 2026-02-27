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

function SourceViewer({ content }) {
  const lines = useMemo(() => content.split("\n"), [content]);

  return (
    <div className="source-viewer" aria-live="polite">
      {lines.map((line, index) => (
        <div key={index + 1} className="source-line" data-line={index + 1}>
          <span className="line-number">{index + 1}</span>
          <code
            className="line-code"
            dangerouslySetInnerHTML={{ __html: highlightGoLine(line) || "&nbsp;" }}
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
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const loadFile = useCallback(async (file) => {
    const trimmedFile = file.trim();
    if (!trimmedFile) {
      setError("Enter a file path to load.");
      setContent("");
      setResolvedFile("No file loaded");
      setPackageName("-");
      setStatus("Error");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus("Loading...");

    try {
      const response = await fetch(
        `${API_BASE}/call-graph/file?file=${encodeURIComponent(trimmedFile)}`,
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${text}`);
      }

      const payload = await response.json();
      const nextContent = payload.content || "";

      setContent(nextContent);
      setResolvedFile(payload.fileResolved || payload.fileRequested || trimmedFile);
      setPackageName(payload.package || "-");
      setStatus(`${nextContent.split("\n").length} lines`);
    } catch (loadError) {
      setContent("");
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
        {error ? <div className="empty-state">{error}</div> : <SourceViewer content={content} />}
      </section>
    </main>
  );
}

export default App;
