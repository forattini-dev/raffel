/**
 * Cache Interceptor
 *
 * Protocol-agnostic response caching for procedures.
 * Reduces latency and load on downstream services by caching responses.
 *
 * Features:
 * - Pluggable driver system (memory, file, redis, s3db)
 * - In-memory LRU cache with TTL (default)
 * - Container-aware memory limits (Docker/K8s)
 * - Procedure pattern matching
 * - Custom key generation
 * - Stale-while-revalidate support
 * - Cache statistics and callbacks
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { CacheConfig, CacheStore } from '../types.js'
import type { CacheDriver, CacheDriverType, MemoryDriverOptions } from '../../cache/types.js'

/**
 * Cache event context for callbacks
 */
export interface CacheEventContext {
  /** The cache key */
  key: string
  /** The procedure name */
  procedure: string
  /** Request ID if available */
  requestId?: string
  /** Whether it was a cache hit */
  hit: boolean
  /** TTL in milliseconds (for sets) */
  ttlMs?: number
  /** Whether the cached value is stale (stale-while-revalidate) */
  stale?: boolean
}

/**
 * Extended cache configuration with callbacks and driver support
 */
export interface ExtendedCacheConfig extends CacheConfig {
  /**
   * Callback when cache is accessed
   * Useful for metrics and debugging
   */
  onAccess?: (info: CacheEventContext) => void

  /**
   * Procedure patterns to exclude from caching
   */
  excludeProcedures?: string[]

  /**
   * Only cache successful responses (default: true)
   */
  cacheSuccessOnly?: boolean

  /**
   * Grace period for stale-while-revalidate in ms (default: ttlMs / 2)
   */
  staleGraceMs?: number

  /**
   * Cache driver instance (new driver-based API)
   * Takes precedence over `store` if both are provided
   */
  driver?: CacheDriver

  /**
   * Driver type to use (creates driver automatically)
   * Only used if neither `store` nor `driver` is provided
   * @default 'memory'
   */
  driverType?: CacheDriverType

  /**
   * Options for the memory driver (when using driverType: 'memory')
   * For other drivers, use the `driver` option with a pre-configured driver
   */
  driverOptions?: MemoryDriverOptions
}

/**
 * In-memory cache entry
 */
interface CacheEntry {
  value: unknown
  expiresAt: number
  /** Timestamp when entry becomes stale (for SWR) */
  staleAt?: number
}

/**
 * Create an in-memory LRU cache store
 */
export function createMemoryCacheStore(maxEntries: number = 1000): CacheStore & {
  stats(): { size: number; maxEntries: number }
} {
  const cache = new Map<string, CacheEntry>()
  const accessOrder: string[] = []

  function updateAccessOrder(key: string): void {
    const idx = accessOrder.indexOf(key)
    if (idx > -1) {
      accessOrder.splice(idx, 1)
    }
    accessOrder.push(key)
  }

  function evictIfNeeded(): void {
    while (cache.size >= maxEntries && accessOrder.length > 0) {
      const oldest = accessOrder.shift()
      if (oldest) {
        cache.delete(oldest)
      }
    }
  }

  return {
    async get(key: string) {
      const entry = cache.get(key)
      if (!entry) {
        return undefined
      }

      // Check if expired
      if (Date.now() > entry.expiresAt) {
        cache.delete(key)
        const idx = accessOrder.indexOf(key)
        if (idx > -1) {
          accessOrder.splice(idx, 1)
        }
        return undefined
      }

      updateAccessOrder(key)
      return { value: entry.value, expiresAt: entry.expiresAt }
    },

    async set(key: string, value: unknown, ttlMs: number) {
      evictIfNeeded()

      const entry: CacheEntry = {
        value,
        expiresAt: Date.now() + ttlMs,
      }

      cache.set(key, entry)
      updateAccessOrder(key)
    },

    async delete(key: string) {
      cache.delete(key)
      const idx = accessOrder.indexOf(key)
      if (idx > -1) {
        accessOrder.splice(idx, 1)
      }
    },

    async clear() {
      cache.clear()
      accessOrder.length = 0
    },

    stats() {
      return {
        size: cache.size,
        maxEntries,
      }
    },
  }
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
    // If payload can't be stringified, return unique key (no cache)
    return Math.random().toString(36).slice(2)
  }
}

/**
 * Default key generator: procedure + payload hash
 */
function defaultKeyGenerator(envelope: Envelope): string {
  return `cache:${envelope.procedure}:${hashPayload(envelope.payload)}`
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
 * Clone a result to prevent mutation of cached data
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
    return result
  }
}

// Track pending revalidations to prevent thundering herd
const pendingRevalidations = new Map<string, Promise<unknown>>()

/**
 * Adapter to use a CacheDriver as a CacheStore
 * This allows the interceptor to work with both old and new APIs
 */
function createDriverAdapter(driver: CacheDriver): CacheStore {
  return {
    async get(key: string) {
      const result = await driver.get(key)
      if (!result) return undefined
      return {
        value: result.entry.value,
        expiresAt: result.entry.expiresAt,
      }
    },
    async set(key: string, value: unknown, ttlMs: number) {
      await driver.set(key, value, ttlMs)
    },
    async delete(key: string) {
      await driver.delete(key)
    },
    async clear() {
      await driver.clear()
    },
  }
}

/**
 * Create a cache store from driver config
 */
function createStoreFromConfig(config: ExtendedCacheConfig): CacheStore {
  // Priority 1: Explicit driver instance
  if (config.driver) {
    return createDriverAdapter(config.driver)
  }

  // Priority 2: Explicit store instance (legacy API)
  if (config.store) {
    return config.store
  }

  // Priority 3: Driver type with options (creates memory driver)
  if (config.driverType === 'memory' || !config.driverType) {
    // Use the advanced memory driver from cache module if options are provided
    if (config.driverOptions) {
      // Lazy load to avoid circular dependency
      const { MemoryDriver } = require('../../cache/drivers/memory.js')
      const driver = new MemoryDriver(config.driverOptions)
      return createDriverAdapter(driver)
    }
  }

  // Default: Simple in-memory store
  return createMemoryCacheStore(config.maxEntries ?? 1000)
}

/**
 * Create a cache interceptor
 *
 * Caches procedure responses to reduce latency and downstream load.
 *
 * @example
 * ```typescript
 * // Basic usage - cache everything for 1 minute
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 * })
 *
 * // Cache specific procedures
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   procedures: ['users.get', 'products.list', 'config.**'],
 * })
 *
 * // With custom key generation (e.g., per-user caching)
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   keyGenerator: (envelope) => {
 *     const userId = envelope.metadata['x-user-id'] ?? 'anonymous'
 *     return `${userId}:${envelope.procedure}:${JSON.stringify(envelope.payload)}`
 *   },
 * })
 *
 * // With stale-while-revalidate
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   staleWhileRevalidate: true,
 *   staleGraceMs: 30000, // Serve stale data for 30s while revalidating
 * })
 *
 * // With Redis driver (new API)
 * import { createDriver } from 'raffel/cache'
 * const redisDriver = await createDriver('redis', { client: redisClient })
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   driver: redisDriver,
 * })
 *
 * // With advanced memory driver
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   driverOptions: {
 *     maxSize: 5000,
 *     maxMemoryPercent: 0.1,  // 10% of system RAM
 *     evictionPolicy: 'lru',
 *     compression: true,
 *   },
 * })
 *
 * // With metrics
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   onAccess: ({ hit, procedure }) => {
 *     metrics.increment(hit ? 'cache.hit' : 'cache.miss', { procedure })
 *   },
 * })
 *
 * server.use(cache)
 * ```
 */
export function createCacheInterceptor(config: ExtendedCacheConfig = {}): Interceptor {
  const {
    ttlMs = 60000,
    procedures,
    excludeProcedures = [],
    keyGenerator = defaultKeyGenerator,
    staleWhileRevalidate = false,
    staleGraceMs,
    onAccess,
    cacheSuccessOnly = true,
  } = config

  // Create cache store (supports both legacy store API and new driver API)
  const cacheStore = createStoreFromConfig(config)

  // Calculate stale grace period
  const effectiveStaleGraceMs = staleGraceMs ?? Math.floor(ttlMs / 2)

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
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

    // Generate cache key
    const key = keyGenerator(envelope)

    // Try to get from cache
    const cached = await cacheStore.get(key)

    if (cached) {
      const now = Date.now()
      const isExpired = now > cached.expiresAt

      // If not expired, return cached value
      if (!isExpired) {
        if (onAccess) {
          onAccess({
            key,
            procedure: envelope.procedure,
            requestId: ctx.requestId,
            hit: true,
            stale: false,
          })
        }
        return cloneResult(cached.value)
      }

      // Stale-while-revalidate logic
      if (staleWhileRevalidate && now < cached.expiresAt + effectiveStaleGraceMs) {
        if (onAccess) {
          onAccess({
            key,
            procedure: envelope.procedure,
            requestId: ctx.requestId,
            hit: true,
            stale: true,
          })
        }

        // Check if revalidation is already in progress
        if (!pendingRevalidations.has(key)) {
          // Start background revalidation
          const revalidationPromise = next()
            .then(async (result) => {
              // Only cache successful results
              await cacheStore.set(key, result, ttlMs)
              return result
            })
            .catch((error) => {
              // On error, keep the stale value
              console.error(`Cache revalidation failed for ${key}:`, error)
            })
            .finally(() => {
              pendingRevalidations.delete(key)
            })

          pendingRevalidations.set(key, revalidationPromise)
        }

        // Return stale value immediately
        return cloneResult(cached.value)
      }
    }

    // Cache miss - execute handler
    if (onAccess) {
      onAccess({
        key,
        procedure: envelope.procedure,
        requestId: ctx.requestId,
        hit: false,
      })
    }

    try {
      const result = await next()

      // Cache the result (clone to prevent mutation)
      if (!cacheSuccessOnly || isSuccessfulResult(result)) {
        await cacheStore.set(key, cloneResult(result), ttlMs)
      }

      return result
    } catch (error) {
      // Don't cache errors
      throw error
    }
  }
}

/**
 * Check if a result is successful (not an error envelope)
 */
function isSuccessfulResult(result: unknown): boolean {
  if (result === null || result === undefined) {
    return true
  }

  if (typeof result === 'object' && 'type' in result) {
    return (result as { type: string }).type !== 'error'
  }

  return true
}

/**
 * Create a read-through cache interceptor
 *
 * Convenience wrapper that only caches read operations
 * (procedures matching common read patterns).
 *
 * @example
 * ```typescript
 * const cache = createReadThroughCacheInterceptor({
 *   ttlMs: 60000,
 * })
 * server.use(cache)
 * ```
 */
export function createReadThroughCacheInterceptor(
  config: Omit<ExtendedCacheConfig, 'procedures'> = {}
): Interceptor {
  return createCacheInterceptor({
    ...config,
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
    // Exclude mutations
    excludeProcedures: [
      '*.create*',
      '*.update*',
      '*.delete*',
      '*.remove*',
      '*.save*',
      '*.set*',
      '*.put*',
      '*.post*',
      '*.patch*',
      'write.**',
      'mutation.**',
    ],
  })
}

/**
 * Create cache presets for common use cases
 */
export const CachePresets = {
  /**
   * Short-lived cache (5 seconds) for frequently changing data
   */
  short: {
    ttlMs: 5000,
    staleWhileRevalidate: true,
    staleGraceMs: 2000,
  } as ExtendedCacheConfig,

  /**
   * Standard cache (1 minute) for general purpose
   */
  standard: {
    ttlMs: 60000,
    staleWhileRevalidate: true,
    staleGraceMs: 30000,
  } as ExtendedCacheConfig,

  /**
   * Long-lived cache (5 minutes) for stable data
   */
  long: {
    ttlMs: 300000,
    staleWhileRevalidate: true,
    staleGraceMs: 120000,
  } as ExtendedCacheConfig,

  /**
   * Aggressive cache (1 hour) for rarely changing data
   */
  aggressive: {
    ttlMs: 3600000,
    staleWhileRevalidate: true,
    staleGraceMs: 1800000,
  } as ExtendedCacheConfig,

  /**
   * No stale - strict TTL without SWR
   */
  strict: {
    ttlMs: 60000,
    staleWhileRevalidate: false,
    maxEntries: 500,
  } as ExtendedCacheConfig,
}

/**
 * Cache invalidation helper
 *
 * Use this to manually invalidate cache entries.
 *
 * @example
 * ```typescript
 * const store = createMemoryCacheStore(1000)
 * const cache = createCacheInterceptor({ store })
 * const invalidator = createCacheInvalidator(store)
 *
 * // In a mutation handler:
 * async function updateUser(input, ctx) {
 *   await db.users.update(input)
 *   // Invalidate related cache entries
 *   await invalidator.invalidatePattern('cache:users.get:*')
 *   return { success: true }
 * }
 * ```
 */
export function createCacheInvalidator(store: CacheStore) {
  return {
    /**
     * Invalidate a specific cache key
     */
    async invalidate(key: string): Promise<void> {
      await store.delete(key)
    },

    /**
     * Clear all cache entries
     */
    async invalidateAll(): Promise<void> {
      await store.clear()
    },

    /**
     * Note: Pattern-based invalidation requires store support
     * The default memory store doesn't support patterns.
     * Use Redis or similar for pattern-based invalidation.
     */
  }
}
