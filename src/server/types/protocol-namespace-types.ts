import type { z } from 'zod'
import type {
  Context,
  Interceptor,
  ProcedureHandler,
  StreamOperationalControls,
  LongPollContract,
  HandlerDocumentationMeta,
} from '../../types/index.js'
import type { RouteCacheConfig } from '../../cache/server-runtime.js'

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
  /** Output shape used by documentation only; never enables runtime validation. */
  documentationOutput?: unknown
  /** Short summary for documentation */
  summary?: string
  /** Detailed description (supports markdown) */
  description?: string
  /** Tags for documentation grouping */
  tags?: string[]
  /** Controls generated documentation visibility. */
  docs?: HandlerDocumentationMeta
  /** Middleware interceptors */
  use?: Interceptor[]
  /** Response cache override for this HTTP route. */
  cache?: RouteCacheConfig | false
  /**
   * HTTP status code returned on a successful response. Defaults to `200`.
   * Resource auto-CRUD applies REST conventions when this is unset:
   * `POST` create → `201`, `DELETE` delete → `204`, everything else → `200`.
   */
  successStatus?: number
  /** Ordinary HTTP Long Poll Interaction contract. */
  longPoll?: LongPollContract
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
  /** Controls generated documentation visibility. */
  docs?: HandlerDocumentationMeta
  /** Connection-scoped controls for Live Streams. */
  controls?: StreamOperationalControls
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
  /** Controls generated documentation visibility. */
  docs?: HandlerDocumentationMeta
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
  /** Controls generated documentation visibility. */
  docs?: HandlerDocumentationMeta
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
