/**
 * Login throttling helpers for HTTP auth middleware.
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import { resolveRequestClientIp } from '../utils/client-ip.js'

// ─────────────────────────────────────────────────────────────────────────────
// Login Throttling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Login attempt record
 */
interface LoginAttempt {
  /** Number of failed attempts */
  count: number
  /** Timestamp of first attempt in current window */
  firstAttemptAt: number
  /** Timestamp when block expires (if blocked) */
  blockedUntil?: number
}

/**
 * Login throttle configuration
 */
export interface LoginThrottleOptions {
  /**
   * Maximum failed attempts before blocking
   * @default 5
   */
  maxAttempts?: number

  /**
   * Time window for counting attempts (ms)
   * @default 900000 (15 minutes)
   */
  windowMs?: number

  /**
   * How long to block after max attempts (ms)
   * @default 3600000 (1 hour)
   */
  blockDurationMs?: number

  /**
   * Optional callback when an IP gets blocked
   */
  onBlock?: (key: string, attempts: number) => void

  /**
   * Optional callback when a blocked attempt occurs
   */
  onBlockedAttempt?: (key: string, remainingMs: number) => void
}

/**
 * Login throttle manager interface
 */
export interface LoginThrottleManager {
  /**
   * Check if a key (IP/user) is currently blocked
   */
  isBlocked(key: string): boolean

  /**
   * Get remaining block time in milliseconds (0 if not blocked)
   */
  getBlockTimeRemaining(key: string): number

  /**
   * Record a failed login attempt
   * Returns true if this attempt triggered a block
   */
  recordFailure(key: string): boolean

  /**
   * Reset attempts for a key (call on successful login)
   */
  reset(key: string): void

  /**
   * Get current attempt count for a key
   */
  getAttempts(key: string): number

  /**
   * Manually block a key
   */
  block(key: string, durationMs?: number): void

  /**
   * Manually unblock a key
   */
  unblock(key: string): void

  /**
   * Clean up expired entries
   */
  cleanup(): void

  /**
   * Get stats about current state
   */
  getStats(): { trackedKeys: number; blockedKeys: number }
}

/**
 * Create a login throttle manager
 *
 * Tracks failed login attempts and blocks keys (IPs/users) after too many failures.
 *
 * @param options - Throttle configuration
 * @returns LoginThrottleManager
 *
 * @example
 * const throttle = createLoginThrottle({
 *   maxAttempts: 5,
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   blockDurationMs: 60 * 60 * 1000, // 1 hour
 *   onBlock: (ip) => console.log(`Blocked IP: ${ip}`)
 * })
 *
 * app.post('/login', async (c) => {
 *   const ip = c.req.header('x-forwarded-for') || 'unknown'
 *
 *   if (throttle.isBlocked(ip)) {
 *     const remaining = throttle.getBlockTimeRemaining(ip)
 *     return c.json({
 *       error: 'Too many failed attempts',
 *       retryAfterMs: remaining
 *     }, 429)
 *   }
 *
 *   const valid = await verifyCredentials(username, password)
 *   if (!valid) {
 *     const blocked = throttle.recordFailure(ip)
 *     if (blocked) {
 *       return c.json({ error: 'Account locked due to too many attempts' }, 429)
 *     }
 *     return c.json({ error: 'Invalid credentials' }, 401)
 *   }
 *
 *   throttle.reset(ip) // Clear on success
 *   // ... create session
 * })
 */
export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottleManager {
  const {
    maxAttempts = 5,
    windowMs = 15 * 60 * 1000,
    blockDurationMs = 60 * 60 * 1000,
    onBlock,
    onBlockedAttempt,
  } = options

  const attempts = new Map<string, LoginAttempt>()

  // Cleanup interval (run every 5 minutes)
  const cleanupInterval = setInterval(() => {
    cleanup()
  }, 5 * 60 * 1000)

  // Allow cleanup to be stopped
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }

  function cleanup(): void {
    const now = Date.now()
    for (const [key, record] of attempts) {
      // Remove if window expired and not blocked
      const windowExpired = now - record.firstAttemptAt > windowMs
      const blockExpired = !record.blockedUntil || record.blockedUntil < now

      if (windowExpired && blockExpired) {
        attempts.delete(key)
      }
    }
  }

  function isBlocked(key: string): boolean {
    const record = attempts.get(key)
    if (!record?.blockedUntil) return false

    const now = Date.now()
    if (record.blockedUntil < now) {
      // Block expired
      attempts.delete(key)
      return false
    }

    onBlockedAttempt?.(key, record.blockedUntil - now)
    return true
  }

  function getBlockTimeRemaining(key: string): number {
    const record = attempts.get(key)
    if (!record?.blockedUntil) return 0

    const remaining = record.blockedUntil - Date.now()
    return remaining > 0 ? remaining : 0
  }

  function recordFailure(key: string): boolean {
    const now = Date.now()
    let record = attempts.get(key)

    if (!record) {
      record = { count: 0, firstAttemptAt: now }
      attempts.set(key, record)
    }

    // Check if window expired - reset if so
    if (now - record.firstAttemptAt > windowMs) {
      record.count = 0
      record.firstAttemptAt = now
      record.blockedUntil = undefined
    }

    record.count++

    // Check if should block
    if (record.count >= maxAttempts) {
      record.blockedUntil = now + blockDurationMs
      onBlock?.(key, record.count)
      return true
    }

    return false
  }

  function reset(key: string): void {
    attempts.delete(key)
  }

  function getAttempts(key: string): number {
    const record = attempts.get(key)
    if (!record) return 0

    // Check if window expired
    if (Date.now() - record.firstAttemptAt > windowMs) {
      attempts.delete(key)
      return 0
    }

    return record.count
  }

  function block(key: string, durationMs?: number): void {
    const duration = durationMs ?? blockDurationMs
    const record = attempts.get(key) || { count: maxAttempts, firstAttemptAt: Date.now() }
    record.blockedUntil = Date.now() + duration
    attempts.set(key, record)
  }

  function unblock(key: string): void {
    const record = attempts.get(key)
    if (record) {
      record.blockedUntil = undefined
      record.count = 0
    }
  }

  function getStats(): { trackedKeys: number; blockedKeys: number } {
    let blockedKeys = 0
    const now = Date.now()

    for (const record of attempts.values()) {
      if (record.blockedUntil && record.blockedUntil > now) {
        blockedKeys++
      }
    }

    return { trackedKeys: attempts.size, blockedKeys }
  }

  return {
    isBlocked,
    getBlockTimeRemaining,
    recordFailure,
    reset,
    getAttempts,
    block,
    unblock,
    cleanup,
    getStats,
  }
}

/**
 * Create login throttle middleware
 *
 * Automatically blocks requests from IPs with too many failures.
 * Use with a login endpoint that calls recordFailure on bad credentials.
 *
 * @param throttle - Login throttle manager
 * @param keyGenerator - Function to extract key from request (default: IP address)
 * @returns Middleware function
 *
 * @example
 * const throttle = createLoginThrottle({ maxAttempts: 5 })
 *
 * // Apply middleware to login route
 * app.post('/login',
 *   loginThrottleMiddleware(throttle),
 *   async (c) => {
 *     // ... verify credentials
 *     // On failure: throttle.recordFailure(key)
 *     // On success: throttle.reset(key)
 *   }
 * )
 */
export function loginThrottleMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  throttle: LoginThrottleManager,
  keyGenerator?: (c: HttpContextInterface<E>) => string
): HttpMiddleware<E> {
  const getKey = keyGenerator ?? ((c) => {
    return c.runtime?.http?.clientIp
      ?? resolveRequestClientIp(c.req.raw).ip
      ?? 'unknown'
  })

  return async (c, next) => {
    const key = getKey(c)

    if (throttle.isBlocked(key)) {
      const remaining = throttle.getBlockTimeRemaining(key)
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many failed login attempts. Please try again later.',
            retryAfterMs: remaining,
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil(remaining / 1000).toString(),
          },
        }
      )
    }

    // Store key in context for handler to use
    c.set('throttleKey' as keyof E, key as E[keyof E])

    await next()
  }
}
