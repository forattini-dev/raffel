/**
 * Redis Cache Driver
 *
 * Duck-typed Redis driver that works with any Redis-like client.
 * Supports ioredis, node-redis, and other compatible clients.
 *
 * Features:
 * - Works with any Redis-compatible client
 * - Key prefixing for namespacing
 * - Optional compression
 * - Automatic TTL handling
 */

import zlib from 'node:zlib'

import type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  RedisDriverOptions,
  RedisLikeClient,
} from '../types.js'

/**
 * Entry stored in Redis
 */
interface RedisEntry {
  value: unknown
  expiresAt: number
  createdAt: number
  tags?: string[]
  compressed?: boolean
}

/**
 * Redis Cache Driver
 *
 * @example With ioredis
 * ```typescript
 * import Redis from 'ioredis'
 *
 * const redis = new Redis()
 * const cache = new RedisDriver({ client: redis })
 *
 * await cache.set('key', { data: 'value' }, 60000)
 * const result = await cache.get('key')
 * ```
 *
 * @example With node-redis
 * ```typescript
 * import { createClient } from 'redis'
 *
 * const redis = createClient()
 * await redis.connect()
 *
 * const cache = new RedisDriver({ client: redis })
 * ```
 */
export class RedisDriver implements CacheDriver {
  readonly name = 'redis'

  private readonly client: RedisLikeClient
  private readonly prefix: string
  private readonly compressionEnabled: boolean
  private readonly compressionThreshold: number

  // Stats
  private _stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
  }

  constructor(options: RedisDriverOptions) {
    if (!options.client) {
      throw new Error('[RedisDriver] Redis client is required')
    }

    this.client = options.client
    this.prefix = options.prefix ?? 'raffel:cache:'
    this.compressionEnabled = options.compression ?? false
    this.compressionThreshold = 1024
  }

  /**
   * Get a cached entry
   */
  async get(key: string): Promise<CacheGetResult | undefined> {
    try {
      const fullKey = this.getFullKey(key)
      const data = await this.client.get(fullKey)

      if (!data) {
        this._stats.misses++
        return undefined
      }

      const redisEntry: RedisEntry = JSON.parse(data)

      // Check expiration (Redis handles TTL, but double-check)
      if (Date.now() > redisEntry.expiresAt) {
        await this.client.del(fullKey)
        this._stats.misses++
        return undefined
      }

      // Decompress if needed
      let value = redisEntry.value
      if (redisEntry.compressed && typeof value === 'string') {
        const buffer = Buffer.from(value, 'base64')
        const decompressed = zlib.gunzipSync(buffer)
        value = JSON.parse(decompressed.toString('utf8'))
      }

      this._stats.hits++

      const entry: CacheEntry = {
        value,
        expiresAt: redisEntry.expiresAt,
        createdAt: redisEntry.createdAt,
        tags: redisEntry.tags,
      }

      return { entry, stale: false }
    } catch {
      this._stats.misses++
      return undefined
    }
  }

  /**
   * Set a cached entry
   */
  async set(key: string, value: unknown, ttlMs: number, tags?: string[]): Promise<void> {
    const now = Date.now()
    const fullKey = this.getFullKey(key)

    let finalValue: unknown = value
    let compressed = false

    // Compress if enabled
    if (this.compressionEnabled) {
      const serialized = JSON.stringify(value)
      if (serialized.length >= this.compressionThreshold) {
        const buffer = Buffer.from(serialized, 'utf8')
        const compressedBuffer = zlib.gzipSync(buffer)
        finalValue = compressedBuffer.toString('base64')
        compressed = true
      }
    }

    const redisEntry: RedisEntry = {
      value: finalValue,
      expiresAt: now + ttlMs,
      createdAt: now,
      tags,
      compressed,
    }

    const serialized = JSON.stringify(redisEntry)
    const ttlSeconds = Math.ceil(ttlMs / 1000)

    // Use SETEX if available, otherwise SET with EX
    if (this.client.setex) {
      await this.client.setex(fullKey, ttlSeconds, serialized)
    } else {
      await this.client.set(fullKey, serialized, 'EX', ttlSeconds)
    }

    this._stats.sets++
  }

  /**
   * Delete a cached entry
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key)
    await this.client.del(fullKey)
    this._stats.deletes++
  }

  /**
   * Clear all cached entries, or those matching a prefix
   */
  async clear(prefix?: string): Promise<void> {
    const pattern = prefix ? `${this.prefix}${prefix}*` : `${this.prefix}*`

    try {
      // Try using SCAN for large datasets
      if (this.client.scan) {
        let cursor = '0'
        do {
          const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
          cursor = nextCursor
          if (keys.length > 0) {
            await this.client.del(keys)
          }
        } while (cursor !== '0')
      } else if (this.client.keys) {
        // Fallback to KEYS (not recommended for large datasets)
        const keys = await this.client.keys(pattern)
        if (keys.length > 0) {
          await this.client.del(keys)
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key)
    try {
      const data = await this.client.get(fullKey)
      if (!data) return false

      const redisEntry: RedisEntry = JSON.parse(data)
      if (Date.now() > redisEntry.expiresAt) {
        await this.client.del(fullKey)
        return false
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern?: string): Promise<string[]> {
    const fullPattern = pattern ? `${this.prefix}${pattern}` : `${this.prefix}*`
    const prefixLength = this.prefix.length

    try {
      if (this.client.keys) {
        const keys = await this.client.keys(fullPattern)
        return keys.map((k) => k.slice(prefixLength))
      }
    } catch {
      // Ignore errors
    }

    return []
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this._stats.hits + this._stats.misses
    const hitRate = total > 0 ? this._stats.hits / total : 0

    return {
      ...this._stats,
      hitRate,
      totalItems: 0, // Would require SCAN to count
    }
  }

  /**
   * Shutdown the driver
   */
  async shutdown(): Promise<void> {
    if (this.client.quit) {
      await this.client.quit()
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }
}

/**
 * Create a Redis cache driver
 */
export function createRedisDriver(options: RedisDriverOptions): CacheDriver {
  return new RedisDriver(options)
}
