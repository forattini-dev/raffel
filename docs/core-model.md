# Raffel Core Model

> Version: 0.1.0 (draft)
> Status: evolving

This document describes the Raffel core: the Envelope, Context, and the
fundamental handler types (procedure, stream, event).

---

## 1. Zero Principle

The core is protocol-agnostic. It receives normalized envelopes and returns
responses or streams. HTTP, gRPC, WebSocket, JSON-RPC, GraphQL, and TCP are
adapters that translate to and from the Envelope.

```
[Client] -> [Adapter HTTP/WS/JSON-RPC/gRPC/GraphQL/TCP] -> [Envelope] -> [Core] -> [Handler]
                                                            |
[Client] <- [Adapter HTTP/WS/JSON-RPC/gRPC/GraphQL/TCP] <- [Envelope] <- [Core] <-
```

---

## 2. Envelope

The Envelope is the fundamental unit of communication. Everything in and out of
the core is expressed as an Envelope.

### 2.1 Base structure

```ts
interface Envelope<T = unknown> {
  // Identification
  id: string                  // Unique message id (UUID or similar)
  procedure: string           // Procedure / stream / event name

  // Message type
  type: EnvelopeType

  // Payload
  payload: T

  // Metadata
  metadata: Record<string, string>

  // Context (set by adapter)
  context: Context
}

type EnvelopeType =
  | 'request'      // Procedure call (expects response)
  | 'response'     // Procedure response
  | 'stream:start' // Stream start
  | 'stream:data'  // Stream data chunk
  | 'stream:end'   // Stream end
  | 'stream:error' // Stream error
  | 'event'        // Fire-and-forget event
  | 'error'        // Generic error
```

### 2.2 Error envelope

```ts
interface ErrorEnvelope extends Envelope<ErrorPayload> {
  type: 'error' | 'stream:error'
  payload: ErrorPayload
}

interface ErrorPayload {
  code: string       // Error code (e.g. 'NOT_FOUND')
  message: string    // Human-readable message
  details?: unknown  // Extra details (stack in dev, metadata, etc.)
}
```

### 2.3 Decisions

- **Decision 1**: Envelope id uses `sid` (compact, fast, URL-safe).
- **Decision 2**: `procedure` accepts any string. Adapters decide mapping.
  For HTTP the mapping is literal (e.g. `users.create` -> `POST /users.create`).
- **Decision 3**: metadata values are strings to align with HTTP headers and gRPC metadata.

---

## 3. Context

Context carries cross-cutting information through the request lifecycle.

### 3.1 Structure

```ts
interface Context {
  // Request correlation
  requestId: string

  // Auth (set by middleware or adapter)
  auth?: AuthContext

  // Tracing
  tracing: TracingContext

  // Flow control
  signal: AbortSignal
  deadline?: number

  // Extensions
  extensions: Map<symbol, unknown>
}

interface AuthContext {
  authenticated: boolean
  principal?: string
  claims?: Record<string, unknown>
}

interface TracingContext {
  traceId: string
  spanId: string
  parentSpanId?: string
}
```

### 3.2 Immutability

Context is treated as immutable. Use helpers to derive new instances:

```ts
function withDeadline(ctx: Context, deadline: number): Context {
  return { ...ctx, deadline }
}

function withAuth(ctx: Context, auth: AuthContext): Context {
  return { ...ctx, auth }
}
```

### 3.3 Decisions

- **Decision 4**: cancellation uses native `AbortSignal`.
- **Decision 5**: extensions use `createExtensionKey` + `withExtension` + `getExtension`.

---

## 4. Core operations

The core supports three kinds of handlers.

### 4.1 Procedure (unary)

```ts
type ProcedureHandler<TInput, TOutput> = (
  input: TInput,
  ctx: Context
) => Promise<TOutput> | TOutput
```

### 4.2 Stream (RaffelStream)

RaffelStream is a duplex stream with backpressure, async iterator support,
priority, and multiplex-ready ids.

```ts
interface RaffelStream<T> {
  read(): Promise<StreamChunk<T>>
  [Symbol.asyncIterator](): AsyncIterator<T>

  write(value: T): Promise<void>
  end(): void
  error(err: Error): void

  pause(): void
  resume(): void
  cancel(reason?: string): void

  readonly readable: boolean
  readonly writable: boolean
  readonly closed: boolean
  readonly errored: Error | null

  readonly id: string
  readonly priority: number
  readonly bufferedAmount: number
}
```

#### Backpressure

```ts
const stream = createStream<LogEntry>({ highWaterMark: 100 })

await stream.write(logEntry) // waits if buffer is full

for await (const entry of stream) {
  await processEntry(entry)
}
```

#### Handler types

```ts
// Server -> Client
export type ServerStreamHandler<TInput, TOutput> = (
  input: TInput,
  ctx: Context
) => RaffelStream<TOutput> | AsyncIterable<TOutput>

// Client -> Server
export type ClientStreamHandler<TInput, TOutput> = (
  input: RaffelStream<TInput> | AsyncIterable<TInput>,
  ctx: Context
) => Promise<TOutput>

// Bidirectional
export type BidiStreamHandler<TInput, TOutput> = (
  input: RaffelStream<TInput> | AsyncIterable<TInput>,
  ctx: Context
) => RaffelStream<TOutput> | AsyncIterable<TOutput>
```

### 4.3 Event (fire-and-forget)

Events support delivery guarantees with retry and deduplication.

```ts
type EventHandler<TPayload = unknown> = (
  payload: TPayload,
  ctx: Context,
  ack?: () => void
) => void | Promise<void>
```

- `best-effort`: no retry
- `at-least-once`: retry until ack or max attempts
- `at-most-once`: deduplicate by event id for a time window

---

## 5. Registry

The registry stores handlers and metadata and supports introspection.

```ts
interface Registry {
  procedure<I, O>(name: string, handler: ProcedureHandler<I, O>): void
  stream<I, O>(name: string, handler: StreamHandler<I, O>): void
  event<P>(name: string, handler: EventHandler<P>): void

  getProcedure(name: string): RegisteredHandler<ProcedureHandler> | undefined
  getStream(name: string): RegisteredHandler<StreamHandler> | undefined
  getEvent(name: string): RegisteredHandler<EventHandler> | undefined

  list(): HandlerMeta[]
  listProcedures(): HandlerMeta[]
  listStreams(): HandlerMeta[]
  listEvents(): HandlerMeta[]
}
```

---

## 6. Router

The Router dispatches envelopes to the appropriate handler, applies interceptors,
and returns an envelope or stream of envelopes.

High-level flow:
1. Check deadline and cancellation.
2. Resolve handler from the registry.
3. Run interceptors (global + handler-specific).
4. Execute handler.
5. Wrap result in response or stream envelopes.
6. For events, use the delivery engine when configured.

---

## 7. End-to-end flow (HTTP)

```
1. HTTP request: POST /users.create
2. Adapter builds Envelope:
   {
     id: "abc123",
     procedure: "users.create",
     type: "request",
     payload: { name: "Ana", email: "ana@example.com" },
     metadata: { "content-type": "application/json" },
     context: { requestId: "abc123", tracing: {...}, signal: ... }
   }
3. Router.handle(envelope)
4. Registry.getProcedure("users.create")
5. Handler executes and returns result
6. Router wraps response envelope
7. Adapter returns HTTP 200 JSON
```

---

## 8. Interceptors

Interceptors implement an onion model around handlers.

```ts
type Interceptor = (
  envelope: Envelope,
  ctx: Context,
  next: () => Promise<Envelope | RaffelStream<Envelope>>
) => Promise<Envelope | RaffelStream<Envelope>>
```

Execution order:

```
Request  -> Global -> Mount -> Module -> Handler
Response <- Global <- Mount <- Module <- Result
```

Example (builder API):

```ts
const users = createRouterModule('users')
users.use(auditInterceptor)
users.procedure('create').handler(createUser)

const server = createServer({ port: 3000 })
server.use(loggingInterceptor)
server.mount('api', users, { interceptors: [authInterceptor] })
```

---

## 9. Adapters

Adapters translate protocols to and from Envelopes.

| Adapter | Protocol | Streaming | Bidirectional |
|---------|----------|-----------|---------------|
| HTTP | JSON | SSE | no |
| WebSocket | Envelope JSON | yes | yes |
| JSON-RPC | JSON | no | no |
| gRPC | Protobuf | yes | yes |
| GraphQL | HTTP + WS | yes | no |
| TCP | Binary (length-prefixed) | yes | yes |

### HTTP mapping (literal)

- Procedures: `POST /procedure.name`
- Streams: `GET /streams/procedure.name`
- Events: `POST /events/event.name`

### WebSocket mapping

```json
{ "id": "abc123", "procedure": "users.create", "type": "request", "payload": { "name": "Ana" } }
```

### gRPC mapping

`service.method` names map directly to procedure names (package prefixes included).

---
