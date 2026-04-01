<div align="center">

# Raffel

### One server. HTTP, WebSocket, gRPC, TCP, UDP — all at once.

[![npm version](https://img.shields.io/npm/v/raffel.svg?style=flat-square&color=8b5cf6)](https://www.npmjs.com/package/raffel)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[Quick Start](#quick-start) · [Full Documentation](https://forattini-dev.github.io/raffel) · [Examples](./examples) · [Migration Guide](#migrating-an-existing-http-app)

</div>

---

Raffel is a TypeScript runtime for building APIs, proxies, and traffic-aware infrastructure in one stack.

- Build HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP services with one project.
- Run reverse proxy, explicit proxy, CONNECT MITM, SOCKS5/SOCKS5h, and transparent proxy modes.
- Export service-mesh style telemetry with `source -> destination -> protocol`, p50/p90/p95, throughput, bytes, and error rates.
- Add resilience and policy with rate limit, retry, timeout, circuit breaker, validation, auth/session, filters, and proxy middleware.

Heavy edge features stay off by default. Telemetry, graph snapshots, Prometheus exporters, and proxy middleware only run when configured.

Need the right guide fast? Use the docs or the built-in MCP tools: `raffel_feature_catalog`, `raffel_proxy_capabilities`, `raffel_get_guide`, and `raffel_search`.

- **Protocols:** [HTTP](https://forattini-dev.github.io/raffel/#/protocols/http), [WebSocket](https://forattini-dev.github.io/raffel/#/protocols/websocket), [gRPC](https://forattini-dev.github.io/raffel/#/protocols/grpc), [UDP](https://forattini-dev.github.io/raffel/#/protocols/udp)
- **Proxies:** [Overview](https://forattini-dev.github.io/raffel/#/proxy), [Modes](https://forattini-dev.github.io/raffel/#/proxy/modes), [Routing](https://forattini-dev.github.io/raffel/#/proxy/routing), [Service Mesh](https://forattini-dev.github.io/raffel/#/proxy/service-mesh)
- **Observability:** [Flow Metrics](https://forattini-dev.github.io/raffel/#/proxy/flow-metrics), [Observability](https://forattini-dev.github.io/raffel/#/observability), [Tracing](https://forattini-dev.github.io/raffel/#/observability/tracing)

## Start with HTTP

```typescript
import { HttpApp, serve } from 'raffel'

const app = new HttpApp()

app.get('/users', async (c) => {
  return c.json(await db.users.findMany())
})

app.get('/users/:id', async (c) => {
  const user = await db.users.findById(c.req.param('id'))
  if (!user) return c.json({ error: 'Not found' }, 404)
  return c.json(user)
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(await db.users.create(body), 201)
})

serve({ fetch: app.fetch, port: 3000 })
```

`HttpApp` gives Raffel a native Fetch-style HTTP front door. Start with familiar
route and middleware concepts, then expand the same contracts across protocols.

---

## Quick Start

```bash
pnpm add raffel
```

### Hello World

```typescript
import { HttpApp, serve } from 'raffel'

const app = new HttpApp()

app.get('/hello/:name', (c) => c.text(`Hello, ${c.req.param('name')}!`))

serve({ fetch: app.fetch, port: 3000 })
```

### CRUD in 30 Seconds

```typescript
import { HttpApp, serve } from 'raffel'

const app = new HttpApp()
const users = new Map<string, unknown>()

app.get('/users', (c) => c.json([...users.values()]))

app.get('/users/:id', (c) => {
  const user = users.get(c.req.param('id'))
  return user ? c.json(user) : c.json({ error: 'Not found' }, 404)
})

app.post('/users', async (c) => {
  const user = { id: crypto.randomUUID(), ...(await c.req.json()) }
  users.set(user.id, user)
  return c.json(user, 201)
})

app.put('/users/:id', async (c) => {
  const id = c.req.param('id')
  if (!users.has(id)) return c.json({ error: 'Not found' }, 404)
  const user = { id, ...(await c.req.json()) }
  users.set(id, user)
  return c.json(user)
})

app.delete('/users/:id', (c) => {
  const id = c.req.param('id')
  return users.delete(id)
    ? c.json({ success: true })
    : c.json({ error: 'Not found' }, 404)
})

serve({ fetch: app.fetch, port: 3000 })
```

### Production-Ready `serve()`

```typescript
serve({
  fetch: app.fetch,
  port: 3000,
  keepAliveTimeout: 65000,   // slightly above load balancer idle timeout
  headersTimeout: 66000,
  onListen: ({ port, hostname }) => console.log(`Listening on ${hostname}:${port}`),
})
```

---

## Developer Experience In 2026

Raffel now ships with an inspection-first workflow for multi-protocol services:

```bash
# optional, for a global CLI
npm i -g raffel

npx raffel new api my-service
cd my-service
pnpm install
npx raffel inspect src/server.ts
npx raffel explain "users.list" src/server.ts
npx raffel doctor src/server.ts
npx raffel playground src/server.ts --port 4301
npx raffel contract-tests src/server.ts
pnpm dev
```

The same runtime graph powers:

- `server.preview()`
- `raffel inspect`
- `raffel explain`
- `raffel doctor`
- `raffel playground`
- `raffel contract-tests`
- OpenAPI/USD output

That keeps your docs, runtime bindings, local tooling, and contract checks
aligned.

---

## Wait, There's More

Raffel is not just an HTTP framework. It's a **unified multi-protocol runtime**. Every handler you write is protocol-agnostic — the same business logic runs over HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP.

### The Procedure API

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer({
  port: 3000,
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
})

server
  .procedure('users.create')
  .input(z.object({ name: z.string().min(2), email: z.string().email() }))
  .output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
  .handler(async (input, ctx) => {
    return db.users.create(input)
  })

await server.start()
```

**Same handler. Every protocol. Zero extra code.**

```bash
# HTTP
curl -X POST http://localhost:3000/users \
  -d '{"name":"Alice","email":"alice@example.com"}'

# WebSocket
wscat -c ws://localhost:3000/ws
> {"method":"users.create","params":{"name":"Alice","email":"alice@example.com"}}

# JSON-RPC 2.0
curl -X POST http://localhost:3000/rpc \
  -d '{"jsonrpc":"2.0","method":"users.create","params":{...},"id":1}'
```

### Streaming

```typescript
// Server → client stream
server
  .stream('logs.tail')
  .handler(async function* ({ file }) {
    for await (const line of readLines(file)) {
      yield { line, timestamp: Date.now() }
    }
  })

// Bidirectional stream
server
  .stream('chat.session')
  .bidi()
  .handler(async (stream, ctx) => {
    for await (const msg of stream) {
      await stream.write({ echo: msg, from: ctx.auth?.userId })
    }
  })
```

### Events with Delivery Guarantees

```typescript
server
  .event('emails.send')
  .delivery('at-least-once')
  .handler(async (payload, ctx, ack) => {
    await sendEmail(payload)
    ack()
  })
```

---

## The Full Picture

| Module | What it does |
|--------|-------------|
| **HTTP** | Native HTTP front door + `serve()` with production timeouts |
| **WebSocket** | Real-time adapter + Pusher-like channels (public/private/presence) |
| **gRPC** | Full gRPC adapter with TLS and streaming |
| **JSON-RPC 2.0** | Batch + notification + error codes per spec |
| **GraphQL** | Schema-first adapter with subscriptions |
| **TCP / UDP** | Raw socket handlers with connection filters |
| **Single-Port** | Sniff protocol on one port — HTTP, WS, gRPC, gRPC-Web all on `:3000` |
| **Interceptors** | Rate limit, circuit breaker, retry, timeout, cache, bulkhead, and more |
| **Session Store** | Memory + Redis drivers with lazy load + auto-save |
| **Proxy Suite** | HTTP forward, CONNECT tunnel (MITM), SOCKS5, transparent |
| **Metrics** | Prometheus-style counters, gauges, histograms with exporters |
| **Tracing** | OpenTelemetry spans with Jaeger / Zipkin exporters |
| **OpenAPI** | Generate spec from schemas + serve ReDoc / Swagger UI |
| **Channels** | Pusher-like pub/sub with presence and authorization |
| **MCP Server** | Model Context Protocol for AI-assisted development |
| **Testing** | Full mock suite: HTTP, WS, TCP, UDP, DNS, SSE, Proxy |
| **Validation** | Plug in Zod, Yup, Joi, Ajv, or fastest-validator |

---

## Interceptors

Interceptors are reusable middleware that compose cleanly across any protocol.

```typescript
import {
  createRateLimitInterceptor,
  createCircuitBreakerInterceptor,
  createRetryInterceptor,
  createTimeoutInterceptor,
  createCacheInterceptor,
  createLoggingInterceptor,
  createTracingInterceptor,
} from 'raffel'

server
  .procedure('users.list')
  .use(createTimeoutInterceptor({ timeout: 5000 }))
  .use(createRateLimitInterceptor({ limit: 100, window: '1m' }))
  .use(createCacheInterceptor({ ttl: 60, store: cacheStore }))
  .use(createLoggingInterceptor())
  .handler(async () => db.users.findMany())
```

Apply globally, per-group, or per-procedure:

```typescript
// Global
server.use(createTracingInterceptor({ tracer }))
server.use(createLoggingInterceptor())

// Group / module
const adminModule = createRouterModule('admin', [requireAdmin])
adminModule.procedure('users.delete').handler(...)

// Per-procedure
server.procedure('payments.charge')
  .use(createCircuitBreakerInterceptor({ threshold: 5, timeout: 30000 }))
  .use(createRetryInterceptor({ attempts: 3, backoff: 'exponential' }))
  .handler(...)
```

| Interceptor | Purpose |
|-------------|---------|
| `createRateLimitInterceptor` | Token bucket / sliding window (memory, Redis, filesystem) |
| `createCircuitBreakerInterceptor` | Auto-open after failures, half-open probe |
| `createBulkheadInterceptor` | Concurrency isolation per procedure |
| `createRetryInterceptor` | Exponential backoff with jitter |
| `createTimeoutInterceptor` | Per-phase, cascading, deadline propagation |
| `createCacheInterceptor` | Read-through / write-through (memory, file, Redis) |
| `createDedupInterceptor` | In-flight request deduplication |
| `createSizeLimitInterceptor` | Request / response size guard |
| `createFallbackInterceptor` | Return default on failure |
| `createRequestIdInterceptor` | Inject/propagate correlation IDs |
| `createLoggingInterceptor` | Structured request/response logging |
| `createMetricsInterceptor` | Auto-instrument with Prometheus metrics |
| `createTracingInterceptor` | OpenTelemetry span creation |
| `createSessionInterceptor` | Session load/save via memory or Redis |
| `createValidationInterceptor` | Schema validation on input/output |
| `createAuthMiddleware` | Bearer token, API key strategies |

---

## Channels (Real-Time Pub/Sub)

Pusher-compatible channel model over WebSocket.

```typescript
import { createChannelManager } from 'raffel'

const channels = createChannelManager(
  {
    authorize: async (socketId, channel, ctx) => {
      // private-* and presence-* channels require auth
      return { authorized: !!ctx.auth }
    },
    presence: {
      onJoin: (channel, member) => broadcastPresence(channel),
      onLeave: (channel, member) => broadcastPresence(channel),
    },
  },
  (socketId, message) => ws.sendToClient(socketId, message)
)

// Subscribe
await channels.subscribe(socketId, 'presence-room:42', ctx)

// Broadcast to all subscribers
channels.broadcast('presence-room:42', 'new-message', { text: 'Hello!' })

// Get online members
const members = channels.getMembers('presence-room:42')
```

Channel types: `public-*` (anyone), `private-*` (authorized), `presence-*` (auth + member tracking).

---

## Proxy Suite

Full proxy toolkit built into Raffel — no extra dependencies.

### HTTP Forward Proxy

```typescript
import { createHttpForwardProxy } from 'raffel'

const proxy = createHttpForwardProxy({
  auth: { credentials: { username: 'admin', password: 'secret' } },
  filter: {
    allowHosts: ['*.trusted.com', 'api.internal'],
    denyHosts: ['*.evil.com'],
  },
  onRequest: (req) => { /* log or modify */ return req },
})

proxy.attachTo(httpServer)
```

### CONNECT Tunnel (with MITM)

```typescript
import { createConnectTunnel } from 'raffel'

// Plain CONNECT tunnel
const tunnel = createConnectTunnel({ mode: 'forward' })

// MITM: inspect and modify HTTPS traffic
const mitm = createConnectTunnel({
  mode: 'mitm',
  onRequest: (req) => {
    req.headers['x-intercepted'] = 'true'
    return req
  },
  onResponse: (res) => {
    res.headers['x-inspected'] = 'true'
    return res
  },
  onUpstreamCert: (cert) => trustedCerts.has(cert.fingerprint),  // cert pinning
})
```

### Unified Proxy Middleware

```typescript
import { createProxySuite } from 'raffel'

const suite = createProxySuite({
  explicit: {
    port: 8080,
    middleware: [
      async (ctx, next) => {
        if (ctx.kind === 'http-request' || ctx.kind === 'mitm-request') {
          ctx.request.headers['x-raffel-policy'] = 'edge-a'
        }

        if (ctx.kind === 'connect' && ctx.target.host.endsWith('.blocked.internal')) {
          ctx.blocked = { statusCode: 403, reason: 'blocked by policy' }
          return
        }

        if (ctx.kind === 'upgrade-request' && ctx.target.host === 'ws.internal.local') {
          ctx.target.port = 4102
        }

        await next()
      },
    ],
    tunnel: { mode: 'mitm' },
  },
  socks5: {
    port: 1080,
    middleware: [
      async (ctx, next) => {
        if (ctx.kind === 'socks5-connect' && ctx.target.host === 'db.internal') {
          ctx.target.host = 'db-replica.internal'
        }
        await next()
      },
    ],
  },
})
```

One middleware model now spans reverse, explicit, MITM, SOCKS5/SOCKS5h, and transparent flows.
Use it to inspect, block, rewrite destinations, shape headers, and attach policy logic only where configured.

### Explicit Proxy Server

```typescript
import { createExplicitProxy } from 'raffel'

const proxy = createExplicitProxy({
  port: 8080,
  auth: { credentials: { username: 'admin', password: 'secret' } },
  tunnel: { mode: 'forward' },
  telemetry: {
    sourceHeader: 'x-service-name',
    metricsEndpoint: '/metrics',
    graphEndpoint: '/proxy/graph',
    defaultLabels: { proxy: 'mesh-edge-a' },
    percentiles: [0.5, 0.9, 0.95],
  },
})

await proxy.start()

// Prometheus: GET http://127.0.0.1:8080/metrics
// Graph JSON: GET http://127.0.0.1:8080/proxy/graph
// Programmatic: proxy.graphSnapshot()
// Edge latency: snapshot.edges[0].latency.percentiles.p95
```

### SOCKS5 Proxy

```typescript
import { createSocks5Proxy } from 'raffel'

const socks5 = createSocks5Proxy({
  port: 1080,
  auth: { credentials: { username: 'alice', password: 'secret' } },
  telemetry: {
    defaultLabels: { proxy: 'mesh-socks' },
  },
})
await socks5.start()

// Supports CONNECT, BIND, and UDP ASSOCIATE.
// SOCKS5h is supported by sending hostnames (ATYP 0x03).
// Telemetry protocols: socks5, socks5h, socks5-bind, socks5h-bind, socks5-udp, socks5h-udp.
```

### Unified HTTP + HTTPS + SOCKS5h Suite

```typescript
import { createProxySuite } from 'raffel'

const suite = createProxySuite({
  explicit: {
    port: 8080,
    tunnel: { mode: 'forward' }, // HTTPS via CONNECT
  },
  socks5: {
    port: 1080,
    auth: { credentials: { username: 'svc-billing', password: 'secret' } },
  },
  telemetry: {
    sourceHeader: 'x-service-name',
    metricsEndpoint: '/metrics',
    graphEndpoint: '/proxy/graph',
    percentiles: [0.5, 0.9, 0.95],
    defaultLabels: { proxy: 'mesh-gateway' },
  },
})

await suite.start()

// Shared graph across HTTP, HTTPS/CONNECT, and SOCKS5 CONNECT/BIND/UDP:
// GET http://127.0.0.1:8080/proxy/graph
// Shared Prometheus metrics:
// GET http://127.0.0.1:8080/metrics
```

### Transparent Proxy (Linux TPROXY)

```typescript
import { createTransparentProxy } from 'raffel'

const proxy = createTransparentProxy({
  mode: 'tproxy',
  port: 8080,
})

await proxy.start()
```

---

## Session Store

```typescript
import { createSessionInterceptor, createRedisSessionDriver } from 'raffel'

const sessions = createSessionInterceptor({
  driver: createRedisSessionDriver({ client: redis }),
  cookie: { name: 'sid', httpOnly: true, secure: true, sameSite: 'lax' },
  ttl: 86400,
})

server.use(sessions)

server.procedure('auth.me').handler(async (_, ctx) => {
  // ctx.session is loaded lazily, saved automatically
  const { userId } = ctx.session.get()
  return db.users.findById(userId)
})
```

Drivers: `createMemorySessionDriver()`, `createRedisSessionDriver({ client })`.

---

## OpenAPI + Docs UI

```typescript
import { mountOpenApiDocs } from 'raffel'

server.enableUSD({
  info: { title: 'My API', version: '1.0.0' },
})

const spec = server.getOpenAPIDocument()
if (!spec) throw new Error('OpenAPI document is not available')

// Mount /openapi.json + /docs (ReDoc or Swagger UI)
mountOpenApiDocs(app, {
  spec,
  ui: 'redoc',       // or 'swagger'
  path: '/docs',
})
```

---

## Metrics & Tracing

### Prometheus Metrics

```typescript
import { createMetricRegistry, createMetricsInterceptor, exportPrometheus } from 'raffel'

const metrics = createMetricRegistry()

server.use(createMetricsInterceptor({ registry: metrics }))

// Expose /metrics endpoint
app.get('/metrics', (c) => c.text(exportPrometheus(metrics), 200, {
  'Content-Type': 'text/plain; version=0.0.4',
}))
```

### OpenTelemetry Tracing

```typescript
import { createTracer, createTracingInterceptor, createJaegerExporter } from 'raffel'

const tracer = createTracer({
  serviceName: 'my-api',
  exporter: createJaegerExporter({ endpoint: 'http://jaeger:14268/api/traces' }),
  sampler: createProbabilitySampler(0.1),  // 10% sampling
})

server.use(createTracingInterceptor({ tracer }))
```

---

## Health Checks

```typescript
import { createHealthCheckProcedures, CommonProbes } from 'raffel'

const health = createHealthCheckProcedures({
  probes: [
    CommonProbes.memory({ maxHeapMb: 512 }),
    CommonProbes.uptime(),
    {
      name: 'database',
      check: async () => {
        await db.ping()
        return { status: 'healthy' }
      },
    },
  ],
})

server.mount('/', health)
// Registers: health.live, health.ready, health.startup
```

---

## Connection Filters

Control who can connect to your TCP, UDP, and WebSocket adapters.

```typescript
import { createTcpAdapter } from 'raffel'

const tcp = createTcpAdapter(router, {
  connectionFilter: {
    allowHosts: ['10.0.0.*', 'trusted.internal'],
    denyHosts: ['*.untrusted.net'],
    onDenied: (host, port) => logger.warn(`Blocked connection from ${host}:${port}`),
  },
})
```

WebSocket adds origin filtering:

```typescript
const ws = createWebSocketAdapter(router, {
  connectionFilter: {
    allowOrigins: ['https://app.example.com'],
    denyOrigins: ['*'],
  },
})
```

---

## Single-Port Multi-Protocol

Run HTTP, WebSocket, gRPC, and gRPC-Web all on the same port. Raffel sniffs the protocol from the first bytes.

```typescript
const server = createServer({
  port: 3000,
  singlePort: {
    http: true,
    websocket: true,
    grpc: true,
    grpcWeb: true,
  },
})
```

---

## File-Based Routing

Drop files into a directory. Raffel discovers and registers them automatically.

```
routes/
  users/
    index.ts      → GET /users
    [id].ts       → GET /users/:id
    [id]/posts.ts → GET /users/:id/posts
  tcp/
    echo.ts       → TCP handler "echo"
  udp/
    ping.ts       → UDP handler "ping"
```

```typescript
const server = createServer({
  port: 3000,
  discovery: { dir: './routes', watch: true },  // hot-reload in dev
})
```

---

## Testing Mocks

A complete mock infrastructure for integration tests — no external services needed.

```typescript
import { MockServiceSuite } from 'raffel'

const suite = new MockServiceSuite()
await suite.start()

const { http, ws, tcp, udp, dns, sse, proxy } = suite

// HTTP mock with request recording
http.onGet('/users', { body: [{ id: '1' }] })
const requests = await http.waitForRequests(1)

// WebSocket mock with pattern responses
ws.setResponse(/ping/, 'pong')
ws.dropRate = 0.1  // simulate 10% packet loss

// DNS mock
dns.addRecord('api.example.com', 'A', '127.0.0.1')

// SSE mock
sse.emit('data', { event: 'update', data: '{"count":42}' })

await suite.stop()
```

| Mock | Features |
|------|---------|
| `MockHttpServer` | CORS, global delay, streaming, `times`, statistics |
| `MockWebSocketServer` | Pattern responses, drop rate, max connections, auto-close |
| `MockTcpServer` | Echo + custom handlers |
| `MockUdpServer` | UDP responder |
| `MockDnsServer` | DNS over UDP (RFC 1035), no deps |
| `MockSSEServer` | Server-Sent Events |
| `MockProxyServer` | HTTP forward + MITM with hooks |

---

## Spec-Driven Mock Server

You can also stand up mock endpoints directly from OpenAPI or USD documents:

```typescript
import { createMockServer } from 'raffel'

const openapi = server.getOpenAPIDocument()
if (!openapi) throw new Error('OpenAPI document is not available')

await createMockServer({
  spec: openapi,
  port: 4100,
})
```

This gives you:

- HTTP routes extracted from documented endpoints
- example-first responses with schema-generated fallback data
- request validation from the same contract
- optional JSON-RPC and WebSocket mocks when the source document is USD

It is useful for frontend handoff, local integration tests, and spec-first
development.

---

## Validation

Bring your own validator. Raffel adapts to it.

```typescript
import { registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

server
  .procedure('users.create')
  .input(z.object({ name: z.string().min(2), email: z.string().email() }))
  .handler(async (input) => db.users.create(input))
```

Adapters available: `createZodAdapter`, `createYupAdapter`, `createJoiAdapter`, `createAjvAdapter`, `createFastestValidatorAdapter`.

---

## MCP Server (AI Integration)

Raffel ships an MCP server for AI-assisted development. It gives tools like Claude direct knowledge of your API.

```bash
# Add to Claude Code
claude mcp add raffel npx raffel-mcp

# Or run directly
npx raffel-mcp
```

Provides: live documentation, code generation prompts (`add_oauth2`, `add_sessions`, etc.), and pattern guidance.

---

## Migrating an Existing HTTP App

Raffel can front an existing HTTP application model, but its goal is bigger than
HTTP parity. Migrate by mapping routes, middleware, validation, and lifecycle
concepts into Raffel's runtime model, then reuse the same contracts across other
transports.

See the [migration guide](./docs/migration/frameworks.md) for concept mapping from
Express, Fastify, Fetch-first routers, `ws`, and Socket.IO.

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Quick Start](https://forattini-dev.github.io/raffel/#/quickstart) | 5-minute guide |
| [HTTP Guide](https://forattini-dev.github.io/raffel/#/protocols/http) | REST, middleware, routing, serve() |
| [Authentication](https://forattini-dev.github.io/raffel/#/auth/overview) | JWT, API Key, OAuth2, OIDC, Sessions |
| [Interceptors](https://forattini-dev.github.io/raffel/#/interceptors) | Rate limit, circuit breaker, cache, etc. |
| [WebSocket](https://forattini-dev.github.io/raffel/#/protocols/websocket) | Real-time, channels, presence |
| [Proxy Suite](https://forattini-dev.github.io/raffel/#/proxy) | Forward, CONNECT, SOCKS5, transparent |
| [Metrics & Tracing](https://forattini-dev.github.io/raffel/#/observability) | Prometheus, OpenTelemetry |
| [Core Model](https://forattini-dev.github.io/raffel/#/core-model) | Envelope, Context, Router, architecture |
| [File-based Routing](https://forattini-dev.github.io/raffel/#/file-system-discovery) | Zero-config discovery |
| [Migration Guide](./docs/migration/frameworks.md) | Concept mapping from existing HTTP and realtime stacks |

---

## License

ISC

---

<div align="center">

**[Documentation](https://forattini-dev.github.io/raffel)** · **[GitHub](https://github.com/tetis-io/raffel)** · **[npm](https://www.npmjs.com/package/raffel)**

</div>
