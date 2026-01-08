/**
 * Cache Driver Types
 *
 * Protocol-agnostic cache abstraction with pluggable drivers.
 * Inspired by Recker's cache architecture.
 */

/**
 * Cache entry stored by drivers
 */
export interface CacheEntry {
  /** The cached value (JSON-serializable) */
  value: unknown
  /** When the entry expires (Unix timestamp in ms) */
  expiresAt: number
  /** When the entry was created */
  createdAt: number
  /** Optional tags for grouping/invalidation */
  tags?: string[]
}

/**
 * Result from cache get operations
 */
export interface CacheGetResult {
  /** The cached entry */
  entry: CacheEntry
  /** Whether the entry is stale (past TTL but within grace period) */
  stale?: boolean
}

/**
 * Cache driver interface
 *
 * All drivers must implement these core methods.
 * Drivers handle serialization, storage, and cleanup internally.
 */
export interface CacheDriver {
  /** Driver name for identification */
  readonly name: string

  /**
   * Get a cached entry
   * @returns The cached entry or undefined if not found/expired
   */
  get(key: string): Promise<CacheGetResult | undefined>

  /**
   * Set a cached entry
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Time to live in milliseconds
   * @param tags - Optional tags for grouping
   */
  set(key: string, value: unknown, ttlMs: number, tags?: string[]): Promise<void>

  /**
   * Delete a cached entry
   */
  delete(key: string): Promise<void>

  /**
   * Clear all entries or entries matching a prefix
   */
  clear(prefix?: string): Promise<void>

  /**
   * Check if a key exists (without fetching value)
   */
  has?(key: string): Promise<boolean>

  /**
   * Get all keys matching a pattern (for debugging/admin)
   */
  keys?(pattern?: string): Promise<string[]>

  /**
   * Get driver statistics
   */
  stats?(): CacheStats

  /**
   * Shutdown the driver (cleanup timers, connections, etc.)
   */
  shutdown?(): Promise<void>
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Number of cache hits */
  hits: number
  /** Number of cache misses */
  misses: number
  /** Number of sets */
  sets: number
  /** Number of deletes */
  deletes: number
  /** Number of evictions */
  evictions: number
  /** Hit rate (0-1) */
  hitRate: number
  /** Total items in cache */
  totalItems: number
  /** Current memory usage in bytes (if tracked) */
  memoryUsageBytes?: number
  /** Maximum memory limit in bytes (if configured) */
  maxMemoryBytes?: number
}

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  currentMemoryBytes: number
  maxMemoryBytes: number
  memoryUsagePercent: number
  totalItems: number
  maxSize: number
  evictedDueToMemory: number
  memoryPressureEvents: number
  averageItemSize: number
}

/**
 * Compression statistics
 */
export interface CompressionStats {
  enabled: boolean
  totalItems: number
  compressedItems: number
  compressionThreshold: number
  totalOriginalSize: number
  totalCompressedSize: number
  compressionRatio: number
  spaceSavingsPercent: number
}

/**
 * Eviction policy for memory driver
 */
export type EvictionPolicy = 'lru' | 'fifo'

/**
 * Compression configuration
 */
export interface CompressionConfig {
  /** Enable compression */
  enabled: boolean
  /** Minimum size in bytes to trigger compression (default: 1024) */
  threshold?: number
}

/**
 * Memory driver options
 */
export interface MemoryDriverOptions {
  /**
   * Maximum number of items to store
   * @default 1000
   */
  maxSize?: number

  /**
   * Maximum memory usage in bytes (0 = use auto-calculated limit)
   * Cannot be used together with maxMemoryPercent
   */
  maxMemoryBytes?: number

  /**
   * Maximum memory as fraction of system memory (0-1)
   * Example: 0.1 = 10% of system RAM
   * Cannot be used together with maxMemoryBytes
   */
  maxMemoryPercent?: number

  /**
   * Eviction policy when cache is full
   * @default 'lru'
   */
  evictionPolicy?: EvictionPolicy

  /**
   * Compression configuration
   */
  compression?: boolean | CompressionConfig

  /**
   * Enable statistics tracking
   * @default false
   */
  enableStats?: boolean

  /**
   * Interval in ms for memory health checks
   * Set to 0 to disable periodic checks
   * @default 15000
   */
  monitorInterval?: number

  /**
   * Evict cache when V8 heap usage exceeds this threshold (0-1)
   * @default 0.6
   */
  heapUsageThreshold?: number

  /**
   * Interval in ms to clean up expired items
   * @default 60000
   */
  cleanupInterval?: number

  /**
   * Callback when items are evicted
   */
  onEvict?: (info: EvictionInfo) => void

  /**
   * Callback when memory pressure is detected
   */
  onPressure?: (info: PressureInfo) => void
}

/**
 * Eviction event information
 */
export interface EvictionInfo {
  reason: 'size' | 'memory' | 'heap' | 'expired'
  key?: string
  freedBytes: number
  currentBytes: number
  maxMemoryBytes: number
}

/**
 * Memory pressure event information
 */
export interface PressureInfo {
  reason: 'limit' | 'heap'
  heapLimit: number
  heapUsed: number
  heapRatio?: number
  currentBytes: number
  maxMemoryBytes: number
  freedBytes: number
}

/**
 * File driver options
 */
export interface FileDriverOptions {
  /**
   * Directory to store cache files
   * @default '.cache'
   */
  directory?: string

  /**
   * Maximum number of files to keep
   * @default 10000
   */
  maxFiles?: number

  /**
   * Maximum total size in bytes
   */
  maxSizeBytes?: number

  /**
   * Enable compression for files
   */
  compression?: boolean

  /**
   * Cleanup interval in ms
   * @default 300000 (5 minutes)
   */
  cleanupInterval?: number
}

/**
 * Redis driver options
 *
 * Duck-typed: accepts any Redis-like client with get/set/del methods.
 */
export interface RedisDriverOptions {
  /**
   * Redis client instance (ioredis, node-redis, etc.)
   * Must implement: get, set, del, keys, scan methods
   */
  client: RedisLikeClient

  /**
   * Key prefix for namespacing
   * @default 'raffel:cache:'
   */
  prefix?: string

  /**
   * Enable compression before storing
   */
  compression?: boolean
}

/**
 * Duck-typed Redis client interface
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode?: string, duration?: number): Promise<unknown>
  setex?(key: string, seconds: number, value: string): Promise<unknown>
  del(key: string | string[]): Promise<number>
  keys?(pattern: string): Promise<string[]>
  scan?(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>
  quit?(): Promise<unknown>
}

/**
 * S3DB driver options
 */
export interface S3DBDriverOptions {
  /**
   * S3DB instance
   */
  s3db: S3DBLikeClient

  /**
   * Resource name for cache entries
   * @default 'cache'
   */
  resource?: string

  /**
   * Enable compression
   */
  compression?: boolean
}

/**
 * Duck-typed S3DB client interface
 */
export interface S3DBLikeClient {
  get(resource: string, key: string): Promise<unknown>
  set(resource: string, key: string, value: unknown, options?: object): Promise<void>
  delete(resource: string, key: string): Promise<void>
  list?(resource: string, options?: object): Promise<unknown[]>
  clear?(resource: string): Promise<void>
}

/**
 * Cache driver type union
 */
export type CacheDriverType = 'memory' | 'file' | 'redis' | 's3db'

/**
 * Cache driver configuration
 */
export type CacheDriverConfig =
  | { driver: 'memory'; options?: MemoryDriverOptions }
  | { driver: 'file'; options?: FileDriverOptions }
  | { driver: 'redis'; options: RedisDriverOptions }
  | { driver: 's3db'; options: S3DBDriverOptions }
