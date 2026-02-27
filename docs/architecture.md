# Architecture

This page explains how Raffel works under the hood. Understanding the architecture will help you use the framework more efficiently and debug issues.

---

## The Core Idea

Raffel solves a common problem: you want to expose the same business logic over multiple protocols (HTTP, WebSocket, gRPC, etc), but you don't want to duplicate code.

The solution is simple: **normalize everything to a single format**.

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

No matter where the request came from — HTTP, WebSocket, gRPC — it is converted to an **Envelope** and processed the same way.

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

The Context carries information about the request that is not the data itself:

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

## Internal Builder Modules

The server builder is composed of independent modules:

| Module | Responsibility |
|:-------|:---------------|
| `front-door.ts` | Application protocol detection at the HTTP edge |
| `single-port/` | Transport protocol detection (TCP sniffing) |
| `protocol-aliases.ts` | Shared alias maps (standard/extended) |
| `discovery-bootstrap.ts` | Lifecycle of filesystem-based route discovery |
| `telemetry-bootstrap.ts` | Metrics and tracing initialization |
| `protocol-config.ts` | Protocol option normalization |
| `handler-builders.ts` | Fluent API for registering procedures, streams, events |

---

## Summary

1. **Envelope** - Normalized format that represents any request
2. **Context** - Request metadata (auth, tracing, cancellation, extensions)
3. **Adapters** - Convert specific protocols to/from Envelope
4. **Router** - Finds and executes the correct handler
5. **Interceptors** - Logic that runs before/after every handler
6. **Registry** - Stores all server configuration
7. **Front-Door** - Application protocol routing at the HTTP edge
8. **Single-Port** - Protocol detection at the TCP transport level

The beauty of the design is that your business logic (the handler) knows nothing about protocols. It receives data, processes it, and returns a result. The adapters take care of the rest.

---

## Next Steps

- **[HTTP in Detail](/protocols/http.md)** - HTTP adapter customization
- **[Single-Port Detection](/single-port.md)** - Multiplexing protocols on one port
- **[Interceptors](/interceptors.md)** - All available interceptors
- **[Streaming](/streams.md)** - How streams work in detail
