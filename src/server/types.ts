/**
 * Server Builder Types
 *
 * Type definitions for the unified server API.
 */

import type { z } from 'zod'
import type { Server } from 'node:http'
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
  StreamDirection,
  RetryPolicy,
} from '../types/index.js'
import type { EventDeliveryOptions } from '../core/event-delivery.js'
import type { ChannelOptions, ChannelManager } from '../channels/index.js'
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
import type { GraphQLOptions, GraphQLAdapter, GeneratedSchemaInfo } from '../graphql/index.js'

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

  // === Middleware ===

  /**
   * Global middleware applied to all handlers.
   *
   * @example
   * ```typescript
   * middleware: [
   *   createAuthMiddleware({ ... }),
   *   createLoggingMiddleware(),
   *   createRateLimitMiddleware({ ... }),
   * ]
   * ```
   */
  middleware?: Interceptor[]

  // === File-System Discovery ===

  /**
   * Auto-discover handlers from file system (Next.js-style).
   * - `true` enables all defaults (./src/http, ./src/channels, ./src/rpc, ./src/streams)
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

  // === Advanced ===

  /** Event delivery configuration (for at-least-once/at-most-once) */
  eventDelivery?: EventDeliveryOptions
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

export interface ServerAddresses {
  http: AddressInfo
  websocket?: AddressInfo & { path: string; shared: boolean }
  jsonrpc?: AddressInfo & { path: string; shared: boolean }
  graphql?: AddressInfo & { path: string; shared: boolean }
  grpc?: AddressInfo
  tcp?: AddressInfo
}

// === Handler Builders ===

export interface ProcedureBuilder<TInput = unknown, TOutput = unknown> {
  /** Define input schema (Zod) */
  input<T extends z.ZodType>(schema: T): ProcedureBuilder<z.infer<T>, TOutput>
  /** Define output schema (Zod) */
  output<T extends z.ZodType>(schema: T): ProcedureBuilder<TInput, z.infer<T>>
  /** Add description for OpenAPI */
  description(desc: string): this
  /** Add interceptor */
  use(interceptor: Interceptor): this
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

export interface RaffelServer {
  // === Protocol Configuration ===

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

  // === Global Middleware ===

  /** Add global interceptor */
  use(interceptor: Interceptor): this

  // === Handler Registration (Fluent) ===

  /** Create a procedure builder */
  procedure(name: string): ProcedureBuilder
  /** Create a stream builder */
  stream(name: string): StreamBuilder
  /** Create an event builder */
  event(name: string): EventBuilder

  // === Handler Registration (Direct) ===

  /** Register procedure directly (backwards compatible) */
  procedure(
    name: string,
    handler: ProcedureHandler,
    options?: { description?: string; interceptors?: Interceptor[] }
  ): void

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

  /** @deprecated Use discoveryWatcher instead */
  readonly routeWatcher: DiscoveryWatcher | null

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
  /** Description */
  description?: string
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
