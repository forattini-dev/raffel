/**
 * HTTP Module
 *
 * Provides a complete HTTP toolkit for Raffel applications:
 * - HttpApp: Hono-compatible HTTP router
 * - serve: Node.js server helper with graceful shutdown
 * - Cookie helpers: getCookie, setCookie, signed/chunked cookies
 * - Types: StatusCode, TypedResponse, etc.
 */

// ─────────────────────────────────────────────────────────────────────────────
// HttpApp - Hono-compatible Router
// ─────────────────────────────────────────────────────────────────────────────

export { HttpApp } from './app.js'
export type {
  HttpMethod,
  HttpHandler,
  HttpMiddleware,
  HttpErrorHandler,
  HttpNotFoundHandler,
} from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// HttpContext - Request/Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

export { HttpContext } from './context.js'
export type {
  HttpContextInterface,
  HttpRequest,
  JsonOptions,
  RedirectOptions,
} from './context.js'

// ─────────────────────────────────────────────────────────────────────────────
// Serve - Node.js Server Helper
// ─────────────────────────────────────────────────────────────────────────────

export { serve } from './serve.js'
export type {
  FetchHandler,
  ServeOptions,
  RaffelServer,
} from './serve.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types - Status Codes, TypedResponse, etc.
// ─────────────────────────────────────────────────────────────────────────────

export {
  typedJson,
  MimeTypes,
} from './types.js'
export type {
  // Status codes
  StatusCode,
  ContentfulStatusCode,
  SuccessStatusCode,
  InformationalStatusCode,
  SuccessfulStatusCode,
  RedirectStatusCode,
  ClientErrorStatusCode,
  ServerErrorStatusCode,
  RedirectStatusCodeExact,

  // Typed response
  TypedResponse,
  TypedHandler,
  Middleware,

  // HTTP methods
  HttpMethod as HttpMethodType,
  HttpMethodWithBody,
  HttpMethodWithoutBody,

  // Content types
  MimeType,

  // Utility types
  InferResponseData,
  InferResponseStatus,
  PathParams,
  PartialExcept,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Cookie Helpers
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Basic cookie operations
  getCookie,
  getCookies,
  setCookie,
  deleteCookie,
  generateCookie,
  parseCookies,

  // Batch operations
  setCookies,
  deleteCookies,

  // Signed cookies
  getSignedCookie,
  setSignedCookie,

  // Prefixed cookies
  setHostCookie,
  setSecureCookie,

  // Chunked cookies (for large values)
  setChunkedCookie,
  getChunkedCookie,
  deleteChunkedCookie,
  isChunkedCookie,

  // Types
  type CookieOptions,
  type CookieContext,
  type ChunkingOptions,
  CookieChunkOverflowError,
} from './cookie.js'

// ─────────────────────────────────────────────────────────────────────────────
// Web Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  BodyInit,
  HeadersInit,
  FetchEvent,
  ExecutionContext,
} from './web-types.js'

// ─────────────────────────────────────────────────────────────────────────────
// CORS Middleware
// ─────────────────────────────────────────────────────────────────────────────

export { cors } from './cors.js'
export type { CorsOptions, OriginFunction } from './cors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Compression Middleware
// ─────────────────────────────────────────────────────────────────────────────

export { compress } from './compress.js'
export type { CompressOptions, CompressionEncoding } from './compress.js'

// ─────────────────────────────────────────────────────────────────────────────
// Security Headers Middleware
// ─────────────────────────────────────────────────────────────────────────────

export { secureHeaders } from './security.js'
export type {
  SecureHeadersOptions,
  ContentSecurityPolicyOptions,
  CspDirectives,
  CspDirectiveValue,
  HstsOptions,
  FrameguardOptions,
  FrameguardAction,
  ReferrerPolicyOptions,
  ReferrerPolicy,
  PermissionsPolicyOptions,
  CrossDomainPolicy,
} from './security.js'

// ─────────────────────────────────────────────────────────────────────────────
// Response Formatters
// ─────────────────────────────────────────────────────────────────────────────

export {
  success,
  error,
  list,
  created,
  noContent,
  accepted,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  validationError,
  tooManyRequests,
  serverError,
  serviceUnavailable,
  filterProtectedFields,
} from './response.js'
export type {
  SuccessResponse,
  ErrorResponse,
  ListResponse,
  PaginationMeta,
  PaginationOptions,
  ValidationErrorDetail,
  ResponseOptions,
} from './response.js'

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Error Classes
// ─────────────────────────────────────────────────────────────────────────────

export {
  HttpError,
  HttpBadRequestError,
  HttpUnauthorizedError,
  HttpPaymentRequiredError,
  HttpForbiddenError,
  HttpNotFoundError,
  HttpMethodNotAllowedError,
  HttpRequestTimeoutError,
  HttpConflictError,
  HttpGoneError,
  HttpPayloadTooLargeError,
  HttpUnsupportedMediaTypeError,
  HttpUnprocessableEntityError,
  HttpValidationError,
  HttpTooManyRequestsError,
  HttpInternalServerError,
  HttpNotImplementedError,
  HttpBadGatewayError,
  HttpServiceUnavailableError,
  HttpGatewayTimeoutError,
  createHttpError,
  isHttpError,
} from './errors.js'
export type {
  HttpErrorOptions,
  ValidationDetail,
} from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Health Checks
// ─────────────────────────────────────────────────────────────────────────────

export {
  healthCheck,
  livenessCheck,
  readinessCheck,
  createHealthMiddleware,
} from './health.js'
export type {
  HealthStatus,
  CheckResult,
  HealthCheckFn,
  HealthCheckOptions,
  HealthResponse,
  LivenessResponse,
  ReadinessResponse,
  HealthMiddlewareOptions,
} from './health.js'

// ─────────────────────────────────────────────────────────────────────────────
// Body Limit Middleware
// ─────────────────────────────────────────────────────────────────────────────

export {
  bodyLimit,
  parseSize,
  formatSize,
} from './body-limit.js'
export type {
  SizeString,
  BodyLimitOptions,
} from './body-limit.js'

// ─────────────────────────────────────────────────────────────────────────────
// Guards System
// ─────────────────────────────────────────────────────────────────────────────

export {
  createGuardsRegistry,
  requireUser,
  requireRole,
  requireScope,
  requirePermission,
  guard,
  allGuards,
  anyGuard,
} from './guards.js'
export type {
  GuardFn,
  GuardResult,
  ExtendedGuardFn,
  GuardUser,
  GuardOptions,
  GuardsRegistry,
} from './guards.js'

// ─────────────────────────────────────────────────────────────────────────────
// Context Helpers
// ─────────────────────────────────────────────────────────────────────────────

export {
  extendContext,
  successResponse,
  errorResponse,
  createdResponse,
  noContentResponse,
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  conflictResponse,
  validationErrorResponse,
  serverErrorResponse,
} from './context-helpers.js'
export type {
  ContextValidationError,
  ExtendedContextHelpers,
  ExtendedContext,
} from './context-helpers.js'

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Middleware
// ─────────────────────────────────────────────────────────────────────────────

export {
  basicAuth,
  bearerAuth,
  cookieSession,
  compositeAuth,
  // Path-based auth strategies
  pathAuth,
  pathRules,
  // Login throttling
  createLoginThrottle,
  loginThrottleMiddleware,
} from './auth.js'
export type {
  BasicAuthOptions,
  BearerAuthOptions,
  CookieSessionOptions,
  SessionData,
  SessionManager,
  CompositeAuthStrategy,
  CompositeAuthOptions,
  // Path-based auth types
  PathAuthRule,
  PathAuthOptions,
  HttpMethod as AuthHttpMethod,
  PathMethodRule,
  PathRulesOptions,
  // Login throttle types
  LoginThrottleOptions,
  LoginThrottleManager,
} from './auth.js'

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 Authentication
// ─────────────────────────────────────────────────────────────────────────────

export {
  oauth2,
  refreshOAuth2Token,
  fetchOAuth2UserInfo,
  createGitHubProvider,
  createGoogleProvider,
  createDiscordProvider,
  createMicrosoftProvider,
} from './oauth2.js'
export type {
  OAuth2Provider,
  OAuth2Tokens,
  OAuth2Options,
  OAuth2Error,
} from './oauth2.js'

// ─────────────────────────────────────────────────────────────────────────────
// OpenID Connect (OIDC) Authentication
// ─────────────────────────────────────────────────────────────────────────────

export {
  oidc,
  discoverOidcProvider,
  buildLogoutUrl,
} from './oidc.js'
export type {
  OidcProvider,
  OidcDiscoveryDocument,
  OidcUserInfo,
  IdTokenClaims,
  OidcOptions,
  DiscoverOidcProviderOptions,
} from './oidc.js'

// ─────────────────────────────────────────────────────────────────────────────
// Static File Serving
// ─────────────────────────────────────────────────────────────────────────────

export { serveStatic } from './static.js'
export type { StaticOptions } from './static.js'

// S3 Static File Serving
export { serveStaticS3 } from './static-s3.js'
export type {
  S3ClientLike,
  S3GetObjectCommand,
  S3HeadObjectCommand,
  SignedUrlGenerator,
  S3StaticOptions,
} from './static-s3.js'

// ─────────────────────────────────────────────────────────────────────────────
// Startup Banner
// ─────────────────────────────────────────────────────────────────────────────

export { printBanner, generateBanner, bannerMiddleware } from './banner.js'
export type { BannerOptions, BannerRoute } from './banner.js'

// ─────────────────────────────────────────────────────────────────────────────
// Event Emitter
// ─────────────────────────────────────────────────────────────────────────────

export { ApiEventEmitter, createEventEmitter } from './events.js'
export type {
  EventListener,
  RequestEventData,
  AuthEventData,
  ErrorEventData,
  RateLimitEventData,
  ApiEventEmitterOptions,
  EventStats,
} from './events.js'

// ─────────────────────────────────────────────────────────────────────────────
// Failban (IP Banning)
// ─────────────────────────────────────────────────────────────────────────────

export { createFailban, failbanMiddleware, getClientIp } from './failban.js'
export type {
  ViolationRecord,
  FailbanOptions,
  FailbanStore,
  FailbanManager,
  FailbanStats,
} from './failban.js'

// ─────────────────────────────────────────────────────────────────────────────
// Session Tracking
// ─────────────────────────────────────────────────────────────────────────────

export {
  createSessionTracker,
  sessionMiddleware,
  createSession,
  destroySession,
} from './session.js'
export type {
  Session,
  SessionManagerOptions,
  SessionStore,
  SessionTracker,
  SessionStats,
  SessionMiddlewareOptions,
} from './session.js'

// Redis Session Store
export {
  createRedisSessionStore,
  RedisSessionStore,
} from './session-redis.js'
export type {
  RedisClient,
  RedisMulti,
  RedisSessionStoreOptions,
} from './session-redis.js'

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

export {
  createRateLimiter,
  rateLimitMiddleware,
  keyByIp,
  keyByUserId,
  keyByApiKey,
  keyByIpAndPath,
  keyByIpAndMethod,
} from './rate-limit.js'
export type {
  RateLimitRule,
  KeyGenerator,
  RateLimitEntry,
  RateLimiterOptions,
  RateLimitInfo,
  RateLimitStore,
  RateLimiter,
  RateLimitStats,
  RateLimitMiddlewareOptions,
} from './rate-limit.js'

// ─────────────────────────────────────────────────────────────────────────────
// Validation Middleware
// ─────────────────────────────────────────────────────────────────────────────

export {
  createValidator,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validate,
} from './validate.js'
export type {
  ValidationTarget,
  Validator,
  CompiledSchema,
  ValidationMiddlewareOptions,
  CombinedValidationOptions,
} from './validate.js'

// ─────────────────────────────────────────────────────────────────────────────
// Templates / Views
// ─────────────────────────────────────────────────────────────────────────────

export {
  createTemplateEngine,
  renderMiddleware,
  renderTemplate,
  createEjsAdapter,
  createPugAdapter,
  createHandlebarsAdapter,
} from './templates.js'
export type {
  TemplateData,
  TemplateEngineAdapter,
  CompiledTemplate,
  TemplateEngineOptions,
  TemplateManager,
  RenderMiddlewareOptions,
} from './templates.js'

// ─────────────────────────────────────────────────────────────────────────────
// Stream Authentication
// ─────────────────────────────────────────────────────────────────────────────

export {
  createStreamAuthFactory,
  streamBearerAuth,
  streamApiKeyAuth,
  streamCookieSession,
  extractBearerToken,
  extractApiKey,
  extractCookieSession,
  parsePathParams,
  parseQueryParams,
  matchStreamRoute,
} from './stream-auth.js'
export type {
  StreamAuthResult,
  StreamBearerOptions,
  StreamApiKeyOptions,
  StreamCookieSessionOptions,
  StreamAuthFactoryOptions,
  StreamContext,
  StreamRoute,
} from './stream-auth.js'
