/**
 * Protocol-Agnostic Interceptors
 *
 * These interceptors work across all Raffel transports (HTTP, WebSocket, TCP, JSON-RPC).
 */

// Rate Limiting
export {
  createRateLimitInterceptor,
  createAuthRateLimiter,
  createTokenBucketLimiter,
  parseRateLimitHeaders,
  isRateLimitExceeded,
  calculateRateLimitDelay,
} from './rate-limit.js'
export type { ParsedRateLimitInfo, TokenBucketConfig } from './rate-limit.js'

// Request ID
export {
  createRequestIdInterceptor,
  createPrefixedRequestIdInterceptor,
  createCorrelatedRequestIdInterceptor,
} from './request-id.js'

// Logging
export {
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
  redactSensitiveHeaders,
} from './logging.js'

// Timeout
export {
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
  setTimeoutPhase,
  getTimeoutPhase,
  getPhaseInfo,
} from './timeout.js'
export type { TimeoutPhase } from './timeout.js'

// Retry
export {
  createRetryInterceptor,
  createSelectiveRetryInterceptor,
  parseRetryAfter,
} from './retry.js'

// Circuit Breaker
export {
  createCircuitBreakerInterceptor,
  createProcedureCircuitBreaker,
  createCircuitBreakerManager,
} from './circuit-breaker.js'
export type { CircuitBreakerManager } from './circuit-breaker.js'

// Deduplication
export {
  createDedupInterceptor,
  createReadOnlyDedupInterceptor,
} from './dedup.js'
export type { DedupConfig } from './dedup.js'

// Size Limiting
export {
  createSizeLimitInterceptor,
  createRequestSizeLimitInterceptor,
  createResponseSizeLimitInterceptor,
  SizeLimitPresets,
} from './size-limit.js'
export type { SizeLimitConfig } from './size-limit.js'

// Cache
export {
  createCacheInterceptor,
  createReadThroughCacheInterceptor,
  createMemoryCacheStore,
  createCacheInvalidator,
  CachePresets,
} from './cache.js'
export type { CacheEventContext, ExtendedCacheConfig } from './cache.js'

// Bulkhead (Concurrency Limiter)
export {
  createBulkheadInterceptor,
  createProcedureBulkhead,
  createBulkheadManager,
} from './bulkhead.js'
export type { BulkheadManager } from './bulkhead.js'

// Fallback Handler
export {
  createFallbackInterceptor,
} from './fallback.js'

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
} from './envelope.js'
export type {
  EnvelopeSuccess,
  EnvelopeError,
  EnvelopeMeta,
  EnvelopeResponse,
} from './envelope.js'
