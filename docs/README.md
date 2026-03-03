# Raffel

> **One function. Seven protocols. Zero config.**

Raffel is a multi-protocol server runtime. You write your logic once and it works automatically over HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP.

No manual adapters. No duplication. No complex configuration.

---

## The Problem

Today, if you want to expose an API over multiple protocols, you need to:

```typescript
// ❌ Duplicated code for each protocol
app.post('/users', async (req, res) => { /* logic */ })
wsServer.on('message', (msg) => { /* same logic, different */ })
grpcService.CreateUser = async (call) => { /* same logic, different */ })
```

With Raffel, you write it once:

```typescript
import { createServer } from 'raffel'

// ✅ One function, all protocols
const server = createServer({ port: 3000 })

server.procedure('users.create')
  .handler(async (input) => {
    // Your business logic
    return { id: crypto.randomUUID(), ...input }
  })

await server.start()
```

That function now responds over:
- **HTTP**: `POST /users.create`
- **WebSocket**: `{ procedure: 'users.create', payload: {...} }`
- **JSON-RPC**: `{ method: 'users.create', params: {...} }`
- **GraphQL**: `mutation { usersCreate(...) }`
- **gRPC**: `UsersService.Create()`
- **TCP/UDP**: binary protocol with frames

---

## Hello World

The simplest possible example:

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('hello')
  // 'hello' is the procedure name
  // The client sends { name: 'World' }
  // The server returns 'Hello, World!'
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Test with curl:

```bash
curl localhost:3000/hello \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'

# Response: "Hello, World!"
```

---

## File-Based Routes

If you prefer to organize by files (like Next.js), just enable discovery:

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  discovery: true  // Enables automatic route discovery
})
```

Now create files in the `src/rpc/` folder:

```typescript
// src/rpc/hello.ts
// This file becomes the 'hello' procedure
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// src/rpc/users/create.ts
// This file becomes the 'users.create' procedure
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

The folder structure defines the names:

```
src/rpc/
├── hello.ts           → procedure: hello
├── users/
│   ├── create.ts      → procedure: users.create
│   ├── list.ts        → procedure: users.list
│   └── [id].ts        → procedure: users.get (with parameter)
└── _middleware.ts     → middleware applied to all handlers
```

---

## Input Validation

To validate incoming data, pass a Zod schema (or Yup, Joi):

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  // Validation schema - automatically rejects invalid requests
  .input(z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email'),
  }))
  // Handler is only called if validation passes
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  }))

await server.start()
```

If the client sends invalid data:

```bash
curl localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "email": "invalid"}'

# Response: 400 Bad Request
# {
#   "error": "VALIDATION_ERROR",
#   "details": [
#     { "field": "name", "message": "Name must be at least 2 characters" },
#     { "field": "email", "message": "Invalid email" }
#   ]
# }
```

---

## Interceptors (Middlewares)

Interceptors are middlewares that run before/after each request. Use them for logging, rate limiting, timeout, etc:

```typescript
import {
  createServer,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from 'raffel'

const server = createServer({ port: 3000 })
  // Global interceptors - applied to ALL routes
  .use(createLoggingInterceptor())
  .use(createTimeoutInterceptor({ defaultMs: 30000 }))
  .use(createRateLimitInterceptor({ maxRequests: 100, windowMs: 60_000 }))

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Available interceptors:

| Interceptor | What it does |
|:------------|:-------------|
| `createLoggingInterceptor()` | Logs each request with method, duration, and status |
| `createTimeoutInterceptor({ defaultMs })` | Cancels slow requests |
| `createRateLimitInterceptor({ maxRequests, windowMs })` | Rate limits requests per IP |
| `createRetryInterceptor({ maxAttempts })` | Automatic retry on failure |
| `createCircuitBreakerInterceptor()` | Stops calling services that are failing |
| `createCacheInterceptor({ ttlMs })` | Response caching |
| `createBulkheadInterceptor({ concurrency })` | Limits concurrent requests |

---

## Authentication

Protect routes with JWT, API Key, or other methods:

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
  // Configures JWT authentication globally
  .use(createAuthMiddleware({
    strategies: [
      createBearerStrategy({
        verify: async (token) => verifyJwt(token),
      }),
    ],
  }))

// Public route - anyone can access
server.procedure('health')
  .handler(async () => ({ ok: true }))

// Protected route - requires a valid token
server.procedure('users.me')
  .handler(async (_input, ctx) => {
    const auth = requireAuth(ctx)
    return {
      id: auth.principal,
      email: auth.claims?.email,
    }
  })

// Route with specific roles
server.procedure('admin.stats')
  .handler(async (_input, ctx) => {
    if (!hasRole(ctx, 'admin')) {
      throw new RaffelError('PERMISSION_DENIED', 'Admin only')
    }
    return getAdminStats()
  })

await server.start()
```

---

## Streaming

For real-time data, use generators:

```typescript
const server = createServer({ port: 3000 })

// Real-time log streaming
server.stream('logs.tail')
  .handler(async function* ({ file }) {
    // The asterisk (*) indicates a generator
    for await (const line of readLines(file)) {
      // yield sends each line to the client
      yield { line, timestamp: Date.now() }
    }
  })

// Upload progress stream
server.stream('upload.progress')
  .handler(async function* ({ uploadId }) {
    while (true) {
      const progress = await getUploadProgress(uploadId)
      yield { percent: progress.percent }

      if (progress.percent >= 100) break
      await sleep(500)  // Updates every 500ms
    }
  })

await server.start()
```

---

## Available Protocols

By default, HTTP and WebSocket are enabled. To customize:

```typescript
const server = createServer({ port: 3000 })
  // Per-protocol configuration
  .protocols({
    websocket: '/ws',
    jsonrpc: '/rpc',
    graphql: '/graphql',
    grpc: { port: 50051 },
    tcp: { port: 9000 },
  })

server.udp
  .handler('metrics', { port: 9001 })
  .onMessage((msg, rinfo, ctx) => {
    console.log(`UDP ${rinfo.address}:${rinfo.port} -> ${msg.length} bytes`)
  })
  .end()

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

## Front-Door (single entry point)

`frontDoor` allows concentrating HTTP/WebSocket/JSON-RPC/GraphQL traffic into a single port, with an explicit policy.

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,                    // default HTTP port (fallback)
  frontDoor: {
    enabled: true,
    port: 443,
    host: '127.0.0.1',
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql', 'tcp'],
  },
  websocket: '/ws',
  jsonrpc: '/rpc',
  graphql: '/graphql',
  tcp: { port: 9000, host: '127.0.0.1' },
})
```

- Without `protocols`, the front-door enters shared mode for HTTP/WebSocket/JSON-RPC/GraphQL.
- Non-HTTP network protocols (such as TCP/gRPC) can enter `offload` mode: they remain on dedicated ports, but gain strategy metadata in `server.addresses`.
- Protocols not listed in `frontDoor.protocols` keep their current native/dedicated behavior.
- Unknown protocols in `frontDoor.protocols` generate an explicit configuration error.

### Front-door support matrix

| Protocol  | `frontDoor` default     | Supported strategy | Note |
|:----------|:------------------------|:-------------------|:-----|
| HTTP      | ✅ Yes                  | `shared`           | Always routed through the main HTTP flow |
| WebSocket | ✅ Yes                  | `shared`           | Detected via `Upgrade: websocket` |
| JSON-RPC  | ✅ Yes                  | `shared`           | Shares the HTTP port |
| RPC/JRPC  | ✅ Yes (alias)          | `shared`           | Synonym for JSON-RPC in `frontDoor.protocols` config |
| GraphQL   | ✅ Yes                  | `shared`           | Shares the HTTP port |
| TCP       | ❌ No (by default)      | `offload`          | Declarable in `frontDoor.protocols` |
| UDP       | ❌ No (by default)      | `offload`/`native` | No demux on a single socket |
| gRPC      | ❌ No (by default)      | `offload`/`native` | Requires its own gRPC on a dedicated port |
| PING/ICMP | ❌ No                   | —                  | Out of application scope |
| FTP       | ❌ No                   | —                  | Out of application scope |

### Boot fixture example (runtime)

After `await server.start()`, `server.addresses` should reflect the front-door boot plan:

```json
{
  "http": { "host": "127.0.0.1", "port": 3000, "frontDoor": true, "strategy": "shared" },
  "websocket": { "host": "127.0.0.1", "port": 3000, "path": "/ws", "shared": true, "frontDoor": true, "strategy": "shared" },
  "jsonrpc": { "host": "127.0.0.1", "port": 3000, "path": "/rpc", "shared": true, "frontDoor": true, "strategy": "shared" },
  "graphql": { "host": "127.0.0.1", "port": 3000, "path": "/graphql", "shared": true, "frontDoor": true, "strategy": "shared" },
  "tcp": { "host": "127.0.0.1", "port": 9000, "frontDoor": true, "strategy": "offload" },
  "udp": { "host": "127.0.0.1", "port": 9001, "frontDoor": true, "strategy": "offload" }
}
```

## Single-Port (multiplexing protocols on one port)

`singlePort` detects the protocol of each TCP connection from the first bytes, without requiring dedicated ports:

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    // Allowlist of accepted protocols (optional)
    protocols: ['http', 'tls', 'websocket'],
    // Maximum bytes for sniffing (default: 4096)
    sniffMaxBytes: 2048,
    // Timeout to read the first chunk (default: 75ms)
    sniffTimeoutMs: 100,
  },
})
```

Automatic detection:

| Detector | Protocol |
|:---------|:---------|
| TLS ClientHello (`0x16 0x03`) | `tls` |
| HTTP/2 preface | `http2` |
| TCP length-prefix frame | `tcp` |
| HTTP method (`GET`, `POST`, ...) | `http` |
| Text protocol (printable + `\n`) | `tcp` |
| Custom `ProtocolSniffer` | any |

---

## Next Steps

<div class="grid-3">
<a href="#/quickstart" class="card">
<div class="icon">🚀</div>
<h4>Quickstart</h4>
<p>Complete 5-minute tutorial</p>
</a>

<a href="#/file-system-discovery" class="card">
<div class="icon">📂</div>
<h4>File-Based Routes</h4>
<p>Organize routes by files</p>
</a>

<a href="#/interceptors" class="card">
<div class="icon">🛡️</div>
<h4>Interceptors</h4>
<p>Rate limit, cache, retry and more</p>
</a>
</div>

---

## Full Feature Set

| Category | What's included |
|:---------|:----------------|
| **Protocols** | HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP |
| **Validation** | Zod, Yup, Joi, Ajv (pick your own) |
| **Auth** | JWT, API Key, OAuth2, OIDC, Sessions |
| **Resilience** | Rate limit, Circuit breaker, Retry, Timeout, Bulkhead |
| **Observability** | Prometheus metrics, OpenTelemetry tracing, Logging |
| **Cache** | Memory, Redis, Custom drivers |
| **Real-time** | Channels (Pusher-like), Presence, Broadcasting |
| **DX** | Hot reload, Auto-discovery, REST Auto-CRUD |

---

<div style="text-align: center; padding: 2rem 0;">
<strong>Write once. Run everywhere.</strong>
</div>
