/**
 * Raffel - Unified Multi-Protocol Server Runtime
 *
 * One core, multiple transports.
 */

// === Ports (Hexagonal Architecture Boundaries) ===
export type {
  LoggerPort,
  LoggerFactory,
  LogData,
  CacheStore,
  ChannelPresencePort,
} from './ports/index.js'
// Note: SessionStore, SessionData, Session, RateLimitDriver, RateLimitRecord,
// CacheDriver, CacheEntry, CacheGetResult, CacheStats, EventDeliveryStore,
// ValidatorAdapter, ValidationResult, ValidationErrorDetails are already
// exported from their respective modules below.

// === Stream ===
export { createStream } from './stream/index.js'
export type {
  RaffelStream,
  StreamChunk,
  StreamOptions as StreamCreateOptions,
  StreamState,
} from './stream/index.js'

// === Core ===
export {
  createRegistry,
  createRouter,
  RaffelError,
  createEventDeliveryEngine,
  createInMemoryEventDeliveryStore,
} from './core/index.js'
export type {
  Registry,
  Router,
  RouterResult,
  ProcedureOptions,
  StreamRegistryOptions,
  EventOptions,
  EventDeliveryOptions,
  EventDeliveryStore,
  EventDeliveryEngine,
} from './core/index.js'

// === Types ===
export type {
  // Envelope
  Envelope,
  EnvelopeType,
  ErrorEnvelope,
  ErrorPayload,

  // Context
  Context,
  CallFunction,
  AuthContext,
  AuthPrincipal,
  AuthRequirement,
  Principal,
  TracingContext,
  ContextSeed,
  ContextInput,
  ContextLogger,
  ProtocolKind,
  HttpContextCapability,
  WebSocketContextCapability,
  JsonRpcContextCapability,
  GraphQLContextCapability,
  GrpcContextCapability,
  TcpContextCapability,
  UdpContextCapability,
  SmtpContextCapability,
  StreamContextCapability,
  ExtensionKey,
  ContractAuthPolicy,
  ContractTimeoutPolicy,
  ContractRateLimitPolicy,
  ContractPolicies,
  ContractContext,

  // Handlers
  ProcedureHandler,
  ServerStreamHandler,
  ClientStreamHandler,
  BidiStreamHandler,
  StreamHandler,
  EventHandler,
  AckFunction,
  HandlerKind,
  JsonRpcErrorMeta,
  JsonRpcMeta,
  GrpcMeta,
  StreamDirection,
  DeliveryGuarantee,
  RetryPolicy,
  HandlerMeta,
  RegisteredHandler,
  Interceptor,
} from './types/index.js'

export {
  // Envelope helpers
  createResponseEnvelope,
  createErrorEnvelope,

  // Context helpers
  ContextAuthError,
  createAuthContext,
  createContext,
  getAuthRoles,
  getAuthScopes,
  getPrincipalId,
  isTypedPrincipal,
  mergeContextSeeds,
  stripTransportCapabilities,
  withDeadline,
  withAuth,
  withExtension,
  getExtension,
  createExtensionKey,
  CONTRACT_POLICY_METADATA_KEY,
  normalizeContractPolicies,
  mergeContractPolicies,
  serializeContractPolicies,
  parseContractPolicies,
} from './types/index.js'

// === Adapters (Server) ===
export {
  createWebSocketAdapter,
  createHttpAdapter,
  createTcpAdapter,
  createSmtpAdapter,
  createSmtpClient,
  createJsonRpcAdapter,
  createGrpcAdapter,
  JsonRpcErrorCode,
  HttpMetadataKey,
  checkConnectionFilter,
  checkWebSocketConnectionFilter,
} from './adapters/index.js'
export type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  HttpAdapter,
  HttpAdapterOptions,
  TcpAdapter,
  TcpAdapterOptions,
  SmtpAdapter,
  SmtpAdapterOptions,
  SmtpTlsOptions,
  SmtpAuthVerifier,
  SmtpRecipientValidator,
  JsonRpcAdapter,
  JsonRpcAdapterOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  GrpcAdapter,
  GrpcAdapterOptions,
  GrpcTlsOptions,
  GrpcMethodInfo,
  ConnectionFilter,
  WebSocketConnectionFilter,
} from './adapters/index.js'

// === Validation ===
export {
  // Core validation
  validate,
  createValidationInterceptor,
  createSchemaValidationInterceptor,
  createSchemaRegistry,
  normalizeSchemaDescriptor,
  SCHEMA_DESCRIPTOR_VERSION,
  // Validator registration
  registerValidator,
  resetValidation,
  getValidator,
  hasValidator,
  listValidators,
  configureValidation,
  getValidationConfig,
  // Adapter factories - user imports their validator and passes it here
  createZodAdapter,
  createYupAdapter,
  createJoiAdapter,
  createAjvAdapter,
  createFastestValidatorAdapter,
  // Error converters for advanced use
  zodErrorToDetails,
  yupErrorToDetails,
  joiErrorToDetails,
  ajvErrorToDetails,
  fvErrorToDetails,
} from './validation/index.js'
export type {
  HandlerSchema,
  ValidationErrorDetails,
  ValidationResult,
  ValidatorAdapter,
  ValidatorType,
  ValidationConfig,
  SchemaRegistry,
  SchemaDescriptor,
  SchemaDescriptorDiagnostic,
  NormalizeSchemaDescriptorOptions,
} from './validation/index.js'

// === Runtime Inspection ===
export {
  buildRuntimeInspectionGraph,
  serializeRuntimeInspectionGraph,
  serializeRuntimeInspectionOperation,
  serializeRuntimeInspectionTransport,
  serializeRuntimeInspectionService,
  serializeRuntimeInspectionChannel,
  serializeRuntimeInspectionDiagnostic,
  serializeRuntimeInspectionSchema,
  serializeRuntimeInspectionPolicies,
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
  RUNTIME_INSPECTION_GRAPH_VERSION,
} from './inspect/index.js'
export type {
  RuntimeInspectionGraph,
  RuntimeInspectionDiagnostic,
  RuntimeInspectionDiagnosticSeverity,
  RuntimeInspectionOperation,
  RuntimeInspectionTransport,
  RuntimeInspectionTransportBinding,
  RuntimeInspectionService,
  RuntimeInspectionChannel,
  RuntimeInspectionSource,
  RuntimeInspectionSourceKind,
  RuntimeInspectionOperationRegistration,
  RuntimeInspectionSchema,
  RuntimeInspectionPolicySummary,
  RuntimeInspectionDoctorReport,
  RuntimeInspectionExplanation,
  RuntimeInspectionLoadOptions,
  LoadedRuntimeInspectionPreview,
  RuntimeContractTestCaseKind,
  RuntimeContractRequestTemplate,
  RuntimeContractBindingTarget,
  RuntimeContractTestCase,
  RuntimeContractTestSuite,
  RuntimePlaygroundEntry,
  RuntimePlaygroundSnapshot,
  RuntimePlaygroundInvokeRequest,
  RuntimePlaygroundSessionView,
  RuntimePlaygroundServerOptions,
  RuntimePlaygroundServer,
} from './inspect/index.js'

// === Middleware ===
export {
  // Auth
  createAuthMiddleware,
  createAuthzMiddleware,
  createBearerStrategy,
  createApiKeyStrategy,
  createStaticApiKeyStrategy,
  requireAuth,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasScope,
  hasAnyScope,
  createRefreshInterceptor,
  createClientCredentialsStrategy,
  createJWKSVerifier,
  // Composition
  compose,
  when,
  forProcedures,
  forPattern,
  except,
  branch,
  passthrough,
} from './middleware/index.js'
export {
  // Rate Limiting
  createRateLimitInterceptor,
  createAuthRateLimiter,
  // Request ID
  createRequestIdInterceptor,
  createPrefixedRequestIdInterceptor,
  createCorrelatedRequestIdInterceptor,
  // Logging
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
  // Timeout
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
  setTimeoutPhase,
  getTimeoutPhase,
  getPhaseInfo,
  // Retry
  createRetryInterceptor,
  createSelectiveRetryInterceptor,
  // Circuit Breaker
  createCircuitBreakerInterceptor,
  createProcedureCircuitBreaker,
  createCircuitBreakerManager,
  // Bulkhead
  createBulkheadInterceptor,
  createProcedureBulkhead,
  createBulkheadManager,
  // Fallback
  createFallbackInterceptor,
  // Deduplication
  createDedupInterceptor,
  createReadOnlyDedupInterceptor,
  // Size Limits
  createSizeLimitInterceptor,
  createRequestSizeLimitInterceptor,
  createResponseSizeLimitInterceptor,
  SizeLimitPresets,
  // Cache
  createCacheInterceptor,
  createReadThroughCacheInterceptor,
  createMemoryCacheStore,
  createCacheInvalidator,
  CachePresets,
  // Response Envelope
  createEnvelopeInterceptor,
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
  createDetailedEnvelopeInterceptor,
  isEnvelopeResponse,
  isEnvelopeSuccess,
  isEnvelopeError,
  EnvelopePresets,
  // Field Filter
  createFieldFilterInterceptor,
  // Guard
  createGuardInterceptor,
} from './middleware/interceptors/index.js'
export type {
  // Auth types
  AuthResult,
  AuthStrategy,
  AuthMiddlewareOptions,
  BearerTokenOptions,
  ApiKeyOptions,
  AuthzMiddlewareOptions,
  AuthzRule,
  RefreshInterceptorOptions,
  RefreshTokenCookieOptions,
  ClientCredentialsConfig,
  ClientCredentialsExchangeOptions,
  ClientCredentialsStrategy,
  CreateJWKSVerifierOptions,
  JWKSVerifier,
} from './middleware/index.js'
export type {
  FieldFilterConfig,
  GuardCheckFn,
  GuardErrorOptions,
} from './middleware/interceptors/index.js'

// === Rate Limit Drivers ===
export {
  createDriver as createRateLimitDriver,
  createDriverFromConfig as createRateLimitDriverFromConfig,
  MemoryRateLimitDriver,
  FilesystemRateLimitDriver,
  RedisRateLimitDriver,
} from './rate-limit/index.js'
export type {
  RateLimitDriver,
  RateLimitDriverType,
  RateLimitDriverConfig,
  MemoryRateLimitDriverOptions,
  FilesystemRateLimitDriverOptions,
  RedisRateLimitDriverOptions,
  RedisLikeClient as RateLimitRedisLikeClient,
} from './rate-limit/index.js'

// === Server (Unified API) ===
export {
  createServer,
  createRouterModule,
  loadRouterModule,
  pathToRouteName,
  loadDiscovery,
  createDiscoveryWatcher,
  createRouteInterceptors,
  createChannelAuthorizer,
  isDevelopment,
  loadRestResources,
  loadResources,
  generateResourceRoutes,
  loadTcpHandlers,
  createTcpServer,
  loadUdpHandlers,
  createUdpServer,
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
  normalizeSinglePortDefaults,
  getSinglePortConcurrencyState,
  SinglePortRegistry,
} from './server/index.js'
export type {
  ServerOptions,
  HttpOptions,
  CorsOptions,
  RaffelServer,
  ServerAddresses,
  AddressInfo,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  // GrpcTlsOptions is exported from adapters/index.js
  ProtocolAdapterContext,
  ProtocolAdapter,
  ProtocolAdapterFactory,
  ProtocolExtensionConfig,
  ProtocolAddress,
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
  SinglePortDetectorOptions,
  SinglePortStreamDetectInput,
  SinglePortChunkDetectInput,
  SinglePortDefaults,
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  GroupBuilder,
  RouterModule,
  MountOptions,
  RouteKind,
  RouteDefinition,
  ProcedureRouteDefinition,
  StreamRouteDefinition,
  EventRouteDefinition,
  RouteLoaderOptions,
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
} from './server/index.js'

// === Errors ===
export {
  Errors,
  ErrorCodes,
  getErrorCode,
  getStatusForCode,
  isClientError,
  isServerError,
  isRetryable,
} from './errors/index.js'
export type { ErrorCode, ErrorCodeDef } from './errors/index.js'

// === Utils ===
export { createLogger, getLogger } from './utils/logger.js'
export {
  defaultCodecs,
  jsonCodec,
  csvCodec,
  textCodec,
  selectCodecForAccept,
  selectCodecForContentType,
  resolveCodecs,
} from './utils/content-codecs.js'
export type { Codec } from './utils/content-codecs.js'

// ID Generation (sid - replacement for nanoid)
export {
  sid,
  customAlphabet,
  customAlphabetByName,
  sidWithOptions,
  sidEntropyBits,
  urlAlphabet,
  URL_SAFE,
  ALPHANUMERIC,
  ALPHANUMERIC_LOWER,
  HEX_LOWER,
  HEX_UPPER,
  BASE58,
  NUMERIC,
  alphabets,
  getAlphabet,
  validateAlphabet,
  randomString,
  calculateEntropyBits,
} from './utils/index.js'
export type { SidOptions, AlphabetName } from './utils/index.js'

// === OpenAPI ===
export {
  generateOpenAPI,
  generateOpenAPIJson,
  generateOpenAPIYaml,
} from './docs/openapi/index.js'

// OpenAPI Documentation UI (ReDoc + Swagger UI)
export {
  serveRedoc,
  serveSwaggerUI,
  mountOpenApiDocs,
} from './http/openapi-ui.js'
export type {
  RedocOptions,
  SwaggerUIOptions,
  DocsUI,
  MountOpenApiDocsOptions,
  HttpAppWithRoutes,
} from './http/openapi-ui.js'
export type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIServer,
  OpenAPIPathItem,
  OpenAPIOperation,
  OpenAPIResponse,
  OpenAPISecurityScheme,
  OpenAPITag,
  GeneratorOptions,
} from './docs/openapi/index.js'

// === Channels (Pusher-like) ===
export {
  createChannelManager,
  isChannelMessage,
  getChannelType,
  requiresAuth,
  createMemoryTicketStore,
  generateTicket,
} from './channels/index.js'
export type {
  ChannelType,
  ChannelOptions,
  ChannelMember,
  ChannelState,
  ChannelManager,
  SubscribeResult,
  SubscribeMessage,
  SubscribedMessage,
  UnsubscribeMessage,
  UnsubscribedMessage,
  PublishMessage,
  ChannelEventMessage,
  ChannelErrorMessage,
  ChannelMessage,
  ClientInfo,
  RoomInfo,
  GroupInfo,
  ChannelLifecycleHooks,
  ClientConnectEvent,
  ClientDisconnectEvent,
  ConnectionTicket,
  TicketStore,
  WebSocketAuthConfig,
  ChannelRateLimits,
  BackpressureConfig,
  AuthRefreshMessage,
  AuthRefreshedMessage,
} from './channels/index.js'

// === GraphQL ===
export {
  createGraphQLAdapter,
  createGraphQLMiddleware,
  generateGraphQLSchema,
  GraphQLJSON,
  GraphQLDateTime,
} from './graphql/index.js'
export type {
  GraphQLOptions,
  GraphQLAdapter,
  GraphQLAdapterOptions,
  GraphQLMiddleware,
  SubscriptionOptions as GraphQLSubscriptionOptions,
  SchemaGenerationOptions,
  GeneratedSchemaInfo,
  GraphQLCorsConfig,
} from './graphql/index.js'

// === Cache (Pluggable Driver System) ===
export {
  // Factory
  createDriver as createCacheDriver,
  createDriverFromConfig as createCacheDriverFromConfig,
  createDriverSync as createCacheDriverSync,
  DRIVER_TYPES as CACHE_DRIVER_TYPES,
  isValidDriverType as isValidCacheDriverType,
  // Drivers (direct import when needed)
  MemoryDriver as CacheMemoryDriver,
  createMemoryDriver as createCacheMemoryDriver,
  FileDriver as CacheFileDriver,
  createFileDriver as createCacheFileDriver,
  RedisDriver as CacheRedisDriver,
  createRedisDriver as createCacheRedisDriver,
} from './cache/index.js'
export type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  MemoryStats as CacheMemoryStats,
  CompressionStats as CacheCompressionStats,
  EvictionPolicy as CacheEvictionPolicy,
  CompressionConfig as CacheCompressionConfig,
  MemoryDriverOptions as CacheMemoryDriverOptions,
  FileDriverOptions as CacheFileDriverOptions,
  RedisDriverOptions as CacheRedisDriverOptions,
  RedisLikeClient as CacheRedisLikeClient,
  CacheDriverType,
  CacheDriverConfig,
  EvictionInfo as CacheEvictionInfo,
  PressureInfo as CachePressureInfo,
} from './cache/index.js'

// === Metrics (Prometheus-style) ===
export {
  createMetricRegistry,
  createMetricsInterceptor,
  registerWsMetrics,
  registerProcessMetrics,
  collectProcessMetrics,
  startProcessMetricsCollection,
  exportPrometheus,
  exportJson,
  DEFAULT_HISTOGRAM_BUCKETS,
  AUTO_METRICS,
} from './metrics/index.js'
export type {
  MetricType,
  Labels,
  MetricOptions,
  MetricsConfig,
  MetricValue,
  HistogramBucket,
  HistogramValue,
  MetricDefinition,
  MetricRegistry,
  ExportFormat,
} from './metrics/index.js'

// === Tracing (OpenTelemetry-compatible) ===
export {
  // Tracer
  createTracer,
  // Span
  createSpan,
  generateTraceId,
  generateSpanId,
  // Samplers
  createAlwaysOnSampler,
  createAlwaysOffSampler,
  createProbabilitySampler,
  createRateLimitedSampler,
  createParentBasedSampler,
  createCompositeSampler,
  // Exporters
  createConsoleExporter,
  createJaegerExporter,
  createZipkinExporter,
  createNoopExporter,
  // Interceptor
  createTracingInterceptor,
  extractTraceHeaders,
  injectTraceHeaders,
  // Constants
  SAMPLING_STRATEGIES,
} from './tracing/index.js'
export type {
  SpanKind,
  SpanStatusCode,
  SpanAttributes,
  SpanLogEntry,
  SpanStatus,
  SpanContext,
  TraceHeaders,
  SpanData,
  Span,
  SpanExporter,
  SamplingResult,
  Sampler,
  StartSpanOptions,
  Tracer,
  TracingConfig,
  JaegerExporterOptions,
  ZipkinExporterOptions,
} from './tracing/index.js'

// === Developer Experience (DX) ===
export {
  // Health Check System
  createHealthCheckProcedures,
  CommonProbes,
  // HTTP Request Logging
  createHttpLoggingMiddleware,
  createDevLoggingMiddleware,
  createTinyLoggingMiddleware,
  createProductionHttpLoggingMiddleware,
  withHttpLogging,
  LOG_FORMATS,
  // USD Documentation
  createUSDHandlers,
  createServerScenario,
  createScaffoldProject,
  writeScaffoldProject,
  listScaffoldPresets,
  serviceScaffoldPresets,
} from './dx/index.js'
export type {
  // Health Check types
  HealthCheckConfig,
  HealthProbe,
  HealthProbeGroupConfig,
  ProbeResult,
  HealthResponse,
  HealthCheckState,
  HealthCheckProcedure,
  HealthCheckProcedures,
  // HTTP Logging types
  HttpLoggingMiddleware,
  HttpLoggingConfig,
  LogFormat,
  LogContext,
  // USD Documentation types
  ServiceScaffoldPreset,
  ServiceScaffoldManifest,
  CreateScaffoldProjectOptions,
  GeneratedScaffoldProject,
  WriteScaffoldProjectOptions,
  WrittenScaffoldProject,
  USDMiddlewareConfig,
  USDHandlers,
  USDMiddlewareContext,
  DevelopmentScenario,
  DevelopmentScenarioInput,
  DevelopmentScenarioOutput,
} from './dx/index.js'

// === Session Store ===
export {
  createSessionInterceptor,
  createMemorySessionDriver,
  createRedisSessionDriver,
} from './middleware/session/index.js'
export type {
  Session,
  SessionData,
  SessionStore,
  SessionConfig,
  SessionCookieOptions,
  SessionDriverType,
  MemorySessionDriverOptions,
  RedisLikeClient as SessionRedisLikeClient,
  RedisSessionDriverOptions,
} from './middleware/session/index.js'

// === Proxy ===
export {
  createHttpForwardProxy,
  createConnectTunnel,
  createSocks5Proxy,
  createTransparentProxy,
} from './proxy/index.js'
export type {
  ProxyAuth,
  ProxyCredentials,
  ProxyStats,
  ProxyServer,
  ConnectMode,
  ConnectTunnelOptions,
  ConnectTunnel,
  TunnelInfo,
  MitmRequest,
  MitmResponse,
  HttpForwardProxyOptions,
  HttpForwardProxy,
  ForwardProxyRequest,
  ForwardProxyResponse,
  ProxyValidateOptions,
  Socks5Options,
  Socks5ConnectionInfo,
  TransparentProxyMode,
  TransparentProxyOptions,
  ProxyFilter,
} from './proxy/index.js'

// === SMTP (Client + Relay) ===
export {
  createSmtpClientConnection,
  buildRawMessage,
  createSmtpRelay,
} from './smtp/index.js'
export type {
  MailAddress,
  MailMessage,
  SmtpClientConfig,
  SmtpClientConnection,
  SmtpResponse,
  SmtpSendResult,
  SmtpRelayConfig,
  SmtpRelay,
  SmtpRelayStats,
  RelayQueueEntry,
  DkimSignConfig,
} from './smtp/index.js'

// === Testing Mocks ===
export * from './testing/index.js'

// === MCP (Model Context Protocol) ===
export {
  // Server
  MCPServer,
  createMCPServer,
  runMCPServer,
  // Error codes
  JsonRpcErrorCode as MCPErrorCode,
  // Tools
  tools as mcpTools,
  toolCategories as mcpToolCategories,
  getToolsByCategory as getMCPToolsByCategory,
  handlers as mcpHandlers,
  // Resources
  getStaticResources as getMCPResources,
  getResourceTemplates as getMCPResourceTemplates,
  readResource as readMCPResource,
  // Prompts
  prompts as mcpPrompts,
  getPromptResult as getMCPPromptResult,
  // Documentation
  interceptors as mcpInterceptorDocs,
  getInterceptor as getMCPInterceptorDoc,
  adapters as mcpAdapterDocs,
  getAdapter as getMCPAdapterDoc,
  patterns as mcpPatterns,
  getPattern as getMCPPattern,
  errors as mcpErrors,
  getError as getMCPError,
  quickstartGuide as mcpQuickstartGuide,
  boilerplates as mcpBoilerplates,
  getBoilerplate as getMCPBoilerplate,
} from './mcp/index.js'
export type {
  // MCP types
  JsonRpcRequest as MCPRequest,
  JsonRpcResponse as MCPResponse,
  JsonRpcError as MCPError,
  MCPServerOptions,
  MCPCapabilities,
  MCPInitializeResult,
  MCPTransportMode,
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPResourceTemplate,
  MCPResourceReadResult,
  MCPPrompt,
  MCPPromptArgument,
  MCPPromptResult,
  CategoryName as MCPCategoryName,
} from './mcp/index.js'

// === JSON Server ===
export {
  createJsonServer,
  createJsonModule,
  InMemoryStore,
  loadDb,
  normalizeId,
} from './json-server/index.js'
export type {
  JsonDb,
  JsonRecord,
  StoreEvent,
  StoreEventOp,
  ListQuery,
  ListResult,
  JsonModuleOptions,
  JsonServerOptions,
  JsonServerResult,
  JsonModule,
} from './json-server/index.js'

// === Mock Server ===
export {
  createMockServer,
  createMockModule,
  generateFromSchema,
  resetFakeDataCounter,
  extractRoutes,
  toExpressPath,
  resolveResponse,
  extractRequestBodySchema,
  mergeParameters,
} from './mock-server/index.js'
export type {
  MockServerOptions,
  MockModuleOptions,
  MockRoute,
  MockResponse,
  MockModule,
  MockServerResult,
  ResolvedParam,
} from './mock-server/index.js'
export { runMockCommand, mockParser } from './mock-server/cli.js'

// === Application Layer (Hexagonal) ===
export { createRegistrationService } from './application/index.js'
export type { RegistrationService, RegistrationContext } from './application/index.js'
export { createRuntimePreviewService } from './application/index.js'
export type { RuntimePreviewService } from './application/index.js'
export { buildServerConfigPreview, emitConfigWarnings, logSinglePortConfig, getConfigWarnings, resolveProtocolFusionMode } from './application/index.js'
export type {
  ServerConfigPreview,
  ServerConfigPreviewContext,
  ProtocolConfig,
  ProtocolPreviewConfig,
  FrontDoorTransport,
} from './application/index.js'

// === Bootstrap Layer (Hexagonal) ===
// createServer is already exported from ./server/index.js above.
export { buildProtocolConfig, resolveSinglePortConfig } from './bootstrap/config-normalization.js'
export { createProtocolWiring, createServerLifecycle } from './bootstrap/protocol-wiring.js'
export type { ServerLifecycleContext } from './bootstrap/protocol-wiring.js'

// === Resource Module ===
export { createResourceModule, createFilteredWatchStream } from './resource-module/index.js'
export type {
  ResourceAdapter,
  ResourceChangeEvent,
  ResourceListQuery,
  ResourceListResult,
  ResourceGuards,
  ResourceFieldPolicy,
  ResourceModuleOptions,
  WatchFilter,
} from './resource-module/index.js'

// === Client SDK ===
export { createRaffelClient, createReconnectController } from './client/index.js'
export type {
  RaffelClientOptions,
  RaffelClient,
  ClientStream,
  CallOptions,
} from './client/index.js'

// === Outbound Adapters (Hexagonal) ===
export { createPinoLoggerAdapter, pinoLoggerFactory } from './adapters/outbound/logger/index.js'
