/**
 * Redis Session Driver
 *
 * Stores sessions in Redis with native TTL support.
 * Suitable for production multi-instance deployments.
 *
 * Works with any Redis-compatible client that exposes:
 * - get(key): Promise<string | null>
 * - set(key, value, options): Promise<unknown>
 * - del(key): Promise<unknown>
 * - expire(key, seconds): Promise<unknown>
 *
 * Compatible clients: ioredis, @redis/client, upstash/redis, etc.
 */

import type { SessionStore, SessionData } from '../types.js'

/**
 * Minimal Redis-like client interface.
 * Any Redis client that satisfies this interface can be used.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: { EX?: number; ex?: number }): Promise<unknown>
  del(key: string | string[]): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
}

export interface RedisSessionDriverOptions {
  /** Redis client instance */
  client: RedisLikeClient

  /**
   * Key prefix for all session keys (default: 'raffel:session:').
   * Change this if you share a Redis instance across multiple services.
   */
  keyPrefix?: string
}

/**
 * Create a Redis-backed session store.
 *
 * @example
 * ```typescript
 * import { createClient } from 'redis'
 * import { createRedisSessionDriver } from 'raffel/session'
 *
 * const redis = createClient({ url: process.env.REDIS_URL })
 * await redis.connect()
 *
 * const server = createServer({
 *   session: {
 *     driver: createRedisSessionDriver({ client: redis }),
 *     ttl: 7200,
 *   }
 * })
 * ```
 */
export function createRedisSessionDriver(options: RedisSessionDriverOptions): SessionStore {
  const { client, keyPrefix = 'raffel:session:' } = options

  function key(id: string): string {
    return `${keyPrefix}${id}`
  }

  return {
    async get(id: string): Promise<SessionData | null> {
      const raw = await client.get(key(id))
      if (raw == null) return null

      try {
        return JSON.parse(raw) as SessionData
      } catch {
        return null
      }
    },

    async set(id: string, data: SessionData, ttl?: number): Promise<void> {
      const serialized = JSON.stringify(data)

      if (ttl != null && ttl > 0) {
        await client.set(key(id), serialized, { EX: ttl })
      } else {
        await client.set(key(id), serialized)
      }
    },

    async delete(id: string): Promise<void> {
      await client.del(key(id))
    },

    async touch(id: string, ttl?: number): Promise<void> {
      if (ttl != null && ttl > 0) {
        await client.expire(key(id), ttl)
      }
    },
  }
}
