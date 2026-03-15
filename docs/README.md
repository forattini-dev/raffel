# Raffel

> **One server. Every protocol.**

Raffel is a multi-protocol server runtime. You write your business logic once — it's automatically exposed over HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP.

No duplicate code. No protocol-specific adapters. No config sprawl.

---

## The Problem

Modern APIs rarely need just one protocol. HTTP for browsers. WebSocket for real-time. gRPC for service-to-service. The result? The same logic written three times:

```typescript
// ❌ Same logic, written three times
app.post('/users/create', async (req, res) => {
  const user = await createUser(req.body)
  res.json(user)
})

wsServer.on('message', async (msg) => {
  if (msg.type === 'users.create') {
    const user = await createUser(msg.payload)
    socket.send(JSON.stringify(user))
  }
})

grpcService.CreateUser = async (call, callback) => {
  const user = await createUser(call.request)
  callback(null, user)
}
```

Every protocol means another adapter, another serialization layer, another place where bugs hide.

---

## The Solution

With Raffel, you define a **procedure** once. The server handles every protocol:

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

// ✅ Write once, works everywhere
server.procedure('users.create')
  .handler(async (input) => {
    return { id: crypto.randomUUID(), ...input }
  })

await server.start()
```

That single procedure now responds over:

| Protocol | How clients call it |
|:---------|:--------------------|
| **HTTP** | `POST /users.create` |
| **WebSocket** | `{ procedure: 'users.create', payload: {...} }` |
| **JSON-RPC** | `{ method: 'users.create', params: {...} }` |
| **GraphQL** | `mutation { usersCreate(...) }` |
| **gRPC** | `UsersService.Create()` |
| **TCP/UDP** | binary frames with length-prefix |

---

## Hello World

The simplest possible server:

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Test it with curl:

```bash
curl localhost:3000/hello \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'

# → "Hello, World!"
```

Same procedure, over WebSocket:

```javascript
const ws = new WebSocket('ws://localhost:3000')
ws.send(JSON.stringify({ procedure: 'hello', payload: { name: 'World' } }))
// ← { result: "Hello, World!" }
```

---

## File-Based Routes

Prefer organizing routes as files, like Next.js? Enable discovery:

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  discovery: true  // auto-discovers src/rpc/**
})
```

Create files in `src/rpc/`:

```typescript
// src/rpc/hello.ts  →  procedure: hello
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// src/rpc/users/create.ts  →  procedure: users.create
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

The folder structure defines procedure names:

```
src/rpc/
├── hello.ts           → hello
├── users/
│   ├── create.ts      → users.create
│   ├── list.ts        → users.list
│   └── [id].ts        → users.get
└── _middleware.ts     → applied to all
```

---

## Input Validation

Validate input with Zod (or Yup, Joi, Ajv — your choice):

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server.procedure('users.create')
  .input(z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email'),
  }))
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  }))

await server.start()
```

Invalid requests are rejected before your handler runs:

```bash
curl localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "email": "bad"}'

# 400 Bad Request
# {
#   "error": "VALIDATION_ERROR",
#   "details": [
#     { "field": "name", "message": "Name must be at least 2 characters" },
#     { "field": "email", "message": "Invalid email" }
#   ]
# }
```

Validation runs identically across every protocol — the same schema protects your HTTP endpoint and your WebSocket handler.

---

## Interceptors

Interceptors are global middleware that run around every request. Add logging, rate limiting, timeouts, and more in one place:

```typescript
import {
  createServer,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from 'raffel'

const server = createServer({ port: 3000 })
  .use(createLoggingInterceptor())
  .use(createTimeoutInterceptor({ defaultMs: 30_000 }))
  .use(createRateLimitInterceptor({ maxRequests: 100, windowMs: 60_000 }))

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Interceptors apply across **all protocols** — configure once, enforced everywhere.

| Interceptor | What it does |
|:------------|:-------------|
| `createLoggingInterceptor()` | Logs each request with method, duration, status |
| `createTimeoutInterceptor({ defaultMs })` | Cancels slow requests |
| `createRateLimitInterceptor({ maxRequests, windowMs })` | Rate limits by IP |
| `createRetryInterceptor({ maxAttempts })` | Retries on failure |
| `createCircuitBreakerInterceptor()` | Stops hammering failing services |
| `createCacheInterceptor({ ttlMs })` | Response caching |
| `createBulkheadInterceptor({ concurrency })` | Limits concurrent requests |

---

## Authentication

Protect procedures with JWT, API Keys, OAuth2, or custom strategies:

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  requireAuth,
  hasRole,
  RaffelError,
} from 'raffel'

const server = createServer({ port: 3000 })
  .use(createAuthMiddleware({
    strategies: [
      createBearerStrategy({
        verify: async (token) => verifyJwt(token),
      }),
    ],
  }))

// Public — no auth required
server.procedure('health')
  .handler(async () => ({ ok: true }))

// Protected — valid token required
server.procedure('users.me')
  .handler(async (_input, ctx) => {
    const auth = requireAuth(ctx)  // throws 401 if no auth
    return { id: auth.principal, email: auth.claims?.email }
  })

// Role-gated
server.procedure('admin.stats')
  .handler(async (_input, ctx) => {
    if (!hasRole(ctx, 'admin')) {
      throw new RaffelError('PERMISSION_DENIED', 'Admin only')
    }
    return getAdminStats()
  })

await server.start()
```

Auth runs at the interceptor layer — a valid token over WebSocket grants the same identity as over HTTP.

---

## Streaming

Return a generator to stream data in real-time:

```typescript
const server = createServer({ port: 3000 })

// Server-sent log tail
server.stream('logs.tail')
  .handler(async function* ({ file }) {
    for await (const line of readLines(file)) {
      yield { line, timestamp: Date.now() }
    }
  })

// Progress updates
server.stream('upload.progress')
  .handler(async function* ({ uploadId }) {
    while (true) {
      const progress = await getUploadProgress(uploadId)
      yield { percent: progress.percent }
      if (progress.percent >= 100) break
      await sleep(500)
    }
  })

await server.start()
```

Streams are delivered via WebSocket, SSE, or gRPC streaming — the client decides.

---

## Protocol Configuration

HTTP and WebSocket are enabled by default. Configure or add others:

```typescript
const server = createServer({ port: 3000 })
  .protocols({
    websocket: '/ws',
    jsonrpc:   '/rpc',
    graphql:   '/graphql',
    grpc:      { port: 50051 },
    tcp:       { port: 9000 },
  })

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

---

## Front-Door (single entry point)

Concentrate multiple protocols behind one port with explicit routing policy:

```typescript
const server = createServer({
  port: 3000,
  frontDoor: {
    enabled: true,
    port: 443,
    host: '0.0.0.0',
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql'],
  },
  websocket: '/ws',
  jsonrpc:   '/rpc',
  graphql:   '/graphql',
  tcp:       { port: 9000 },
})
```

| Protocol | Default strategy | Notes |
|:---------|:-----------------|:------|
| HTTP | `shared` | Always routed through main HTTP flow |
| WebSocket | `shared` | Detected via `Upgrade: websocket` header |
| JSON-RPC | `shared` | Shares the HTTP port |
| GraphQL | `shared` | Shares the HTTP port |
| TCP | `offload` | Stays on dedicated port |
| UDP | `offload` / `native` | No demux on a single socket |
| gRPC | `offload` / `native` | Requires dedicated gRPC port |

---

## Shared-Port Protocol Fusion

Serve every protocol on one port — Raffel sniffs the first bytes to detect the protocol:

```typescript
const server = createServer({
  port: 3000,
  sharedPort: {
    enabled: true,
    protocols: ['http', 'tls', 'websocket', 'tcp'],
    sniffMaxBytes: 2048,
    sniffTimeoutMs: 100,
  },
})
```

| First bytes | Detected as |
|:-----------|:------------|
| `0x16 0x03` (TLS ClientHello) | `tls` |
| HTTP/2 preface | `http2` |
| `GET`, `POST`, etc. | `http` |
| Length-prefix frame | `tcp` |
| Printable text + `\n` | `tcp` |

---

## Next Steps

<div class="grid-3">
<a href="#/learn/quickstart" class="card">
<div class="icon">🚀</div>
<h4>Quickstart</h4>
<p>Up and running in 5 minutes</p>
</a>

<a href="#/protocols/http" class="card">
<div class="icon">🔌</div>
<h4>Protocols</h4>
<p>HTTP, WS, gRPC, GraphQL and more</p>
</a>

<a href="#/core/interceptors/overview" class="card">
<div class="icon">🛡️</div>
<h4>Interceptors</h4>
<p>Auth, rate limiting, cache, retry</p>
</a>
</div>

---

## Full Feature Set

| Category | What's included |
|:---------|:----------------|
| **Protocols** | HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP |
| **Validation** | Zod, Yup, Joi, Ajv |
| **Auth** | JWT, API Key, OAuth2, OIDC, Sessions |
| **Resilience** | Rate limit, Circuit breaker, Retry, Timeout, Bulkhead |
| **Observability** | Prometheus metrics, OpenTelemetry tracing, Structured logging |
| **Cache** | Memory, Redis, custom drivers |
| **Real-time** | Channels (Pusher-like), Presence, Broadcasting |
| **DX** | Hot reload, file-system discovery, REST auto-CRUD |

---

<div style="text-align: center; padding: 2rem 0;">
<strong>One server. Every protocol.</strong>
</div>
