# HTTP Adapter

Raffel exposes procedures, streams, and events over HTTP with a REST-like mapping.

## Enable HTTP

HTTP is enabled by default when you create a server:

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

await server.start()
// HTTP server running on :3000
```

## Options

When you use `createServer`, HTTP adapter options live under `http`:

```ts
const server = createServer({
  port: 3000,
  basePath: '/api',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  http: {
    maxBodySize: 1024 * 1024,
    codecs: [],
    middleware: [],
    contextFactory: (req) => ({ requestId: req.headers['x-request-id'] as string }),
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on |
| `host` | string | `'0.0.0.0'` | Host to bind to |
| `basePath` | string | `'/'` | Base path prefix for all endpoints |
| `cors` | object | - | CORS configuration |
| `http.maxBodySize` | number | `1MB` | Maximum request body size in bytes |
| `http.codecs` | array | - | Additional codecs for content negotiation |
| `http.middleware` | array | - | HTTP middleware to run before routing |
| `http.contextFactory` | function | - | Build request context from the HTTP request |

## Endpoint Mapping

| Handler Type | HTTP Method | Path Pattern | Response |
|--------------|-------------|--------------|----------|
| Procedure | POST | `/{basePath}/{procedure.name}` | Negotiated (JSON/CSV/Text) |
| Stream (server) | GET | `/{basePath}/streams/{name}` | SSE |
| Event | POST | `/{basePath}/events/{name}` | 202 Accepted |

## Procedure Calls

```bash
curl -X POST http://localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name":"Maya","email":"maya@example.com"}'
```

Response:

```json
{
  "id": "usr_123",
  "name": "Maya",
  "email": "maya@example.com"
}
```

## Content Negotiation

Procedure and event endpoints negotiate formats using `Content-Type` and `Accept`.
Supported codecs by default:
- `application/json` / `application/*+json`
- `text/csv` (expects a header row and parses to an array of records)
- `text/plain`

Requests with an unsupported `Content-Type`, or with a body but no `Content-Type`,
return `415 UNSUPPORTED_MEDIA_TYPE`. Responses are encoded based on `Accept`; if
`Accept` is missing or `*/*`, JSON is used. Unsupported `Accept` values return
`406 NOT_ACCEPTABLE`. SSE streams are not subject to content negotiation.

You can register additional codecs via `http.codecs`.

## Rate Limit Headers

When rate limiting metadata is available, the adapter includes standard
rate-limit headers on both successful and error responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

If a request is rate-limited, `Retry-After` is included as well.

## Streaming (SSE)

Server streams use Server-Sent Events:

```bash
curl -N http://localhost:3000/streams/logs.tail?limit=10
```

SSE response:

```
data: {"line":"2024-01-01 Starting server..."}

data: {"line":"2024-01-01 Ready on port 3000"}

event: end
data: {}
```

Event types:
- `data` - Stream chunk (default)
- `end` - Stream completed
- `error` - Stream error

## Events (Fire-and-Forget)

```bash
curl -X POST http://localhost:3000/events/audit.write \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","userId":"usr_123"}'
```

Returns HTTP 202 Accepted immediately.

## CORS Configuration

```ts
const server = createServer({
  port: 3000,
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    headers: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
  },
})
```

CORS options:

| Option | Type | Description |
|--------|------|-------------|
| `origin` | string/array/boolean | Allowed origins (`true` = all) |
| `methods` | string[] | Allowed HTTP methods |
| `headers` | string[] | Allowed headers |
| `credentials` | boolean | Allow credentials (cookies) |

## Base Path

Prefix all endpoints with a base path:

```ts
const server = createServer({
  port: 3000,
  basePath: '/api/v1',
})
```

Endpoints become:
- `POST /api/v1/users.create`
- `GET /api/v1/streams/logs.tail`
- `POST /api/v1/events/audit.write`

## Header Mapping

HTTP headers are mapped to envelope metadata:

| HTTP Header | Envelope Field |
|-------------|----------------|
| `Authorization` | `metadata.authorization` |
| `X-Request-Id` | `metadata.x-request-id` |
| `Traceparent` | `metadata.traceparent` |
| `Tracestate` | `metadata.tracestate` |
| `Content-Type` | `metadata.content-type` |
| `Accept` | `metadata.accept` |
| `X-*` | `metadata.x-*` (lowercased) |

If `X-Request-Id` is present, it is also used as the envelope `id`.

## Error Responses

Raffel errors are mapped to HTTP status codes:

| Error Code | HTTP Status |
|------------|-------------|
| `INVALID_ARGUMENT` | 400 Bad Request |
| `VALIDATION_ERROR` | 400 Bad Request |
| `INVALID_TYPE` | 400 Bad Request |
| `INVALID_ENVELOPE` | 400 Bad Request |
| `PARSE_ERROR` | 400 Bad Request |
| `UNPROCESSABLE_ENTITY` | 422 Unprocessable Entity |
| `UNAUTHENTICATED` | 401 Unauthorized |
| `PERMISSION_DENIED` | 403 Forbidden |
| `NOT_FOUND` | 404 Not Found |
| `NOT_ACCEPTABLE` | 406 Not Acceptable |
| `ALREADY_EXISTS` | 409 Conflict |
| `FAILED_PRECONDITION` | 412 Precondition Failed |
| `PAYLOAD_TOO_LARGE` | 413 Payload Too Large |
| `MESSAGE_TOO_LARGE` | 413 Payload Too Large |
| `UNSUPPORTED_MEDIA_TYPE` | 415 Unsupported Media Type |
| `RATE_LIMITED` | 429 Too Many Requests |
| `RESOURCE_EXHAUSTED` | 429 Too Many Requests |
| `CANCELLED` | 499 Client Closed |
| `BAD_GATEWAY` | 502 Bad Gateway |
| `UNIMPLEMENTED` | 501 Not Implemented |
| `UNAVAILABLE` | 503 Service Unavailable |
| `GATEWAY_TIMEOUT` | 504 Gateway Timeout |
| `DEADLINE_EXCEEDED` | 504 Gateway Timeout |
| `OUTPUT_VALIDATION_ERROR` | 500 Internal Server Error |
| `STREAM_ERROR` | 500 Internal Server Error |
| `DATA_LOSS` | 500 Internal Server Error |
| `UNKNOWN` | 500 Internal Server Error |
| `INTERNAL_ERROR` | 500 Internal Server Error |

Error response format:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [
      { "field": "email", "message": "Invalid email format" }
    ]
  }
}
```

## HTTP Middleware

Run custom middleware before routing:

```ts
const server = createServer({
  port: 3000,
  http: {
    middleware: [
      async (req, res) => {
        // Log all requests
        console.log(`${req.method} ${req.url}`)
        return false // Continue to next middleware/router
      },
      async (req, res) => {
        // Handle custom endpoints
        if (req.url === '/custom') {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('Custom response')
          return true // Request handled, stop processing
        }
        return false
      },
    ],
  },
})
```

## Query Parameters

For procedures, query parameters are merged with body:

```bash
curl -X POST 'http://localhost:3000/users.list?page=2&limit=10'
```

Equivalent to:

```bash
curl -X POST http://localhost:3000/users.list \
  -H 'Content-Type: application/json' \
  -d '{"page":2,"limit":10}'
```

For streams, query parameters become input:

```bash
curl -N 'http://localhost:3000/streams/logs.tail?limit=100&level=error'
```

## Health Check

A built-in health endpoint is available:

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

See [Health Checks](../dx.md) for advanced configuration.
