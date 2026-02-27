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
      runQueryByName: () => [],
      getFunctionDetail: () => null,
      getSourceByFile: () => null,
      resolveSourceFilePath: () => null,
      listFunctionsByFile: () => [],
      listSourceFiles: () => [],
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
  const getQuerySqlStatement = connection.prepare(`
    SELECT sql
    FROM queries
    WHERE name = ?
  `);
  const getFunctionDetailStatement = connection.prepare(`
    SELECT *
    FROM dashboard_function_detail
    WHERE function_id = ?
  `);
  const getSourceByFileStatement = connection.prepare(`
    SELECT file, package, content
    FROM sources
    WHERE file = ?
  `);
  const sourceFileExistsStatement = connection.prepare(`
    SELECT file
    FROM sources
    WHERE file = ?
    LIMIT 1
  `);
  const findSourceFilesBySuffixStatement = connection.prepare(`
    SELECT file
    FROM sources
    WHERE file LIKE ?
    LIMIT 2
  `);
  const listFunctionsByFileStatement = connection.prepare(`
    SELECT
      id AS function_id,
      name,
      package,
      file,
      line,
      end_line,
      parent_function
    FROM nodes
    WHERE kind = 'function'
      AND file = ?
    ORDER BY line, col, name
  `);
  const listSourceFilesStatement = connection.prepare(`
    SELECT file, package
    FROM sources
    ORDER BY file
  `);

  const preparedQueryStatements = new Map();
  let sourceFilesCache = null;

  function normalizeFilePath(filePath) {
    return String(filePath || "").trim().replace(/\\/g, "/");
  }

  function resolveSourceFilePath(filePath) {
    const normalized = normalizeFilePath(filePath);
    if (!normalized) {
      return null;
    }

    const candidates = [
      normalized,
      normalized.replace(/^\.\//, ""),
      normalized.replace(/^\/+/, ""),
    ];

    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);

      const row = sourceFileExistsStatement.get(candidate);
      if (row && row.file) {
        return row.file;
      }
    }

    const parts = normalized.split("/").filter(Boolean);
    for (let start = 0; start < parts.length; start += 1) {
      const suffix = parts.slice(start).join("/");
      if (suffix.length < 8) {
        continue;
      }

      const matches = findSourceFilesBySuffixStatement.all(`%${suffix}`);
      if (matches.length === 1) {
        return matches[0].file;
      }
    }

    return null;
  }

  function getPreparedQueryByName(queryName) {
    if (!preparedQueryStatements.has(queryName)) {
      const row = getQuerySqlStatement.get(queryName);
      if (!row || !row.sql) {
        return null;
      }
      preparedQueryStatements.set(queryName, connection.prepare(row.sql));
    }

    return preparedQueryStatements.get(queryName);
  }

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
    runQueryByName: (queryName, params = {}) => {
      const statement = getPreparedQueryByName(queryName);
      if (!statement) {
        throw new Error(`Unknown query: ${queryName}`);
      }
      return statement.all(params);
    },
    getFunctionDetail: (functionId) => {
      return getFunctionDetailStatement.get(functionId) || null;
    },
    getSourceByFile: (filePath) => {
      return getSourceByFileStatement.get(filePath) || null;
    },
    resolveSourceFilePath: (filePath) => {
      return resolveSourceFilePath(filePath);
    },
    listFunctionsByFile: (filePath) => {
      const resolvedFilePath = resolveSourceFilePath(filePath);
      if (!resolvedFilePath) {
        return [];
      }
      return listFunctionsByFileStatement.all(resolvedFilePath);
    },
    listSourceFiles: () => {
      if (!sourceFilesCache) {
        sourceFilesCache = listSourceFilesStatement.all();
      }
      return sourceFilesCache;
    },
    close: () => {
      connection.close();
    },
  };
}

module.exports = {
  createDbClient,
};
