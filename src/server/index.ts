/**
 * Unified Server Module
 *
 * Single entry point for multi-protocol Raffel server.
 */

export { createServer } from './builder.js'
export { createRouterModule } from './router-module.js'
export { loadRouterModule, pathToRouteName } from './route-discovery.js'
export type {
  // Server
  ServerOptions,
  CorsOptions,
  RaffelServer,
  ServerAddresses,
  AddressInfo,

  // Protocol options
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  GrpcTlsOptions,

  // Builders
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  GroupBuilder,
  RouterModule,
  MountOptions,

  // Programmatic Add Types
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,

  // Providers (Dependency Injection)
  ProviderFactory,
  ProviderDefinition,
  ProvidersConfig,
  ResolvedProviders,
} from './types.js'
export type {
  RouteKind,
  RouteDefinition,
  ProcedureRouteDefinition,
  StreamRouteDefinition,
  EventRouteDefinition,
  RouteLoaderOptions,
} from './route-discovery.js'

// === File-System Discovery ===
export {
  // Discovery
  loadDiscovery,
  loadRoutes,
  createDiscoveryWatcher,
  createRouteWatcher,
  createRouteInterceptors,
  createChannelAuthorizer,
  isDevelopment,

  // REST Auto-CRUD
  loadRestResources,

  // Resource Handlers
  loadResources,
  generateResourceRoutes,

  // TCP/UDP Custom Handlers
  loadTcpHandlers,
  createTcpServer,
  loadUdpHandlers,
  createUdpServer,
} from './fs-routes/index.js'

export type {
  // Discovery Config
  DiscoveryConfig,
  DiscoveryLoaderOptions,
  DiscoveryStats,
  DiscoveryWatcher,

  // Legacy aliases
  RoutesConfig,
  RoutesLoaderOptions,
  RouteLoadStats,
  RouteWatcher,

  // Loaded Handlers
  LoadedRoute,
  LoadedChannel,

  // Handler Exports
  HandlerExports,
  HandlerFunction,
  HandlerMeta,
  MiddlewareExports,
  MiddlewareFunction,
  MiddlewareConfig,
  AuthConfigExports,
  AuthConfig,
  AuthVerifyFunction,
  AuthResult,
  ChannelExports,
  ChannelEventConfig,
  StreamExports,
  StreamHandlerFunction,

  // REST Types
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

  // Resource Types
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

  // TCP Types
  TcpConfig as TcpHandlerConfig,
  TcpFramingConfig,
  TcpContext,
  TcpServerRef,
  TcpHandlerExports,
  TcpLoaderOptions,
  TcpLoaderResult,
  LoadedTcpHandler,
  ResolvedTcpConfig,
  TcpServerInstance,

  // UDP Types
  UdpConfig as UdpHandlerConfig,
  UdpMulticastConfig,
  UdpContext,
  UdpHandlerExports,
  UdpLoaderOptions,
  UdpLoaderResult,
  LoadedUdpHandler,
  ResolvedUdpConfig,
  UdpServerInstance,
} from './fs-routes/index.js'
