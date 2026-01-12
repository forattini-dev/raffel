/**
 * Raffel - Unified Multi-Protocol Server Runtime
 *
 * One core, multiple transports.
 */

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
  StreamOptions,
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
  AuthContext,
  TracingContext,
  ExtensionKey,

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
  createContext,
  withDeadline,
  withAuth,
  withExtension,
  getExtension,
  createExtensionKey,
} from './types/index.js'

// === Adapters (Server) ===
export {
  createWebSocketAdapter,
  createHttpAdapter,
  createTcpAdapter,
  createJsonRpcAdapter,
  createGrpcAdapter,
  JsonRpcErrorCode,
  HttpMetadataKey,
  // S3DB Resource Adapter
  createS3DBAdapter,
  createS3DBContextInterceptor,
  generateS3DBHttpPaths,
} from './adapters/index.js'
export type {
  WebSocketAdapter,
  WebSocketAdapterOptions,
  HttpAdapter,
  HttpAdapterOptions,
  TcpAdapter,
  TcpAdapterOptions,
  JsonRpcAdapter,
  JsonRpcAdapterOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  GrpcAdapter,
  GrpcAdapterOptions,
  GrpcTlsOptions,
  GrpcMethodInfo,
  // S3DB types
  S3DBResourceLike,
  S3DBDatabaseLike,
  S3DBRelationDefinition,
  S3DBAdapterOptions,
  S3DBListInput,
  S3DBGetInput,
  S3DBCreateInput,
  S3DBUpdateInput,
  S3DBDeleteInput,
  S3DBListResponse,
  S3DBSingleResponse,
  S3DBDeleteResponse,
  S3DBOptionsResponse,
  S3DBHeadResponse,
} from './adapters/index.js'

// === Validation ===
export {
  // Core validation
  validate,
  createValidationInterceptor,
  createSchemaValidationInterceptor,
  createSchemaRegistry,
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
} from './validation/index.js'

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
  // Composition
  compose,
  when,
  forProcedures,
  forPattern,
  except,
  branch,
  passthrough,
} from './middleware/index.js'
export type {
  // Auth types
  AuthResult,
  AuthStrategy,
  AuthMiddlewareOptions,
  BearerTokenOptions,
  ApiKeyOptions,
  AuthzMiddlewareOptions,
  AuthzRule,
} from './middleware/index.js'

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
  S3DBDriver as CacheS3DBDriver,
  createS3DBDriver as createCacheS3DBDriver,
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
  S3DBDriverOptions as CacheS3DBDriverOptions,
  S3DBLikeClient,
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
  USDMiddlewareConfig,
  USDHandlers,
  USDMiddlewareContext,
} from './dx/index.js'

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
