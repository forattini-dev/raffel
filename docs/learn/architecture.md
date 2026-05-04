# Architecture

This page explains how Raffel works under the hood. Understanding the architecture
will help you use the runtime more efficiently and reason about contracts,
policies, transports, and observability as one system.

---

## The Core Idea

Raffel solves a broader problem than routing HTTP requests: you want one contract
and one operational model to drive HTTP, WebSocket, gRPC, JSON-RPC, GraphQL,
streams, and events without duplicating business logic or policy wiring.

The solution is simple: **normalize everything to a single format**, then attach
policies, tooling, and transport adapters around that contract.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │     │   Client    │     │   Client    │
│    HTTP     │     │  WebSocket  │     │    gRPC     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Adapter   │     │   Adapter   │     │   Adapter   │
│    HTTP     │     │  WebSocket  │     │    gRPC     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Envelope  │  ← Normalized format
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Router    │  ← Finds the handler
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Interceptors│  ← Logging, auth, etc
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Handler   │  ← Your business logic
                    └─────────────┘
```

No matter where the request came from — HTTP, WebSocket, gRPC — it is converted
to an **Envelope** and processed through the same runtime model.

---

## The Envelope

The Envelope is the heart of Raffel. It is the data structure that represents any request, regardless of protocol:

```typescript
interface Envelope {
  // Unique request identifier (for tracing/correlation)
  id: string

  // Procedure name (e.g. 'users.create')
  procedure: string

  // Message type
  type: 'request' | 'response' | 'stream:data' | 'stream:end' | 'event'

  // Data sent by the client
  payload: unknown

  // Protocol metadata (headers, etc.)
  metadata: Record<string, string>

  // Metadata and state
  context: Context
}
```

### Conversion Examples

**HTTP Request → Envelope:**

```
POST /users.create HTTP/1.1
Content-Type: application/json

{"name": "Alice", "email": "alice@example.com"}
```

Becomes:

```typescript
{
  id: "req_abc123",
  procedure: "users.create",
  type: "request",
  payload: { name: "Alice", email: "alice@example.com" },
  metadata: { /* headers, etc */ },
  context: { /* auth, tracing, etc */ }
}
```

**WebSocket Message → Envelope:**

```json
{"procedure": "users.create", "payload": {"name": "Alice"}}
```

Becomes the same Envelope! The only difference is the transport.

**gRPC Call → Envelope:**

```protobuf
service Users {
  rpc Create(CreateRequest) returns (CreateResponse);
}
```

Also becomes the same Envelope. The procedure name is `Users.Create`.

---

## The Context

The Context carries information about the request that is not the data itself.
In Raffel, context is also the vehicle for deadlines, tracing, auth, extensions,
and internal-call propagation:

```typescript
interface Context {
  // Unique request identifier
  requestId: string

  // Authentication information (if present)
  auth?: {
    authenticated: boolean
    principal?: string      // User ID
    claims?: Record<string, unknown>  // Token data
  }

  // Distributed tracing context
  tracing: {
    traceId: string
    spanId: string
    parentSpanId?: string
  }

  // Cancellation signal (AbortSignal)
  signal: AbortSignal

  // Deadline (ms since epoch)
  deadline?: number

  // Custom extensions
  extensions: Map<symbol, unknown>

  // Call another procedure while preserving context
  call?: (procedure: string, input: unknown) => Promise<unknown>

  // Cascading call level (0 = top-level)
  callingLevel?: number
}
```

The Context is passed to your handler as the second argument:

```typescript
const server = createServer({ port: 3000 })

server.procedure('users.me')
  .handler(async (input, ctx) => {
    // ctx.auth contains authenticated user data
    // ctx.tracing contains trace/span IDs
    // ctx.extensions stores custom data
    return { userId: ctx.auth?.principal }
  })
```

---

## Adapters

Adapters are responsible for converting requests from the specific protocol to an Envelope and back.

### How an Adapter Works

```typescript
// Simplified - the HTTP adapter does this internally
class HttpAdapter {
  async handleRequest(req: Request): Promise<Response> {
    // 1. Extract information from the HTTP request
    const procedure = req.url.pathname.slice(1)  // /users.create → users.create
    const payload = await req.json()
    const headers = Object.fromEntries(req.headers)

    // 2. Create the Envelope
    const envelope: Envelope = {
      id: generateId(),
      procedure,
      type: 'request',
      payload,
      context: {
        id: generateId(),
        headers,
        params: {},
        query: parseQuery(req.url),
        signal: req.signal,
        metadata: {}
      }
    }

    // 3. Pass to the Router
    const result = await this.router.handle(envelope)

    // 4. Convert response back to HTTP
    return new Response(JSON.stringify(result.payload), {
      status: result.type === 'error' ? 400 : 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### Available Adapters

| Adapter | Protocol | Default Port |
|:--------|:---------|:-------------|
| `HttpAdapter` | HTTP/HTTPS | 3000 |
| `WebSocketAdapter` | WebSocket | 3000 (same as HTTP) |
| `JsonRpcAdapter` | JSON-RPC 2.0 | 3000/rpc |
| `GraphQLAdapter` | GraphQL | 3000/graphql |
| `GrpcAdapter` | gRPC | 50051 |
| `TcpAdapter` | TCP raw | 9000 |
| `UdpAdapter` | UDP raw | 9001 |

---

## Router

The Router receives an Envelope and finds the correct handler to process it.

```typescript
// Internally, the Router maintains a registry of handlers
class Router {
  private handlers: Map<string, Handler> = new Map()

  register(procedure: string, handler: Handler) {
    this.handlers.set(procedure, handler)
  }

  async handle(envelope: Envelope): Promise<Envelope> {
    // 1. Find the handler
    const handler = this.handlers.get(envelope.procedure)
    if (!handler) {
      return createErrorEnvelope('PROCEDURE_NOT_FOUND')
    }

    // 2. Execute interceptors (onion model)
    const ctx = envelope.context
    const result = await this.runInterceptors(envelope, ctx, handler.fn)

    // 3. Return response
    return createResponseEnvelope(result)
  }
}
```

---

## Interceptors

Interceptors are functions that wrap the handler in an "onion" style and have access
to the full Envelope.

```typescript
type Interceptor = (
  envelope: Envelope,
  ctx: Context,
  next: () => Promise<unknown>
) => Promise<unknown>
```

### Execution Order

```
Request arrives
    │
    ▼
┌─────────────────┐
│ Interceptor 1   │
│   (logging)     │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Interceptor 2   │
│   (rateLimit)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Interceptor 3   │
│    (auth)       │
└────────┬────────┘
         ▼
┌─────────────────┐
│    Handler      │
└────────┬────────┘
         ▼
    Response leaves
```

Each interceptor can execute logic before and after `await next()`:

```typescript
const logging: Interceptor = async (envelope, ctx, next) => {
  const start = Date.now()
  try {
    return await next()
  } finally {
    const duration = Date.now() - start
    console.log(`← ${envelope.procedure} ${duration}ms`)
  }
}
```

---

## Full Flow

Let's follow a request from start to finish:

### 1. Client Makes HTTP Request

```bash
curl -X POST http://localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJ...' \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

### 2. HTTP Adapter Receives

```typescript
// HttpAdapter.handleRequest()
const envelope = {
  id: "req_7x8y9z",
  procedure: "users.create",
  type: "request",
  payload: { name: "Alice", email: "alice@example.com" },
  metadata: {
    'content-type': 'application/json',
    'authorization': 'Bearer eyJ...'
  },
  context: {
    requestId: "req_7x8y9z",
    tracing: { traceId: "req_7x8y9z", spanId: "req_7x8y9z" },
    signal: AbortSignal,
    extensions: new Map()
  }
}
```

### 3. Router Processes

```typescript
// Router.handle(envelope)

// 3a. Execute interceptors (onion model)
// logging: marks startTime
// auth: decodes JWT, populates ctx.auth
// validation: validates input

// 3b. Execute handler
const result = await handler(envelope.payload, envelope.context)
// result = { id: "usr_abc", name: "Alice", email: "alice@example.com" }

// 3c. Interceptors finalize
// logging: logs duration
```

### 4. HTTP Adapter Responds

```typescript
// Converts result to HTTP Response
return new Response(JSON.stringify({
  id: "usr_abc",
  name: "Alice",
  email: "alice@example.com"
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
})
```

### 5. Client Receives

```json
{"id": "usr_abc", "name": "Alice", "email": "alice@example.com"}
```

---

## Streaming

For streams, the flow is slightly different. Instead of a single response, the handler is a generator that yields multiple values:

```typescript
// Stream handler
async function* logsHandler({ file }) {
  yield { line: "Log 1", ts: 1234 }
  yield { line: "Log 2", ts: 1235 }
  yield { line: "Log 3", ts: 1236 }
}
```

The Adapter converts each `yield` to the protocol's format:

**WebSocket:**
```
← {"type": "stream:data", "data": {"line": "Log 1", "ts": 1234}}
← {"type": "stream:data", "data": {"line": "Log 2", "ts": 1235}}
← {"type": "stream:data", "data": {"line": "Log 3", "ts": 1236}}
← {"type": "stream:end"}
```

**HTTP (Server-Sent Events):**
```
data: {"line": "Log 1", "ts": 1234}

data: {"line": "Log 2", "ts": 1235}

data: {"line": "Log 3", "ts": 1236}

event: end
```

**gRPC:**
```
ServerStream<LogEntry> → multiple protobuf messages
```

---

## Registry

The Registry is where all handlers, interceptors, and configurations are stored:

```typescript
interface Registry {
  // Handler registration
  procedure(name: string, handler: ProcedureHandler, options?: ProcedureOptions): void
  stream(name: string, handler: StreamHandler, options?: StreamOptions): void
  event(name: string, handler: EventHandler, options?: EventOptions): void

  // Introspection
  list(): HandlerMeta[]
  listProcedures(): HandlerMeta[]
  listStreams(): HandlerMeta[]
  listEvents(): HandlerMeta[]
}
```

When you call `createServer()`, internally we are populating the Registry:

```typescript
// This:
const server = createServer({ port: 3000 })
server.procedure('hello').handler(({ name }) => `Hello, ${name}!`)

// Does this internally:
const registry = createRegistry()
registry.procedure('hello', ({ name }) => `Hello, ${name}!`)

const httpAdapter = new HttpAdapter(registry, { port: 3000 })
const wsAdapter = new WebSocketAdapter(registry, { port: 3000 })

await httpAdapter.start()
await wsAdapter.start()
```

---

## Front-Door

The Front-Door is a routing layer at the edge of the HTTP server that classifies each incoming request by application protocol before dispatching it to the correct handler.

```
[HTTP Connection] → [Front-Door] → detects protocol → dispatches
                                    ├── HTTP       → HttpAdapter
                                    ├── WebSocket  → WebSocketAdapter (Upgrade)
                                    ├── JSON-RPC   → JsonRpcAdapter (POST /rpc)
                                    └── GraphQL    → GraphQLAdapter (POST/GET /graphql)
```

Enable it with the `frontDoor` option in `createServer()`. TCP/gRPC protocols remain on dedicated ports with the `offload` strategy.

---

## Single-Port Detection

The Single-Port subsystem operates at the transport layer (TCP), even before any HTTP parsing. It reads the first bytes of each new connection and decides the protocol:

```
[TCP Socket] → [Single-Port Sniffer] → detects protocol → dispatches
                                         ├── TLS     → TLS termination
                                         ├── HTTP/2  → HTTP/2 handler
                                         ├── HTTP    → HttpAdapter
                                         └── TCP     → TcpAdapter
```

Useful when only one port is available (restricted firewall) and you need to serve multiple protocols simultaneously. Configure via `singlePort` in `createServer()`.

---

## Hexagonal Architecture

Raffel follows a pragmatic hexagonal (ports & adapters) architecture. The codebase is organized into concentric layers with explicit boundaries:

```
                    ┌─────────────────────────────────────────────┐
                    │              bootstrap/                      │
                    │   create-server · config-normalization       │
                    │   protocol-wiring                            │
                    │                                              │
                    │  ┌───────────────────────────────────────┐  │
                    │  │           application/                 │  │
                    │  │   registration · lifecycle             │  │
                    │  │   discovery · runtime-preview          │  │
                    │  │                                        │  │
                    │  │  ┌─────────────────────────────────┐  │  │
                    │  │  │            core/                 │  │  │
                    │  │  │   Registry · Router · Envelope   │  │  │
                    │  │  │   EventDelivery · RaffelError    │  │  │
                    │  │  └─────────────────────────────────┘  │  │
                    │  │                                        │  │
                    │  │  ┌─────────────────────────────────┐  │  │
                    │  │  │         ports/outbound/          │  │  │
                    │  │  │   LoggerPort · SessionStore      │  │  │
                    │  │  │   CacheDriver · RateLimitDriver  │  │  │
                    │  │  │   ValidatorAdapter · EventStore  │  │  │
                    │  │  │   ChannelPresencePort            │  │  │
                    │  │  └─────────────────────────────────┘  │  │
                    │  └───────────────────────────────────────┘  │
                    │                                              │
  ┌──────────┐     │  ┌──────────────┐   ┌──────────────────┐    │
  │  Client   │◄──►│  │ adapters/    │   │  adapters/        │    │
  │  HTTP/WS  │    │  │ inbound/     │   │  outbound/        │    │
  │  gRPC/TCP │    │  │  http        │   │   session/memory  │    │
  │  JSON-RPC │    │  │  websocket   │   │   rate-limit/redis│    │
  └──────────┘     │  │  grpc · tcp  │   │   cache/file      │    │
                    │  │  udp · jsonrpc│   │   logger/pino     │    │
                    │  └──────────────┘   └──────────────────┘    │
                    └─────────────────────────────────────────────┘
```

### Directory Structure

| Layer | Directory | Purpose |
|:------|:----------|:--------|
| **Core** | `src/core/` | Domain logic — Registry, Router, EventDelivery. Zero external deps. |
| **Ports** | `src/ports/outbound/` | Interfaces (contracts) for infrastructure dependencies. |
| **Application** | `src/application/` | Orchestration — registration, lifecycle, discovery, preview. |
| **Bootstrap** | `src/bootstrap/` | Composition root — creates server, normalizes config, wires adapters. |
| **Inbound Adapters** | `src/adapters/inbound/` | Protocol → Envelope translation (HTTP, WS, gRPC, TCP, UDP, JSON-RPC). |
| **Outbound Adapters** | `src/adapters/outbound/` | Concrete port implementations (session, rate-limit, cache, logger drivers). |

### Boundary Rules

1. **core/** has zero imports from adapters/, bootstrap/, or application/
2. **application/** depends on core/ and ports/ — never on concrete outbound adapters
3. **ports/** defines interfaces only — no implementation logic
4. **bootstrap/** is the composition root — it wires everything together
5. **adapters/inbound/** translate protocols to Envelopes
6. **adapters/outbound/** implement port interfaces with concrete infrastructure

### Key Ports

| Port | Interface | Default Adapter |
|:-----|:----------|:----------------|
| `LoggerPort` | `debug/info/warn/error` | pino (`adapters/outbound/logger/pino`) |
| `SessionStore` | `get/set/delete/touch` | memory, redis |
| `RateLimitDriver` | `increment/get/reset` | memory, filesystem, redis, s3db |
| `CacheDriver` | `get/set/delete/clear` | memory, file, redis |
| `EventDeliveryStore` | `getRetryState/isDuplicate` | in-memory |
| `ValidatorAdapter` | `validate/toJsonSchema` | zod, yup, joi, ajv |
| `ChannelPresencePort` | `getMembers/addMember` | in-memory (ChannelManager) |

---

## Internal Builder Modules

The server builder is composed of independent modules:

| Module | Responsibility |
|:-------|:---------------|
| `application/registration.ts` | Handler, channel, and resource registration orchestration |
| `application/config-preview.ts` | Pure config preview and warning derivation |
| `application/runtime-preview.ts` | Config preview and runtime inspection graph |
| `bootstrap/config-normalization.ts` | Protocol option normalization |
| `bootstrap/create-server.ts` | Canonical bootstrap entrypoint for `createServer()` |
| `bootstrap/protocol-wiring.ts` | Protocol lifecycle wiring façade |
| `server/discovery-bootstrap.ts` | Filesystem-based route discovery and hot-reload |
| `server/builder/lifecycle.ts` | Startup/shutdown sequencing and adapter composition |
| `server/front-door.ts` | Application protocol detection at the HTTP edge |
| `server/single-port/` | Transport protocol detection (TCP sniffing) |
| `server/handler-builders.ts` | Fluent API for registering procedures, streams, events |

---

## Summary

1. **Envelope** - Normalized format that represents any request
2. **Context** - Request metadata (auth, tracing, cancellation, extensions)
3. **Ports** - Interfaces defining infrastructure boundaries
4. **Inbound Adapters** - Convert specific protocols to/from Envelope
5. **Outbound Adapters** - Implement ports with concrete infrastructure
6. **Router** - Finds and executes the correct handler
7. **Interceptors** - Logic that runs before/after every handler
8. **Registry** - Stores all server configuration
9. **Application** - Orchestrates registration, lifecycle, discovery
10. **Bootstrap** - Composition root that wires everything together

The beauty of the design is that your business logic (the handler) knows nothing about protocols. It receives data, processes it, and returns a result. The adapters take care of the rest.

---

## Next Steps

- **[HTTP in Detail](/protocols/http.md)** - HTTP adapter customization
- **[Single-Port Detection](/protocols/single-port.md)** - Multiplexing protocols on one port
- **[Interceptors](/core/interceptors/overview.md)** - All available interceptors
- **[Streaming](/core/streams.md)** - How streams work in detail

---

## Authorization (opt-in)

Raffel separates **authentication** (who) from **authorization** (what they may do). The optional [policy engine](/policies/README.md) sits in the request pipeline *after* authentication and validation, *before* the handler. Procedures gate themselves by calling `.authz({...})` on the builder.

```
ConnectionFilter → Session → Auth → Rate-limit → Validation
  → Policy (opt-in)
  → Custom interceptors
  → Handler
```

Without `policy: { ... }` in `createServer({})`, the engine is not loaded and the pipeline is unchanged. See the [Policies overview](/policies/README.md) for the full picture.
