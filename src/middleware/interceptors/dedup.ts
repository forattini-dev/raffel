/**
 * Request Deduplication Interceptor
 *
 * Coalesces identical in-flight requests to avoid duplicate work.
 * When multiple requests with the same key are made simultaneously,
 * only the first one executes - subsequent ones wait for and share the result.
 *
 * Features:
 * - Automatic key generation based on procedure + payload hash
 * - Custom key generators for complex scenarios
 * - Safe method detection (only dedup idempotent operations)
 * - Memory-efficient with automatic cleanup
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'

/**
 * Deduplication configuration
 */
export interface DedupConfig {
  /**
   * Custom key generator for deduplication
   * Default: procedure + JSON hash of payload
   */
  keyGenerator?: (envelope: Envelope, ctx: Context) => string

  /**
   * Envelope types to deduplicate (default: ['query'])
   * Procedures are typically not safe to deduplicate
   */
  types?: Array<'query' | 'procedure' | 'stream' | 'event'>

  /**
   * Procedure patterns to deduplicate (glob patterns)
   * If specified, only matching procedures are deduplicated
   */
  procedures?: string[]

  /**
   * Procedure patterns to exclude from deduplication
   */
  excludeProcedures?: string[]

  /**
   * TTL for pending request entries in ms (default: 30000)
   * Prevents memory leaks if requests never complete
   */
  ttlMs?: number

  /**
   * Callback when a request is deduplicated
   * Useful for metrics and debugging
   */
  onDedup?: (info: {
    key: string
    procedure: string
    requestId?: string
    waitingCount: number
  }) => void
}

/**
 * Pending request record
 */
interface PendingRequest {
  promise: Promise<unknown>
  timestamp: number
  waitingCount: number
}

/**
 * Simple hash function for payload
 */
function hashPayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return 'null'
  }

  try {
    const str = JSON.stringify(payload)
    // Simple djb2 hash
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    }
    return (hash >>> 0).toString(36)
  } catch {
    // If payload can't be stringified, use a random key (no dedup)
    return Math.random().toString(36).slice(2)
  }
}

/**
 * Default key generator: procedure + payload hash
 */
function defaultKeyGenerator(envelope: Envelope): string {
  return `${envelope.procedure}:${hashPayload(envelope.payload)}`
}

/**
 * Match a procedure name against glob patterns
 */
function matchProcedure(patterns: string[], procedure: string): boolean {
  return patterns.some((pattern) => {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DOUBLE_STAR}}')
      .replace(/\*/g, '[^.]*')
      .replace(/{{DOUBLE_STAR}}/g, '.*')

    return new RegExp(`^${regex}$`).test(procedure)
  })
}

/**
 * Create a request deduplication interceptor
 *
 * Coalesces identical in-flight requests to avoid duplicate work.
 * Only the first request executes; subsequent identical requests
 * wait for and share the result.
 *
 * @example
 * ```typescript
 * // Basic usage - dedup queries only
 * const dedup = createDedupInterceptor()
 *
 * // Custom key generation
 * const dedup = createDedupInterceptor({
 *   keyGenerator: (envelope, ctx) => {
 *     // Include user in key for user-specific caching
 *     return `${ctx.auth?.principal}:${envelope.procedure}`
 *   }
 * })
 *
 * // With metrics
 * const dedup = createDedupInterceptor({
 *   onDedup: ({ procedure, waitingCount }) => {
 *     metrics.increment('dedup.coalesced', { procedure })
 *     metrics.gauge('dedup.waiting', waitingCount)
 *   }
 * })
 *
 * // Deduplicate specific procedures
 * const dedup = createDedupInterceptor({
 *   types: ['query', 'procedure'],
 *   procedures: ['users.get', 'products.list', 'cache.**'],
 * })
 *
 * server.use(dedup)
 * ```
 */
export function createDedupInterceptor(config: DedupConfig = {}): Interceptor {
  const {
    keyGenerator = defaultKeyGenerator,
    types = ['query'],
    procedures,
    excludeProcedures = [],
    ttlMs = 30000,
    onDedup,
  } = config

  const pending = new Map<string, PendingRequest>()

  // Cleanup stale entries periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, record] of pending) {
      if (now - record.timestamp > ttlMs) {
        pending.delete(key)
      }
    }
  }, ttlMs)

  cleanupInterval.unref?.()

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Check if this type should be deduplicated
    if (!types.includes(envelope.type as any)) {
      return next()
    }

    // Check procedure patterns
    if (procedures && procedures.length > 0) {
      if (!matchProcedure(procedures, envelope.procedure)) {
        return next()
      }
    }

    // Check exclusions
    if (excludeProcedures.length > 0) {
      if (matchProcedure(excludeProcedures, envelope.procedure)) {
        return next()
      }
    }

    // Generate dedup key
    const key = keyGenerator(envelope, ctx)

    // Check for pending request
    const existing = pending.get(key)
    if (existing) {
      existing.waitingCount++

      // Callback for metrics
      if (onDedup) {
        onDedup({
          key,
          procedure: envelope.procedure,
          requestId: ctx.requestId,
          waitingCount: existing.waitingCount,
        })
      }

      // Wait for the existing request to complete
      // Clone the result to prevent mutation issues
      const result = await existing.promise
      return cloneResult(result)
    }

    // Create new pending request
    const promise = next()
      .then((result) => {
        // Keep result briefly for late arrivals
        setTimeout(() => pending.delete(key), 10)
        return result
      })
      .catch((error) => {
        // Remove on error so next request can retry
        pending.delete(key)
        throw error
      })

    pending.set(key, {
      promise,
      timestamp: Date.now(),
      waitingCount: 0,
    })

    return promise
  }
}

/**
 * Clone a result to prevent mutation between shared responses
 */
function cloneResult(result: unknown): unknown {
  if (result === null || result === undefined) {
    return result
  }

  if (typeof result !== 'object') {
    return result
  }

  // Handle arrays
  if (Array.isArray(result)) {
    return result.map(cloneResult)
  }

  // Handle plain objects
  try {
    return JSON.parse(JSON.stringify(result))
  } catch {
    // If cloning fails, return as-is (might cause issues but better than crashing)
    return result
  }
}

/**
 * Create a deduplication interceptor for read-only procedures
 *
 * Convenience wrapper that only deduplicates queries and
 * procedures matching common read patterns.
 *
 * @example
 * ```typescript
 * const dedup = createReadOnlyDedupInterceptor()
 * server.use(dedup)
 * ```
 */
export function createReadOnlyDedupInterceptor(config: Omit<DedupConfig, 'types' | 'procedures'> = {}): Interceptor {
  return createDedupInterceptor({
    ...config,
    types: ['query', 'procedure'],
    procedures: [
      '*.get',
      '*.get*',
      '*.find',
      '*.find*',
      '*.list',
      '*.list*',
      '*.search',
      '*.search*',
      '*.count',
      '*.count*',
      '*.exists',
      '*.check*',
      'read.**',
      'query.**',
      'fetch.**',
    ],
  })
}
