/**
 * File-System Discovery
 *
 * Next.js-style auto-discovery of handlers for Raffel.
 *
 * @example
 * ```typescript
 * import { createServer } from 'raffel'
 *
 * const server = createServer({
 *   port: 3000,
 *   discovery: {
 *     http: './src/http',
 *     channels: './src/channels',
 *     rpc: './src/rpc',
 *     streams: './src/streams',
 *     rest: './src/rest',       // Auto-CRUD from schema
 *     resources: './src/resources', // 1 file = 1 resource
 *     tcp: './src/tcp',         // Custom TCP handlers
 *     udp: './src/udp',         // Custom UDP handlers
 *   },
 * })
 *
 * await server.start()
 * ```
 *
 * Directory Structure:
 * ```
 * src/
 * ├── http/                    # Individual handlers (max control)
 * │   ├── _middleware.ts
 * │   ├── _auth.ts
 * │   └── users/
 * │       ├── get.ts
 * │       └── [id]/
 * │           └── update.ts
 * ├── rest/                    # Auto-CRUD (min boilerplate)
 * │   └── users.ts             # → GET/POST/PUT/PATCH/DELETE /users
 * ├── resources/               # Explicit handlers (balance)
 * │   └── products.ts          # → All CRUD with custom logic
 * ├── channels/                # WebSocket pub/sub
 * │   ├── chat-room.ts
 * │   └── presence-lobby.ts
 * ├── streams/                 # Streaming handlers
 * │   └── logs/tail.ts
 * ├── tcp/                     # Custom TCP servers
 * │   └── game-server.ts
 * └── udp/                     # Custom UDP servers
 *     └── metrics-collector.ts
 * ```
 */

// === Loader ===
export { loadDiscovery, clearModuleCache } from './loader.js'
export type { DiscoveryResult } from './loader.js'

// === Watcher ===
export { createDiscoveryWatcher, isDevelopment } from './watcher.js'
export type { DiscoveryWatcherOptions, DiscoveryWatcher } from './watcher.js'

// === Middleware Processor ===
export { createRouteInterceptors, createChannelAuthorizer } from './middleware-processor.js'

// === Types ===
export type {
  // Config
  DiscoveryConfig,
  DiscoveryLoaderOptions,
  DiscoveryStats,

  // Handler exports
  HandlerExports,
  HandlerFunction,
  HandlerMeta,
  DirectoryMeta,

  // Middleware exports
  MiddlewareExports,
  MiddlewareFunction,
  MiddlewareConfig,

  // Auth exports
  AuthConfigExports,
  AuthConfig,
  AuthVerifyFunction,
  AuthResult,

  // Channel exports
  ChannelExports,
  ChannelEventConfig,
  ChannelMember,

  // Stream exports
  StreamExports,
  StreamHandlerFunction,

  // Loaded handlers
  LoadedRoute,
  LoadedChannel,
  ParsedRoute,
} from './types.js'

// === REST Auto-CRUD ===
export {
  loadRestResources,
} from './rest/index.js'
export type {
  RestConfig,
  RestExports,
  RestAdapter,
  RestHandler,
  RestHandlerConfig,
  RestActionConfig,
  RestLoaderOptions,
  RestLoaderResult,
  LoadedRestResource,
  RestRoute,
  AdapterQuery,
  AdapterFindQuery,
  AdapterCreateData,
  AdapterUpdateQuery,
  AdapterDeleteQuery,
  AdapterCountQuery,
} from './rest/index.js'

// === Resource Handlers ===
export {
  loadResources,
  generateResourceRoutes,
} from './resources/index.js'
export type {
  ResourceConfig,
  ResourceExports,
  ResourceContext,
  ResourceQuery,
  ResourceOperation,
  ResourceMiddleware,
  ResourceAction,
  ResourceLoaderOptions,
  ResourceLoaderResult,
  LoadedResource,
  ResolvedResourceConfig,
  ResourceRoute,
  ListHandler,
  GetHandler,
  CreateHandler,
  UpdateHandler,
  PatchHandler,
  DeleteHandler,
  HeadHandler,
  OptionsHandler,
  ListResult,
  ResourceOptionsResult,
} from './resources/index.js'

// === TCP Custom Handlers ===
export {
  loadTcpHandlers,
  createTcpServer,
} from './tcp/index.js'
export type {
  TcpConfig,
  TcpFramingConfig,
  TcpContext,
  TcpServerRef,
  TcpHandlerExports,
  TcpLoaderOptions,
  TcpLoaderResult,
  LoadedTcpHandler,
  ResolvedTcpConfig,
  TcpServerInstance,
  TcpConnectHandler,
  TcpDataHandler,
  TcpMessageHandler,
  TcpCloseHandler,
  TcpErrorHandler,
  TcpTimeoutHandler,
  TcpDrainHandler,
} from './tcp/index.js'

// === UDP Custom Handlers ===
export {
  loadUdpHandlers,
  createUdpServer,
} from './udp/index.js'
export type {
  UdpConfig,
  UdpMulticastConfig,
  UdpContext,
  UdpHandlerExports,
  UdpLoaderOptions,
  UdpLoaderResult,
  LoadedUdpHandler,
  ResolvedUdpConfig,
  UdpServerInstance,
  UdpMessageHandler,
  UdpListeningHandler,
  UdpErrorHandler,
  UdpCloseHandler,
} from './udp/index.js'
