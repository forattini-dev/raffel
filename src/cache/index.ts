/**
 * Cache Module
 *
 * Pluggable cache system with multiple driver support.
 *
 * Available drivers:
 * - `memory`: High-performance in-memory cache (default)
 *   - LRU/FIFO eviction
 *   - Memory limits (bytes, percentage)
 *   - Container-aware (Docker/K8s)
 *   - Optional compression
 *
 * - `file`: File-system based persistent cache
 *   - Survives restarts
 *   - Size limits
 *   - Optional compression
 *
 * - `redis`: Redis-backed distributed cache
 *   - Works with any Redis-compatible client
 *   - Key prefixing
 *   - Optional compression
 *
 * @example Basic usage with memory driver
 * ```typescript
 * import { createDriver } from 'raffel/cache'
 *
 * const cache = await createDriver('memory', {
 *   maxSize: 5000,
 *   evictionPolicy: 'lru',
 *   compression: true,
 * })
 *
 * await cache.set('users:123', user, 60000) // 1 minute TTL
 * const result = await cache.get('users:123')
 * ```
 *
 * @example Using with cache interceptor
 * ```typescript
 * import { createCacheInterceptor } from 'raffel/middleware'
 * import { createDriver } from 'raffel/cache'
 *
 * const driver = await createDriver('redis', {
 *   client: redisClient,
 * })
 *
 * const cache = createCacheInterceptor({
 *   ttlMs: 60000,
 *   driver,
 * })
 *
 * server.use(cache)
 * ```
 */

// Types
export type {
  CacheDriver,
  CacheEntry,
  CacheGetResult,
  CacheStats,
  MemoryStats,
  CompressionStats,
  EvictionPolicy,
  CompressionConfig,
  MemoryDriverOptions,
  FileDriverOptions,
  RedisDriverOptions,
  RedisLikeClient,
  CacheDriverType,
  CacheDriverConfig,
  EvictionInfo,
  PressureInfo,
} from './types.js'

// Factory
export {
  createDriver,
  createDriverFromConfig,
  createDriverSync,
  DRIVER_TYPES,
  isValidDriverType,
} from './factory.js'

// Drivers (for direct import when needed)
export {
  MemoryDriver,
  createMemoryDriver,
  FileDriver,
  createFileDriver,
  RedisDriver,
  createRedisDriver,
} from './drivers/index.js'

// Hierarchical response cache (L1 memory → L2 filesystem → L3 provider)
export {
  cacheNamespacePrefix,
  createTieredCache,
  createMemoryCacheLayer,
  createFileSystemCacheLayer,
  DEFAULT_CACHE_CIRCUIT_COOLDOWN_MS,
  DEFAULT_CACHE_CIRCUIT_FAILURE_THRESHOLD,
  DEFAULT_CACHE_OPERATION_TIMEOUT_MS,
  DEFAULT_CACHE_READ_TIMEOUT_MS,
  DEFAULT_L1_MAX_ENTRIES,
  DEFAULT_L1_MAX_MEMORY_BYTES,
  DEFAULT_L2_MAX_FILES,
  DEFAULT_L2_MAX_SIZE_BYTES,
} from './tiered.js'
export { createRedisCacheLayer } from './redis-layer.js'
export {
  compileProcedureCacheKey,
  composeCacheKey,
  procedureCacheKey,
  procedureCacheKeyFor,
} from './key.js'
export type {
  CacheFillTicket,
  CacheInvalidationResult,
  CacheLayer,
  CacheLayerCapabilities,
  CacheCircuitBreakerOptions,
  CacheLayerInvalidationResult,
  CacheLayerStats,
  CacheLookup,
  CacheRecord,
  CacheWriteOptions,
  MemoryCacheLayerOptions,
  TieredCache,
  TieredCacheAccess,
  TieredCacheOptions,
} from './tiered.js'
export type { FileSystemCacheLayerOptions } from './fs-layer.js'
export type { RedisCacheLayerClient, RedisCacheLayerOptions } from './redis-layer.js'
export type {
  CacheIdentityScope,
  CacheKeyDimension,
  CacheKeyFormat,
  CompiledProcedureCacheKey,
  ComposeCacheKeyOptions,
  ProcedureCacheKeyOptions,
} from './key.js'
export type {
  CacheProfileConfig,
  CacheRule,
  CacheTagResolver,
  FileSystemLayerConfig,
  MemoryLayerConfig,
  ProviderLayerConfig,
  RouteCacheConfig,
  ServerCacheConfig,
  ServerCacheController,
  ServerCacheLayerConfig,
} from './server-runtime.js'
export type { WriteBehindQueueOptions, WriteBehindQueueStats } from './write-behind-queue.js'
