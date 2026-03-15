# Mock Server

Raffel ships with a spec-driven mock server for OpenAPI 3.x and USD documents.

Use it when you want to:

- stand up HTTP mocks directly from an OpenAPI spec
- mirror the HTTP endpoints your Raffel server already documents
- generate realistic example payloads from schemas when examples are missing
- validate request bodies before the real service exists
- expose JSON-RPC or WebSocket mock procedures from the same USD document

---

## Why It Matters

The new 2026 DX flow in Raffel is:

1. build the server contract
2. inspect the runtime graph
3. generate OpenAPI/USD
4. spin up mocks from the same contract when needed
5. validate behavior with playground and contract checks

That gives teams one documentation and testing loop instead of separate
hand-written mock servers.

---

## Standalone Mock Server

```ts
import { createMockServer } from 'raffel'

const { server, routes } = await createMockServer({
  spec: './openapi.yaml',
  port: 4000,
})

console.log(`Mock server running with ${routes.length} routes`)
```

Accepted `spec` inputs:

- parsed OpenAPI or USD object
- raw JSON string
- file path when using `createMockServer(...)`

If you want to pre-parse YAML yourself, use the USD parser first and pass the
parsed document into the mock server.

---

## Mount Into An Existing Raffel Server

`createMockModule(...)` returns both an HTTP middleware and a router module.
That lets you mount mocked HTTP endpoints and optional RPC surfaces into an
existing Raffel server instead of starting a second process.

```ts
import { createServer, createMockModule } from 'raffel'

const mock = createMockModule(openapiDocument)

const server = createServer({
  port: 3000,
  http: { middleware: [mock.middleware] },
})

server.mount('', mock.module)

await server.start()
```

Use this pattern for:

- integration tests
- local "mixed" environments with some real modules and some mocked ones
- feature work before upstream services are ready

---

## OpenAPI And USD Integration

The easiest path is to generate the docs from a real Raffel server and feed the
result into the mock server.

```ts
import { createMockServer } from 'raffel'
import server from './src/server'

server.enableUSD({
  info: { title: 'Users API', version: '1.0.0' },
})

const openapi = server.getOpenAPIDocument()

if (!openapi) {
  throw new Error('OpenAPI document is not available')
}

const { server: mock } = await createMockServer({
  spec: openapi,
  port: 4100,
})
```

That means your mocked HTTP endpoints come from the same contract that powers:

- `/docs/openapi.json`
- `/docs/openapi.yaml`
- `/docs/usd.json`
- `/docs/usd.yaml`
- `raffel inspect`
- `raffel contract-tests`

If the documented endpoint is wrong, fix the runtime graph or the server
contract first. Do not fork the mock spec manually unless you intentionally need
different behavior.

---

## How Responses Are Chosen

For each HTTP operation, Raffel resolves the mock response in this order:

1. `content[application/json].example`
2. first named example under `examples`
3. `schema.example`
4. generated fake data from the response schema

For successful responses, the resolver prefers:

1. `200`
2. `201`
3. `204`
4. first `2xx`

OpenAPI path templates are converted automatically:

```text
/users/{userId}/posts/{postId}
-> /users/:userId/posts/:postId
```

---

## Request Validation

Request body validation is enabled by default.

```ts
const { server } = await createMockServer({
  spec: './openapi.yaml',
  port: 4000,
  validateRequests: true,
})
```

When a request body is required or fails schema validation, the mock server
returns Raffel's standard error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body validation failed"
  }
}
```

You can disable validation when you want looser local testing:

```ts
await createMockServer({
  spec: './openapi.yaml',
  port: 4000,
  validateRequests: false,
})
```

---

## Echo Semantics For Mutations

For `POST`, `PUT`, and `PATCH`, Raffel merges the incoming request body over the
mock response template when possible.

That gives mutation endpoints more realistic behavior:

- example/template response provides stable fields such as generated IDs
- request body overrides matching fields such as `name` or `status`

If no response body template exists, the mock server can echo the request body
back directly.

---

## USD Multi-Protocol Mocking

If the source document is USD, you can also expose non-HTTP mock surfaces.

```ts
await createMockServer({
  spec: './service.usd.yaml',
  port: 4000,
  protocols: {
    ws: true,
    jsonrpc: true,
  },
})
```

Current support:

- HTTP routes from OpenAPI `paths`
- JSON-RPC methods from `x-usd.jsonrpc.methods`
- WebSocket and JSON-RPC transport enablement through the same mock server

Use this when a frontend or SDK team needs protocol-shaped mocks before the real
implementation is finished.

---

## Inspection And Debugging

The mock server returns extracted route metadata as `routes`, which is useful
for test assertions and local inspection.

```ts
const { routes } = await createMockServer({ spec, port: 4000 })

console.log(routes.map((route) => ({
  method: route.method,
  path: route.pathPattern,
  operationId: route.operationId,
})))
```

For lower-level use cases, Raffel also exports:

- `extractRoutes(...)`
- `resolveResponse(...)`
- `toExpressPath(...)`
- `generateFromSchema(...)`
- `resetFakeDataCounter()`

---

## Recommended Workflow

Use the mock server as part of the same dev loop as the rest of Raffel:

```bash
raffel inspect src/server.ts
raffel doctor src/server.ts --fail-on warning
raffel contract-tests src/server.ts
```

Then generate or fetch the OpenAPI/USD document and start mocks for downstream
teams or local integration tests.

The important principle is consistency:

- one server contract
- one inspection graph
- one documentation surface
- optional mocks derived from the same source

---

## CLI

The fastest way to start a mock server is the `raffel mock` command.

### From an OpenAPI spec (local file)

```bash
raffel mock petstore.yaml
raffel mock openapi.json -p 4000
```

### From a remote URL

```bash
raffel mock https://petstore3.swagger.io/api/v3/openapi.json
raffel mock https://raw.githubusercontent.com/org/repo/main/openapi.yaml -p 4000
```

### From a JSON data file (json-server mode)

When the file contains plain JSON with array values (no `openapi`/`paths` keys),
Raffel starts a full CRUD json-server instead:

```bash
raffel mock db.json
```

Where `db.json` looks like:

```json
{
  "posts": [
    { "id": 1, "title": "Hello World" }
  ],
  "users": [
    { "id": 1, "name": "Alice" }
  ]
}
```

This gives you:

- `GET /posts` — list with `?_sort=title&_order=desc&_page=1&_limit=10&_q=text`
- `GET /posts/:id` — get by id
- `POST /posts` — create
- `PUT /posts/:id` — replace
- `PATCH /posts/:id` — update
- `DELETE /posts/:id` — delete
- WebSocket procedures: `posts.list`, `posts.get`, `posts.$watch` (real-time stream)

### CLI Options

```
raffel mock <source> [options]

Options:
  -p, --port <port>       Server port (default: 3000)
  --host <host>           Bind address (default: 0.0.0.0)
  -d, --delay <ms>        Simulate network latency
  --readonly              Disable write operations (data mode only)
  --no-validate           Skip request body validation (spec mode only)
  --ws                    Enable WebSocket protocol
  --jsonrpc               Enable JSON-RPC on /rpc
  --id-key <field>        Record ID field name (default: id, data mode only)
  -w, --watch             Watch file for changes and auto-reload
```

### Auto-Detection

The source type is detected automatically:

| Content | Mode |
|---------|------|
| Has `openapi`, `swagger`, or `paths` key | OpenAPI spec → mock responses |
| Has `operations` key | USD document → multi-protocol mock |
| Object with array values | JSON data → CRUD json-server |
| URL (`http://` or `https://`) | Remote fetch → spec mode |

### Examples

```bash
# OpenAPI mock with simulated latency
raffel mock api.yaml --delay 200

# Read-only JSON server with WebSocket + JSON-RPC
raffel mock db.json --readonly --ws --jsonrpc

# Custom ID field
raffel mock db.json --id-key _id

# Watch for file changes
raffel mock db.json --watch

# Remote spec
raffel mock https://api.example.com/v3/openapi.json -p 4000
```
