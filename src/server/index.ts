/**
 * Unified Server Module
 *
 * Single entry point for multi-protocol Raffel server.
 */

export { createServer } from '../bootstrap/create-server.js'
export { createRouterModule } from './router-module.js'
export { loadRouterModule, pathToRouteName } from './route-discovery.js'
export {
  buildRuntimeInspectionGraph,
  serializeRuntimeInspectionGraph,
  loadRuntimeInspectionPreview,
  createSchemaExample,
  createSchemaInvalidExample,
  explainRuntimeInspectionSubject,
  buildRuntimeInspectionDoctorReport,
  formatRuntimeInspectionGraph,
  formatRuntimeInspectionExplanation,
  formatRuntimeInspectionDoctorReport,
  buildRuntimeContractTestSuite,
  formatRuntimeContractTestSuite,
  createRuntimePlaygroundSnapshot,
  createRuntimePlaygroundServer,
  startRuntimePlayground,
} from '../inspect/index.js'
export type {
  // Server
  ServerOptions,
  HttpOptions,
  CorsOptions,
  RaffelServer,
  ServerConfigPreview,
  ServerPreset,
  ServerPresetOptions,
  ServerProfile,
  ExtendedProtocolConfig,
  ProtocolPreviewConfig,
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

  // HTTP Routes
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
  ProtocolAdapterContext,
  ProtocolAdapter,
  ProtocolAdapterFactory,
  ProtocolExtensionConfig,
  ProtocolAddress,

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
  ServerPlugin,
  ServerPluginRegisterContext,
  ServerPluginRuntimeContext,
  ServerPluginInspectContext,

  // Procedure Hooks
  BeforeHook,
  AfterHook,
  ErrorHook,
  GlobalHooksConfig,
} from './types.js'
export type {
  RuntimeInspectionGraph,
  RuntimeInspectionDiagnostic,
  RuntimeInspectionOperation,
  RuntimeInspectionService,
  RuntimeInspectionChannel,
  RuntimeInspectionTransport,
  RuntimeInspectionOperationRegistration,
  RuntimeInspectionExtensionNode,
  RuntimeInspectionContribution,
  RuntimeInspectionDoctorReport,
  RuntimeInspectionExplanation,
  RuntimeInspectionLoadOptions,
  LoadedRuntimeInspectionPreview,
  RuntimeContractTestCase,
  RuntimeContractTestSuite,
  RuntimePlaygroundEntry,
  RuntimePlaygroundSnapshot,
  RuntimePlaygroundSessionView,
  RuntimePlaygroundServer,
} from '../inspect/index.js'
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

// === Single-port transport utilities ===
export {
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
  normalizeSinglePortDefaults,
  getSinglePortConcurrencyState,
  SinglePortRegistry,
} from './single-port/index.js'

export type {
  NormalizedError,
  GlobalErrorHandler,
  ErrorProtocol,
} from './types.js'

export type {
  ProtocolSniffer,
  ProtocolDecisionPayload,
  ProtocolFusionDecision,
  ProtocolFusionState,
  ProtocolFusionMode,
  ProtocolFusionLayer,
  ProtocolFusionOutcome,
  ProtocolSnifferContext,
  SinglePortProtocolKind,
  SinglePortDecisionReason,
  SinglePortConfig,
} from './types.js'
export type {
  SinglePortDetectorOptions,
  SinglePortStreamDetectInput,
  SinglePortChunkDetectInput,
  SinglePortDefaults,
} from './single-port/index.js'
