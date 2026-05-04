/**
 * Server Builder Types — Handler signatures, namespaces, builders
 *
 * Type definitions for procedure/stream/event handlers, protocol namespaces,
 * fluent builders, router modules, and declarative definition maps.
 */

import type { z } from 'zod'
import type {
  Context,
  Interceptor,
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  JsonRpcMeta,
  GrpcMeta,
  HttpMethod,
  StreamDirection,
  RetryPolicy,
  ContractPolicies,
} from '../../types/index.js'
import type { ProcedurePolicyConfig } from '../../middleware/policy/types.js'

// === Procedure Hooks ===

/**
 * Before hook - runs before the handler.
 * Can modify context extensions. Throwing prevents handler execution.
 */
export type BeforeHook<TInput = unknown> = (
  input: TInput,
  ctx: Context
) => void | Promise<void>

/**
 * After hook - runs after the handler.
 * Receives and can transform the result.
 */
export type AfterHook<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: Context,
  result: TOutput
) => TOutput | Promise<TOutput>

/**
 * Error hook - runs when an error occurs.
 * Can swallow errors (by returning a value), transform them, or re-throw.
 */
export type ErrorHook<TInput = unknown> = (
  input: TInput,
  ctx: Context,
  error: Error
) => unknown | Promise<unknown>

/**
 * Global hooks configuration with pattern matching.
 */
export interface GlobalHooksConfig {
  /** Before hooks by pattern (e.g., '*', 'users.*') */
  before?: Record<string, BeforeHook<any> | BeforeHook<any>[]>
  /** After hooks by pattern */
  after?: Record<string, AfterHook<any, any> | AfterHook<any, any>[]>
  /** Error hooks by pattern */
  error?: Record<string, ErrorHook<any> | ErrorHook<any>[]>
}

// === HTTP Route Types ===

/**
 * HTTP route handler function.
 * Similar to ProcedureHandler but with Response return support.
 */
export type HttpRouteHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: Context
) => TOutput | Promise<TOutput> | Response | Promise<Response>

/**
 * Options for HTTP route registration.
 * Generics allow type inference from input/output schemas.
 */
export interface HttpRouteOptions<TInput = unknown, TOutput = unknown> {
  /** Input schema (Zod) - for GET: query params, for others: body */
  input?: z.ZodType<TInput>
  /** Output schema (Zod) */
  output?: z.ZodType<TOutput>
  /** Short summary for documentation */
  summary?: string
  /** Detailed description (supports markdown) */
  description?: string
  /** Tags for documentation grouping */
  tags?: string[]
  /** Middleware interceptors */
  use?: Interceptor[]
}


// === Protocol Namespace Types ===

/**
 * HTTP protocol namespace for native Raffel routes.
 * Provides organized access to HTTP route registration methods with full type inference.
 *
 * @example
 * ```typescript
 * // Type inference from schema
 * server.http
 *   .get('/users', handler)
 *   .post('/users', { input: z.object({ name: z.string() }) }, (input, ctx) => {
 *     // input is typed as { name: string }
 *     return { id: '1', name: input.name }
 *   })
 * ```
 */
export interface HttpNamespace {
  /** Register an HTTP GET route */
  get(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP GET route with typed options */
  get<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP POST route */
  post(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP POST route with typed options */
  post<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP PUT route */
  put(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP PUT route with typed options */
  put<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP PATCH route */
  patch(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP PATCH route with typed options */
  patch<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP DELETE route */
  delete(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP DELETE route with typed options */
  delete<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP OPTIONS route */
  options(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP OPTIONS route with typed options */
  options<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Register an HTTP HEAD route */
  head(path: string, handler: HttpRouteHandler): HttpNamespace
  /** Register an HTTP HEAD route with typed options */
  head<TIn, TOut>(
    path: string,
    options: HttpRouteOptions<TIn, TOut>,
    handler: HttpRouteHandler<TIn, TOut>
  ): HttpNamespace

  /** Add middleware to all routes in this namespace */
  use(interceptor: Interceptor): HttpNamespace
}

/**
 * WebSocket protocol namespace for pub/sub channels.
 *
 * @example
 * ```typescript
 * server.ws
 *   .channel('chat-room', { type: 'public' })
 *   .channel('user-updates', { type: 'private' })
 *   .onSubscribe((channel, ctx) => { ... })
 * ```
 */
export interface WebSocketNamespace {
  /** Define a WebSocket channel */
  channel(name: string, options?: WebSocketChannelOptions): WebSocketNamespace
  /** Handle channel subscription */
  onSubscribe(handler: WebSocketSubscribeHandler): WebSocketNamespace
  /** Handle incoming messages */
  onMessage(handler: WebSocketMessageHandler): WebSocketNamespace
  /** Handle unsubscription */
  onUnsubscribe(handler: WebSocketUnsubscribeHandler): WebSocketNamespace
  /** Add middleware to all WebSocket handlers */
  use(interceptor: Interceptor): WebSocketNamespace
}

/**
 * WebSocket channel configuration options.
 */
export interface WebSocketChannelOptions {
  /** Channel type: public (no auth), private (requires auth), presence (shows members) */
  type?: 'public' | 'private' | 'presence'
  /** Description for documentation */
  description?: string
  /** Tags for documentation grouping */
  tags?: string[]
  /** Custom authorization function */
  authorize?: (ctx: Context) => boolean | Promise<boolean>
}

/** WebSocket subscribe event handler */
export type WebSocketSubscribeHandler = (
  channel: string,
  ctx: Context
) => void | Promise<void>

/** WebSocket message event handler */
export type WebSocketMessageHandler = (
  channel: string,
  event: string,
  data: unknown,
  ctx: Context
) => void | Promise<void>

/** WebSocket unsubscribe event handler */
export type WebSocketUnsubscribeHandler = (
  channel: string,
  ctx: Context
) => void | Promise<void>

/**
 * Streams protocol namespace for SSE/EventSource.
 *
 * @example
 * ```typescript
 * server.streams
 *   .source('events', async function*(ctx) {
 *     while (true) {
 *       yield { event: 'tick', data: { time: Date.now() } }
 *       await delay(1000)
 *     }
 *   })
 * ```
 */
export interface StreamsNamespace {
  /** Define a server-to-client stream (SSE source) */
  source(name: string, handler: StreamSourceHandler): StreamsNamespace
  /** Define a server-to-client stream with typed options */
  source<TOut>(
    name: string,
    options: StreamOptions<unknown, TOut>,
    handler: StreamSourceHandler<TOut>
  ): StreamsNamespace

  /** Define a client-to-server stream (upload sink) */
  sink(name: string, handler: StreamSinkHandler): StreamsNamespace
  /** Define a client-to-server stream with typed options */
  sink<TIn>(
    name: string,
    options: StreamOptions<TIn>,
    handler: StreamSinkHandler<TIn>
  ): StreamsNamespace

  /** Define a bidirectional stream */
  duplex(name: string, handler: StreamDuplexHandler): StreamsNamespace
  /** Define a bidirectional stream with typed options */
  duplex<TIn, TOut>(
    name: string,
    options: StreamOptions<TIn, TOut>,
    handler: StreamDuplexHandler<TIn, TOut>
  ): StreamsNamespace

  /** Add middleware to all stream handlers */
  use(interceptor: Interceptor): StreamsNamespace
}

/**
 * Stream configuration options.
 * Generics allow type inference for input params and output chunks.
 */
export interface StreamOptions<TInput = unknown, TOutput = unknown> {
  /** HTTP path for the stream endpoint */
  path?: string
  /** Description for documentation */
  description?: string
  /** Tags for documentation grouping */
  tags?: string[]
  /** Input schema for stream parameters */
  input?: z.ZodType<TInput>
  /** Output schema for stream chunks (for documentation) */
  output?: z.ZodType<TOutput>
}

/** Stream source handler (server → client) with typed output */
export type StreamSourceHandler<TOutput = unknown> = (
  ctx: Context
) => AsyncIterable<{ event?: string; data: TOutput }> | Promise<AsyncIterable<{ event?: string; data: TOutput }>>

/** Stream sink handler (client → server) with typed input */
export type StreamSinkHandler<TInput = unknown> = (
  stream: AsyncIterable<TInput>,
  ctx: Context
) => void | Promise<void>

/** Stream duplex handler (bidirectional) with typed input/output */
export type StreamDuplexHandler<TInput = unknown, TOutput = unknown> = (
  input: AsyncIterable<TInput>,
  ctx: Context
) => AsyncIterable<TOutput> | Promise<AsyncIterable<TOutput>>

/**
 * JSON-RPC protocol namespace for method and notification handlers.
 *
 * @example
 * ```typescript
 * server.rpc
 *   .method('users.get', { input: GetUserSchema }, async (input, ctx) => {
 *     return db.users.findById(input.id)
 *   })
 *   .notification('logs.write', async (data, ctx) => {
 *     logger.info(data)
 *   })
 * ```
 */
export interface RpcNamespace {
  /** Register a JSON-RPC method (request/response) */
  method(name: string, handler: ProcedureHandler): RpcNamespace
  /** Register a JSON-RPC method with typed options */
  method<TIn, TOut>(
    name: string,
    options: RpcMethodOptions<TIn, TOut>,
    handler: (input: TIn, ctx: Context) => TOut | Promise<TOut>
  ): RpcNamespace

  /** Register a JSON-RPC notification (fire-and-forget, no response) */
  notification(name: string, handler: ProcedureHandler): RpcNamespace
  /** Register a JSON-RPC notification with typed options */
  notification<TIn>(
    name: string,
    options: RpcMethodOptions<TIn, void>,
    handler: (input: TIn, ctx: Context) => void | Promise<void>
  ): RpcNamespace

  /** Add middleware to all RPC handlers */
  use(interceptor: Interceptor): RpcNamespace
}

/**
 * RPC method configuration options.
 * Generics allow type inference from input/output schemas.
 */
export interface RpcMethodOptions<TInput = unknown, TOutput = unknown> {
  /** Description for documentation */
  description?: string
  /** Tags for documentation grouping */
  tags?: string[]
  /** Input schema for validation */
  input?: z.ZodType<TInput>
  /** Output schema for documentation */
  output?: z.ZodType<TOutput>
}

/**
 * TCP protocol namespace for raw socket handlers.
 *
 * @example
 * ```typescript
 * server.tcp
 *   .handler('echo', {
 *     port: 9000,
 *     framing: 'line'
 *   })
 *   .onConnect((socket, ctx) => {
 *     console.log('Client connected')
 *   })
 *   .onData((data, socket, ctx) => {
 *     socket.write(data) // Echo back
 *   })
 *   .onClose((socket, ctx) => {
 *     console.log('Client disconnected')
 *   })
 * ```
 */
export interface TcpNamespace {
  /** Define a TCP handler with connection lifecycle */
  handler(name: string, options?: TcpHandlerOptions): TcpHandlerBuilder
  /** Add middleware to all TCP handlers */
  use(interceptor: Interceptor): TcpNamespace
}

/**
 * TCP handler configuration options.
 */
export interface TcpHandlerOptions {
  /** TCP port to listen on */
  port?: number
  /** Host to bind to */
  host?: string
  /** Description for documentation */
  description?: string
  /** Framing mode for message boundaries */
  framing?: 'none' | 'line' | 'length-prefixed' | 'delimiter'
  /** Delimiter character for 'delimiter' framing (default: '\n') */
  delimiter?: string
  /** TLS options for secure connections */
  tls?: {
    key: string | Buffer
    cert: string | Buffer
    ca?: string | Buffer
  }
}

/**
 * Builder for a TCP handler with lifecycle hooks.
 */
export interface TcpHandlerBuilder {
  /** Handle new connection */
  onConnect(handler: TcpConnectHandler): TcpHandlerBuilder
  /** Handle incoming data */
  onData(handler: TcpDataHandler): TcpHandlerBuilder
  /** Handle connection close */
  onClose(handler: TcpCloseHandler): TcpHandlerBuilder
  /** Handle errors */
  onError(handler: TcpErrorHandler): TcpHandlerBuilder
  /** Return to the main TCP namespace */
  end(): TcpNamespace
}

/** TCP connection handler */
export type TcpConnectHandler = (socket: import('node:net').Socket, ctx: Context) => void | Promise<void>

/** TCP data handler */
export type TcpDataHandler = (data: Buffer, socket: import('node:net').Socket, ctx: Context) => void | Promise<void>

/** TCP close handler */
export type TcpCloseHandler = (socket: import('node:net').Socket, ctx: Context) => void | Promise<void>

/** TCP error handler */
export type TcpErrorHandler = (error: Error, socket: import('node:net').Socket, ctx: Context) => void | Promise<void>

/**
 * UDP protocol namespace for datagram handlers.
 *
 * @example
 * ```typescript
 * server.udp
 *   .handler('metrics', {
 *     port: 9001,
 *     multicast: '239.0.0.1'
 *   })
 *   .onMessage((msg, rinfo, ctx) => {
 *     console.log(`Received: ${msg} from ${rinfo.address}:${rinfo.port}`)
 *   })
 * ```
 */
export interface UdpNamespace {
  /** Define a UDP handler */
  handler(name: string, options?: UdpHandlerOptions): UdpHandlerBuilder
  /** Add middleware to all UDP handlers */
  use(interceptor: Interceptor): UdpNamespace
}

/**
 * UDP handler configuration options.
 */
export interface UdpHandlerOptions {
  /** UDP port to listen on */
  port?: number
  /** Host to bind to */
  host?: string
  /** Description for documentation */
  description?: string
  /** Multicast group to join */
  multicast?: string
  /** UDP socket type */
  type?: 'udp4' | 'udp6'
}

/**
 * Builder for a UDP handler with message callback.
 */
export interface UdpHandlerBuilder {
  /** Handle incoming messages */
  onMessage(handler: UdpMessageHandler): UdpHandlerBuilder
  /** Handle errors */
  onError(handler: UdpErrorHandler): UdpHandlerBuilder
  /** Return to the main UDP namespace */
  end(): UdpNamespace
}

/** UDP message handler */
export type UdpMessageHandler = (
  msg: Buffer,
  rinfo: import('node:dgram').RemoteInfo,
  ctx: Context
) => void | Promise<void>

/** UDP error handler */
export type UdpErrorHandler = (error: Error, ctx: Context) => void | Promise<void>

// === gRPC Namespace ===

/**
 * gRPC protocol namespace for defining gRPC services.
 * Provides a chainable API for defining gRPC methods.
 * Use `grpcNs` to avoid conflict with the `grpc(options)` method that configures gRPC.
 *
 * @example
 * ```typescript
 * server.grpcNs
 *   .use(loggingInterceptor)
 *   .service('UserService')
 *     .method('GetUser', { input: GetUserRequest, output: User }, async (req, ctx) => {
 *       return db.users.findById(req.id)
 *     })
 *     .method('CreateUser', { input: CreateUserRequest, output: User }, async (req, ctx) => {
 *       return db.users.create(req)
 *     })
 *     .end()
 * ```
 */
export interface GrpcNamespace {
  /** Define a gRPC service */
  service(name: string, options?: GrpcServiceOptions): GrpcServiceBuilder
  /** Add middleware to all gRPC services */
  use(interceptor: Interceptor): GrpcNamespace
}

/**
 * gRPC service configuration options.
 */
export interface GrpcServiceOptions {
  /** Package name for the service */
  packageName?: string
  /** Description for documentation */
  description?: string
}

/**
 * Builder for a gRPC service with methods.
 */
export interface GrpcServiceBuilder {
  /**
   * Add a unary method to the service.
   *
   * @example
   * ```typescript
   * .method('GetUser', async (request, ctx) => {
   *   return { id: request.id, name: 'John' }
   * })
   * ```
   */
  method(name: string, handler: GrpcMethodHandler): GrpcServiceBuilder
  /**
   * Add a unary method with options.
   *
   * @example
   * ```typescript
   * .method('GetUser', { input: GetUserRequest, output: User }, async (request, ctx) => {
   *   return db.users.findById(request.id)
   * })
   * ```
   */
  method(name: string, options: GrpcMethodOptions, handler: GrpcMethodHandler): GrpcServiceBuilder
  /**
   * Add a server streaming method.
   * Returns multiple responses for a single request.
   */
  serverStream(name: string, handler: GrpcServerStreamHandler): GrpcServiceBuilder
  serverStream(name: string, options: GrpcMethodOptions, handler: GrpcServerStreamHandler): GrpcServiceBuilder
  /**
   * Add a client streaming method.
   * Receives multiple requests and returns a single response.
   */
  clientStream(name: string, handler: GrpcClientStreamHandler): GrpcServiceBuilder
  clientStream(name: string, options: GrpcMethodOptions, handler: GrpcClientStreamHandler): GrpcServiceBuilder
  /**
   * Add a bidirectional streaming method.
   * Both client and server can send multiple messages.
   */
  bidiStream(name: string, handler: GrpcBidiStreamHandler): GrpcServiceBuilder
  bidiStream(name: string, options: GrpcMethodOptions, handler: GrpcBidiStreamHandler): GrpcServiceBuilder
  /** Return to the main gRPC namespace */
  end(): GrpcNamespace
}

/**
 * gRPC method configuration options.
 */
export interface GrpcMethodOptions {
  /** Input schema (Zod) */
  input?: z.ZodType
  /** Output schema (Zod) */
  output?: z.ZodType
  /** Description for documentation */
  description?: string
}

/** gRPC unary method handler */
export type GrpcMethodHandler = (
  request: unknown,
  ctx: Context
) => unknown | Promise<unknown>

/** gRPC server streaming method handler */
export type GrpcServerStreamHandler = (
  request: unknown,
  ctx: Context
) => AsyncIterable<unknown>

/** gRPC client streaming method handler */
export type GrpcClientStreamHandler = (
  requests: AsyncIterable<unknown>,
  ctx: Context
) => unknown | Promise<unknown>

/** gRPC bidirectional streaming method handler */
export type GrpcBidiStreamHandler = (
  requests: AsyncIterable<unknown>,
  ctx: Context
) => AsyncIterable<unknown>

// === Handler Builders ===

export interface ProcedureBuilder<TInput = unknown, TOutput = unknown> {
  /** Define input schema (Zod) */
  input<T extends z.ZodType>(schema: T): ProcedureBuilder<z.infer<T>, TOutput>
  /** Define output schema (Zod) */
  output<T extends z.ZodType>(schema: T): ProcedureBuilder<TInput, z.infer<T>>
  /** Add short summary for OpenAPI (one-liner) */
  summary(sum: string): this
  /** Add description for OpenAPI (supports markdown) */
  description(desc: string): this
  /**
   * Set tags for OpenAPI grouping.
   *
   * @example
   * ```ts
   * server.procedure('users.create')
   *   .tags(['users', 'admin'])
   * ```
  */
  tags(tags: string[]): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /**
   * Declare an authorization policy for this procedure.
   *
   * Requires `policy: { ... }` on `createServer`. The policy interceptor runs
   * after validation, before custom interceptors / handler.
   *
   * @example
   * ```ts
   * server.procedure('lead.read')
   *   .input(z.object({ id: z.string() }))
   *   .authz({ resource: (input, ctx) => ({ type: 'lead', id: input.id, tenantId: ctx.auth.tenantId ?? null }) })
   *   .handler(async ({ id }) => loadLead(id))
   * ```
   */
  authz(config: ProcedurePolicyConfig<TInput, Context>): this
  /** Mark GraphQL mapping */
  graphql(type: 'query' | 'mutation'): this
  /** Configure JSON-RPC metadata for USD generation */
  jsonrpc(meta: JsonRpcMeta): this
  /** Configure gRPC metadata for USD generation */
  grpc(meta: GrpcMeta): this
  /**
   * Configure HTTP routing for this procedure.
   * By default, procedures use POST /{name}.
   * Use this to define REST-style routes with path parameters.
   *
   * @param path - HTTP path with optional parameters (e.g., '/users/{id}')
   * @param method - HTTP method (GET, POST, PUT, PATCH, DELETE)
   *
   * @example
   * ```ts
   * server.procedure('users.get')
   *   .http('/users/{userId}', 'GET')
   *   .input(z.object({
   *     userId: z.string().uuid(), // extracted from path
   *     include: z.string().optional() // becomes query param
   *   }))
   * ```
   */
  http(path: string, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): this
  /**
   * Add a before hook - runs before the handler.
   * Multiple before hooks run in order of registration.
   * Throwing from a before hook prevents handler execution.
   */
  before(hook: BeforeHook<TInput>): this
  /**
   * Add an after hook - runs after the handler.
   * Receives the result and can transform it.
   * Multiple after hooks run in order, each receiving the previous result.
   */
  after(hook: AfterHook<TInput, TOutput>): this
  /**
   * Add an error hook - runs when handler or before hooks throw.
   * Can swallow errors (by returning a value), transform them, or re-throw.
   */
  error(hook: ErrorHook<TInput>): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context) => Promise<TOutput>): void
}

export interface StreamBuilder<TInput = unknown, TOutput = unknown> {
  /** Define input schema */
  input<T extends z.ZodType>(schema: T): StreamBuilder<z.infer<T>, TOutput>
  /** Define output chunk schema */
  output<T extends z.ZodType>(schema: T): StreamBuilder<TInput, z.infer<T>>
  /** Set stream direction */
  direction(direction: StreamDirection): this
  /** Add description */
  description(desc: string): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context) => AsyncIterable<TOutput>): void
}

export interface EventBuilder<TInput = unknown> {
  /** Define input schema */
  input<T extends z.ZodType>(schema: T): EventBuilder<z.infer<T>>
  /** Add description */
  description(desc: string): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
  /** Attach contract-bound runtime policies */
  policy(policies: ContractPolicies): this
  /** Set delivery guarantee */
  delivery(guarantee: 'best-effort' | 'at-least-once' | 'at-most-once'): this
  /** Set retry policy (for at-least-once) */
  retryPolicy(policy: RetryPolicy): this
  /** Set deduplication window in ms (for at-most-once) */
  deduplicationWindow(ms: number): this
  /** Register the handler */
  handler(fn: (input: TInput, ctx: Context, ack: () => void) => Promise<void>): void
}

// === Resource Builder ===

/**
 * Resource builder for REST CRUD operations.
 * Dramatically reduces verbosity for defining REST endpoints.
 *
 * @example
 * ```typescript
 * // Instead of 5+ procedure definitions with .http():
 * server.resource('users', User)
 *   .list(ListInput, async (input, ctx) => db.users.list(input))
 *   .get(async (id, ctx) => db.users.findById(id))
 *   .create(CreateInput, async (input, ctx) => db.users.create(input))
 *   .update(UpdateInput, async (id, input, ctx) => db.users.update(id, input))
 *   .delete(async (id, ctx) => db.users.delete(id))
 * ```
 */
export interface ResourceBuilder<TOutput = unknown> {
  /** Add interceptor to all operations */
  use(interceptor: Interceptor): ResourceBuilder<TOutput>
  /** Set tags for documentation */
  tags(tags: string[]): ResourceBuilder<TOutput>
  /** GET /resources - List all */
  list<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput[]>
  ): ResourceBuilder<TOutput>
  /** GET /resources - List all (no input) */
  list(handler: (input: unknown, ctx: Context) => Promise<TOutput[]>): ResourceBuilder<TOutput>
  /** GET /resources/:id - Get one */
  get(handler: (id: string, ctx: Context) => Promise<TOutput | null>): ResourceBuilder<TOutput>
  /** POST /resources - Create */
  create<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** PUT /resources/:id - Full update */
  update<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** PATCH /resources/:id - Partial update */
  patch<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>
  /** DELETE /resources/:id - Delete */
  delete(handler: (id: string, ctx: Context) => Promise<void | TOutput>): ResourceBuilder<TOutput>
  /** POST /resources/:action - Custom collection action */
  action<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
  /** POST /resources/:id/:action - Custom item action */
  itemAction<TInput = void, TActionOutput = TOutput>(
    actionName: string,
    handler: (id: string, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
  itemAction<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
}

// === Group Builder ===

export interface GroupBuilder {
  /** Add interceptor to all handlers in this group */
  use(interceptor: Interceptor): this
  /** Create a procedure in this group */
  procedure(name: string): ProcedureBuilder
  /** Create a stream in this group */
  stream(name: string): StreamBuilder
  /** Create an event in this group */
  event(name: string): EventBuilder
  /** Create a nested group (inherits middleware) */
  group(prefix: string): GroupBuilder
}

// === Router Modules ===

export interface RouterModule {
  /** Add interceptor to all handlers in this module */
  use(interceptor: Interceptor): this
  /** Create a procedure in this module */
  procedure(name: string): ProcedureBuilder
  /** Create a stream in this module */
  stream(name: string): StreamBuilder
  /** Create an event in this module */
  event(name: string): EventBuilder
  /** Create a nested module group */
  group(prefix: string): RouterModule
}

export interface MountOptions {
  /** Interceptors applied between global and module interceptors */
  interceptors?: Interceptor[]
}

export type DirectProcedureOptions = Omit<AddProcedureInput, 'name' | 'handler'>

// === Declarative Definition Types ===

/**
 * Procedure definition as plain object.
 * More concise than the builder pattern for simple cases.
 *
 * @example
 * ```typescript
 * const createUser: ProcedureDef = {
 *   input: CreateUserInput,
 *   output: User,
 *   http: '/users',  // shorthand for POST
 *   handler: async (input, ctx) => db.users.create(input)
 * }
 *
 * // Or with explicit method
 * const listUsers: ProcedureDef = {
 *   input: ListInput,
 *   output: z.array(User),
 *   http: ['GET', '/users'],  // [method, path] tuple
 *   handler: async (input, ctx) => db.users.list(input)
 * }
 * ```
 */
export interface ProcedureDef<TInput = unknown, TOutput = unknown> {
  /** Input validation schema */
  input?: z.ZodType<TInput>
  /** Output validation schema */
  output?: z.ZodType<TOutput>
  /** Handler function */
  handler: (input: TInput, ctx: Context) => Promise<TOutput>
  /**
   * HTTP endpoint configuration:
   * - string: path (defaults to POST)
   * - [method, path]: explicit method and path
   * - object: full config
   */
  http?: string | [HttpMethod, string] | { method?: HttpMethod; path: string }
  /** Short summary for docs */
  summary?: string
  /** Longer description */
  description?: string
  /** Tags for grouping in docs */
  tags?: string[]
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors/middleware */
  use?: Interceptor[]
}

/**
 * Map of procedure names to their definitions.
 *
 * @example
 * ```typescript
 * server.procedures({
 *   'users.create': {
 *     input: CreateUserInput,
 *     output: User,
 *     http: '/users',
 *     handler: async (input) => db.users.create(input)
 *   },
 *   'users.list': {
 *     output: z.array(User),
 *     http: ['GET', '/users'],
 *     handler: async () => db.users.list()
 *   }
 * })
 * ```
 */
export type ProcedureMap = Record<string, ProcedureDef>

/**
 * Resource definition as plain object.
 * Define all CRUD operations in one place.
 *
 * @example
 * ```typescript
 * const usersResource: ResourceDef = {
 *   schema: User,
 *   basePath: '/users',  // optional, defaults to /{name}
 *   list: async () => db.users.list(),
 *   get: async (id) => db.users.findById(id),
 *   create: {
 *     input: CreateUserInput,
 *     handler: async (input) => db.users.create(input)
 *   },
 *   update: {
 *     input: UpdateUserInput,
 *     handler: async (id, input) => db.users.update(id, input)
 *   },
 *   delete: async (id) => db.users.delete(id),
 *   actions: {
 *     import: {
 *       input: ImportInput,
 *       handler: async (input) => db.users.bulkCreate(input)
 *     }
 *   }
 * }
 * ```
 */
export interface ResourceDef<TOutput = unknown> {
  /** Output schema for the resource */
  schema?: z.ZodType<TOutput>
  /** Base path (defaults to /{resourceName}) */
  basePath?: string
  /** Tags for docs */
  tags?: string[]
  /** Interceptors for all operations */
  use?: Interceptor[]

  /** GET /resources - List all */
  list?:
    | ((input: unknown, ctx: Context) => Promise<TOutput[]>)
    | {
        input?: z.ZodType
        handler: (input: unknown, ctx: Context) => Promise<TOutput[]>
      }

  /** GET /resources/:id - Get one */
  get?: (id: string, ctx: Context) => Promise<TOutput | null>

  /** POST /resources - Create */
  create?:
    | ((input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** PUT /resources/:id - Full update */
  update?:
    | ((id: string, input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** PATCH /resources/:id - Partial update */
  patch?:
    | ((id: string, input: unknown, ctx: Context) => Promise<TOutput>)
    | {
        input: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<TOutput>
      }

  /** DELETE /resources/:id */
  delete?: (id: string, ctx: Context) => Promise<void | TOutput>

  /** Custom collection actions (POST /resources/:action) */
  actions?: Record<
    string,
    {
      input?: z.ZodType
      handler: (input: unknown, ctx: Context) => Promise<unknown>
    }
  >

  /** Custom item actions (POST /resources/:id/:action) */
  itemActions?: Record<
    string,
    | ((id: string, ctx: Context) => Promise<unknown>)
    | {
        input?: z.ZodType
        handler: (id: string, input: unknown, ctx: Context) => Promise<unknown>
      }
  >
}

/**
 * Map of resource names to their definitions.
 *
 * @example
 * ```typescript
 * server.resources({
 *   users: {
 *     schema: User,
 *     list: async () => db.users.list(),
 *     get: async (id) => db.users.findById(id),
 *     create: {
 *       input: CreateUserInput,
 *       handler: async (input) => db.users.create(input)
 *     }
 *   },
 *   posts: {
 *     schema: Post,
 *     list: async () => db.posts.list(),
 *     get: async (id) => db.posts.findById(id)
 *   }
 * })
 * ```
 */
export type ResourceMap = Record<string, ResourceDef>

// === Add Handler Types ===

/**
 * Input for adding a procedure handler programmatically.
 * Compatible with LoadedRoute from discovery.
 */
export interface AddProcedureInput {
  /** Procedure name */
  name: string
  /** Handler function */
  handler: ProcedureHandler
  /** Input schema (Zod) */
  inputSchema?: import('zod').ZodType
  /** Output schema (Zod) */
  outputSchema?: import('zod').ZodType
  /** Short summary (one-liner) */
  summary?: string
  /** Description */
  description?: string
  /** Tags for grouping */
  tags?: string[]
  /** GraphQL mapping */
  graphql?: {
    type: 'query' | 'mutation'
  }
  /** HTTP path override */
  httpPath?: string
  /** HTTP method override */
  httpMethod?: HttpMethod
  /** JSON-RPC metadata */
  jsonrpc?: JsonRpcMeta
  /** gRPC metadata */
  grpc?: GrpcMeta
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors */
  interceptors?: Interceptor[]
}

/**
 * Input for adding a stream handler programmatically.
 */
export interface AddStreamInput {
  /** Stream name */
  name: string
  /** Handler function */
  handler: StreamHandler
  /** Input schema */
  inputSchema?: import('zod').ZodType
  /** Output schema */
  outputSchema?: import('zod').ZodType
  /** Stream direction */
  direction?: StreamDirection
  /** Description */
  description?: string
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors */
  interceptors?: Interceptor[]
}

/**
 * Input for adding an event handler programmatically.
 */
export interface AddEventInput {
  /** Event name */
  name: string
  /** Handler function */
  handler: EventHandler
  /** Input schema */
  inputSchema?: import('zod').ZodType
  /** Description */
  description?: string
  /** Delivery guarantee */
  delivery?: 'best-effort' | 'at-least-once' | 'at-most-once'
  /** Retry policy (for at-least-once) */
  retryPolicy?: RetryPolicy
  /** Deduplication window in ms (for at-most-once) */
  deduplicationWindow?: number
  /** Contract-bound runtime policies */
  policies?: ContractPolicies
  /** Interceptors */
  interceptors?: Interceptor[]
}
