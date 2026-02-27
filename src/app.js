const Fastify = require("fastify");
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const sensible = require("@fastify/sensible");
const { createDbClient } = require("./db");

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
    if (!app.db.configured) {
      throw app.httpErrors.serviceUnavailable("SQLite database is not configured");
    }

    const includeSql =
      request.query && String(request.query.includeSql).toLowerCase() === "true";
    const queries = app.db.listQueries(includeSql);

    return {
      count: queries.length,
      includeSql,
      queries,
    };
  });

  app.get("/", async () => {
    return {
      name: "CallGraphExplorer Fastify backend",
      endpoints: ["/health", "/health/db", "/queries"],
    };
  });

  return app;
}

module.exports = {
  buildApp,
};
