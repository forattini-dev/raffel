/**
 * Middleware Presets
 *
 * Pre-configured middleware combinations for common use cases.
 */

import type { Interceptor } from '../types/index.js'
import { compose } from './compose.js'

// Interceptors
import {
  createRateLimitInterceptor,
  createRequestIdInterceptor,
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createTimeoutInterceptor,
  createRetryInterceptor,
  createCircuitBreakerInterceptor,
  createCacheInterceptor,
  CachePresets,
} from './interceptors/index.js'

// Types
import type {
  RateLimitConfig,
  LoggingConfig,
  TimeoutConfig,
  RetryConfig,
  CircuitBreakerConfig,
} from './types.js'

import type { ExtendedCacheConfig } from './interceptors/cache.js'

// HTTP
import {
  defaultSecurityConfig,
  strictSecurityConfig,
  relaxedSecurityConfig,
} from './http/index.js'

/**
 * Standard middleware stack for production APIs
 *
 * Includes: request ID, logging, timeout, rate limiting
 *
 * @example
 * ```typescript
 * const middleware = createProductionStack()
 * server.use(middleware)
 * ```
 */
export function createProductionStack(config?: {
  rateLimit?: RateLimitConfig
  timeout?: TimeoutConfig
  logging?: LoggingConfig
}): Interceptor {
  return compose(
    createRequestIdInterceptor(),
    createProductionLoggingInterceptor({ logger: config?.logging?.logger }),
    createTimeoutInterceptor(config?.timeout),
    createRateLimitInterceptor(config?.rateLimit),
  )
}

/**
 * Development middleware stack with verbose logging
 *
 * @example
 * ```typescript
 * const middleware = createDevelopmentStack()
 * server.use(middleware)
 * ```
 */
export function createDevelopmentStack(config?: {
  rateLimit?: RateLimitConfig
  timeout?: TimeoutConfig
}): Interceptor {
  return compose(
    createRequestIdInterceptor(),
    createLoggingInterceptor({
      format: 'pretty',
      includePayload: true,
      includeResponse: true,
    }),
    createTimeoutInterceptor(config?.timeout ?? { defaultMs: 60000 }),
    createRateLimitInterceptor(config?.rateLimit ?? { maxRequests: 1000 }),
  )
}

/**
 * Resilient middleware stack for external service calls
 *
 * Includes: retry, circuit breaker, timeout
 *
 * @example
 * ```typescript
 * const resilient = createResilientStack()
 * server.procedure('external.call').use(resilient).handler(...)
 * ```
 */
export function createResilientStack(config?: {
  retry?: RetryConfig
  circuitBreaker?: CircuitBreakerConfig
  timeout?: TimeoutConfig
}): Interceptor {
  return compose(
    createTimeoutInterceptor(config?.timeout ?? { defaultMs: 10000 }),
    createCircuitBreakerInterceptor(config?.circuitBreaker),
    createRetryInterceptor(config?.retry),
  )
}

/**
 * Minimal middleware stack
 *
 * Just request ID and basic timeout. For high-performance scenarios.
 *
 * @example
 * ```typescript
 * const minimal = createMinimalStack()
 * server.use(minimal)
 * ```
 */
export function createMinimalStack(config?: {
  timeoutMs?: number
}): Interceptor {
  return compose(
    createRequestIdInterceptor(),
    createTimeoutInterceptor({ defaultMs: config?.timeoutMs ?? 30000 }),
  )
}

/**
 * Rate limiting presets
 */
export const rateLimitPresets = {
  /**
   * Strict rate limiting (10 requests per minute)
   */
  strict: {
    windowMs: 60000,
    maxRequests: 10,
  } as RateLimitConfig,

  /**
   * Standard rate limiting (100 requests per minute)
   */
  standard: {
    windowMs: 60000,
    maxRequests: 100,
  } as RateLimitConfig,

  /**
   * Relaxed rate limiting (1000 requests per minute)
   */
  relaxed: {
    windowMs: 60000,
    maxRequests: 1000,
  } as RateLimitConfig,

  /**
   * Burst-friendly (high limit with short window)
   */
  burst: {
    windowMs: 10000, // 10 seconds
    maxRequests: 100,
  } as RateLimitConfig,

  /**
   * Per-user with higher limits
   */
  authenticated: {
    windowMs: 60000,
    maxRequests: 500,
    keyGenerator: (envelope, ctx) => ctx.auth?.principal ?? 'anonymous',
  } as RateLimitConfig,
}

/**
 * Timeout presets
 */
export const timeoutPresets = {
  /**
   * Fast timeout (5 seconds)
   */
  fast: {
    defaultMs: 5000,
  } as TimeoutConfig,

  /**
   * Standard timeout (30 seconds)
   */
  standard: {
    defaultMs: 30000,
  } as TimeoutConfig,

  /**
   * Long timeout (2 minutes)
   */
  long: {
    defaultMs: 120000,
  } as TimeoutConfig,

  /**
   * Mixed - fast default with long for specific procedures
   */
  mixed: {
    defaultMs: 10000,
    patterns: {
      'reports.**': 60000,
      'export.*': 120000,
      'import.*': 180000,
    },
  } as TimeoutConfig,
}

/**
 * Circuit breaker presets
 */
export const circuitBreakerPresets = {
  /**
   * Sensitive - opens quickly (3 failures)
   */
  sensitive: {
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 30000,
  } as CircuitBreakerConfig,

  /**
   * Standard - balanced (5 failures)
   */
  standard: {
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeoutMs: 30000,
  } as CircuitBreakerConfig,

  /**
   * Tolerant - allows more failures (10)
   */
  tolerant: {
    failureThreshold: 10,
    successThreshold: 5,
    resetTimeoutMs: 60000,
  } as CircuitBreakerConfig,
}

/**
 * Retry presets
 */
export const retryPresets = {
  /**
   * Quick retry (2 attempts, fast backoff)
   */
  quick: {
    maxAttempts: 2,
    initialDelayMs: 50,
    maxDelayMs: 500,
    backoffMultiplier: 2,
  } as RetryConfig,

  /**
   * Standard retry (3 attempts)
   */
  standard: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  } as RetryConfig,

  /**
   * Aggressive retry (5 attempts with longer delays)
   */
  aggressive: {
    maxAttempts: 5,
    initialDelayMs: 200,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true,
  } as RetryConfig,
}

/**
 * Cache presets (re-exported from interceptors)
 */
export const cachePresets = {
  /**
   * Short-lived cache (5 seconds) for frequently changing data
   */
  short: CachePresets.short,

  /**
   * Standard cache (1 minute) for general purpose
   */
  standard: CachePresets.standard,

  /**
   * Long-lived cache (5 minutes) for stable data
   */
  long: CachePresets.long,

  /**
   * Aggressive cache (1 hour) for rarely changing data
   */
  aggressive: CachePresets.aggressive,

  /**
   * No stale - strict TTL without SWR
   */
  strict: CachePresets.strict,
}

/**
 * Security presets (HTTP-specific)
 */
export const securityPresets = {
  strict: strictSecurityConfig,
  recommended: defaultSecurityConfig,
  relaxed: relaxedSecurityConfig,
}

/**
 * Get a complete middleware stack based on environment
 *
 * @example
 * ```typescript
 * const stack = getEnvironmentStack('production')
 * server.use(stack)
 * ```
 */
export function getEnvironmentStack(
  env: 'development' | 'staging' | 'production'
): Interceptor {
  switch (env) {
    case 'development':
      return createDevelopmentStack()
    case 'staging':
      return createProductionStack({
        rateLimit: rateLimitPresets.relaxed,
        timeout: timeoutPresets.long,
      })
    case 'production':
    default:
      return createProductionStack({
        rateLimit: rateLimitPresets.standard,
        timeout: timeoutPresets.standard,
      })
  }
}

/**
 * Create a custom middleware stack from preset configurations
 *
 * @example
 * ```typescript
 * const stack = createCustomStack({
 *   rateLimit: 'strict',
 *   timeout: 'fast',
 *   circuitBreaker: 'sensitive',
 *   retry: 'quick',
 *   cache: 'standard',
 * })
 * ```
 */
export function createCustomStack(config: {
  rateLimit?: keyof typeof rateLimitPresets | RateLimitConfig
  timeout?: keyof typeof timeoutPresets | TimeoutConfig
  circuitBreaker?: keyof typeof circuitBreakerPresets | CircuitBreakerConfig
  retry?: keyof typeof retryPresets | RetryConfig
  cache?: keyof typeof cachePresets | ExtendedCacheConfig
  includeRequestId?: boolean
  includeLogging?: boolean | 'production' | 'debug'
}): Interceptor {
  const interceptors: Interceptor[] = []

  // Request ID (default: on)
  if (config.includeRequestId !== false) {
    interceptors.push(createRequestIdInterceptor())
  }

  // Logging
  if (config.includeLogging === true || config.includeLogging === 'debug') {
    interceptors.push(createLoggingInterceptor({ format: 'pretty' }))
  } else if (config.includeLogging === 'production') {
    interceptors.push(createProductionLoggingInterceptor())
  }

  // Timeout
  if (config.timeout) {
    const timeoutConfig = typeof config.timeout === 'string'
      ? timeoutPresets[config.timeout]
      : config.timeout
    interceptors.push(createTimeoutInterceptor(timeoutConfig))
  }

  // Cache (before rate limit to serve cached responses without counting)
  if (config.cache) {
    const cacheConfig = typeof config.cache === 'string'
      ? cachePresets[config.cache]
      : config.cache
    interceptors.push(createCacheInterceptor(cacheConfig))
  }

  // Rate Limit
  if (config.rateLimit) {
    const rateLimitConfig = typeof config.rateLimit === 'string'
      ? rateLimitPresets[config.rateLimit]
      : config.rateLimit
    interceptors.push(createRateLimitInterceptor(rateLimitConfig))
  }

  // Circuit Breaker
  if (config.circuitBreaker) {
    const cbConfig = typeof config.circuitBreaker === 'string'
      ? circuitBreakerPresets[config.circuitBreaker]
      : config.circuitBreaker
    interceptors.push(createCircuitBreakerInterceptor(cbConfig))
  }

  // Retry
  if (config.retry) {
    const retryConfig = typeof config.retry === 'string'
      ? retryPresets[config.retry]
      : config.retry
    interceptors.push(createRetryInterceptor(retryConfig))
  }

  return compose(...interceptors)
}
