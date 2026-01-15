/**
 * Memory Cache Driver
 *
 * High-performance, memory-aware cache implementation ported from Recker.
 *
 * Features:
 * - LRU (Least Recently Used) and FIFO eviction policies
 * - Memory limits (bytes, percentage, or auto-calculated)
 * - Container-aware (cgroup detection for Docker/K8s)
 * - V8 heap pressure monitoring
 * - Optional gzip compression
 * - Comprehensive statistics
 */

import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import v8 from 'node:v8'

import type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  MemoryStats,
  CompressionStats,
  MemoryDriverOptions,
  EvictionInfo,
  PressureInfo,
} from '../types.js'

/** Default: Use up to 50% of effective memory */
const DEFAULT_TOTAL_PERCENT = 0.5

/** Default: Cap at 60% of V8 heap limit */
const DEFAULT_HEAP_PERCENT = 0.6

/**
 * Internal metadata for cached items
 */
interface CacheMetadata {
  createdAt: number
  expiresAt: number
  lastAccess: number
  insertOrder: number
  accessOrder: number
  compressed: boolean
  originalSize: number
  compressedSize: number
  tags?: string[]
}

/**
 * Compressed data wrapper
 */
interface CompressedData {
  __compressed: true
  __data: string
  __originalSize: number
}

/**
 * Read cgroup memory limit (v2 first, fallback to v1)
 * Used to detect container memory limits in Docker/Kubernetes
 */
function readCgroupLimit(): number | null {
  const candidates = [
    '/sys/fs/cgroup/memory.max', // cgroup v2
    '/sys/fs/cgroup/memory/memory.limit_in_bytes', // cgroup v1
  ]

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8').trim()
        if (!raw || raw === 'max') continue
        const value = Number.parseInt(raw, 10)
        if (Number.isFinite(value) && value > 0) {
          return value
        }
      }
    } catch {
      // Ignore and continue to next candidate
    }
  }

  return null
}

/**
 * Get effective memory limit that takes container cgroups into account.
 * Falls back to os.totalmem() when no container limit is imposed.
 */
function getEffectiveTotalMemoryBytes(): number {
  const cgroupLimit = readCgroupLimit()
  if (cgroupLimit && Number.isFinite(cgroupLimit) && cgroupLimit > 0) {
    return cgroupLimit
  }
  return os.totalmem()
}

/**
 * Get current V8 heap statistics
 */
function getHeapStats(): { heapUsed: number; heapLimit: number; heapRatio: number } {
  const heapStats = v8.getHeapStatistics()
  const { heapUsed } = process.memoryUsage()
  const heapLimit = heapStats?.heap_size_limit ?? 0
  const heapRatio = heapLimit > 0 ? heapUsed / heapLimit : 0

  return { heapUsed, heapLimit, heapRatio }
}

/**
 * Compute safe cache memory boundaries
 */
function resolveCacheMemoryLimit(options: {
  maxMemoryBytes?: number
  maxMemoryPercent?: number
}): { maxMemoryBytes: number; inferredPercent: number } {
  const { maxMemoryBytes, maxMemoryPercent } = options

  const heapStats = v8.getHeapStatistics()
  const heapLimit = heapStats?.heap_size_limit ?? 0
  const effectiveTotal = getEffectiveTotalMemoryBytes()

  let resolvedBytes = 0

  // Priority 1: Explicit bytes limit
  if (typeof maxMemoryBytes === 'number' && maxMemoryBytes > 0) {
    resolvedBytes = maxMemoryBytes
  }
  // Priority 2: Percentage of system memory
  else if (typeof maxMemoryPercent === 'number' && maxMemoryPercent > 0) {
    const percent = Math.max(0, Math.min(maxMemoryPercent, 1))
    resolvedBytes = Math.floor(effectiveTotal * percent)
  }

  // Apply safety cap based on total memory
  const totalCap = Math.floor(effectiveTotal * DEFAULT_TOTAL_PERCENT)
  if (resolvedBytes === 0 || totalCap < resolvedBytes) {
    resolvedBytes = totalCap
  }

  // Apply V8 heap cap (prevent Node.js OOM)
  if (heapLimit > 0) {
    const heapCap = Math.floor(heapLimit * DEFAULT_HEAP_PERCENT)
    if (resolvedBytes === 0 || heapCap < resolvedBytes) {
      resolvedBytes = heapCap
    }
  }

  // Guard against zero/negative values
  if (!Number.isFinite(resolvedBytes) || resolvedBytes <= 0) {
    resolvedBytes = Math.floor(effectiveTotal * DEFAULT_TOTAL_PERCENT)
  }

  const inferredPercent = effectiveTotal > 0 ? resolvedBytes / effectiveTotal : 0

  return { maxMemoryBytes: resolvedBytes, inferredPercent }
}

/**
 * Memory Cache Driver
 *
 * @example Basic usage
 * ```typescript
 * const cache = new MemoryDriver()
 * await cache.set('key', { data: 'value' }, 60000)
 * const result = await cache.get('key')
 * ```
 *
 * @example Advanced configuration
 * ```typescript
 * const cache = new MemoryDriver({
 *   maxSize: 5000,
 *   maxMemoryPercent: 0.1,      // 10% of system RAM
 *   evictionPolicy: 'lru',
 *   compression: { enabled: true, threshold: 512 },
 *   enableStats: true,
 *   monitorInterval: 30000
 * })
 * ```
 */
export class MemoryDriver implements CacheDriver {
  readonly name = 'memory'

  // Storage
  private storage = new Map<string, string | CompressedData>()
  private meta = new Map<string, CacheMetadata>()

  // Configuration
  private readonly maxSize: number
  private readonly maxMemoryBytes: number
  private readonly maxMemoryPercent: number
  private readonly evictionPolicy: 'lru' | 'fifo'
  private readonly compressionEnabled: boolean
  private readonly compressionThreshold: number
  private readonly enableStats: boolean
  private readonly heapUsageThreshold: number

  // Callbacks
  private readonly onEvict?: (info: EvictionInfo) => void
  private readonly onPressure?: (info: PressureInfo) => void

  // Tracking
  private currentMemoryBytes = 0
  private evictedDueToMemory = 0
  private memoryPressureEvents = 0
  private accessCounter = 0

  // Timers
  private monitorHandle: ReturnType<typeof setInterval> | null = null
  private cleanupHandle: ReturnType<typeof setInterval> | null = null

  // Stats
  private _stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
  }

  // Compression stats
  private compressionStatsData = {
    totalCompressed: 0,
    totalOriginalSize: 0,
    totalCompressedSize: 0,
  }

  constructor(options: MemoryDriverOptions = {}) {
    // Validate mutually exclusive options
    if (
      options.maxMemoryBytes &&
      options.maxMemoryBytes > 0 &&
      options.maxMemoryPercent &&
      options.maxMemoryPercent > 0
    ) {
      throw new Error('[MemoryDriver] Cannot use both maxMemoryBytes and maxMemoryPercent')
    }

    // Validate maxMemoryPercent range
    if (
      options.maxMemoryPercent !== undefined &&
      (options.maxMemoryPercent < 0 || options.maxMemoryPercent > 1)
    ) {
      throw new Error('[MemoryDriver] maxMemoryPercent must be between 0 and 1')
    }

    // Basic config
    this.maxSize = options.maxSize ?? 1000
    this.evictionPolicy = options.evictionPolicy ?? 'lru'
    this.enableStats = options.enableStats ?? false
    this.heapUsageThreshold = options.heapUsageThreshold ?? 0.6

    // Memory limits
    if (options.maxMemoryBytes && options.maxMemoryBytes > 0) {
      this.maxMemoryBytes = options.maxMemoryBytes
      this.maxMemoryPercent = 0
    } else if (options.maxMemoryPercent && options.maxMemoryPercent > 0) {
      const effectiveTotal = getEffectiveTotalMemoryBytes()
      this.maxMemoryBytes = Math.floor(effectiveTotal * options.maxMemoryPercent)
      this.maxMemoryPercent = options.maxMemoryPercent
    } else {
      // Auto-calculate safe limit
      const resolved = resolveCacheMemoryLimit({})
      this.maxMemoryBytes = resolved.maxMemoryBytes
      this.maxMemoryPercent = resolved.inferredPercent
    }

    // Compression
    if (options.compression === true) {
      this.compressionEnabled = true
      this.compressionThreshold = 1024
    } else if (typeof options.compression === 'object' && options.compression.enabled) {
      this.compressionEnabled = true
      this.compressionThreshold = options.compression.threshold ?? 1024
    } else {
      this.compressionEnabled = false
      this.compressionThreshold = 1024
    }

    // Callbacks
    this.onEvict = options.onEvict
    this.onPressure = options.onPressure

    // Start monitor interval
    const monitorInterval = options.monitorInterval ?? 15000
    if (monitorInterval > 0) {
      this.monitorHandle = setInterval(() => this.memoryHealthCheck(), monitorInterval)
      this.monitorHandle.unref()
    }

    // Start cleanup interval
    const cleanupInterval = options.cleanupInterval ?? 60000
    if (cleanupInterval > 0) {
      this.cleanupHandle = setInterval(() => this.cleanupExpired(), cleanupInterval)
      this.cleanupHandle.unref()
    }
  }

  /**
   * Get a cached entry
   */
  async get(key: string): Promise<CacheGetResult | undefined> {
    const data = this.storage.get(key)
    const metadata = this.meta.get(key)

    if (!data || !metadata) {
      this.recordStat('misses')
      return undefined
    }

    // Check expiration
    const now = Date.now()
    if (now > metadata.expiresAt) {
      // Expired - remove and return undefined
      this.deleteInternal(key)
      this.recordStat('misses')
      return undefined
    }

    // Update LRU access order
    if (this.evictionPolicy === 'lru') {
      metadata.lastAccess = now
      metadata.accessOrder = ++this.accessCounter
    }

    this.recordStat('hits')

    // Decompress if needed
    let value: unknown
    if (this.isCompressed(data)) {
      try {
        const decompressed = this.decompress(data)
        value = JSON.parse(decompressed)
      } catch {
        // Corrupted entry - remove it
        this.deleteInternal(key)
        return undefined
      }
    } else {
      value = JSON.parse(data)
    }

    const entry: CacheEntry = {
      value,
      expiresAt: metadata.expiresAt,
      createdAt: metadata.createdAt,
      tags: metadata.tags,
    }

    return { entry, stale: false }
  }

  /**
   * Set a cached entry
   */
  async set(key: string, value: unknown, ttlMs: number, tags?: string[]): Promise<void> {
    const now = Date.now()

    // Serialize
    const serialized = JSON.stringify(value)
    const originalSize = Buffer.byteLength(serialized, 'utf8')

    // Prepare data (potentially compressed)
    let finalData: string | CompressedData = serialized
    let compressedSize = originalSize
    let compressed = false

    if (this.compressionEnabled && originalSize >= this.compressionThreshold) {
      try {
        const result = this.compress(serialized)
        finalData = result
        compressedSize = Buffer.byteLength(result.__data, 'utf8')
        compressed = true

        this.compressionStatsData.totalCompressed++
        this.compressionStatsData.totalOriginalSize += originalSize
        this.compressionStatsData.totalCompressedSize += compressedSize
      } catch {
        // Compression failed - store uncompressed
      }
    }

    // If updating existing key, subtract old size
    const existingMeta = this.meta.get(key)
    if (existingMeta) {
      this.currentMemoryBytes -= existingMeta.compressedSize
    }

    // Check if new item fits
    if (!this.enforceMemoryLimit(compressedSize)) {
      // Item too large or can't make room
      this.evictedDueToMemory++
      return
    }

    // Enforce max size (item count)
    if (!existingMeta && this.storage.size >= this.maxSize) {
      this.evictOne('size')
    }

    // Store
    this.storage.set(key, finalData)
    this.meta.set(key, {
      createdAt: now,
      expiresAt: now + ttlMs,
      lastAccess: now,
      insertOrder: ++this.accessCounter,
      accessOrder: this.accessCounter,
      compressed,
      originalSize,
      compressedSize,
      tags,
    })

    this.currentMemoryBytes += compressedSize
    this.recordStat('sets')
  }

  /**
   * Delete a cached entry
   */
  async delete(key: string): Promise<void> {
    this.deleteInternal(key)
    this.recordStat('deletes')
  }

  /**
   * Clear all cached entries, or those matching a prefix
   */
  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.storage.clear()
      this.meta.clear()
      this.currentMemoryBytes = 0
      this.evictedDueToMemory = 0
      if (this.enableStats) {
        this._stats = { hits: 0, misses: 0, sets: 0, deletes: 0, evictions: 0 }
      }
      return
    }

    // Clear by prefix
    for (const key of this.storage.keys()) {
      if (key.startsWith(prefix)) {
        this.deleteInternal(key)
      }
    }
  }

  /**
   * Check if a key exists (without updating LRU)
   */
  async has(key: string): Promise<boolean> {
    const meta = this.meta.get(key)
    if (!meta) return false
    if (Date.now() > meta.expiresAt) {
      this.deleteInternal(key)
      return false
    }
    return true
  }

  /**
   * Get all keys matching a pattern
   */
  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.storage.keys())
    if (!pattern) return allKeys

    // Simple glob pattern matching
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '{{DOUBLE_STAR}}')
          .replace(/\*/g, '[^:]*')
          .replace(/{{DOUBLE_STAR}}/g, '.*') +
        '$'
    )

    return allKeys.filter((key) => regex.test(key))
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
      totalItems: this.storage.size,
      memoryUsageBytes: this.currentMemoryBytes,
      maxMemoryBytes: this.maxMemoryBytes,
    }
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): MemoryStats {
    const totalItems = this.storage.size
    const memoryUsagePercent =
      this.maxMemoryBytes > 0 ? (this.currentMemoryBytes / this.maxMemoryBytes) * 100 : 0

    return {
      currentMemoryBytes: this.currentMemoryBytes,
      maxMemoryBytes: this.maxMemoryBytes,
      maxMemoryPercent: this.maxMemoryPercent || undefined,
      memoryUsagePercent: parseFloat(memoryUsagePercent.toFixed(2)),
      totalItems,
      maxSize: this.maxSize,
      evictedDueToMemory: this.evictedDueToMemory,
      memoryPressureEvents: this.memoryPressureEvents,
      averageItemSize: totalItems > 0 ? Math.round(this.currentMemoryBytes / totalItems) : 0,
    }
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(): CompressionStats {
    if (!this.compressionEnabled) {
      return {
        enabled: false,
        totalItems: this.storage.size,
        compressedItems: 0,
        compressionThreshold: this.compressionThreshold,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        compressionRatio: 0,
        spaceSavingsPercent: 0,
      }
    }

    const ratio =
      this.compressionStatsData.totalOriginalSize > 0
        ? this.compressionStatsData.totalCompressedSize /
          this.compressionStatsData.totalOriginalSize
        : 0

    const savings =
      this.compressionStatsData.totalOriginalSize > 0
        ? ((this.compressionStatsData.totalOriginalSize -
            this.compressionStatsData.totalCompressedSize) /
            this.compressionStatsData.totalOriginalSize) *
          100
        : 0

    return {
      enabled: true,
      totalItems: this.storage.size,
      compressedItems: this.compressionStatsData.totalCompressed,
      compressionThreshold: this.compressionThreshold,
      totalOriginalSize: this.compressionStatsData.totalOriginalSize,
      totalCompressedSize: this.compressionStatsData.totalCompressedSize,
      compressionRatio: parseFloat(ratio.toFixed(2)),
      spaceSavingsPercent: parseFloat(savings.toFixed(2)),
    }
  }

  /**
   * Shutdown the cache, cleaning up timers
   */
  async shutdown(): Promise<void> {
    if (this.monitorHandle) {
      clearInterval(this.monitorHandle)
      this.monitorHandle = null
    }
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle)
      this.cleanupHandle = null
    }
  }

  /**
   * Get the current size of the cache
   */
  size(): number {
    return this.storage.size
  }

  // ─────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────

  private deleteInternal(key: string): void {
    const meta = this.meta.get(key)
    if (meta) {
      this.currentMemoryBytes -= meta.compressedSize
    }
    this.storage.delete(key)
    this.meta.delete(key)
  }

  private recordStat(type: keyof typeof this._stats): void {
    if (this.enableStats) {
      this._stats[type]++
    }
  }

  private isCompressed(data: string | CompressedData): data is CompressedData {
    return typeof data === 'object' && data !== null && '__compressed' in data
  }

  private compress(data: string): CompressedData {
    const buffer = Buffer.from(data, 'utf8')
    const compressed = zlib.gzipSync(buffer)
    return {
      __compressed: true,
      __data: compressed.toString('base64'),
      __originalSize: buffer.length,
    }
  }

  private decompress(data: CompressedData): string {
    const buffer = Buffer.from(data.__data, 'base64')
    const decompressed = zlib.gunzipSync(buffer)
    return decompressed.toString('utf8')
  }

  /**
   * Select the best candidate for eviction based on policy
   */
  private selectEvictionCandidate(): string | null {
    if (this.meta.size === 0) return null

    let candidate: string | null = null
    let candidateValue = Infinity

    for (const [key, meta] of this.meta) {
      const value = this.evictionPolicy === 'lru' ? meta.accessOrder : meta.insertOrder
      if (value < candidateValue) {
        candidateValue = value
        candidate = key
      }
    }

    return candidate
  }

  /**
   * Evict one item based on policy
   */
  private evictOne(reason: 'size' | 'memory' | 'heap'): { key: string; freedBytes: number } | null {
    const candidate = this.selectEvictionCandidate()
    if (!candidate) return null

    const meta = this.meta.get(candidate)
    const freedBytes = meta?.compressedSize ?? 0

    this.deleteInternal(candidate)
    this._stats.evictions++

    if (reason === 'memory' || reason === 'heap') {
      this.evictedDueToMemory++
    }

    this.onEvict?.({
      reason,
      key: candidate,
      freedBytes,
      currentBytes: this.currentMemoryBytes,
      maxMemoryBytes: this.maxMemoryBytes,
    })

    return { key: candidate, freedBytes }
  }

  /**
   * Enforce memory limit, evicting items until space is available
   */
  private enforceMemoryLimit(incomingSize: number): boolean {
    // If the single item exceeds the limit, reject it
    if (incomingSize > this.maxMemoryBytes) {
      return false
    }

    // Evict until we have room
    while (
      this.currentMemoryBytes + incomingSize > this.maxMemoryBytes &&
      this.storage.size > 0
    ) {
      const result = this.evictOne('memory')
      if (!result) break
    }

    return this.currentMemoryBytes + incomingSize <= this.maxMemoryBytes
  }

  /**
   * Reduce memory to target bytes
   */
  private reduceMemoryTo(targetBytes: number): number {
    targetBytes = Math.max(0, targetBytes)
    let freedBytes = 0

    while (this.currentMemoryBytes > targetBytes && this.storage.size > 0) {
      const result = this.evictOne('memory')
      if (!result) break
      freedBytes += result.freedBytes
    }

    return freedBytes
  }

  /**
   * Periodic memory health check
   */
  private memoryHealthCheck(): number {
    let totalFreed = 0

    // Check memory limit
    if (this.currentMemoryBytes > this.maxMemoryBytes) {
      const before = this.currentMemoryBytes
      this.enforceMemoryLimit(0)
      const freed = before - this.currentMemoryBytes
      if (freed > 0) {
        totalFreed += freed
        this.memoryPressureEvents++
        this.onPressure?.({
          reason: 'limit',
          heapLimit: getHeapStats().heapLimit,
          heapUsed: getHeapStats().heapUsed,
          currentBytes: this.currentMemoryBytes,
          maxMemoryBytes: this.maxMemoryBytes,
          freedBytes: freed,
        })
      }
    }

    // Check V8 heap pressure
    const { heapUsed, heapLimit, heapRatio } = getHeapStats()
    if (heapLimit > 0 && heapRatio >= this.heapUsageThreshold) {
      const before = this.currentMemoryBytes
      const target = Math.floor(this.currentMemoryBytes * 0.5)
      this.reduceMemoryTo(target)
      const freed = before - this.currentMemoryBytes
      if (freed > 0) {
        totalFreed += freed
        this.memoryPressureEvents++
        this.onPressure?.({
          reason: 'heap',
          heapLimit,
          heapUsed,
          heapRatio,
          currentBytes: this.currentMemoryBytes,
          maxMemoryBytes: this.maxMemoryBytes,
          freedBytes: freed,
        })
      }
    }

    return totalFreed
  }

  /**
   * Clean up expired items
   */
  private cleanupExpired(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [key, meta] of this.meta) {
      if (now > meta.expiresAt) {
        this.deleteInternal(key)
        cleaned++
        this.onEvict?.({
          reason: 'expired',
          key,
          freedBytes: meta.compressedSize,
          currentBytes: this.currentMemoryBytes,
          maxMemoryBytes: this.maxMemoryBytes,
        })
      }
    }

    return cleaned
  }
}

/**
 * Create a memory cache driver
 */
export function createMemoryDriver(options?: MemoryDriverOptions): CacheDriver {
  return new MemoryDriver(options)
}
