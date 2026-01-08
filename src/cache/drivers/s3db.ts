/**
 * S3DB Cache Driver
 *
 * Uses S3DB (S3-based document database) as a cache backend.
 * Ideal for serverless environments or when you need persistent,
 * distributed caching with S3's durability.
 *
 * Features:
 * - S3's durability and availability
 * - Works with S3-compatible storage (AWS, MinIO, R2, etc.)
 * - Optional compression
 * - Distributed cache out of the box
 */

import zlib from 'node:zlib'

import type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  S3DBDriverOptions,
  S3DBLikeClient,
} from '../types.js'

/**
 * Entry stored in S3DB
 */
interface S3DBEntry {
  value: unknown
  expiresAt: number
  createdAt: number
  tags?: string[]
  compressed?: boolean
}

/**
 * S3DB Cache Driver
 *
 * @example Basic usage
 * ```typescript
 * import { S3DB } from 's3db.js'
 *
 * const s3db = new S3DB({
 *   bucket: 'my-cache-bucket',
 *   region: 'us-east-1',
 * })
 *
 * const cache = new S3DBDriver({ s3db })
 *
 * await cache.set('key', { data: 'value' }, 60000)
 * const result = await cache.get('key')
 * ```
 */
export class S3DBDriver implements CacheDriver {
  readonly name = 's3db'

  private readonly s3db: S3DBLikeClient
  private readonly resource: string
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

  constructor(options: S3DBDriverOptions) {
    if (!options.s3db) {
      throw new Error('[S3DBDriver] S3DB instance is required')
    }

    this.s3db = options.s3db
    this.resource = options.resource ?? 'cache'
    this.compressionEnabled = options.compression ?? false
    this.compressionThreshold = 1024
  }

  /**
   * Get a cached entry
   */
  async get(key: string): Promise<CacheGetResult | undefined> {
    try {
      const data = await this.s3db.get(this.resource, key)

      if (!data) {
        this._stats.misses++
        return undefined
      }

      const s3dbEntry = data as S3DBEntry

      // Check expiration
      if (Date.now() > s3dbEntry.expiresAt) {
        // Expired - delete and return undefined
        await this.s3db.delete(this.resource, key).catch(() => {})
        this._stats.misses++
        return undefined
      }

      // Decompress if needed
      let value = s3dbEntry.value
      if (s3dbEntry.compressed && typeof value === 'string') {
        const buffer = Buffer.from(value, 'base64')
        const decompressed = zlib.gunzipSync(buffer)
        value = JSON.parse(decompressed.toString('utf8'))
      }

      this._stats.hits++

      const entry: CacheEntry = {
        value,
        expiresAt: s3dbEntry.expiresAt,
        createdAt: s3dbEntry.createdAt,
        tags: s3dbEntry.tags,
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

    const s3dbEntry: S3DBEntry = {
      value: finalValue,
      expiresAt: now + ttlMs,
      createdAt: now,
      tags,
      compressed,
    }

    await this.s3db.set(this.resource, key, s3dbEntry, {
      // S3DB might support TTL natively
      ttl: ttlMs,
    })

    this._stats.sets++
  }

  /**
   * Delete a cached entry
   */
  async delete(key: string): Promise<void> {
    await this.s3db.delete(this.resource, key)
    this._stats.deletes++
  }

  /**
   * Clear all cached entries, or those matching a prefix
   */
  async clear(prefix?: string): Promise<void> {
    try {
      if (!prefix && this.s3db.clear) {
        // Clear all
        await this.s3db.clear(this.resource)
      } else if (this.s3db.list) {
        // List and delete matching entries
        const items = (await this.s3db.list(this.resource, {
          prefix,
        })) as Array<{ id: string }>

        for (const item of items) {
          await this.s3db.delete(this.resource, item.id)
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
    try {
      const data = await this.s3db.get(this.resource, key)
      if (!data) return false

      const s3dbEntry = data as S3DBEntry
      if (Date.now() > s3dbEntry.expiresAt) {
        await this.s3db.delete(this.resource, key).catch(() => {})
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
    try {
      if (this.s3db.list) {
        const items = (await this.s3db.list(this.resource, {
          prefix: pattern,
        })) as Array<{ id: string }>

        return items.map((item) => item.id)
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
      totalItems: 0, // Would require listing to count
    }
  }

  /**
   * Shutdown the driver
   */
  async shutdown(): Promise<void> {
    // S3DB doesn't need explicit shutdown
  }
}

/**
 * Create an S3DB cache driver
 */
export function createS3DBDriver(options: S3DBDriverOptions): CacheDriver {
  return new S3DBDriver(options)
}
