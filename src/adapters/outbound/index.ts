/**
 * Outbound Adapters
 *
 * Concrete implementations of outbound ports (driven adapters).
 * These adapt external infrastructure to the port interfaces
 * defined in ports/outbound/.
 */

// Session drivers
export { createMemorySessionDriver } from './session/index.js'
export type { MemorySessionDriverOptions } from './session/index.js'
export { createRedisSessionDriver } from './session/index.js'
export type { RedisLikeClient as SessionRedisLikeClient, RedisSessionDriverOptions } from './session/index.js'

// Rate limit drivers
export {
  MemoryRateLimitDriver,
  FilesystemRateLimitDriver,
  RedisRateLimitDriver,
  S3dbRateLimitDriver,
} from './rate-limit/index.js'

// Cache drivers
export {
  MemoryDriver as CacheMemoryDriver,
  createMemoryDriver as createCacheMemoryDriver,
  FileDriver as CacheFileDriver,
  createFileDriver as createCacheFileDriver,
  RedisDriver as CacheRedisDriver,
  createRedisDriver as createCacheRedisDriver,
} from './cache/index.js'

// Logger adapters
export { createPinoLoggerAdapter, pinoLoggerFactory, getBasePinoLogger } from './logger/index.js'
