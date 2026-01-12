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
  HttpOptions,
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
  ResourceBuilder,
  RouterModule,
  MountOptions,

  // HTTP Routes (Hono-style)
  HttpRouteHandler,
  HttpRouteOptions,

  // Protocol Namespaces
  HttpNamespace,
  WebSocketNamespace,
  WebSocketChannelOptions,
  WebSocketSubscribeHandler,
  WebSocketMessageHandler,
  WebSocketUnsubscribeHandler,
  StreamsNamespace,
  StreamOptions,
  StreamSourceHandler,
  StreamSinkHandler,
  StreamDuplexHandler,

  // Declarative Definition Types
  ProcedureDef,
  ProcedureMap,
  ResourceDef,
  ResourceMap,

  // Programmatic Add Types
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,

  // Providers (Dependency Injection)
  ProviderFactory,
  ProviderDefinition,
  ProvidersConfig,
  ResolvedProviders,

  // Procedure Hooks
  BeforeHook,
  AfterHook,
  ErrorHook,
  GlobalHooksConfig,
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
  createDiscoveryWatcher,
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

// === Cross-Protocol Context Sharing ===
export {
  createSharedContextFactory,
  createAuthContextFactory,
  mergeContextFactories,
  // Extension symbols for storing data in ctx.extensions
  SESSION_SYMBOL,
  HTTP_REQUEST_SYMBOL,
  // Helpers to retrieve from extensions
  getSessionFromContext,
  getHttpRequestFromContext,
} from './shared-context.js'

export type {
  SharedContextFactoryOptions,
  ProtocolContextFactory,
} from './shared-context.js'

// === Unified Error Handling ===
export {
  // Error normalization
  normalizeError,
  isOperationalError,
  // Error interceptor
  createErrorInterceptor,
  // Error response helpers
  createErrorEnvelope,
  toRaffelError,
  // Protocol-specific formatters
  formatHttpError,
  formatJsonRpcError,
  formatWebSocketError,
  formatStreamError,
  // Global error handler helper
  createGlobalErrorHandler,
} from './errors.js'

export type {
  ErrorInterceptorOptions,
} from './errors.js'

export type {
  NormalizedError,
  GlobalErrorHandler,
  ErrorProtocol,
} from './types.js'
