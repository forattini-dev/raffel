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
  // Rate Limiting
  createRateLimitMiddleware,
  createPerProcedureRateLimitMiddleware,
  createInMemoryStore,
  createSlidingWindowRateLimiter,
  // Composition
  compose,
  pipe,
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
  // Rate limit types
  RateLimitOptions,
  RateLimitInfo,
  RateLimitStore,
  ProcedureRateLimit,
  PerProcedureRateLimitOptions,
} from './middleware/index.js'

// === Server (Unified API) ===
export { createServer, createRouterModule, loadRouterModule, pathToRouteName } from './server/index.js'
export type {
  ServerOptions,
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
} from './openapi/index.js'
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
} from './openapi/index.js'

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
  generateGraphQLSchema,
  GraphQLJSON,
  GraphQLDateTime,
} from './graphql/index.js'
export type {
  GraphQLOptions,
  GraphQLAdapter,
  GraphQLAdapterOptions,
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
  RedisLikeClient,
  S3DBDriverOptions as CacheS3DBDriverOptions,
  S3DBLikeClient,
  CacheDriverType,
  CacheDriverConfig,
  EvictionInfo as CacheEvictionInfo,
  PressureInfo as CachePressureInfo,
} from './cache/index.js'
