<div align="center">

# ⚡ Raffel

### Unified Multi-Protocol Server Runtime

One handler. Seven protocols. Zero duplication.

[![npm version](https://img.shields.io/npm/v/raffel.svg?style=flat-square&color=8b5cf6)](https://www.npmjs.com/package/raffel)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Documentation](https://forattini-dev.github.io/raffel) · [Quick Start](#quick-start) · [Examples](./examples) · [MCP Server](#mcp-server)

</div>

---

## Why Raffel?

```typescript
// Define once
server.procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .handler(async (input) => db.users.create({ data: input }))

// Expose everywhere
// ✓ HTTP POST /users.create
// ✓ WebSocket { procedure: 'users.create', payload: {...} }
// ✓ gRPC UsersService.Create()
// ✓ JSON-RPC { method: 'users.create', params: {...} }
// ✓ GraphQL mutation { usersCreate(...) }
// ✓ TCP/UDP raw protocol support
```

**Same validation. Same errors. Same auth. Same metrics. All protocols.**

---

## Quick Start

```bash
pnpm add raffel zod
```

Prefer another validator? Swap Zod for Yup/Joi/Ajv and register its adapter.

```typescript
import { createServer, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({
  port: 3000,
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
})

server
  .procedure('hello')
  .input(z.object({ name: z.string() }))
  .handler(async ({ name }) => ({ message: `Hello, ${name}!` }))

await server.start()
```

```bash
# Test all protocols
curl -X POST localhost:3000/hello -d '{"name":"World"}'
wscat -c ws://localhost:3000/ws -x '{"procedure":"hello","payload":{"name":"World"}}'
```

---

## Custom Protocols

Need a transport Raffel does not ship with? Register a protocol adapter:

```typescript
server.registerProtocol('custom', ({ router, host, port }) => ({
  async start() {
    // Start your server and translate requests into Raffel envelopes
  },
  async stop() {
    // Clean shutdown
  },
  address: { host, port, path: '/custom', shared: true },
}))
```

---

## Documentation (Docsify Deep Dive)

**Raffel's docs are the product** - dense, example-first, and protocol-accurate.

**👉 Full documentation:** https://forattini-dev.github.io/raffel

| Path | What you get |
|------|--------------|
| [Quickstart](https://forattini-dev.github.io/raffel/#/quickstart) | 5-minute multi-protocol server |
| [Core Model](https://forattini-dev.github.io/raffel/#/core-model) | Envelope, Context, handler lifecycle |
| [Handlers](https://forattini-dev.github.io/raffel/#/handlers/procedures) | Procedures, Streams, Events with real examples |
| [Protocols](https://forattini-dev.github.io/raffel/#/protocols/http) | HTTP/WS/gRPC/JSON-RPC/GraphQL/TCP/UDP mappings |
| [Interceptors](https://forattini-dev.github.io/raffel/#/interceptors) | Rate limit, retry, timeout, caching, fallback |
| [Auth](https://forattini-dev.github.io/raffel/#/auth/overview) | Bearer/API key/OAuth2/OIDC/Sessions |
| [Routing & Discovery](https://forattini-dev.github.io/raffel/#/file-system-discovery) | File-based routing, REST Auto-CRUD |
| [Observability](https://forattini-dev.github.io/raffel/#/metrics) | Prometheus metrics + OpenTelemetry tracing |
| [USD & OpenAPI](https://forattini-dev.github.io/raffel/#/usd) | Universal docs generated from schemas |
| [MCP Server](https://forattini-dev.github.io/raffel/#/mcp) | AI tools, resources, prompts |

---

## What's Inside

| Category | Features |
|----------|----------|
| **Protocols** | HTTP • WebSocket • gRPC • JSON-RPC • GraphQL • TCP • UDP |
| **Handler Types** | Procedures (RPC) • Streams (Server/Client/Bidi) • Events (Pub/Sub) |
| **Validation** | Zod • Yup • Joi • Ajv • fastest-validator |
| **Auth** | JWT • API Key • OAuth2 • OIDC • Basic • Session |
| **Resilience** | Rate Limit • Circuit Breaker • Retry • Timeout • Bulkhead • Fallback |
| **Observability** | Prometheus Metrics • OpenTelemetry Tracing • Structured Logging |
| **Caching** | Memory • Redis • S3DB • Read-through • Write-through |
| **Real-time** | Channels (Pusher-like) • Presence • Broadcasting |
| **Documentation** | USD (Universal Service Docs) • Auto-generated from schemas |
| **DX** | Hot Reload • File-based Routing • REST Auto-CRUD |

---

## Highlights

### Unified Envelope Architecture

Every request becomes a normalized `Envelope` - same processing for all protocols:

```typescript
interface Envelope {
  id: string           // Request correlation
  procedure: string    // Handler name
  type: 'request' | 'response' | 'stream:data' | 'event'
  payload: unknown     // Your data
  context: Context     // Auth, tracing, deadline
}
```

### Three Handler Types

```typescript
// Procedures - Request → Response
server.procedure('math.add')
  .handler(async ({ a, b }) => ({ result: a + b }))

// Streams - Request → Multiple Responses
server.stream('logs.tail')
  .handler(async function* ({ file }) {
    for await (const line of readLines(file)) {
      yield { line }
    }
  })

// Events - Fire and Forget with Guarantees
server.event('emails.send')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    await sendEmail(payload)
    ack()
  })
```

### Protocol-Agnostic Interceptors

Write middleware once, apply everywhere:

```typescript
server.use(async (envelope, ctx, next) => {
  const start = Date.now()
  const result = await next()
  console.log(`${envelope.procedure}: ${Date.now() - start}ms`)
  return result
})
// Runs for HTTP, WebSocket, gRPC, JSON-RPC, TCP, UDP...
```

<details>
<summary><strong>Built-in Interceptors</strong></summary>

```typescript
import {
  // Auth
  createAuthMiddleware,
  createBearerStrategy,
  createApiKeyStrategy,

  // Resilience
  createRateLimitInterceptor,
  createCircuitBreakerInterceptor,
  createRetryInterceptor,
  createTimeoutInterceptor,
  createBulkheadInterceptor,
  createFallbackInterceptor,

  // Observability
  createMetricsInterceptor,
  createTracingInterceptor,
  createLoggingInterceptor,

  // Caching
  createCacheInterceptor,

  // Response
  createEnvelopeInterceptor,
} from 'raffel'
```

</details>

### File-System Discovery

Drop files in folders, get endpoints automatically:

```
src/
├── http/
│   └── users/
│       ├── get.ts      → users.get
│       └── create.ts   → users.create
├── streams/
│   └── logs/
│       └── tail.ts     → logs.tail
├── rest/
│   └── users.ts        → Auto-CRUD
└── channels/
    └── chat-room.ts    → WebSocket channel
```

```typescript
const server = createServer({ port: 3000, discovery: true })
```

### REST Auto-CRUD

Define a schema, get a full REST API:

```typescript
// src/rest/users.ts
export const schema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
})

export const adapter = prisma.user
```

```
GET    /users           → list
GET    /users/:id       → get
POST   /users           → create
PUT    /users/:id       → update
PATCH  /users/:id       → patch
DELETE /users/:id       → delete
```

### WebSocket Channels

Pusher-like real-time with authentication:

```typescript
const server = createServer({
  websocket: {
    channels: {
      authorize: async (socketId, channel, ctx) => {
        if (channel.startsWith('private-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      },
    },
  },
})

// Public channels
server.channels.broadcast('news', 'update', { headline: '...' })

// Private channels
server.channels.broadcast('private-user-123', 'notification', {...})

// Presence channels
const members = server.channels.getMembers('presence-lobby')
```

### Unified Error Handling

Throw once, convert automatically per protocol:

```typescript
import { RaffelError } from 'raffel'

throw new RaffelError('NOT_FOUND', 'User not found', { userId: '123' })

// HTTP → 404 Not Found + JSON body
// JSON-RPC → { error: { code: -32601, message: '...' } }
// gRPC → status: NOT_FOUND (5)
// WebSocket → { type: 'error', code: 'NOT_FOUND' }
```

---

## HTTP Module

Raffel includes a complete HTTP toolkit - no extra dependencies needed:

```typescript
import {
  // Server
  HttpApp, serve,

  // Middleware
  cors, compress, secureHeaders, bodyLimit,
  basicAuth, bearerAuth, cookieSession, oauth2, oidc,
  rateLimitMiddleware, validate,

  // Static files
  serveStatic, serveStaticS3,

  // Responses
  success, error, list, created, notFound, validationError,

  // Session
  createSessionTracker, createRedisSessionStore,

  // Utils
  getCookie, setCookie, healthCheck,
} from 'raffel/http'
```

---

## MCP Server

Raffel includes an MCP server for AI-powered development:

```bash
# Add to Claude Code
claude mcp add raffel npx raffel-mcp

# Or run directly
npx raffel-mcp --category minimal
npx raffel-mcp --category docs,codegen
npx raffel-mcp --transport http --port 3200
```

<details>
<summary><strong>Available Categories</strong></summary>

| Category | Tokens | Tools |
|----------|--------|-------|
| `minimal` | ~2.5K | Essential docs & patterns |
| `docs` | ~3K | Documentation search |
| `codegen` | ~4K | Code generation |
| `full` | ~8K | All 16 tools |

</details>

### MCP Tools

**Docs & Reference**
- `raffel_getting_started` - Quick start guide
- `raffel_search` - Search all documentation
- `raffel_list_interceptors` - List interceptors by category
- `raffel_get_interceptor` - Interceptor details + examples
- `raffel_list_adapters` - List protocol adapters
- `raffel_get_adapter` - Adapter details + protocol mapping
- `raffel_api_patterns` - **Critical** - Correct code patterns
- `raffel_explain_error` - Error code explanations

**Codegen**
- `raffel_create_server` - Generate server boilerplate
- `raffel_create_procedure` - Generate RPC endpoints
- `raffel_create_stream` - Generate streaming handlers
- `raffel_create_event` - Generate event handlers
- `raffel_add_middleware` - Add interceptors
- `raffel_create_module` - Generate router modules
- `raffel_boilerplate` - Multi-file project templates

**Meta**
- `raffel_version` - Version + compatibility info

### MCP Prompts

- `create_rest_api` - Build complete REST API
- `create_realtime_server` - WebSocket + channels
- `create_grpc_service` - gRPC services (unary + streaming)
- `create_microservice` - Production-ready service
- `add_authentication` - Add JWT/API key auth
- `add_caching` - Add caching drivers
- `add_rate_limiting` - Add per-route or global limits
- `add_observability` - Metrics + tracing
- `migrate_from_express` - Convert from Express
- `migrate_from_fastify` - Convert from Fastify
- `migrate_from_trpc` - Convert from tRPC
- `debug_middleware` - Diagnose interceptor order/issues
- `optimize_performance` - Perf review + tuning ideas

### MCP Resources

The MCP server also exposes documentation and boilerplates as resources:

- `raffel://guide/quickstart`
- `raffel://interceptor/{name}`
- `raffel://adapter/{name}`
- `raffel://pattern/{name}`
- `raffel://error/{code}`
- `raffel://boilerplate/{template}`

---

## Documentation

The docs go deep on **every** adapter, interceptor, and design choice.

| Topic | Highlights |
|-------|------------|
| [Quickstart](https://forattini-dev.github.io/raffel/#/quickstart) | Multi-protocol in 5 minutes |
| [Core Model](https://forattini-dev.github.io/raffel/#/core-model) | Envelope + Context deep dive |
| [Handlers](https://forattini-dev.github.io/raffel/#/handlers/procedures) | Procedures, Streams, Events |
| [Interceptors](https://forattini-dev.github.io/raffel/#/interceptors) | Retry, timeout, bulkhead, cache |
| [Auth](https://forattini-dev.github.io/raffel/#/auth/overview) | Bearer/API key/OAuth2/OIDC |
| [Routing](https://forattini-dev.github.io/raffel/#/route-discovery) | Modules, discovery, REST Auto-CRUD |
| [USD + OpenAPI](https://forattini-dev.github.io/raffel/#/usd) | Specs from schemas |
| [MCP Server](https://forattini-dev.github.io/raffel/#/mcp) | Tools, resources, prompts |

---

## By the Numbers

| Metric | Value |
|--------|-------|
| **Protocols** | 7 (HTTP, WS, gRPC, JSON-RPC, GraphQL, TCP, UDP) |
| **Interceptors** | 20+ built-in |
| **Validation Libraries** | 5 supported |
| **Auth Strategies** | 8+ (JWT, API Key, OAuth2, OIDC, Basic, Session, etc.) |
| **MCP Tools** | 16 |
| **MCP Prompts** | 13 |

---

## Examples

```bash
# Clone and run examples
pnpm tsx examples/00-hello-world.ts
pnpm tsx examples/01-rest-api.ts
pnpm tsx examples/02-websocket-server.ts
pnpm tsx examples/03-rpc-server.ts
```

---

## Comparison

### vs Express, Koa, Fastify, Hono

| Feature | Express/Koa | Raffel |
|---------|-------------|--------|
| HTTP routing | ✅ | ✅ |
| WebSocket | ❌ separate | ✅ same handlers |
| gRPC | ❌ separate | ✅ same handlers |
| JSON-RPC | ❌ separate | ✅ same handlers |
| GraphQL | ❌ separate | ✅ same handlers |
| Unified validation | ❌ | ✅ one schema |
| Unified errors | ❌ | ✅ auto-converted |
| Unified auth | ❌ | ✅ all protocols |

### vs tRPC

| Feature | tRPC | Raffel |
|---------|------|--------|
| Type-safe RPC | ✅ | ✅ |
| HTTP | ✅ | ✅ |
| WebSocket | ✅ | ✅ |
| gRPC | ❌ | ✅ |
| JSON-RPC | ❌ | ✅ |
| TCP/UDP | ❌ | ✅ |
| Channels/Presence | ❌ | ✅ |
| File routing | ❌ | ✅ |

---

## License

ISC

---

<div align="center">

**[Documentation](https://forattini-dev.github.io/raffel)** · **[GitHub](https://github.com/forattini-dev/raffel)** · **[npm](https://www.npmjs.com/package/raffel)**

</div>
