/**
 * Session Outbound Adapters
 *
 * Concrete implementations of the SessionStore port.
 */
export { createMemorySessionDriver } from './memory.js'
export type { MemorySessionDriverOptions } from './memory.js'

export { createRedisSessionDriver } from './redis.js'
export type { RedisLikeClient, RedisSessionDriverOptions } from './redis.js'

export { createS3dbSessionDriver } from './s3db.js'
export type { S3dbResource, S3dbSessionDriverOptions } from './s3db.js'
