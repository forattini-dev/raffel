/**
 * Middleware Module
 *
 * Comprehensive middleware for Raffel services including:
 * - Protocol-agnostic interceptors (rate limiting, timeout, retry, circuit breaker)
 * - HTTP-specific middleware (security headers, compression)
 * - Authentication & authorization
 * - Composition helpers
 * - Pre-configured presets
 */

// ============================================================================
// Composition Helpers
// ============================================================================

export {
  compose,
  when,
  forProcedures,
  forPattern,
  except,
  branch,
  passthrough,
} from './compose.js'

// ============================================================================
// Types
// ============================================================================

export type {
  // Rate Limiting
  RateLimitConfig,
  RateLimitInfo,
  RateLimitRule,

  // Request ID
  RequestIdConfig,

  // Logging
  LogLevel,
  LogFilterContext,
  LoggingConfig,

  // Timeout
  TimeoutConfig,

  // Retry
  RetryConfig,

  // Circuit Breaker
  CircuitState,
  CircuitBreakerConfig,

  // Cache
  CacheConfig,
  CacheStore,

  // HTTP Security
  HstsConfig,
  CspConfig,
  CspDirective,
  PermissionsPolicyConfig,
  SecurityConfig,

  // HTTP Compression
  CompressionConfig,
  CompressionEncoding,

  // HTTP CORS
  EnhancedCorsConfig,

  // Presets
  SecurityPreset,
  PerformancePreset,

  // Response Envelope
  EnvelopeConfig,
} from './types.js'

// ============================================================================
// Protocol-Agnostic Interceptors
// ============================================================================

// Rate Limiting
export {
  createRateLimitInterceptor,
  createAuthRateLimiter,
} from './interceptors/rate-limit.js'

// Request ID
export {
  createRequestIdInterceptor,
  createPrefixedRequestIdInterceptor,
  createCorrelatedRequestIdInterceptor,
} from './interceptors/request-id.js'

// Logging
export {
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
} from './interceptors/logging.js'

// Timeout
export {
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
} from './interceptors/timeout.js'

// Retry
export {
  createRetryInterceptor,
  createSelectiveRetryInterceptor,
} from './interceptors/retry.js'

// Circuit Breaker
export {
  createCircuitBreakerInterceptor,
  createProcedureCircuitBreaker,
  createCircuitBreakerManager,
} from './interceptors/circuit-breaker.js'
export type { CircuitBreakerManager } from './interceptors/circuit-breaker.js'

// Cache
export {
  createCacheInterceptor,
  createReadThroughCacheInterceptor,
  createMemoryCacheStore,
  createCacheInvalidator,
  CachePresets,
} from './interceptors/cache.js'
export type { CacheEventContext, ExtendedCacheConfig } from './interceptors/cache.js'

// Response Envelope
export {
  createEnvelopeInterceptor,
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
  createDetailedEnvelopeInterceptor,
  isEnvelopeResponse,
  isEnvelopeSuccess,
  isEnvelopeError,
  EnvelopePresets,
} from './interceptors/envelope.js'
export type {
  EnvelopeSuccess,
  EnvelopeError,
  EnvelopeMeta,
  EnvelopeResponse,
} from './interceptors/envelope.js'

// ============================================================================
// HTTP-Specific Middleware
// ============================================================================

// Security Headers
export {
  applySecurityHeaders,
  createSecurityMiddleware,
  getSecurityPreset,
  mergeSecurityConfig,
  defaultSecurityConfig,
  strictSecurityConfig,
  relaxedSecurityConfig,
} from './http/security.js'

// Compression
export {
  compressBuffer,
  compressResponse,
  createCompressionMiddleware,
  defaultCompressionConfig,
} from './http/compression.js'
export type { CompressionResult } from './http/compression.js'

// ============================================================================
// Presets
// ============================================================================

export {
  // Stack creators
  createProductionStack,
  createDevelopmentStack,
  createResilientStack,
  createMinimalStack,
  createCustomStack,
  getEnvironmentStack,

  // Preset configurations
  rateLimitPresets,
  timeoutPresets,
  circuitBreakerPresets,
  retryPresets,
  cachePresets,
  securityPresets,
} from './presets.js'

// ============================================================================
// Legacy Exports (backwards compatible)
// ============================================================================

// Authentication & Authorization
export {
  // Middleware creators
  createAuthMiddleware,
  createAuthzMiddleware,

  // Strategy creators
  createBearerStrategy,
  createApiKeyStrategy,
  createStaticApiKeyStrategy,

  // Helpers
  requireAuth,
  hasRole,
  hasAnyRole,
  hasAllRoles,
} from './auth.js'

export type {
  // Auth types
  AuthResult,
  AuthStrategy,
  AuthMiddlewareOptions,
  BearerTokenOptions,
  ApiKeyOptions,

  // Authz types
  AuthzMiddlewareOptions,
  AuthzRule,

  // OAuth2/OIDC types
  OAuth2Config,
  OAuth2Tokens,
  OAuth2UserInfo,
  OAuth2StrategyWithFlow,
  OIDCConfig,
  OIDCDiscoveryDocument,
  OIDCStrategyWithFlow,
  OAuth2Provider,
} from './auth.js'

// OAuth2/OIDC Strategies
export {
  createOAuth2Strategy,
  createOIDCStrategy,
  OAuth2Providers,
  createGoogleOAuth2Strategy,
  createGitHubOAuth2Strategy,
  createMicrosoftOAuth2Strategy,
  createAppleOAuth2Strategy,
  createFacebookOAuth2Strategy,
  generateState,
  generateNonce,
  clearDiscoveryCache,
} from './auth.js'
