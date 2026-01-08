/**
 * Rate Limiting Middleware
 *
 * Protects services from abuse with configurable rate limiting.
 * Supports sliding window algorithm with in-memory or custom stores.
 */

import { RaffelError } from '../core/index.js'
import type { Interceptor, Envelope, Context } from '../types/index.js'

/**
 * Rate limit configuration
 */
export interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  limit: number
  /** Window size in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number
  /** Function to extract the rate limit key (default: uses principal or IP) */
  keyExtractor?: (envelope: Envelope, ctx: Context) => string
  /** Custom store for distributed rate limiting */
  store?: RateLimitStore
  /** Handler for rate limit exceeded (default: throws RATE_LIMITED error) */
  onLimitReached?: (envelope: Envelope, ctx: Context, info: RateLimitInfo) => void | Promise<void>
  /** Skip rate limiting for certain requests */
  skip?: (envelope: Envelope, ctx: Context) => boolean | Promise<boolean>
  /** Procedures to skip rate limiting */
  skipProcedures?: string[]
  /** Custom headers to include in response metadata */
  includeHeaders?: boolean
}

/**
 * Rate limit information
 */
export interface RateLimitInfo {
  /** Total limit for the window */
  limit: number
  /** Remaining requests in the window */
  remaining: number
  /** Timestamp when the window resets (ms since epoch) */
  resetAt: number
  /** Whether the limit was exceeded */
  exceeded: boolean
}

/**
 * Store interface for rate limit state
 */
export interface RateLimitStore {
  /** Increment the counter and return current count + TTL info */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>
  /** Get current count for a key */
  get(key: string): Promise<{ count: number; resetAt: number } | null>
  /** Reset a key */
  reset(key: string): Promise<void>
}

/**
 * In-memory sliding window entry
 */
interface WindowEntry {
  /** Timestamps of requests in current window */
  timestamps: number[]
  /** When this entry was last cleaned */
  lastClean: number
}

/**
 * Create an in-memory rate limit store
 */
export function createInMemoryStore(): RateLimitStore {
  const entries = new Map<string, WindowEntry>()

  // Clean up expired entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of entries) {
      // Remove entries that haven't been touched in 5 minutes
      if (now - entry.lastClean > 300000) {
        entries.delete(key)
      }
    }
  }, 60000) // Run every minute

  // Make interval non-blocking
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }

  return {
    async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
      const now = Date.now()
      const windowStart = now - windowMs

      let entry = entries.get(key)
      if (!entry) {
        entry = { timestamps: [], lastClean: now }
        entries.set(key, entry)
      }

      // Remove timestamps outside the window (sliding window)
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)
      entry.lastClean = now

      // Add current request
      entry.timestamps.push(now)

      // Calculate reset time (oldest timestamp + window, or now + window if fresh)
      const oldestInWindow = entry.timestamps[0] || now
      const resetAt = oldestInWindow + windowMs

      return {
        count: entry.timestamps.length,
        resetAt,
      }
    },

    async get(key: string): Promise<{ count: number; resetAt: number } | null> {
      const entry = entries.get(key)
      if (!entry || entry.timestamps.length === 0) {
        return null
      }

      const oldestInWindow = entry.timestamps[0]
      return {
        count: entry.timestamps.length,
        resetAt: oldestInWindow + 60000, // Approximate, store doesn't track windowMs
      }
    },

    async reset(key: string): Promise<void> {
      entries.delete(key)
    },
  }
}

/**
 * Default key extractor - uses auth principal or falls back to a constant
 */
function defaultKeyExtractor(envelope: Envelope, ctx: Context): string {
  // Try to use authenticated principal
  if (ctx.auth?.principal) {
    return `user:${ctx.auth.principal}`
  }

  // Try to use request ID as a proxy for connection
  if (envelope.metadata?.['x-forwarded-for']) {
    return `ip:${envelope.metadata['x-forwarded-for']}`
  }

  if (envelope.metadata?.['x-real-ip']) {
    return `ip:${envelope.metadata['x-real-ip']}`
  }

  // Fallback to a general key (not recommended for production)
  return `global:${envelope.procedure}`
}

/**
 * Create rate limiting middleware
 */
export function createRateLimitMiddleware(options: RateLimitOptions): Interceptor {
  const {
    limit,
    windowMs = 60000,
    keyExtractor = defaultKeyExtractor,
    store = createInMemoryStore(),
    onLimitReached,
    skip,
    skipProcedures = [],
    includeHeaders = false,
  } = options

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Check if should skip
    if (skipProcedures.includes(envelope.procedure)) {
      return next()
    }

    if (skip && (await skip(envelope, ctx))) {
      return next()
    }

    // Extract key for rate limiting
    const key = keyExtractor(envelope, ctx)

    // Increment counter
    const { count, resetAt } = await store.increment(key, windowMs)
    const remaining = Math.max(0, limit - count)
    const exceeded = count > limit

    const info: RateLimitInfo = {
      limit,
      remaining,
      resetAt,
      exceeded,
    }

    // Add rate limit headers to context if configured
    if (includeHeaders) {
      ;(ctx as any).rateLimitInfo = info
    }

    // Check if exceeded
    if (exceeded) {
      if (onLimitReached) {
        await onLimitReached(envelope, ctx, info)
      }

      throw new RaffelError(
        'RATE_LIMITED',
        `Rate limit exceeded. Try again in ${Math.ceil((resetAt - Date.now()) / 1000)} seconds.`,
        {
          limit,
          remaining: 0,
          resetAt,
          retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
        }
      )
    }

    return next()
  }
}

/**
 * Create rate limit middleware with per-procedure limits
 */
export interface ProcedureRateLimit {
  /** Procedure name or pattern (supports * and .*) */
  procedure: string
  /** Maximum requests allowed in the window */
  limit: number
  /** Window size in milliseconds */
  windowMs?: number
}

export interface PerProcedureRateLimitOptions extends Omit<RateLimitOptions, 'limit' | 'windowMs'> {
  /** Rate limits per procedure */
  limits: ProcedureRateLimit[]
  /** Default limit for procedures not in the list */
  defaultLimit?: { limit: number; windowMs?: number }
}

/**
 * Create rate limit middleware with different limits per procedure
 */
export function createPerProcedureRateLimitMiddleware(
  options: PerProcedureRateLimitOptions
): Interceptor {
  const { limits, defaultLimit, ...baseOptions } = options
  const store = baseOptions.store ?? createInMemoryStore()

  // Compile procedure patterns
  const compiledLimits = limits.map((l) => ({
    ...l,
    pattern: l.procedure,
    matches: createMatcher(l.procedure),
  }))

  function createMatcher(pattern: string): (procedure: string) => boolean {
    if (pattern === '*') return () => true
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2) + '.'
      return (p) => p.startsWith(prefix)
    }
    return (p) => p === pattern
  }

  function findLimit(procedure: string): { limit: number; windowMs: number } | null {
    for (const compiled of compiledLimits) {
      if (compiled.matches(procedure)) {
        return { limit: compiled.limit, windowMs: compiled.windowMs ?? 60000 }
      }
    }
    return defaultLimit ? { limit: defaultLimit.limit, windowMs: defaultLimit.windowMs ?? 60000 } : null
  }

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Find applicable limit
    const procedureLimit = findLimit(envelope.procedure)

    // If no limit configured, pass through
    if (!procedureLimit) {
      return next()
    }

    // Create a rate limiter for this specific configuration
    const middleware = createRateLimitMiddleware({
      ...baseOptions,
      limit: procedureLimit.limit,
      windowMs: procedureLimit.windowMs,
      store,
      keyExtractor: (e, c) => {
        const baseKey = (baseOptions.keyExtractor ?? defaultKeyExtractor)(e, c)
        return `${baseKey}:${e.procedure}`
      },
    })

    return middleware(envelope, ctx, next)
  }
}

/**
 * Sliding window rate limiter for more precise rate limiting
 */
export function createSlidingWindowRateLimiter(options: {
  limit: number
  windowMs: number
}): {
  check: (key: string) => { allowed: boolean; remaining: number; resetAt: number }
  reset: (key: string) => void
} {
  const { limit, windowMs } = options
  const windows = new Map<string, number[]>()

  return {
    check(key: string) {
      const now = Date.now()
      const windowStart = now - windowMs

      let timestamps = windows.get(key) || []
      timestamps = timestamps.filter((ts) => ts > windowStart)

      const count = timestamps.length
      const remaining = Math.max(0, limit - count)
      const oldestInWindow = timestamps[0] || now
      const resetAt = oldestInWindow + windowMs

      if (count < limit) {
        timestamps.push(now)
        windows.set(key, timestamps)
        return { allowed: true, remaining: remaining - 1, resetAt }
      }

      return { allowed: false, remaining: 0, resetAt }
    },

    reset(key: string) {
      windows.delete(key)
    },
  }
}
