/**
 * Server Builder Types — Server runtime + USD docs + internals
 *
 * Type definitions for server addresses, the RaffelServer interface,
 * protocol adapters, USD documentation handlers, and internal types.
 */

import type { z } from 'zod'
import type { Server } from 'node:http'
import type { WebSocketServer } from 'ws'
import type { Server as NetServer } from 'node:net'
import type { Registry } from '../../core/registry.js'
import type { Router } from '../../core/router.js'
import type {
  Interceptor,
  ProcedureHandler,
} from '../../types/index.js'
import type { ChannelManager } from '../../channels/index.js'
import type { HttpAdapter } from '../../adapters/http.js'
import type {
  DiscoveryWatcher,
  LoadedRoute,
  LoadedChannel,
  LoadedRestResource,
  LoadedResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
} from '../fs-routes/index.js'
import type { DiscoveryResult } from '../fs-routes/loader.js'
import type { GraphQLOptions, GraphQLAdapter } from '../../graphql/index.js'
import type { MetricsConfig, MetricRegistry } from '../../metrics/index.js'
import type { TracingConfig, Tracer } from '../../tracing/index.js'
import type {
  USDDocument,
  USDProtocol,
  USDTag,
  USDTagGroup,
  USDExternalDocs,
  USDServer,
  USDSecurityScheme,
} from '../../usd/index.js'
import type { OpenAPIDocument } from '../../usd/export/openapi.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type {
  RuntimeInspectionGraph,
} from '../../inspect/index.js'
import type {
  FrontDoorStrategy,
  ProtocolFusionState,
  ResolvedProviders,
  ProviderFactory,
  ServerPlugin,
  ServerConfigPreview,
  ServerPreset,
  ServerPresetOptions,
  SinglePortConfig,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
} from './config-types.js'
import type {
  HttpNamespace,
  HttpRouteHandler,
  HttpRouteOptions,
  WebSocketNamespace,
  StreamsNamespace,
  RpcNamespace,
  TcpNamespace,
  UdpNamespace,
  GrpcNamespace,
  GlobalHooksConfig,
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  ResourceBuilder,
  GroupBuilder,
  RouterModule,
  MountOptions,
  DirectProcedureOptions,
  ProcedureMap,
  ResourceMap,
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,
} from './handler-types.js'

// === Address Info ===

export interface AddressInfo {
  host: string
  port: number
}

export type ProtocolAddress = AddressInfo & { path?: string; shared?: boolean; source?: 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown' }

export type FrontDoorProtocolAddress = ProtocolAddress & {
  frontDoor?: boolean
  strategy?: FrontDoorStrategy
}

export interface ServerAddresses {
  http: FrontDoorProtocolAddress
  websocket?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  jsonrpc?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  graphql?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  grpc?: FrontDoorProtocolAddress
  tcp?: FrontDoorProtocolAddress
  udp?: FrontDoorProtocolAddress
  protocols?: Record<string, ProtocolAddress>
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

/**
 * Extended protocol configuration with per-protocol `enabled` toggle and UDP support.
 * Used by `withProtocols()` for richer DX.
 */
export interface ExtendedProtocolConfig {
  /** HTTP is enabled by default */
  http?: boolean | { enabled: boolean }
  /** WebSocket: toggle + optional path/options */
  websocket?: boolean | string | WebSocketOptions | ({ enabled: boolean } & Partial<WebSocketOptions>)
  /** JSON-RPC: toggle + optional path/options */
  jsonrpc?: boolean | string | JsonRpcOptions | ({ enabled: boolean } & Partial<JsonRpcOptions>)
  /** SSE Streams: toggle + optional path */
  streams?: boolean | string
  /** GraphQL: toggle + optional path/options */
  graphql?: boolean | string | GraphQLOptions | ({ enabled: boolean } & Partial<GraphQLOptions>)
  /** TCP: toggle + optional port/options (port required when enabled) */
  tcp?: TcpOptions | ({ enabled: boolean } & Partial<TcpOptions>)
  /** UDP: test-scope marker only, no production adapter */
  udp?: boolean | { enabled: boolean }
  /** gRPC: toggle + optional options (protoPath required when enabled) */
  grpc?: GrpcOptions | ({ enabled: boolean } & Partial<GrpcOptions>)
}

/**
 * Environment profile for `withProfile()`.
 * - `local`: development/mock mode with extended protocol aliases
 * - `staging`: neutral defaults
 * - `production`: production hardening with warnings for dev-only options
 */
export type ServerProfile = 'local' | 'staging' | 'production'

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
   * @deprecated Prefer {@link withProtocols} for extended protocol options and
   * explicit disable support.
   * Enable multiple protocols with a single configuration object.
   * Legacy compatibility alias that maps to {@link withProtocols()}.
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
   * Enable multiple protocols with per-protocol `enabled` toggle, UDP marker, and eager
   * conflict warnings logged via `logger.warn()`.
   *
   * @example
   * ```typescript
   * createServer({ port: 3000 })
   *   .withProtocols({
   *     websocket: { enabled: true, path: '/ws' },
   *     tcp: { enabled: false },
   *   })
   * ```
   */
  withProtocols(config: ExtendedProtocolConfig): this

  /**
   * Apply environment-specific server profile.
   * - `local`: extended protocol aliases for mocks
   * - `staging`: neutral defaults
 * - `production`: production hardening + dev-option warnings
   *
   * @param profile - Target environment
   * @param overrides - Optional protocol overrides applied after profile defaults
   *
   * @example
   * ```typescript
   * createServer({ port: 3000 })
   *   .withProfile('production')
   *   .withProtocols({ websocket: true })
   *
   * // With overrides
   * createServer({ port: 3000 })
   *   .withProfile('local', { protocols: { tcp: { port: 9000 } } })
   * ```
   */
  withProfile(profile: ServerProfile, overrides?: { protocols?: ExtendedProtocolConfig }): this

  /**
   * Apply a common protocol preset to speed up setup.
   * Presets:
   * - api / dev / full: enable shared websocket + jsonrpc + graphql
   * - realtime: enable websocket only
   * - rpc: enable jsonrpc only
   */
  withPreset(preset: ServerPreset, options?: ServerPresetOptions): this

  /**
   * Enable or disable single-port transport fusion after server creation.
   */
  enableSinglePort(config?: SinglePortConfig | boolean): this

  /**
   * Enable or disable shared-port protocol fusion after server creation.
   * Canonical alias for `enableSinglePort()`.
   */
  enableSharedPort(config?: SinglePortConfig | boolean): this

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
   *   .provide('cacheStore', () => ({
   *     host: process.env.CACHE_HOST,
   *   }))
   *   .provide('config', () => ({ apiKey: process.env.API_KEY }))
   *
   * // In handlers:
   * server.procedure('users.get').handler(async (input, ctx) => {
   *   const services = ctx.services as { db: PrismaClient }
   *   return services.db.user.findUnique({ where: { id: input.id } })
   * })
   * ```
   */
  provide<T>(
    name: string,
    factory: ProviderFactory<T>,
    options?: { onShutdown?: (instance: T) => void | Promise<void> }
  ): this

  /**
   * Register a runtime plugin.
   * Plugins must be registered before `server.start()`.
   */
  usePlugin(plugin: ServerPlugin): this

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
    options?: DirectProcedureOptions
  ): void

  // === HTTP Routes ===

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
   * Single high-leverage entry point for programmatic handler registration.
   * Replaces the four-step `procedure(name).input(...).output(...).handler(...)`
   * ritual with one call. Discriminated by `opts.kind` (defaults to
   * `'procedure'`).
   *
   * @example
   * ```typescript
   * server.registerHandler('users.get', getUser, { input: GetUserSchema })
   * server.registerHandler('chat.tokens', tokenStream, { kind: 'stream', direction: 'server' })
   * server.registerHandler('order.placed', onOrder, { kind: 'event', delivery: 'at-least-once' })
   * ```
   */
  registerHandler(
    name: string,
    handler:
      | import('../../types/index.js').ProcedureHandler
      | import('../../types/index.js').StreamHandler
      | import('../../types/index.js').EventHandler,
    opts?: import('./handler-types.js').RegisterHandlerOptions,
  ): this

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

  // === Authorization (policies) ===

  /**
   * Policy module namespace. Present only when `policy: { ... }` was passed
   * to `createServer`. `undefined` otherwise.
   */
  readonly policy?: {
    /**
     * Evaluate an `AuthzInput` against the loaded policies without producing
     * any side effects (no log, no metric, no decision attached to ctx).
     * Useful for REPL / CLI debugging and unit tests.
     */
    explain(
      input: import('../../middleware/policy/types.js').AuthzInput
    ): import('../../middleware/policy/types.js').Decision
      | Promise<import('../../middleware/policy/types.js').Decision>

    /**
     * Read-only snapshot of all loaded policies (inline + JSON, after merge).
     */
    list(): readonly import('../../middleware/policy/types.js').Policy[]
  }

  // === Protocol Namespaces ===

  /**
   * HTTP protocol namespace for native Raffel route registration.
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
   * Preview final protocol bootstrap decision graph without starting the server.
   */
  previewConfig(): ServerConfigPreview

  /**
   * Preview the canonical runtime inspection graph without starting the server.
   */
  preview(): RuntimeInspectionGraph

  /**
   * Inspect runtime protocol-fusion mode and recent routing/rejection decisions.
   */
  getProtocolFusionState(): ProtocolFusionState

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
    /** Favicon URL */
    favicon?: string
    /** Enable "Try It Out" feature */
    tryItOut?: boolean
    /** Code generation options */
    codeGeneration?: {
      enabled?: boolean
      languages?: ('typescript' | 'python' | 'go' | 'curl')[]
    }
    /** Hero section configuration (Docsify-style cover page) */
    hero?: {
      /** Override title from info.title */
      title?: string
      /** Version badge */
      version?: string
      /** Tagline/description */
      tagline?: string
      /** Feature list */
      features?: string[]
      /** Background style */
      background?: 'gradient' | 'solid' | 'pattern' | 'image'
      /** Background image URL */
      backgroundImage?: string
      /** Background color (for solid) */
      backgroundColor?: string
      /** CTA buttons */
      buttons?: Array<{ text: string; href?: string; primary?: boolean }>
      /** Quick links */
      quickLinks?: Array<{ title: string; description?: string; href: string; icon?: string }>
      /** GitHub URL (corner octocat) */
      github?: string
    }
    /** Sidebar configuration */
    sidebar?: {
      search?: boolean
      expandAll?: boolean
      showCounts?: boolean
    }
  }

  /** Documentation customization for USD spec (portable, included in x-usd) */
  documentation?: {
    /** Hero section configuration */
    hero?: {
      title?: string
      version?: string
      tagline?: string
      features?: string[]
      background?: 'gradient' | 'solid' | 'pattern' | 'image'
      backgroundImage?: string
      backgroundColor?: string
      buttons?: Array<{ text: string; href?: string; primary?: boolean }>
      quickLinks?: Array<{ title: string; description?: string; href: string; icon?: string }>
      github?: string
    }
    /** Introduction markdown (displayed after hero) */
    introduction?: string
    /** Logo URL */
    logo?: string
    /** Favicon URL */
    favicon?: string
    /** External links */
    externalLinks?: Array<{ title: string; url: string; description?: string }>
  }

  /** Include standard error schemas */
  includeErrorSchemas?: boolean

  /** Include stream event schemas */
  includeStreamEventSchemas?: boolean

  /** Global content types for documentation and content negotiation */
  contentTypes?: {
    /** Default content type */
    default?: string
    /** Supported content types */
    supported?: string[]
  }

  /** Tag groups for the documentation sidebar */
  tagGroups?: USDTagGroup[]

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
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  jsonrpc?: {
    enabled: boolean
    options: JsonRpcOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  graphql?: {
    enabled: boolean
    options: GraphQLOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  tcp?: {
    enabled: boolean
    options: TcpOptions
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  grpc?: {
    enabled: boolean
    options: GrpcOptions
    shared?: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
}

export interface ActiveAdapters {
  http?: Server
  websocket?: WebSocketServer
  jsonrpc?: Server
  tcp?: NetServer
}
