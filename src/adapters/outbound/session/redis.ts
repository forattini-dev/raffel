/**
 * Redis Session Driver
 *
 * Redis-backed implementation of the SessionStore port.
 * @see ../../../middleware/session/drivers/redis.ts
 */
export { createRedisSessionDriver } from '../../../middleware/session/drivers/redis.js'
export type { RedisLikeClient, RedisSessionDriverOptions } from '../../../middleware/session/drivers/redis.js'
