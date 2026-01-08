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
 * - `s3db`: S3-based persistent cache
 *   - Works with S3DB library
 *   - Distributed cache
 *   - High durability
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
  S3DBDriverOptions,
  S3DBLikeClient,
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
  S3DBDriver,
  createS3DBDriver,
} from './drivers/index.js'
