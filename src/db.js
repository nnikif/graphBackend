const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function resolveDbPath(inputPath) {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

function createDbClient(dbPathFromEnv) {
  if (!dbPathFromEnv) {
    return {
      configured: false,
      dbPath: null,
      ping: () => ({ ok: false, reason: "SQLITE_PATH is not configured" }),
      listQueries: () => [],
      close: () => {},
    };
  }

  const dbPath = resolveDbPath(dbPathFromEnv);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database file does not exist: ${dbPath}`);
  }

  const connection = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  const pingStatement = connection.prepare("SELECT 1 AS ok");
  const tableCountStatement = connection.prepare(`
    SELECT COUNT(*) AS count
    FROM sqlite_master
    WHERE type = 'table'
  `);
  const listQueriesStatement = connection.prepare(`
    SELECT name, description
    FROM queries
    ORDER BY name
  `);
  const listQueriesWithSqlStatement = connection.prepare(`
    SELECT name, description, sql
    FROM queries
    ORDER BY name
  `);

  return {
    configured: true,
    dbPath,
    ping: () => {
      const pingRow = pingStatement.get();
      const tableCountRow = tableCountStatement.get();

      return {
        ok: pingRow.ok === 1,
        tableCount: tableCountRow.count,
      };
    },
    listQueries: (includeSql = false) => {
      return includeSql
        ? listQueriesWithSqlStatement.all()
        : listQueriesStatement.all();
    },
    close: () => {
      connection.close();
    },
  };
}

module.exports = {
  createDbClient,
};
