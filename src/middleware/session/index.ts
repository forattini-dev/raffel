/**
 * Session Store Module
 *
 * Provides session management for Raffel servers.
 *
 * @example
 * ```typescript
 * import { createServer } from 'raffel'
 * import { createSessionInterceptor } from 'raffel/session'
 *
 * const server = createServer({ port: 3000 })
 *
 * server.use(createSessionInterceptor({
 *   driver: 'memory',
 *   ttl: 3600,
 *   cookie: { name: 'sid', secure: true },
 * }))
 *
 * server.procedure('auth.login').handler(async (input, ctx) => {
 *   ctx.session.data.userId = input.userId
 *   ctx.session.touch()
 *   return { ok: true }
 * })
 * ```
 *
 * For Redis in production:
 *
 * ```typescript
 * import { createRedisSessionDriver } from 'raffel/session'
 * import { createClient } from 'redis'
 *
 * const redis = createClient({ url: process.env.REDIS_URL })
 * await redis.connect()
 *
 * server.use(createSessionInterceptor({
 *   driver: createRedisSessionDriver({ client: redis }),
 *   ttl: 7200,
 * }))
 * ```
 */

// Interceptor
export { createSessionInterceptor } from './interceptor.js'

// Drivers
export { createMemorySessionDriver } from './drivers/memory.js'
export { createRedisSessionDriver } from './drivers/redis.js'

// Types
export type {
  Session,
  SessionData,
  SessionStore,
  SessionConfig,
  SessionCookieOptions,
  SessionDriverType,
} from './types.js'

export type { MemorySessionDriverOptions } from './drivers/memory.js'
export type { RedisLikeClient, RedisSessionDriverOptions } from './drivers/redis.js'
