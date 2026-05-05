/**
 * Rate Limiting Middleware
 *
 * Provides configurable rate limiting with sliding window algorithm,
 * custom rules per path/method, and event emission.
 *
 * @example
 * import { createRateLimiter, rateLimitMiddleware } from 'raffel/http/rate-limit'
 *
 * // Basic usage - 100 requests per minute per IP
 * const limiter = createRateLimiter({
 *   windowMs: 60000,
 *   max: 100,
 * })
 * app.use('*', rateLimitMiddleware(limiter))
 *
 * // Advanced - different limits per path
 * const limiter = createRateLimiter({
 *   windowMs: 60000,
 *   max: 100,
 *   rules: [
 *     { path: '/api/auth/*', method: 'POST', max: 5 },   // Strict for auth
 *     { path: '/api/search', max: 30 },                  // Moderate for search
 *     { path: '/api/public/*', max: 1000 },              // Lenient for public
 *   ],
 * })
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import type { ApiEventEmitter } from './events.js'
import type {
  RateLimitDriver,
  RateLimitDriverConfig,
  RateLimitDriverType,
} from '../rate-limit/types.js'
import { resolveRequestClientIp, type TrustedProxyConfig } from '../utils/client-ip.js'
import { createInMemoryRateLimitStore, createRateLimitStoreAdapter } from './rate-limit-store.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rate limit rule for specific path/method combinations
 */
export interface RateLimitRule {
  /** Path pattern (supports * wildcard) */
  path: string

  /** HTTP method (optional, applies to all if not specified) */
  method?: string | string[]

  /** Maximum requests in window */
  max: number

  /** Window duration in ms (overrides global) */
  windowMs?: number

  /** Custom key generator for this rule */
  keyGenerator?: KeyGenerator

  /** Skip this rule if returns true */
  skip?: (c: HttpContextInterface) => boolean | Promise<boolean>
}

/**
 * Key generator function type
 */
export type KeyGenerator = (c: HttpContextInterface) => string | Promise<string>

/**
 * Rate limit entry for tracking requests
 */
export interface RateLimitEntry {
  /** Request timestamps in the current window */
  timestamps: number[]

  /** Total requests in current window */
  count: number

  /** Window start time */
  windowStart: number
}

/**
 * Rate limiter configuration options
 */
export interface RateLimiterOptions {
  /**
   * Time window in milliseconds
   * @default 60000 (1 minute)
   */
  windowMs?: number

  /**
   * Maximum requests per window
   * @default 100
   */
  max?: number

  /**
   * Custom key generator
   * @default client IP resolved from socket or trusted proxies
   */
  keyGenerator?: KeyGenerator

  /**
   * Trusted proxy hops that are allowed to supply forwarding headers.
   * When omitted or false, x-forwarded-for and x-real-ip are ignored.
   * @default false
   */
  trustedProxies?: TrustedProxyConfig

  /**
   * Path/method specific rules (checked in order, first match wins)
   */
  rules?: RateLimitRule[]

  /**
   * Maximum unique keys to track (prevents memory exhaustion)
   * @default 10000
   */
  maxUniqueKeys?: number

  /**
   * Event emitter for rate limit events
   */
  events?: ApiEventEmitter

  /**
   * Custom store for distributed rate limiting
   */
  store?: RateLimitStore

  /**
   * Rate limit driver configuration
   *
   * Supports:
   * - 'memory' for in-memory storage (or built-in defaults)
   * - 'filesystem' for file-backed storage
   * - 'redis' with explicit driver config + options
   * - 's3db' with explicit driver config + resource
   * - explicit driver instance
   */
  driver?: RateLimitDriverConfig | RateLimitDriverType | RateLimitDriver

  /**
   * Skip rate limiting if returns true
   */
  skip?: (c: HttpContextInterface) => boolean | Promise<boolean>

  /**
   * Callback when rate limit is exceeded
   */
  onLimit?: (c: HttpContextInterface, info: RateLimitInfo) => void | Promise<void>

  /**
   * Include rate limit headers in response
   * @default true
   */
  headers?: boolean

  /**
   * Header names for rate limit info
   */
  headerNames?: {
    limit?: string
    remaining?: string
    reset?: string
    retryAfter?: string
  }

  /**
   * Use sliding window algorithm (more accurate but slightly more memory)
   * @default true
   */
  slidingWindow?: boolean

  /**
   * Cleanup interval for expired entries (ms)
   * @default 60000 (1 minute)
   */
  cleanupInterval?: number
}

/**
 * Rate limit info returned by check
 */
export interface RateLimitInfo {
  /** Whether rate limit is exceeded */
  limited: boolean

  /** Maximum requests allowed */
  limit: number

  /** Remaining requests in window */
  remaining: number

  /** Time until window resets (ms) */
  resetIn: number

  /** Timestamp when window resets */
  resetAt: number

  /** Current request count */
  current: number

  /** The key used for this request */
  key: string

  /** Rule that matched (if any) */
  rule?: RateLimitRule
}

/**
 * Custom store interface for distributed rate limiting
 */
export interface RateLimitStore {
  /**
   * Increment counter and get current count
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>

  /**
   * Get current count for a key
   */
  get(key: string, windowMs?: number): Promise<{ count: number; resetAt: number } | undefined>

  /**
   * Reset a key
   */
  reset(key: string): Promise<void>

  /**
   * Clear all entries
   */
  clear(): Promise<void>
}

/**
 * Rate limiter manager interface
 */
export interface RateLimiter {
  /**
   * Check rate limit for a context
   */
  check(c: HttpContextInterface): Promise<RateLimitInfo>

  /**
   * Increment counter for a context
   */
  increment(c: HttpContextInterface): Promise<RateLimitInfo>

  /**
   * Reset rate limit for a key
   */
  reset(key: string): Promise<void>

  /**
   * Get current stats
   */
  getStats(): RateLimitStats

  /**
   * Clear all rate limit data
   */
  clear(): Promise<void>

  /**
   * Stop cleanup timer
   */
  stop(): void
}

/**
 * Rate limit statistics
 */
export interface RateLimitStats {
  totalKeys: number
  totalRequests: number
  limitedRequests: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default IP extraction function
 */
function defaultKeyGenerator(
  c: HttpContextInterface,
  trustedProxies: TrustedProxyConfig = false
): string {
  return c.runtime?.http?.clientIp
    ?? resolveRequestClientIp(c.req.raw, trustedProxies).ip
    ?? 'unknown'
}

/**
 * Match a path against a pattern with wildcard support
 */
function matchPath(path: string, pattern: string): boolean {
  // Exact match
  if (pattern === path) return true

  // Wildcard patterns
  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars except *
      .replace(/\*/g, '.*') // Convert * to .*
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(path)
  }

  return false
}

/**
 * Find matching rule for a request
 */
function findMatchingRule(
  rules: RateLimitRule[],
  path: string,
  method: string
): RateLimitRule | undefined {
  for (const rule of rules) {
    // Check path match
    if (!matchPath(path, rule.path)) continue

    // Check method match
    if (rule.method) {
      const methods = Array.isArray(rule.method) ? rule.method : [rule.method]
      if (!methods.some((m) => m.toUpperCase() === method.toUpperCase())) {
        continue
      }
    }

    return rule
  }

  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a rate limiter
 *
 * @param options - Rate limiter configuration
 * @returns Rate limiter instance
 *
 * @example
 * // Basic usage
 * const limiter = createRateLimiter({
 *   windowMs: 60000,  // 1 minute
 *   max: 100,         // 100 requests per minute
 * })
 *
 * // With path-specific rules
 * const limiter = createRateLimiter({
 *   windowMs: 60000,
 *   max: 100,
 *   rules: [
 *     { path: '/api/auth/login', method: 'POST', max: 5 },
 *     { path: '/api/auth/*', max: 20 },
 *     { path: '/api/heavy/*', max: 10, windowMs: 300000 },
 *   ],
 * })
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const {
    windowMs = 60000,
    max = 100,
    keyGenerator,
    rules = [],
    maxUniqueKeys = 10000,
    events,
    skip,
    slidingWindow = true,
    cleanupInterval = 60000,
    trustedProxies = false,
  } = options

  const store = options.store
    ? createRateLimitStoreAdapter(options)
    : options.driver
      ? createRateLimitStoreAdapter(options)
      : createInMemoryRateLimitStore(maxUniqueKeys, slidingWindow, cleanupInterval)

  let totalRequests = 0
  let limitedRequests = 0
  const effectiveKeyGenerator = keyGenerator ?? ((c: HttpContextInterface) => defaultKeyGenerator(c, trustedProxies))

  async function getKeyAndLimits(c: HttpContextInterface): Promise<{
    key: string
    effectiveMax: number
    effectiveWindowMs: number
    rule?: RateLimitRule
  }> {
    const path = new URL(c.req.url).pathname
    const method = c.req.method

    // Find matching rule
    const rule = findMatchingRule(rules, path, method)

    // Determine effective limits
    const effectiveMax = rule?.max ?? max
    const effectiveWindowMs = rule?.windowMs ?? windowMs

    // Generate key
    const keyGen = rule?.keyGenerator ?? effectiveKeyGenerator
    const key = await keyGen(c)

    return { key, effectiveMax, effectiveWindowMs, rule }
  }

  return {
    async check(c: HttpContextInterface): Promise<RateLimitInfo> {
      // Check skip
      if (skip && (await skip(c))) {
        return {
          limited: false,
          limit: max,
          remaining: max,
          resetIn: 0,
          resetAt: Date.now(),
          current: 0,
          key: '',
        }
      }

      const { key, effectiveMax, effectiveWindowMs, rule } = await getKeyAndLimits(c)

      // Check rule-specific skip
      if (rule?.skip && (await rule.skip(c))) {
        return {
          limited: false,
          limit: effectiveMax,
          remaining: effectiveMax,
          resetIn: 0,
          resetAt: Date.now(),
          current: 0,
          key,
          rule,
        }
      }

      const entry = await store.get(key, effectiveWindowMs)
      const now = Date.now()

      if (!entry) {
        return {
          limited: false,
          limit: effectiveMax,
          remaining: effectiveMax,
          resetIn: effectiveWindowMs,
          resetAt: now + effectiveWindowMs,
          current: 0,
          key,
          rule,
        }
      }

      const remaining = Math.max(0, effectiveMax - entry.count)
      const resetIn = Math.max(0, entry.resetAt - now)

      return {
        limited: entry.count >= effectiveMax,
        limit: effectiveMax,
        remaining,
        resetIn,
        resetAt: entry.resetAt,
        current: entry.count,
        key,
        rule,
      }
    },

    async increment(c: HttpContextInterface): Promise<RateLimitInfo> {
      totalRequests++

      // Check skip
      if (skip && (await skip(c))) {
        return {
          limited: false,
          limit: max,
          remaining: max,
          resetIn: 0,
          resetAt: Date.now(),
          current: 0,
          key: '',
        }
      }

      const { key, effectiveMax, effectiveWindowMs, rule } = await getKeyAndLimits(c)

      // Check rule-specific skip
      if (rule?.skip && (await rule.skip(c))) {
        return {
          limited: false,
          limit: effectiveMax,
          remaining: effectiveMax,
          resetIn: 0,
          resetAt: Date.now(),
          current: 0,
          key,
          rule,
        }
      }

      const result = await store.increment(key, effectiveWindowMs)
      const now = Date.now()

      const limited = result.count > effectiveMax
      const remaining = Math.max(0, effectiveMax - result.count)
      const resetIn = Math.max(0, result.resetAt - now)

      if (limited) {
        limitedRequests++

        // Emit event
        if (events) {
          events.emitRateLimit('blocked', {
            ip: key,
            path: new URL(c.req.url).pathname,
            limit: effectiveMax,
            current: result.count,
            resetAt: result.resetAt,
            blocked: true,
          })
        }
      } else if (remaining <= Math.ceil(effectiveMax * 0.1)) {
        // Warning when 90% consumed
        if (events) {
          events.emitRateLimit('warning', {
            ip: key,
            path: new URL(c.req.url).pathname,
            limit: effectiveMax,
            current: result.count,
            resetAt: result.resetAt,
            blocked: false,
          })
        }
      }

      return {
        limited,
        limit: effectiveMax,
        remaining,
        resetIn,
        resetAt: result.resetAt,
        current: result.count,
        key,
        rule,
      }
    },

    async reset(key: string): Promise<void> {
      await store.reset(key)
    },

    getStats(): RateLimitStats {
      return {
        totalKeys: store.getKeyCount(),
        totalRequests,
        limitedRequests,
      }
    },

    async clear(): Promise<void> {
      await store.clear()
      totalRequests = 0
      limitedRequests = 0
    },

    stop(): void {
      void store.stop()
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rate limit middleware options
 */
export interface RateLimitMiddlewareOptions {
  /**
   * Include rate limit headers in response
   * @default true
   */
  headers?: boolean

  /**
   * Header names
   */
  headerNames?: {
    limit?: string
    remaining?: string
    reset?: string
    retryAfter?: string
  }

  /**
   * Custom response when rate limited
   */
  onLimit?: (c: HttpContextInterface, info: RateLimitInfo) => Response | Promise<Response>

  /**
   * Message in default rate limit response
   * @default 'Too many requests'
   */
  message?: string
}

/**
 * Create rate limit middleware
 *
 * @param limiter - Rate limiter instance
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * const limiter = createRateLimiter({ windowMs: 60000, max: 100 })
 * app.use('*', rateLimitMiddleware(limiter))
 */
export function rateLimitMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  limiter: RateLimiter,
  options: RateLimitMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    headers = true,
    headerNames = {},
    onLimit,
    message = 'Too many requests',
  } = options

  const limitHeader = headerNames.limit ?? 'X-RateLimit-Limit'
  const remainingHeader = headerNames.remaining ?? 'X-RateLimit-Remaining'
  const resetHeader = headerNames.reset ?? 'X-RateLimit-Reset'
  const retryAfterHeader = headerNames.retryAfter ?? 'Retry-After'

  return async (c, next) => {
    const info = await limiter.increment(c)

    // Add rate limit headers
    if (headers) {
      c.header(limitHeader, String(info.limit))
      c.header(remainingHeader, String(info.remaining))
      c.header(resetHeader, String(Math.ceil(info.resetAt / 1000)))
    }

    // Check if rate limited
    if (info.limited) {
      if (headers) {
        c.header(retryAfterHeader, String(Math.ceil(info.resetIn / 1000)))
      }

      if (onLimit) {
        c.res = await onLimit(c, info)
        return
      }

      c.res = new Response(
        JSON.stringify({
          success: false,
          error: {
            message,
            code: 'RATE_LIMIT_EXCEEDED',
            retryAfter: Math.ceil(info.resetIn / 1000),
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      return
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Key generator by IP address (default)
 */
export const keyByIp: KeyGenerator = defaultKeyGenerator

/**
 * Key generator by user ID (requires auth middleware)
 */
export function keyByUserId(userIdKey = 'userId'): KeyGenerator {
  return (c) => {
    const userId = c.get(userIdKey)
    return userId ? String(userId) : defaultKeyGenerator(c)
  }
}

/**
 * Key generator by API key header
 */
export function keyByApiKey(headerName = 'x-api-key'): KeyGenerator {
  return (c) => {
    const apiKey = c.req.header(headerName) as string | undefined
    return apiKey || defaultKeyGenerator(c)
  }
}

/**
 * Key generator combining IP and path
 */
export const keyByIpAndPath: KeyGenerator = (c) => {
  const ip = defaultKeyGenerator(c)
  const path = new URL(c.req.url).pathname
  return `${ip}:${path}`
}

/**
 * Key generator combining IP and method
 */
export const keyByIpAndMethod: KeyGenerator = (c) => {
  const ip = defaultKeyGenerator(c)
  const method = c.req.method
  return `${ip}:${method}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createRateLimiter,
  rateLimitMiddleware,
  keyByIp,
  keyByUserId,
  keyByApiKey,
  keyByIpAndPath,
  keyByIpAndMethod,
}
