/**
 * Rate Limiting Interceptor
 *
 * Protocol-agnostic rate limiting that works across all transports.
 * Uses sliding window algorithm with in-memory storage.
 *
 * Features:
 * - Sliding window rate limiting
 * - Token bucket with burst support
 * - Adaptive rate limit parsing for proxied responses
 * - Rate limit event hooks for observability
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { RateLimitConfig, RateLimitInfo, RateLimitRule } from '../types.js'
import type { RateLimitDriver, RateLimitDriverConfig } from '../../rate-limit/types.js'
import { createDriver, createDriverFromConfig } from '../../rate-limit/factory.js'
import { RaffelError } from '../../core/router.js'

/**
 * Token bucket record for burst-capable rate limiting
 */
interface TokenBucketRecord {
  tokens: number
  lastRefill: number
}

/**
 * Parsed rate limit info from upstream headers
 */
export interface ParsedRateLimitInfo {
  /** Maximum requests allowed in the window */
  limit?: number
  /** Remaining requests in current window */
  remaining?: number
  /** Timestamp when the rate limit resets (ms since epoch) */
  resetAt?: number
  /** Seconds until rate limit resets */
  retryAfter?: number
}

/**
 * Parse rate limit headers from metadata or response headers
 *
 * Parses standard x-ratelimit-* headers and retry-after.
 * Useful when Raffel acts as a proxy or for client-side logic.
 *
 * @example
 * ```typescript
 * const info = parseRateLimitHeaders({
 *   'x-ratelimit-limit': '100',
 *   'x-ratelimit-remaining': '42',
 *   'x-ratelimit-reset': '1699876543000',
 *   'retry-after': '30',
 * })
 *
 * console.log(info)
 * // { limit: 100, remaining: 42, resetAt: 1699876543000, retryAfter: 30 }
 * ```
 */
export function parseRateLimitHeaders(
  headers: Record<string, string | undefined>
): ParsedRateLimitInfo {
  const result: ParsedRateLimitInfo = {}

  // Parse x-ratelimit-limit
  const limit = headers['x-ratelimit-limit']
  if (limit) {
    const parsed = parseInt(limit, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      result.limit = parsed
    }
  }

  // Parse x-ratelimit-remaining
  const remaining = headers['x-ratelimit-remaining']
  if (remaining) {
    const parsed = parseInt(remaining, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      result.remaining = parsed
    }
  }

  // Parse x-ratelimit-reset (could be timestamp or seconds)
  const reset = headers['x-ratelimit-reset']
  if (reset) {
    const parsed = parseInt(reset, 10)
    if (!isNaN(parsed) && parsed > 0) {
      // If the value is small, assume it's seconds; otherwise, it's a timestamp
      if (parsed < 1000000000000) {
        // Seconds - convert to ms timestamp
        result.resetAt = Date.now() + parsed * 1000
      } else {
        // Already a millisecond timestamp
        result.resetAt = parsed
      }
    }
  }

  // Parse retry-after (can be seconds or HTTP-date)
  const retryAfter = headers['retry-after']
  if (retryAfter) {
    // Try as seconds first
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds) && seconds >= 0) {
      result.retryAfter = seconds
    } else {
      // Try as HTTP-date
      const date = Date.parse(retryAfter)
      if (!isNaN(date)) {
        const secondsUntil = Math.ceil((date - Date.now()) / 1000)
        result.retryAfter = Math.max(0, secondsUntil)
      }
    }
  }

  return result
}

/**
 * Check if rate limit is exceeded based on parsed headers
 */
export function isRateLimitExceeded(info: ParsedRateLimitInfo): boolean {
  if (info.remaining !== undefined && info.remaining <= 0) {
    return true
  }
  return false
}

/**
 * Calculate delay before next request based on rate limit info
 */
export function calculateRateLimitDelay(info: ParsedRateLimitInfo): number {
  if (info.retryAfter !== undefined) {
    return info.retryAfter * 1000
  }
  if (info.resetAt !== undefined) {
    return Math.max(0, info.resetAt - Date.now())
  }
  return 0
}

/**
 * Match a procedure name against a glob pattern
 */
function matchPattern(pattern: string, procedure: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^.]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*')

  return new RegExp(`^${regex}$`).test(procedure)
}

/**
 * Find the best matching rule for a procedure
 */
function findMatchingRule(rules: RateLimitRule[], procedure: string): RateLimitRule | null {
  // Sort by specificity (longer patterns first)
  const sorted = [...rules].sort((a, b) => b.pattern.length - a.pattern.length)

  for (const rule of sorted) {
    if (matchPattern(rule.pattern, procedure)) {
      return rule
    }
  }

  return null
}

/**
 * Default key generator - uses requestId or 'unknown'
 */
function defaultKeyGenerator(envelope: Envelope, ctx: Context): string {
  // Try to get client identifier from various sources
  const auth = ctx.auth
  if (auth?.principal) {
    return `user:${auth.principal}`
  }

  // Try metadata for API key or client ID
  const apiKey = envelope.metadata['x-api-key'] || envelope.metadata['authorization']
  if (apiKey) {
    return `key:${apiKey.substring(0, 32)}`
  }

  // Fall back to request ID (unique per request, not ideal for rate limiting)
  // In real scenarios, adapters should inject client IP or other identifiers
  const clientId = envelope.metadata['x-client-id'] || envelope.metadata['x-forwarded-for']
  if (clientId) {
    return `client:${clientId}`
  }

  return `req:${ctx.requestId}`
}

function resolveRateLimitDriver(config: RateLimitConfig): RateLimitDriver {
  const driver = config.driver
  const memoryOptions = config.maxUniqueKeys ? { maxKeys: config.maxUniqueKeys } : undefined

  if (!driver) {
    return createDriver('memory', memoryOptions)
  }
  if (typeof driver === 'string') {
    if (driver === 'memory') {
      return createDriver('memory', memoryOptions)
    }
    if (driver === 'filesystem') {
      return createDriver('filesystem')
    }
    // Redis requires options - caller should use driver config object
    throw new Error(`Rate limit driver '${driver}' requires configuration. Use { driver: '${driver}', options: {...} } instead.`)
  }
  if (typeof (driver as RateLimitDriver).increment === 'function') {
    return driver as RateLimitDriver
  }
  if ((driver as RateLimitDriverConfig).driver === 'memory') {
    const configOptions = (driver as RateLimitDriverConfig).options ?? {}
    return createDriver('memory', { ...configOptions, ...memoryOptions })
  }
  return createDriverFromConfig(driver as RateLimitDriverConfig)
}

/**
 * Create a rate limiting interceptor
 *
 * @example
 * ```typescript
 * // Basic usage
 * const rateLimit = createRateLimitInterceptor({
 *   windowMs: 60000,  // 1 minute
 *   maxRequests: 100,
 * })
 *
 * // With path-specific rules
 * const rateLimit = createRateLimitInterceptor({
 *   windowMs: 60000,
 *   maxRequests: 100,
 *   rules: [
 *     { id: 'auth', pattern: 'auth.*', maxRequests: 10 },
 *     { id: 'admin', pattern: 'admin.**', maxRequests: 50 },
 *   ]
 * })
 *
 * server.use(rateLimit)
 * ```
 */
export function createRateLimitInterceptor(config: RateLimitConfig = {}): Interceptor {
  const {
    windowMs = 60000,
    maxRequests = 100,
    skipSuccessfulRequests = false,
    keyGenerator = defaultKeyGenerator,
    rules = [],
  } = config

  const driver = resolveRateLimitDriver(config)

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const procedure = envelope.procedure
    const matchedRule = rules.length > 0 ? findMatchingRule(rules, procedure) : null

    const effectiveWindow = matchedRule?.windowMs ?? windowMs
    const effectiveLimit = matchedRule?.maxRequests ?? maxRequests
    const rulePrefix = matchedRule ? `rule:${matchedRule.id}:` : 'default:'

    // Generate the rate limit key
    const effectiveKeyGenerator = matchedRule?.keyGenerator ?? keyGenerator
    const key = `${rulePrefix}${effectiveKeyGenerator(envelope, ctx)}`

    const now = Date.now()
    const record = await driver.increment(key, effectiveWindow)
    const remaining = Math.max(0, effectiveLimit - record.count)
    const retryAfter = Math.max(0, Math.ceil((record.resetAt - now) / 1000))

    const info: RateLimitInfo = {
      limit: effectiveLimit,
      remaining,
      resetAt: record.resetAt,
      retryAfter,
    }

    ;(ctx as any).rateLimitInfo = info
    ;(envelope.context as any).rateLimitInfo = info

    // Add rate limit headers to metadata
    envelope.metadata['x-ratelimit-limit'] = effectiveLimit.toString()
    envelope.metadata['x-ratelimit-remaining'] = remaining.toString()
    envelope.metadata['x-ratelimit-reset'] = record.resetAt.toString()
    envelope.metadata['retry-after'] = retryAfter.toString()

    if (record.count > effectiveLimit) {
      throw new RaffelError('RATE_LIMITED', 'Rate limit exceeded', { ...info })
    }

    try {
      const result = await next()

      // Optionally skip counting successful requests
      if (skipSuccessfulRequests && driver.decrement) {
        await driver.decrement(key)
      }

      return result
    } catch (error) {
      // Always count failed requests
      throw error
    }
  }
}

/**
 * Create a rate limiter with authentication-aware defaults
 *
 * @example
 * ```typescript
 * const authRateLimit = createAuthRateLimiter({
 *   authenticated: { windowMs: 60000, maxRequests: 1000 },
 *   anonymous: { windowMs: 60000, maxRequests: 100 },
 * })
 * ```
 */
export function createAuthRateLimiter(config: {
  authenticated?: Partial<RateLimitConfig>
  anonymous?: Partial<RateLimitConfig>
}): Interceptor {
  const authenticatedLimiter = createRateLimitInterceptor({
    windowMs: 60000,
    maxRequests: 1000,
    ...config.authenticated,
  })

  const anonymousLimiter = createRateLimitInterceptor({
    windowMs: 60000,
    maxRequests: 100,
    ...config.anonymous,
  })

  return async (envelope, ctx, next) => {
    const isAuthenticated = ctx.auth?.authenticated === true

    if (isAuthenticated) {
      return authenticatedLimiter(envelope, ctx, next)
    }

    return anonymousLimiter(envelope, ctx, next)
  }
}

/**
 * Token bucket rate limiter configuration
 */
export interface TokenBucketConfig {
  /** Maximum tokens (burst capacity) */
  bucketSize: number

  /** Tokens added per second (sustained rate) */
  refillRate: number

  /** Maximum unique keys to track (default: 10000) */
  maxUniqueKeys?: number

  /** Custom key generator */
  keyGenerator?: (envelope: Envelope, ctx: Context) => string

  /**
   * Callback when rate limit is exceeded
   * Useful for monitoring and alerting
   */
  onRateLimited?: (info: {
    key: string
    procedure: string
    requestId?: string
    tokensNeeded: number
    tokensAvailable: number
  }) => void
}

/**
 * Create a token bucket rate limiter
 *
 * Token bucket allows bursts while maintaining an average rate.
 * This is more flexible than sliding window for bursty traffic.
 *
 * @example
 * ```typescript
 * // Allow bursts of 10 requests, sustained rate of 1 req/sec
 * const rateLimit = createTokenBucketLimiter({
 *   bucketSize: 10,    // Max burst
 *   refillRate: 1,     // 1 token per second
 * })
 *
 * // Allow bursts of 100 requests, sustained rate of 10 req/sec
 * const rateLimit = createTokenBucketLimiter({
 *   bucketSize: 100,
 *   refillRate: 10,
 *   onRateLimited: ({ key, procedure }) => {
 *     console.warn(`Rate limited: ${key} on ${procedure}`)
 *   }
 * })
 *
 * server.use(rateLimit)
 * ```
 */
export function createTokenBucketLimiter(config: TokenBucketConfig): Interceptor {
  const {
    bucketSize,
    refillRate,
    maxUniqueKeys = 10000,
    keyGenerator = defaultKeyGenerator,
    onRateLimited,
  } = config

  const buckets = new Map<string, TokenBucketRecord>()

  // Cleanup old entries periodically (1 minute)
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    const staleThreshold = 60000 // Remove buckets not used in last minute

    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > staleThreshold) {
        buckets.delete(key)
      }
    }
  }, 60000)

  cleanupInterval.unref?.()

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const key = keyGenerator(envelope, ctx)
    const now = Date.now()

    let bucket = buckets.get(key)

    if (!bucket) {
      bucket = { tokens: bucketSize, lastRefill: now }
      buckets.set(key, bucket)

      // Evict oldest if too many keys
      if (buckets.size > maxUniqueKeys) {
        const oldestKey = buckets.keys().next().value
        if (oldestKey) {
          buckets.delete(oldestKey)
        }
      }
    } else {
      // Refill tokens based on time elapsed
      const elapsed = (now - bucket.lastRefill) / 1000 // seconds
      const tokensToAdd = elapsed * refillRate
      bucket.tokens = Math.min(bucketSize, bucket.tokens + tokensToAdd)
      bucket.lastRefill = now
    }

    // Check if we have enough tokens
    if (bucket.tokens < 1) {
      // Calculate when we'll have a token
      const tokensNeeded = 1 - bucket.tokens
      const waitSeconds = tokensNeeded / refillRate
      const retryAfter = Math.ceil(waitSeconds)

      // Callback for monitoring
      if (onRateLimited) {
        onRateLimited({
          key,
          procedure: envelope.procedure,
          requestId: ctx.requestId,
          tokensNeeded: 1,
          tokensAvailable: bucket.tokens,
        })
      }

      // Add rate limit headers
      envelope.metadata['x-ratelimit-limit'] = bucketSize.toString()
      envelope.metadata['x-ratelimit-remaining'] = '0'
      envelope.metadata['retry-after'] = retryAfter.toString()

      throw new RaffelError('RATE_LIMITED', 'Rate limit exceeded', {
        limit: bucketSize,
        remaining: 0,
        retryAfter,
        tokensAvailable: bucket.tokens,
      })
    }

    // Consume a token
    bucket.tokens -= 1

    // Add rate limit headers
    envelope.metadata['x-ratelimit-limit'] = bucketSize.toString()
    envelope.metadata['x-ratelimit-remaining'] = Math.floor(bucket.tokens).toString()

    return next()
  }
}
