# JSON-RPC 2.0 Adapter

Implements the [JSON-RPC 2.0 specification](https://www.jsonrpc.org/specification) over HTTP.
Supports batch requests, notifications, and standard error codes.

## Enable JSON-RPC

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .jsonRpc({ port: 3100, path: '/rpc' })

await server.start()
// HTTP on 3000, JSON-RPC on 3100
```

Or share the same HTTP server:

```ts
const server = createServer({ port: 3000 })
  .jsonRpc({ path: '/rpc' }) // No port = shared with HTTP

await server.start()
// Both HTTP and JSON-RPC on 3000
```

When JSON-RPC shares the HTTP server, `basePath` prefixes the JSON-RPC path
(for example `basePath: '/api'` + `path: '/rpc'` → `/api/rpc`).

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | - | Port to listen on (omit to share HTTP) |
| `host` | string | `'0.0.0.0'` | Host to bind to |
| `path` | string | `'/'` | Endpoint path |
| `cors` | boolean | `true` | Enable CORS headers |
| `maxBodySize` | number | `1MB` | Maximum request body size |
| `timeout` | number | `30000` | Request timeout in ms |
| `codecs` | array | - | Additional codecs for response negotiation |

## Content Negotiation

JSON-RPC requests must be JSON. `Content-Type` is validated against supported
codecs (JSON and text by default); if a body is present without a `Content-Type`,
the server returns `415 UNSUPPORTED_MEDIA_TYPE`. Responses are encoded based on
`Accept` (defaulting to JSON). Unsupported `Accept` values return `406`.

You can register additional codecs via `codecs` to support other response formats.

## USD Content Types

USD defaults to JSON for JSON-RPC. You can describe overrides at the protocol or
method level for documentation:

```ts
server.enableUSD({
  contentTypes: { default: 'application/json', supported: ['application/json', 'text/csv'] },
  jsonrpc: { contentTypes: { default: 'application/json' } },
})
```

For file-system discovery, use handler metadata to override a method:

```ts
export const meta = {
  contentType: 'text/csv',
}
```

## Request Format

### Single Request

```json
{
  "jsonrpc": "2.0",
  "method": "users.create",
  "params": { "name": "Maya", "email": "maya@example.com" },
  "id": 1
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "result": { "id": "usr_123", "name": "Maya" },
  "id": 1
}
```

### Batch Request

Send multiple requests in a single HTTP call:

```json
[
  { "jsonrpc": "2.0", "method": "users.get", "params": { "id": "usr_1" }, "id": 1 },
  { "jsonrpc": "2.0", "method": "users.get", "params": { "id": "usr_2" }, "id": 2 },
  { "jsonrpc": "2.0", "method": "config.get", "id": 3 }
]
```

Response (order may vary):

```json
[
  { "jsonrpc": "2.0", "result": { "id": "usr_1", "name": "Alice" }, "id": 1 },
  { "jsonrpc": "2.0", "result": { "id": "usr_2", "name": "Bob" }, "id": 2 },
  { "jsonrpc": "2.0", "result": { "theme": "dark" }, "id": 3 }
]
```

### Notifications

Requests without `id` are notifications (fire-and-forget):

```json
{
  "jsonrpc": "2.0",
  "method": "analytics.track",
  "params": { "event": "page_view", "path": "/home" }
}
```

Notifications return no response body (HTTP 204).

## Metadata

Standard headers (`authorization`, `x-request-id`, `traceparent`, `tracestate`,
`content-type`, `accept`, and `x-*`) are copied into envelope metadata.

## Error Codes

Standard JSON-RPC error codes:

| Code | Constant | Description |
|------|----------|-------------|
| `-32700` | `PARSE_ERROR` | Invalid JSON |
| `-32600` | `INVALID_REQUEST` | Not a valid request object |
| `-32601` | `METHOD_NOT_FOUND` | Method does not exist |
| `-32602` | `INVALID_PARAMS` | Invalid method parameters |
| `-32603` | `INTERNAL_ERROR` | Internal error |
| `-32000` | `SERVER_ERROR` | Generic server error |

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32601,
    "message": "Method not found: users.unknown",
    "data": { "method": "users.unknown" }
  },
  "id": 1
}
```

### Error Mapping

Raffel errors are mapped to JSON-RPC codes:

| Raffel Code | JSON-RPC Code |
|-------------|---------------|
| `NOT_FOUND` | `-32601` (Method not found) |
| `VALIDATION_ERROR` | `-32602` (Invalid params) |
| `INVALID_ARGUMENT` | `-32602` (Invalid params) |
| `UNPROCESSABLE_ENTITY` | `-32602` (Invalid params) |
| `INVALID_TYPE` | `-32600` (Invalid request) |
| `INVALID_ENVELOPE` | `-32600` (Invalid request) |
| `PARSE_ERROR` | `-32700` (Parse error) |
| `UNAUTHENTICATED` | `-32001` (Server error) |
| `PERMISSION_DENIED` | `-32001` (Server error) |
| `RATE_LIMITED` | `-32002` (Server error) |
| `RESOURCE_EXHAUSTED` | `-32002` (Server error) |
| `NOT_ACCEPTABLE` | `-32000` (Server error) |
| `UNSUPPORTED_MEDIA_TYPE` | `-32000` (Server error) |
| `PAYLOAD_TOO_LARGE` | `-32000` (Server error) |
| `MESSAGE_TOO_LARGE` | `-32000` (Server error) |
| `FAILED_PRECONDITION` | `-32000` (Server error) |
| `ALREADY_EXISTS` | `-32000` (Server error) |
| `DEADLINE_EXCEEDED` | `-32000` (Server error) |
| `UNAVAILABLE` | `-32000` (Server error) |
| `BAD_GATEWAY` | `-32000` (Server error) |
| `GATEWAY_TIMEOUT` | `-32000` (Server error) |
| Other | `-32603` (Internal error) |

## Client Examples

### curl

```bash
# Single request
curl -X POST http://localhost:3100/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"health.check","id":1}'

# Batch request
curl -X POST http://localhost:3100/rpc \
  -H 'Content-Type: application/json' \
  -d '[
    {"jsonrpc":"2.0","method":"users.list","id":1},
    {"jsonrpc":"2.0","method":"config.get","id":2}
  ]'

# Notification (no response)
curl -X POST http://localhost:3100/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"logs.write","params":{"msg":"hello"}}'
```

### TypeScript Client

```ts
async function rpc<T>(method: string, params?: unknown, id = 1): Promise<T> {
  const res = await fetch('http://localhost:3100/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  return data.result
}

// Usage
const user = await rpc<User>('users.get', { id: 'usr_123' })
```

## Procedure Mapping

Raffel procedures map directly to JSON-RPC methods:

```ts
server
  .procedure('users.create')
  .input(z.object({ name: z.string() }))
  .handler(async (input) => {
    return { id: 'usr_123', name: input.name }
  })
```

Call via JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "method": "users.create",
  "params": { "name": "Maya" },
  "id": 1
}
```

## USD Documentation Metadata

Add JSON-RPC metadata so USD can document notifications and error shapes:

```ts
import { z } from 'zod'

server
  .procedure('users.get')
  .jsonrpc({
    notification: false,
    errors: [
      {
        code: -32602,
        message: 'Invalid params',
        dataSchema: z.object({ field: z.string() }),
      },
    ],
  })
  .handler(async () => ({ id: 'usr_1' }))
```

With file-system discovery, use metadata:

```ts
export const meta = {
  jsonrpc: {
    notification: true,
    errors: [{ code: -32602, message: 'Invalid params' }],
  },
}
```

## When to Use JSON-RPC

- Language-agnostic RPC (many client libraries available)
- Batch multiple operations in one request
- Interop with existing JSON-RPC systems
- When you prefer explicit method names over REST paths
