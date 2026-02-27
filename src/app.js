const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const sensible = require("@fastify/sensible");
const { createDbClient } = require("./db");

const CALL_GRAPH_QUERY_NAMES = {
  neighborhood: "function_neighborhood",
  callChain: "call_chain",
  callers: "callers_of",
  pathfinder: "call_chain_pathfinder",
  symbolSearch: "symbol_search",
};

function requireStringQueryParam(request, app, name) {
  const value = request.query && request.query[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw app.httpErrors.badRequest(`Query parameter "${name}" is required`);
  }
  return value.trim();
}

function ensureDbConfigured(app) {
  if (!app.db.configured) {
    throw app.httpErrors.serviceUnavailable("SQLite database is not configured");
  }
}

async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: true,
  });
  await app.register(sensible);

  const db = createDbClient(process.env.SQLITE_PATH || "../cp_graph.db");
  app.decorate("db", db);
  app.addHook("onClose", async () => {
    app.db.close();
  });

  app.get("/health", async () => {
    const dbStatus = app.db.ping();

    return {
      status: dbStatus.ok || !app.db.configured ? "ok" : "degraded",
      service: "fastbackend",
      dbConfigured: app.db.configured,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/health/db", async () => {
    const dbStatus = app.db.ping();

    return {
      status: dbStatus.ok ? "ok" : "unavailable",
      configured: app.db.configured,
      dbPath: app.db.dbPath,
      ...dbStatus,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/queries", async (request) => {
    ensureDbConfigured(app);

    const includeSql =
      request.query && String(request.query.includeSql).toLowerCase() === "true";
    const queries = app.db.listQueries(includeSql);

    return {
      count: queries.length,
      includeSql,
      queries,
    };
  });

  app.get("/call-graph/search", async (request) => {
    ensureDbConfigured(app);

    const q = requireStringQueryParam(request, app, "q");
    const requestedLimit = Number(request.query && request.query.limit);
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 25;

    const rows = app.db.runQueryByName(CALL_GRAPH_QUERY_NAMES.symbolSearch, {
      pattern: `%${q}%`,
    });
    const functions = rows.filter((row) => row.kind === "function").slice(0, limit);

    return {
      query: q,
      count: functions.length,
      functions,
    };
  });

  app.get("/call-graph/function-detail", async (request) => {
    ensureDbConfigured(app);

    const functionId = requireStringQueryParam(request, app, "functionId");
    const detail = app.db.getFunctionDetail(functionId);

    if (!detail) {
      throw app.httpErrors.notFound(`Function not found: ${functionId}`);
    }

    return detail;
  });

  app.get("/call-graph/source", async (request) => {
    ensureDbConfigured(app);

    const functionId = requireStringQueryParam(request, app, "functionId");
    const detail = app.db.getFunctionDetail(functionId);

    if (!detail) {
      throw app.httpErrors.notFound(`Function not found: ${functionId}`);
    }

    const source = app.db.getSourceByFile(detail.file);
    if (!source) {
      throw app.httpErrors.notFound(`Source file not found: ${detail.file}`);
    }

    return {
      functionId: detail.function_id,
      name: detail.name,
      file: detail.file,
      package: detail.package,
      line: detail.line,
      endLine: detail.end_line,
      content: source.content,
    };
  });

  app.get("/call-graph/neighborhood", async (request) => {
    ensureDbConfigured(app);

    const functionId = requireStringQueryParam(request, app, "functionId");
    const nodes = app.db.runQueryByName(CALL_GRAPH_QUERY_NAMES.neighborhood, {
      function_id: functionId,
    });

    return {
      functionId,
      count: nodes.length,
      nodes,
    };
  });

  app.get("/call-graph/call-chain", async (request) => {
    ensureDbConfigured(app);

    const functionId = requireStringQueryParam(request, app, "functionId");
    const nodes = app.db.runQueryByName(CALL_GRAPH_QUERY_NAMES.callChain, {
      function_id: functionId,
    });

    return {
      functionId,
      count: nodes.length,
      nodes,
    };
  });

  app.get("/call-graph/callers", async (request) => {
    ensureDbConfigured(app);

    const functionId = requireStringQueryParam(request, app, "functionId");
    const nodes = app.db.runQueryByName(CALL_GRAPH_QUERY_NAMES.callers, {
      function_id: functionId,
    });

    return {
      functionId,
      count: nodes.length,
      nodes,
    };
  });

  app.get("/call-graph/path", async (request) => {
    ensureDbConfigured(app);

    const startFunctionId = requireStringQueryParam(request, app, "startFunctionId");
    const endFunctionId = requireStringQueryParam(request, app, "endFunctionId");
    const paths = app.db.runQueryByName(CALL_GRAPH_QUERY_NAMES.pathfinder, {
      start: startFunctionId,
      end: endFunctionId,
    });

    return {
      startFunctionId,
      endFunctionId,
      count: paths.length,
      paths,
    };
  });

  app.get("/", async () => {
    return {
      name: "CallGraphExplorer Fastify backend",
      endpoints: [
        "/health",
        "/health/db",
        "/queries",
        "/call-graph/search?q=<query>",
        "/call-graph/function-detail?functionId=<id>",
        "/call-graph/source?functionId=<id>",
        "/call-graph/neighborhood?functionId=<id>",
        "/call-graph/call-chain?functionId=<id>",
        "/call-graph/callers?functionId=<id>",
        "/call-graph/path?startFunctionId=<id>&endFunctionId=<id>",
      ],
    };
  });

  return app;
}

module.exports = {
  buildApp,
};
