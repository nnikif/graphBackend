# CallGraphExplorer Backend API

Base URL: `http://localhost:3000`

All endpoints are `GET`.

## Health

### `GET /health`
Service health summary.

### `GET /health/db`
Database health details.

## Metadata

### `GET /queries?includeSql=<true|false>`
List built-in SQL queries from the CPG database.

Query params:
- `includeSql` (optional): `true` to include SQL text.

## File Browser and Source

### `GET /call-graph/files?path=<directory>`
List entries in a directory from the in-memory source-file index.

Query params:
- `path` (optional): directory path, e.g. `adapter/pkg`.

Response fields:
- `path`
- `count`
- `entries[]`: `{ type: "directory"|"file", name, path, package? }`

### `GET /call-graph/file?file=<path>`
Return full source text for a file.

Query params:
- `file` (required): relative DB path, `./...`, or absolute path.

Response fields:
- `fileRequested`
- `fileResolved`
- `package`
- `content`

### `GET /call-graph/file-functions?file=<path>`
List function nodes in a file, including CPG function IDs.

Query params:
- `file` (required): relative DB path, `./...`, or absolute path.

Response fields:
- `fileRequested`
- `fileResolved`
- `count`
- `functions[]`: `{ function_id, name, package, file, line, end_line, parent_function }`

## Function Lookup

### `GET /call-graph/search?q=<text>&limit=<1..50>`
Search symbols and return functions only.

Query params:
- `q` (required): search text.
- `limit` (optional): defaults to `25`, clamped to `1..50`.

### `GET /call-graph/function-detail?functionId=<id>`
Return function details from `dashboard_function_detail`.

Query params:
- `functionId` (required): exact CPG function ID.

### `GET /call-graph/source?functionId=<id>`
Return source content and source location for a function.

Query params:
- `functionId` (required): exact CPG function ID.

## Call Graph Traversal

### `GET /call-graph/neighborhood?functionId=<id>`
Direct callers/callees for a function (`function_neighborhood`).

### `GET /call-graph/call-chain?functionId=<id>`
Transitive downstream call chain (`call_chain`).

### `GET /call-graph/callers?functionId=<id>`
Transitive upstream callers (`callers_of`).

For all three endpoints:
- Query params:
  - `functionId` (required): exact CPG function ID.
- Response fields:
  - `functionId`
  - `count`
  - `nodes[]`

### `GET /call-graph/path?startFunctionId=<id>&endFunctionId=<id>`
Call paths between two functions (`call_chain_pathfinder`).

Query params:
- `startFunctionId` (required)
- `endFunctionId` (required)

Response fields:
- `startFunctionId`
- `endFunctionId`
- `count`
- `paths[]`

## Error Semantics

- `400` for missing required query params.
- `404` for unknown file/function/directory.
- `503` when SQLite database is not configured.
