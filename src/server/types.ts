/**
 * Server Builder Types
 *
 * Type definitions for the unified server API.
 */

import type { z } from 'zod'
import type { IncomingMessage, Server } from 'node:http'
import type { WebSocketServer } from 'ws'
import type { Server as NetServer } from 'node:net'
import type { Options as ProtoLoaderOptions } from '@grpc/proto-loader'
import type { Registry } from '../core/registry.js'
import type { Router } from '../core/router.js'
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
} from '../types/index.js'
import type { EventDeliveryOptions } from '../core/event-delivery.js'
import type { ChannelOptions, ChannelManager } from '../channels/index.js'
import type { HttpAdapter, HttpMiddleware } from '../adapters/http.js'
import type {
  DiscoveryConfig,
  DiscoveryWatcher,
  LoadedRoute,
  LoadedChannel,
  LoadedRestResource,
  LoadedResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
} from './fs-routes/index.js'
import type { DiscoveryResult } from './fs-routes/loader.js'
import type { GraphQLOptions, GraphQLAdapter } from '../graphql/index.js'
import type { MetricsConfig, MetricRegistry } from '../metrics/index.js'
import type { TracingConfig, Tracer } from '../tracing/index.js'
import type { Codec } from '../utils/content-codecs.js'
import type { USDDocument, USDProtocol, USDTag, USDExternalDocs, USDServer, USDSecurityScheme } from '../usd/index.js'
import type { OpenAPIDocument } from '../usd/export/openapi.js'
import type { SchemaRegistry } from '../validation/index.js'

// === Providers (Dependency Injection) ===

/**
 * Provider factory function.
 * Called once at server startup to create the singleton instance.
 */
export type ProviderFactory<T> = () => T | Promise<T>

/**
 * Provider definition with optional lifecycle hooks.
 */
export interface ProviderDefinition<T = unknown> {
  /** Factory function to create the provider instance */
  factory: ProviderFactory<T>
  /** Called on server shutdown */
  onShutdown?: (instance: T) => void | Promise<void>
}

/**
 * Map of provider names to their definitions or factory functions.
 */
export type ProvidersConfig = Record<string, ProviderFactory<unknown> | ProviderDefinition<unknown>>

/**
 * Resolved provider instances (after initialization).
 */
export type ResolvedProviders = Record<string, unknown>

// === Error Handling ===

/**
 * Protocol identifier for error context
 */
export type ErrorProtocol = 'http' | 'websocket' | 'jsonrpc' | 'grpc' | 'streams' | 'tcp' | 'udp' | 'graphql'

/**
 * Normalized error information for cross-protocol consistency
 */
export interface NormalizedError {
  /** String error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR') */
  code: string
  /** Numeric status (HTTP-compatible) */
  status: number
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: unknown
  /** Original error */
  cause?: Error
  /** Stack trace (only in development) */
  stack?: string
}

/**
 * Global error handler function type
 *
 * @param error - The original error (may be RaffelError, HttpError, or plain Error)
 * @param protocol - The protocol where the error occurred
 * @param ctx - Request context (if available)
 */
export type GlobalErrorHandler = (
  error: Error,
  protocol: ErrorProtocol,
  ctx?: Context
) => void | Promise<void>

// === Server Options ===

export interface ServerOptions {
  // === Core ===

  /** Port to listen on (HTTP) */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Base path for HTTP procedures (default: '/') */
  basePath?: string
  /** CORS configuration (default: enabled with '*') */
  cors?: CorsOptions | boolean
  /** HTTP adapter options */
  http?: HttpOptions

  // === Protocols ===

  /**
   * WebSocket configuration.
   * - `true` enables with defaults (path: '/')
   * - Object for custom configuration
   *
   * @example
   * ```typescript
   * // Quick enable
   * websocket: true
   *
   * // With channels
   * websocket: {
   *   path: '/ws',
   *   channels: {
   *     authorize: async (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,
   *     presenceData: (socketId, channel, ctx) => ({ userId: ctx.auth?.principal }),
   *   }
   * }
   * ```
   */
  websocket?: WebSocketOptions | boolean

  /**
   * JSON-RPC configuration.
   * - `true` enables with defaults (path: '/rpc')
   * - Object for custom configuration
   */
  jsonrpc?: JsonRpcOptions | boolean

  /**
   * TCP configuration (always requires separate port).
   */
  tcp?: TcpOptions

  /**
   * GraphQL configuration.
   * - `true` enables with defaults (path: '/graphql', auto-generate schema)
   * - Object for custom configuration
   *
   * @example
   * ```typescript
   * // Quick enable
   * graphql: true
   *
   * // With configuration
   * graphql: {
   *   path: '/graphql',
   *   playground: true,
   *   subscriptions: true,
   *   schemaOptions: {
   *     procedureMapping: 'prefix', // get*, list* → Query, others → Mutation
   *   },
   * }
   * ```
   */
  graphql?: GraphQLOptions | boolean

  /**
   * Custom protocol adapters registered at startup.
   */
  protocolExtensions?: ProtocolExtensionConfig[]

  // === Middleware ===

  /**
   * Global middleware applied to all handlers.
   *
   * @example
   * ```typescript
   * middleware: [
   *   createAuthMiddleware({ ... }),
   *   createLoggingMiddleware(),
   *   createRateLimitInterceptor({ ... }),
   * ]
   * ```
   */
  middleware?: Interceptor[]

  // === File-System Discovery ===

  /**
   * Auto-discover handlers from file system (Next.js-style).
   * - `true` enables all defaults (./src/http, ./src/channels, ./src/rpc, ./src/streams, ./src/rest, ./src/resources, ./src/tcp, ./src/udp)
   * - Object for custom configuration
   *
   * This is separate from manual route definition (via `.procedure()`, `.stream()`, `.mount()`)
   * which can be used alongside or instead of discovery.
   *
   * @example
   * ```typescript
   * // Quick enable all
   * discovery: true
   *
   * // Custom paths
   * discovery: {
   *   http: './src/api',
   *   channels: './src/realtime',
   *   rpc: './src/rpc',
   *   streams: './src/streams',
   *   rest: './src/rest',
   *   resources: './src/resources',
   *   tcp: './src/tcp',
   *   udp: './src/udp',
   * }
   *
   * // Only HTTP and RPC
   * discovery: {
   *   http: true,
   *   rpc: './api/rpc',
   * }
   * ```
   */
  discovery?: DiscoveryConfig | boolean

  /**
   * Enable hot reload for discovered handlers in development.
   * @default true in development, false in production
   */
  hotReload?: boolean

  // === Providers (Dependency Injection) ===

  /**
   * Providers are singletons injected into the context of all handlers.
   * Use this to share database clients, services, configs, etc.
   *
   * @example
   * ```typescript
   * import { PrismaClient } from '@prisma/client'
   * import { S3DB } from 's3db.js'
   *
   * const server = createServer({
   *   port: 3000,
   *   providers: {
   *     db: () => new PrismaClient(),
   *     s3db: () => new S3DB({ bucket: 'my-bucket' }),
   *     config: () => ({
   *       apiKey: process.env.API_KEY,
   *       environment: process.env.NODE_ENV,
   *     }),
   *   },
   * })
   *
   * // In handlers (including discovered routes):
   * server.procedure('users.get').handler(async (input, ctx) => {
   *   return ctx.db.user.findUnique({ where: { id: input.id } })
   * })
   * ```
   */
  providers?: ProvidersConfig

  // === Advanced ===

  /** Event delivery configuration (for at-least-once/at-most-once) */
  eventDelivery?: EventDeliveryOptions

  // === Error Handling ===

  /**
   * Global error handler for all protocols.
   * Called when an error occurs in any handler (HTTP, WebSocket, Streams, JSON-RPC, etc.).
   *
   * @example
   * ```typescript
   * const server = createServer({
   *   port: 3000,
   *   onError: (error, protocol, ctx) => {
   *     console.error(`[${protocol}] Error:`, error.message)
   *     // Report to error tracking service
   *     errorTracker.captureException(error, { protocol, requestId: ctx?.requestId })
   *   },
   * })
   * ```
   */
  onError?: GlobalErrorHandler
}

export interface CorsOptions {
  /** Allowed origins (default: '*') */
  origin?: string | string[] | boolean
  /** Allowed HTTP methods */
  methods?: string[]
  /** Allowed headers */
  headers?: string[]
  /** Whether to allow credentials */
  credentials?: boolean
}

export interface HttpOptions {
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Additional codecs for content negotiation */
  codecs?: Codec[]

  /**
   * HTTP middleware to run before routing.
   * Middleware that returns true indicates it handled the request.
   */
  middleware?: HttpMiddleware[]

  /** Context factory for creating request context */
  contextFactory?: (req: IncomingMessage) => Partial<Context>
}

// === Protocol Options ===

export interface WebSocketOptions {
  /** Port (if omitted, shares HTTP port via upgrade) */
  port?: number
  /** WebSocket path (default: '/') */
  path?: string
  /** Max payload size in bytes (default: 1MB) */
  maxPayloadSize?: number
  /** Heartbeat interval in ms (default: 30000, 0 to disable) */
  heartbeatInterval?: number
  /**
   * Enable Pusher-like channels for real-time pub/sub.
   *
   * @example
   * ```typescript
   * channels: {
   *   authorize: async (socketId, channel, ctx) => {
   *     if (channel.startsWith('private-') || channel.startsWith('presence-')) {
   *       return ctx.auth?.authenticated ?? false
   *     }
   *     return true
   *   },
   *   presenceData: (socketId, channel, ctx) => ({
   *     userId: ctx.auth?.principal,
   *     name: ctx.auth?.claims?.name,
   *   }),
   * }
   * ```
   */
  channels?: ChannelOptions
  /**
   * Context factory for creating auth context from WebSocket connection.
   * Called once per connection to establish the connection context.
   *
   * @example
   * ```typescript
   * contextFactory: (ws, req) => {
   *   const url = new URL(req.url, 'http://localhost')
   *   const token = url.searchParams.get('token')
   *   return {
   *     auth: token ? { authenticated: true, principal: token } : undefined,
   *   }
   * }
   * ```
   */
  contextFactory?: (ws: import('ws').WebSocket, req: import('http').IncomingMessage) => Partial<Context>
}

export interface JsonRpcOptions {
  /** Port (if omitted, shares HTTP port) */
  port?: number
  /** JSON-RPC endpoint path (default: '/rpc') */
  path?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Max body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Additional codecs for content negotiation */
  codecs?: Codec[]
}

export interface TcpOptions {
  /** Port (required - TCP always needs separate port) */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Max message size in bytes (default: 16MB) */
  maxMessageSize?: number
  /** Keep-alive interval in ms (default: 30000, 0 to disable) */
  keepAliveInterval?: number
}

export interface GrpcTlsOptions {
  /** Server private key */
  key: string | Buffer
  /** Server certificate chain */
  cert: string | Buffer
  /** Root CA certificates (optional) */
  ca?: string | Buffer
  /** Require client certificate */
  requireClientCert?: boolean
}

export interface GrpcOptions {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Proto file path(s) */
  protoPath: string | string[]
  /** Package name to scope services (optional) */
  packageName?: string
  /** Service names to register (optional) */
  serviceNames?: string[]
  /** Proto loader options */
  loaderOptions?: ProtoLoaderOptions
  /** TLS credentials */
  tls?: GrpcTlsOptions
  /** Max receive message length in bytes */
  maxReceiveMessageLength?: number
  /** Max send message length in bytes */
  maxSendMessageLength?: number
}

// === Address Info ===

export interface AddressInfo {
  host: string
  port: number
}

export type ProtocolAddress = AddressInfo & { path?: string; shared?: boolean }

export interface ServerAddresses {
  http: AddressInfo
  websocket?: AddressInfo & { path: string; shared: boolean }
  jsonrpc?: AddressInfo & { path: string; shared: boolean }
  graphql?: AddressInfo & { path: string; shared: boolean }
  grpc?: AddressInfo
  tcp?: AddressInfo
  udp?: AddressInfo
  protocols?: Record<string, ProtocolAddress>
}

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

// === HTTP Route Types (Hono-style) ===

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

/**
 * Helper type to infer input type from HttpRouteOptions
 */
export type InferHttpInput<T> = T extends HttpRouteOptions<infer I, unknown> ? I : unknown

/**
 * Helper type to infer output type from HttpRouteOptions
 */
export type InferHttpOutput<T> = T extends HttpRouteOptions<unknown, infer O> ? O : unknown

// === Protocol Namespace Types ===

/**
 * HTTP protocol namespace for Hono-style routes.
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
 * gRPC protocol namespace for service definitions.
 *
 * @example
 * ```typescript
 * server.grpc
 *   .service('UserService')
 *   .unary('GetUser', { input: GetUserSchema }, async (input, ctx) => {
 *     return db.users.findById(input.id)
 *   })
 *   .serverStream('ListUsers', async function*(input, ctx) {
 *     for await (const user of db.users.stream()) {
 *       yield user
 *     }
 *   })
 * ```
 */
export interface GrpcNamespace {
  /** Define a gRPC service (namespace for methods) */
  service(serviceName: string): GrpcServiceBuilder
  /** Add middleware to all gRPC handlers */
  use(interceptor: Interceptor): GrpcNamespace
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

// === Server Builder ===

/**
 * Unified protocol configuration for enabling multiple protocols at once.
 *
 * @example
 * ```typescript
 * const server = createServer({ port: 3000 })
 *   .protocols({
 *     http: true,                    // Already enabled by default
 *     websocket: { path: '/ws' },    // Enable WebSocket at /ws
 *     jsonrpc: '/rpc',               // Enable JSON-RPC at /rpc
 *     streams: true,                 // Enable SSE streams
 *     graphql: { path: '/graphql' }, // Enable GraphQL
 *   })
 * ```
 */
export interface UnifiedProtocolConfig {
  /** HTTP is enabled by default. Set to false to disable */
  http?: boolean
  /** WebSocket: boolean to enable on /ws, string for custom path, or full options */
  websocket?: boolean | string | WebSocketOptions
  /** JSON-RPC: boolean to enable on /rpc, string for custom path, or full options */
  jsonrpc?: boolean | string | JsonRpcOptions
  /** SSE Streams: boolean to enable on /streams, string for custom path */
  streams?: boolean | string
  /** GraphQL: boolean to enable on /graphql, string for custom path, or full options */
  graphql?: boolean | string | GraphQLOptions
  /** TCP: requires explicit port */
  tcp?: TcpOptions
  /** gRPC: requires proto path */
  grpc?: GrpcOptions
}

export interface ProtocolAdapterContext {
  router: Router
  registry: Registry
  schemaRegistry: SchemaRegistry
  httpServer: HttpAdapter | null
  basePath: string
  host: string
  port: number
  providers: ResolvedProviders
}

export interface ProtocolAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  address?: ProtocolAddress
}

export type ProtocolAdapterFactory<TOptions = unknown> = (
  context: ProtocolAdapterContext,
  options: TOptions
) => ProtocolAdapter | Promise<ProtocolAdapter>

export interface ProtocolExtensionConfig<TOptions = unknown> {
  name: string
  factory: ProtocolAdapterFactory<TOptions>
  options?: TOptions
}

export interface RaffelServer {
  // === Protocol Configuration ===

  /**
   * Enable multiple protocols with a single configuration object.
   * This is the recommended way to configure protocols for multi-protocol servers.
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000 })
   *   .protocols({
   *     websocket: '/ws',
   *     jsonrpc: true,
   *     streams: true,
   *   })
   * ```
   */
  protocols(config: UnifiedProtocolConfig): this

  /**
   * Register a custom protocol adapter to start with the server.
   */
  registerProtocol<TOptions = unknown>(
    name: string,
    factory: ProtocolAdapterFactory<TOptions>,
    options?: TOptions
  ): this

  /** Enable WebSocket on same HTTP port (upgrade) */
  enableWebSocket(path?: string): this
  /** Configure WebSocket on custom port */
  websocket(options: WebSocketOptions): this

  /** Enable JSON-RPC on same HTTP port */
  enableJsonRpc(path?: string): this
  /** Configure JSON-RPC on custom port */
  jsonrpc(options: JsonRpcOptions): this

  /** Configure TCP (always separate port) */
  tcp(options: TcpOptions): this
  /** Configure gRPC */
  grpc(options: GrpcOptions): this

  /** Enable GraphQL on same HTTP port */
  enableGraphQL(path?: string): this
  /** Configure GraphQL with custom options */
  configureGraphQL(options: GraphQLOptions): this

  // === Metrics ===

  /**
   * Enable Prometheus-style metrics collection.
   *
   * @param config - Metrics configuration
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000 })
   *   .enableMetrics({
   *     endpoint: '/metrics',
   *     collectRequestMetrics: true,
   *     collectProcessMetrics: true,
   *     defaultLabels: { service: 'api' },
   *   })
   *
   * // Custom metrics
   * server.metrics?.counter('orders_created', { labels: ['region'] })
   * server.metrics?.increment('orders_created', { region: 'us-east' })
   *
   * // Timer helper
   * const end = server.metrics?.timer('db_query_duration_seconds')
   * await database.query(...)
   * end?.()
   * ```
   */
  enableMetrics(config?: MetricsConfig): this

  // === Tracing ===

  /**
   * Enable distributed tracing with OpenTelemetry-compatible spans.
   *
   * @param config - Tracing configuration
   *
   * @example
   * ```typescript
   * import { createConsoleExporter, createJaegerExporter } from 'raffel'
   *
   * const server = createServer({ port: 3000 })
   *   .enableTracing({
   *     serviceName: 'my-service',
   *     sampleRate: 1.0, // Sample all requests
   *     exporters: [
   *       createConsoleExporter(), // Dev logging
   *       createJaegerExporter({ serviceName: 'my-service' }), // Production
   *     ],
   *   })
   *
   * // Spans are automatically created for requests
   * // W3C Trace Context headers are propagated
   * ```
   */
  enableTracing(config?: TracingConfig): this

  // === USD Documentation ===

  /**
   * Enable USD (Universal Service Documentation) - the modern multi-protocol documentation format.
   *
   * USD extends OpenAPI 3.1 with the x-usd namespace to document:
   * - HTTP endpoints (procedures, REST resources)
   * - WebSocket channels
   * - Server-Sent Events (streams)
   * - JSON-RPC methods
   * - gRPC services
   *
   * @param config - USD configuration
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000 })
   *   .enableUSD({
   *     basePath: '/docs',
   *     info: {
   *       title: 'My API',
   *       version: '1.0.0',
   *     },
   *     ui: { theme: 'dark' },
   *   })
   *
   * // Documentation available at:
   * // - /docs              - Interactive UI
   * // - /docs/usd.json     - USD document
   * // - /docs/usd.yaml     - USD document (YAML)
   * // - /docs/openapi.json - Pure OpenAPI 3.1
   * ```
   */
  enableUSD(config?: USDDocsConfig): this

  /**
   * Get the USD document.
   * Available after server.start() or after enableUSD() is called.
   *
   * @example
   * ```typescript
   * const doc = server.getUSDDocument()
   * console.log(doc.info.title)
   * console.log(doc['x-usd']?.websocket?.channels)
   * ```
   */
  getUSDDocument(): USDDocument | null

  /**
   * Get pure OpenAPI 3.1 document (for Swagger UI compatibility).
   * This strips the x-usd namespace and other USD extensions.
   *
   * @example
   * ```typescript
   * const openapi = server.getOpenAPIDocument()
   * // Use with Swagger UI or other OpenAPI tools
   * ```
   */
  getOpenAPIDocument(): OpenAPIDocument | null

  /** Get USD handlers (available after enableUSD) */
  readonly usd?: USDDocsHandlers

  // === Providers (Dependency Injection) ===

  /**
   * Register a provider (singleton) that will be available in all handlers.
   * Providers are initialized on server start and injected into context.
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000 })
   *   .provide('db', () => new PrismaClient())
   *   .provide('s3db', () => new S3DB({ bucket: 'my-bucket' }))
   *   .provide('config', () => ({ apiKey: process.env.API_KEY }))
   *
   * // In handlers:
   * server.procedure('users.get').handler(async (input, ctx) => {
   *   return ctx.db.user.findUnique({ where: { id: input.id } })
   * })
   * ```
   */
  provide<T>(
    name: string,
    factory: ProviderFactory<T>,
    options?: { onShutdown?: (instance: T) => void | Promise<void> }
  ): this

  // === Global Middleware ===

  /** Add global interceptor */
  use(interceptor: Interceptor): this

  // === Global Hooks ===

  /**
   * Register global hooks with pattern matching.
   * Hooks run for procedures whose names match the pattern.
   *
   * Patterns:
   * - '*' matches all procedures
   * - 'users.*' matches all procedures starting with 'users.'
   * - 'users.get' matches exact procedure name
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000 })
   *   .hooks({
   *     before: {
   *       '*': async (input, ctx) => {
   *         console.log('Before all:', ctx.requestId)
   *       },
   *       'users.*': async (input, ctx) => {
   *         if (!ctx.auth?.authenticated) {
   *           throw new Error('Unauthorized')
   *         }
   *       },
   *     },
   *     after: {
   *       '*': async (input, ctx, result) => {
   *         console.log('After all:', result)
   *         return result
   *       },
   *     },
   *     error: {
   *       '*': async (input, ctx, error) => {
   *         console.error('Error:', error)
   *         throw error // re-throw or return recovery value
   *       },
   *     },
   *   })
   * ```
   */
  hooks(config: GlobalHooksConfig): this

  // === Handler Registration (Fluent) ===

  /** Create a procedure builder */
  procedure(name: string): ProcedureBuilder
  /** Create a stream builder */
  stream(name: string): StreamBuilder
  /** Create an event builder */
  event(name: string): EventBuilder

  /**
   * Create a REST resource with CRUD operations.
   * Dramatically reduces verbosity for REST endpoints.
   *
   * @param name - Resource name (e.g., 'users', 'posts')
   * @param outputSchema - Zod schema for the resource output type
   * @param basePath - Custom base path (defaults to `/${name}`)
   *
   * @example
   * ```typescript
   * // Before: 5 procedure definitions with .http() each
   * // After: One fluent chain
   * server.resource('users', User)
   *   .list(async (input, ctx) => db.users.list())
   *   .get(async (id, ctx) => db.users.findById(id))
   *   .create(CreateUserInput, async (input, ctx) => db.users.create(input))
   *   .update(UpdateUserInput, async (id, input, ctx) => db.users.update(id, input))
   *   .delete(async (id, ctx) => db.users.delete(id))
   *
   * // Generates:
   * // GET /users       → users.list
   * // GET /users/:id   → users.get
   * // POST /users      → users.create
   * // PUT /users/:id   → users.update
   * // DELETE /users/:id → users.delete
   *
   * // Custom actions:
   * server.resource('users', User)
   *   .action('import', ImportSchema, async (input) => db.users.bulkCreate(input))
   *   .itemAction('activate', async (id) => db.users.activate(id))
   * // → POST /users/import
   * // → POST /users/:id/activate
   * ```
   */
  resource<TOutput>(
    name: string,
    outputSchema?: z.ZodType<TOutput>,
    basePath?: string
  ): ResourceBuilder<TOutput>

  // === Declarative Registration (Object-based) ===

  /**
   * Register multiple procedures from a plain object map.
   * More concise than chaining multiple `.procedure()` calls.
   *
   * @example
   * ```typescript
   * server.procedures({
   *   'users.create': {
   *     input: CreateUserInput,
   *     output: User,
   *     http: '/users',  // POST by default
   *     handler: async (input) => db.users.create(input)
   *   },
   *   'users.list': {
   *     output: z.array(User),
   *     http: ['GET', '/users'],
   *     handler: async () => db.users.list()
   *   },
   *   'users.get': {
   *     output: User,
   *     http: ['GET', '/users/:id'],
   *     handler: async (input) => db.users.findById(input.id)
   *   }
   * })
   * ```
   */
  procedures(map: ProcedureMap): this

  /**
   * Register multiple resources from a plain object map.
   * Each resource generates full CRUD endpoints.
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
   *     },
   *     update: {
   *       input: UpdateUserInput,
   *       handler: async (id, input) => db.users.update(id, input)
   *     },
   *     delete: async (id) => db.users.delete(id)
   *   },
   *   posts: {
   *     schema: Post,
   *     list: async () => db.posts.list(),
   *     get: async (id) => db.posts.findById(id)
   *   }
   * })
   * ```
   */
  resources(map: ResourceMap): this

  // === Handler Registration (Direct) ===

  /** Register procedure directly (backwards compatible) */
  procedure(
    name: string,
    handler: ProcedureHandler,
    options?: { description?: string; interceptors?: Interceptor[] }
  ): void

  // === HTTP Routes (Hono-style) ===

  /**
   * Register an HTTP GET route.
   * Creates a procedure with the path as name (e.g., `get:/users/:id`).
   *
   * @example
   * ```typescript
   * // Simple route
   * server.get('/users', async (input, ctx) => {
   *   return { users: await db.users.list() }
   * })
   *
   * // With path parameters
   * server.get('/users/:id', async (input, ctx) => {
   *   return await db.users.findById(ctx.params.id)
   * })
   *
   * // With options
   * server.get('/users', {
   *   input: z.object({ page: z.number().optional() }),
   *   output: z.array(UserSchema),
   *   summary: 'List all users',
   * }, async (input, ctx) => {
   *   return await db.users.list(input.page)
   * })
   * ```
   */
  get(path: string, handler: HttpRouteHandler): this
  get(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP POST route.
   *
   * @example
   * ```typescript
   * server.post('/users', {
   *   input: CreateUserSchema,
   *   output: UserSchema,
   * }, async (input, ctx) => {
   *   return await db.users.create(input)
   * })
   * ```
   */
  post(path: string, handler: HttpRouteHandler): this
  post(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP PUT route.
   */
  put(path: string, handler: HttpRouteHandler): this
  put(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP PATCH route.
   */
  patch(path: string, handler: HttpRouteHandler): this
  patch(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP DELETE route.
   */
  delete(path: string, handler: HttpRouteHandler): this
  delete(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP OPTIONS route.
   */
  options(path: string, handler: HttpRouteHandler): this
  options(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  /**
   * Register an HTTP HEAD route.
   */
  head(path: string, handler: HttpRouteHandler): this
  head(path: string, options: HttpRouteOptions, handler: HttpRouteHandler): this

  // === Grouping ===

  /** Create a handler group with shared middleware */
  group(prefix: string): GroupBuilder
  /** Mount a router module with an additional prefix */
  mount(prefix: string, module: RouterModule, options?: MountOptions): this

  // === Programmatic Registration ===

  /**
   * Add a procedure handler programmatically.
   * Compatible with LoadedRoute from discovery.
   *
   * @example
   * ```typescript
   * server.addProcedure({
   *   name: 'users.get',
   *   handler: async (input, ctx) => db.users.find(input.id),
   *   inputSchema: z.object({ id: z.string() }),
   * })
   *
   * // Or from discovery:
   * const result = await loadDiscovery({ discovery: true })
   * for (const route of result.routes) {
   *   if (route.kind === 'procedure') server.addProcedure(route)
   * }
   * ```
   */
  addProcedure(input: AddProcedureInput | LoadedRoute): this

  /**
   * Add a stream handler programmatically.
   */
  addStream(input: AddStreamInput | LoadedRoute): this

  /**
   * Add an event handler programmatically.
   */
  addEvent(input: AddEventInput | LoadedRoute): this

  /**
   * Add a channel configuration.
   * Channels are for WebSocket pub/sub.
   */
  addChannel(channel: LoadedChannel): this

  /**
   * Add a REST resource (auto-CRUD from schema).
   * Generates standard CRUD endpoints.
   *
   * @example
   * ```typescript
   * const result = await loadRestResources({ restDir: './src/rest' })
   * for (const resource of result.resources) {
   *   server.addRest(resource)
   * }
   * ```
   */
  addRest(resource: LoadedRestResource): this

  /**
   * Add a resource handler (explicit handlers).
   * Each resource file exports specific handlers.
   *
   * @example
   * ```typescript
   * const result = await loadResources({ resourcesDir: './src/resources' })
   * for (const resource of result.resources) {
   *   server.addResource(resource)
   * }
   * ```
   */
  addResource(resource: LoadedResource): this

  /**
   * Add a TCP handler.
   * TCP handlers have full control over socket lifecycle.
   *
   * @example
   * ```typescript
   * const result = await loadTcpHandlers({ tcpDir: './src/tcp' })
   * for (const handler of result.handlers) {
   *   server.addTcpHandler(handler)
   * }
   * ```
   */
  addTcpHandler(handler: LoadedTcpHandler): this

  /**
   * Add a UDP handler.
   * UDP handlers receive datagrams and can respond.
   *
   * @example
   * ```typescript
   * const result = await loadUdpHandlers({ udpDir: './src/udp' })
   * for (const handler of result.handlers) {
   *   server.addUdpHandler(handler)
   * }
   * ```
   */
  addUdpHandler(handler: LoadedUdpHandler): this

  /**
   * Add all handlers from a discovery result.
   * Convenience method for bulk registration.
   *
   * @example
   * ```typescript
   * const result = await loadDiscovery({ discovery: true })
   * server.addDiscovery(result)
   * ```
   */
  addDiscovery(result: DiscoveryResult): this

  // === Lifecycle ===

  /** Start all configured protocols */
  start(): Promise<void>
  /** Stop all protocols */
  stop(): Promise<void>
  /** Restart all protocols */
  restart(): Promise<void>

  // === Protocol Namespaces ===

  /**
   * HTTP protocol namespace for Hono-style route registration.
   * Provides a chainable API for defining HTTP routes.
   *
   * @example
   * ```typescript
   * server.http
   *   .get('/users', async (input, ctx) => db.users.list())
   *   .get('/users/:id', async (input, ctx) => db.users.findById(ctx.params.id))
   *   .post('/users', { input: CreateUserSchema }, async (input, ctx) => db.users.create(input))
   *   .delete('/users/:id', async (input, ctx) => db.users.delete(ctx.params.id))
   * ```
   */
  readonly http: HttpNamespace

  /**
   * WebSocket protocol namespace for pub/sub channels.
   * Provides a chainable API for defining WebSocket channels and handlers.
   *
   * @example
   * ```typescript
   * server.ws
   *   .channel('chat-room', { type: 'public' })
   *   .channel('user-updates', { type: 'private' })
   *   .onSubscribe(async (channel, ctx) => {
   *     console.log(`User ${ctx.auth?.userId} subscribed to ${channel}`)
   *   })
   * ```
   */
  readonly ws: WebSocketNamespace

  /**
   * Streams protocol namespace for SSE/EventSource.
   * Provides a chainable API for defining server-sent event streams.
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
  readonly streams: StreamsNamespace

  /**
   * JSON-RPC protocol namespace for RPC methods and notifications.
   * Provides a chainable API for defining JSON-RPC 2.0 handlers.
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
  readonly rpc: RpcNamespace

  /**
   * TCP protocol namespace for raw socket handlers.
   * Provides a chainable API for defining TCP socket handlers.
   * Use `tcpNs` to avoid conflict with the `tcp(options)` method that enables TCP.
   *
   * @example
   * ```typescript
   * server.tcpNs
   *   .handler('echo', { port: 9000, framing: 'line' })
   *   .onConnect((socket, ctx) => console.log('Connected'))
   *   .onData((data, socket, ctx) => socket.write(data))
   *   .onClose((socket, ctx) => console.log('Disconnected'))
   *   .end()
   * ```
   */
  readonly tcpNs: TcpNamespace

  /**
   * UDP protocol namespace for datagram handlers.
   * Provides a chainable API for defining UDP message handlers.
   *
   * @example
   * ```typescript
   * server.udp
   *   .handler('metrics', { port: 9001 })
   *   .onMessage((msg, rinfo, ctx) => {
   *     console.log(`Received: ${msg} from ${rinfo.address}`)
   *   })
   *   .end()
   * ```
   */
  readonly udp: UdpNamespace

  /**
   * gRPC protocol namespace for defining gRPC services.
   * Provides a chainable API for defining gRPC methods.
   * Use `grpcNs` to avoid conflict with the `grpc(options)` method that configures gRPC.
   *
   * @example
   * ```typescript
   * server.grpcNs
   *   .service('UserService')
   *     .method('GetUser', async (req, ctx) => {
   *       return db.users.findById(req.id)
   *     })
   *     .end()
   * ```
   */
  readonly grpcNs: GrpcNamespace

  // === Accessors ===

  /** Get the registry */
  readonly registry: Registry
  /** Get the router */
  readonly router: Router
  /** Check if server is running */
  readonly isRunning: boolean
  /** Get server addresses */
  readonly addresses: ServerAddresses | null
  /**
   * Channel manager for Pusher-like pub/sub.
   * Only available when WebSocket is enabled with channels option.
   *
   * @example
   * ```typescript
   * // Broadcast to a channel
   * server.channels?.broadcast('chat-room', 'message', { text: 'Hello!' })
   *
   * // Get presence members
   * const members = server.channels?.getMembers('presence-lobby')
   *
   * // Kick a user from a channel
   * server.channels?.kick('presence-lobby', socketId)
   * ```
   */
  readonly channels: ChannelManager | null

  /**
   * Discovery watcher for hot reload.
   * Only available when `discovery` option is enabled.
   *
   * @example
   * ```typescript
   * // Force reload all handlers
   * await server.discoveryWatcher?.reload()
   *
   * // Check if watching
   * console.log(server.discoveryWatcher?.isWatching)
   * ```
   */
  readonly discoveryWatcher: DiscoveryWatcher | null

  /**
   * Resolved provider instances.
   * Available after server.start() is called.
   *
   * @example
   * ```typescript
   * await server.start()
   *
   * // Access providers directly (useful for CLI tools, scripts)
   * const db = server.providers.db as PrismaClient
   * await db.user.findMany()
   * ```
   */
  readonly providers: ResolvedProviders

  /**
   * GraphQL adapter info.
   * Only available when `graphql` option is enabled.
   *
   * @example
   * ```typescript
   * // Get generated schema info
   * console.log(server.graphql?.schemaInfo?.queries)
   * console.log(server.graphql?.schemaInfo?.mutations)
   *
   * // Access the GraphQL schema directly
   * const schema = server.graphql?.schema
   * ```
   */
  readonly graphql: GraphQLAdapter | null

  /**
   * Metrics registry for custom metrics.
   * Only available when `enableMetrics()` is called.
   *
   * @example
   * ```typescript
   * // Register custom metrics
   * server.metrics?.counter('orders_created', { labels: ['region'] })
   * server.metrics?.gauge('active_users')
   * server.metrics?.histogram('payment_amount', { buckets: [10, 50, 100, 500] })
   *
   * // Record metrics
   * server.metrics?.increment('orders_created', { region: 'us-east' })
   * server.metrics?.set('active_users', 150)
   * server.metrics?.observe('payment_amount', 75.50)
   *
   * // Timer helper
   * const end = server.metrics?.timer('db_query_duration_seconds')
   * await database.query(...)
   * end?.()
   * ```
   */
  readonly metrics: MetricRegistry | null

  /**
   * Tracer for distributed tracing.
   * Only available when `enableTracing()` is called.
   *
   * @example
   * ```typescript
   * // Manual span creation
   * const span = server.tracer?.startSpan('custom-operation')
   * span?.setAttribute('key', 'value')
   * // ... do work ...
   * span?.finish()
   *
   * // Extract/inject trace context
   * const headers = server.tracer?.injectContext(span!.context)
   * const context = server.tracer?.extractContext(headers!)
   * ```
   */
  readonly tracer: Tracer | null
}

// === USD Documentation Types ===

/**
 * USD (Universal Service Documentation) configuration.
 *
 * USD extends OpenAPI 3.1 with the x-usd namespace for multi-protocol support.
 */
export interface USDDocsConfig {
  /** Base path for documentation endpoints (default: '/docs') */
  basePath?: string

  /** API information */
  info?: {
    title?: string
    version?: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
      identifier?: string
    }
    summary?: string
  }

  /** Server definitions */
  servers?: USDServer[]

  /** Protocols to include (auto-detected if not specified) */
  protocols?: USDProtocol[]

  /** Security schemes */
  securitySchemes?: Record<string, USDSecurityScheme>

  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>

  /** Tags for grouping */
  tags?: USDTag[]

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** UI configuration */
  ui?: {
    /** Theme preference */
    theme?: 'light' | 'dark' | 'auto'
    /** Primary color for UI */
    primaryColor?: string
    /** Logo URL */
    logo?: string
    /** Enable "Try It Out" feature */
    tryItOut?: boolean
    /** Code generation options */
    codeGeneration?: {
      enabled?: boolean
      languages?: ('typescript' | 'python' | 'go' | 'curl')[]
    }
  }

  /** Include standard error schemas */
  includeErrorSchemas?: boolean

  /** Include stream event schemas */
  includeStreamEventSchemas?: boolean

  /** JSON-RPC generation options */
  jsonrpc?: {
    endpoint?: string
    version?: '2.0'
    batch?: {
      enabled?: boolean
      maxSize?: number
    }
    groupByNamespace?: boolean
  }

  /** gRPC generation options */
  grpc?: {
    package?: string
    syntax?: 'proto3' | 'proto2'
    options?: Record<string, unknown>
    serviceNameOverrides?: Record<string, { service: string; method?: string }>
    defaultServiceName?: string
  }
}

/**
 * USD documentation handlers
 */
export interface USDDocsHandlers {
  /** Serve the main documentation UI */
  serveUI: () => Response
  /** Serve USD document as JSON */
  serveUSD: () => Response
  /** Serve USD document as YAML */
  serveUSDYaml: () => Response
  /** Serve pure OpenAPI 3.1 JSON (for Swagger UI compatibility) */
  serveOpenAPI: () => Response
  /** Get the USD document */
  getUSDDocument: () => USDDocument
  /** Get the OpenAPI document */
  getOpenAPIDocument: () => OpenAPIDocument
}

// === Internal Types ===

export interface ProtocolConfig {
  websocket?: {
    enabled: boolean
    options: WebSocketOptions
    shared: boolean
  }
  jsonrpc?: {
    enabled: boolean
    options: JsonRpcOptions
    shared: boolean
  }
  graphql?: {
    enabled: boolean
    options: GraphQLOptions
    shared: boolean
  }
  tcp?: {
    enabled: boolean
    options: TcpOptions
  }
  grpc?: {
    enabled: boolean
    options: GrpcOptions
  }
}

export interface ActiveAdapters {
  http?: Server
  websocket?: WebSocketServer
  jsonrpc?: Server
  tcp?: NetServer
}

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
  /** Interceptors */
  interceptors?: Interceptor[]
}
