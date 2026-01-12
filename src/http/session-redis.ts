/**
 * Redis Session Store
 *
 * Production-ready session store using Redis as the backend.
 * Supports automatic TTL, user-based lookups, and efficient cleanup.
 *
 * @example
 * ```typescript
 * import { Redis } from 'ioredis'
 * import { createRedisSessionStore } from 'raffel/http/session-redis'
 * import { createSessionTracker } from 'raffel/http/session'
 *
 * const redis = new Redis({ host: 'localhost', port: 6379 })
 *
 * const store = createRedisSessionStore(redis, {
 *   prefix: 'sess:',
 *   ttl: 3600, // 1 hour in seconds
 * })
 *
 * const sessions = createSessionTracker({ store })
 * ```
 */

import type { Session, SessionStore } from './session.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal Redis client interface
 * Compatible with ioredis, redis, and similar libraries
 */
export interface RedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>
  del(...keys: string[]): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  ttl(key: string): Promise<number>
  keys(pattern: string): Promise<string[]>
  sadd(key: string, ...members: string[]): Promise<number>
  srem(key: string, ...members: string[]): Promise<number>
  smembers(key: string): Promise<string[]>
  scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]>
  multi(): RedisMulti
}

/**
 * Redis multi/pipeline interface
 */
export interface RedisMulti {
  del(...keys: string[]): RedisMulti
  srem(key: string, ...members: string[]): RedisMulti
  exec(): Promise<unknown[]>
}

/**
 * Redis session store configuration
 */
export interface RedisSessionStoreOptions {
  /**
   * Key prefix for session data
   * @default 'raffel:session:'
   */
  prefix?: string

  /**
   * Key prefix for user-session index
   * @default 'raffel:user_sessions:'
   */
  userPrefix?: string

  /**
   * Default TTL in seconds
   * @default 3600 (1 hour)
   */
  ttl?: number

  /**
   * Whether to use Redis SCAN for cleanup (safer for large datasets)
   * @default true
   */
  useScan?: boolean

  /**
   * SCAN count per iteration
   * @default 100
   */
  scanCount?: number

  /**
   * Serialize session data (default: JSON.stringify)
   */
  serialize?: (session: Session) => string

  /**
   * Deserialize session data (default: JSON.parse)
   */
  deserialize?: (data: string) => Session
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redis-backed session store
 *
 * Features:
 * - Automatic TTL management
 * - User-session index for efficient user lookups
 * - SCAN-based cleanup (safe for large datasets)
 * - Configurable serialization
 */
export class RedisSessionStore implements SessionStore {
  private readonly redis: RedisClient
  private readonly prefix: string
  private readonly userPrefix: string
  private readonly ttl: number
  private readonly useScan: boolean
  private readonly scanCount: number
  private readonly serialize: (session: Session) => string
  private readonly deserialize: (data: string) => Session

  constructor(redis: RedisClient, options: RedisSessionStoreOptions = {}) {
    this.redis = redis
    this.prefix = options.prefix ?? 'raffel:session:'
    this.userPrefix = options.userPrefix ?? 'raffel:user_sessions:'
    this.ttl = options.ttl ?? 3600
    this.useScan = options.useScan ?? true
    this.scanCount = options.scanCount ?? 100
    this.serialize = options.serialize ?? JSON.stringify
    this.deserialize = options.deserialize ?? JSON.parse
  }

  /**
   * Get session key
   */
  private sessionKey(id: string): string {
    return `${this.prefix}${id}`
  }

  /**
   * Get user sessions set key
   */
  private userKey(userId: string | number): string {
    return `${this.userPrefix}${userId}`
  }

  /**
   * Calculate remaining TTL based on session expiry
   */
  private calculateTtl(session: Session): number {
    const now = Date.now()
    const remaining = Math.ceil((session.expiresAt - now) / 1000)
    return Math.max(remaining, 1) // At least 1 second
  }

  /**
   * Get a session by ID
   */
  async get(id: string): Promise<Session | undefined> {
    const data = await this.redis.get(this.sessionKey(id))

    if (!data) {
      return undefined
    }

    try {
      const session = this.deserialize(data)

      // Check if session is expired (Redis TTL might be slightly out of sync)
      if (session.expiresAt <= Date.now()) {
        await this.delete(id)
        return undefined
      }

      return session
    } catch {
      // Invalid data, delete it
      await this.delete(id)
      return undefined
    }
  }

  /**
   * Save or update a session
   */
  async set(id: string, session: Session): Promise<void> {
    const key = this.sessionKey(id)
    const data = this.serialize(session)
    const ttl = this.calculateTtl(session)

    // Store session with TTL
    await this.redis.set(key, data, 'EX', ttl)

    // Add to user index if userId is present
    if (session.userId !== undefined) {
      const userKey = this.userKey(session.userId)
      await this.redis.sadd(userKey, id)
      // Set TTL on user index (slightly longer to ensure cleanup)
      await this.redis.expire(userKey, ttl + 60)
    }
  }

  /**
   * Delete a session
   */
  async delete(id: string): Promise<void> {
    // First get the session to find userId for index cleanup
    const data = await this.redis.get(this.sessionKey(id))

    if (data) {
      try {
        const session = this.deserialize(data)
        if (session.userId !== undefined) {
          await this.redis.srem(this.userKey(session.userId), id)
        }
      } catch {
        // Ignore deserialization errors
      }
    }

    await this.redis.del(this.sessionKey(id))
  }

  /**
   * Clear all sessions
   */
  async clear(): Promise<void> {
    if (this.useScan) {
      await this.clearWithScan()
    } else {
      await this.clearWithKeys()
    }
  }

  /**
   * Clear using SCAN (safer for large datasets)
   */
  private async clearWithScan(): Promise<void> {
    let cursor = '0'

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.prefix}*`,
        'COUNT',
        this.scanCount
      )
      cursor = nextCursor

      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } while (cursor !== '0')

    // Also clear user indexes
    cursor = '0'
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.userPrefix}*`,
        'COUNT',
        this.scanCount
      )
      cursor = nextCursor

      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } while (cursor !== '0')
  }

  /**
   * Clear using KEYS (simpler but blocks Redis on large datasets)
   */
  private async clearWithKeys(): Promise<void> {
    const sessionKeys = await this.redis.keys(`${this.prefix}*`)
    if (sessionKeys.length > 0) {
      await this.redis.del(...sessionKeys)
    }

    const userKeys = await this.redis.keys(`${this.userPrefix}*`)
    if (userKeys.length > 0) {
      await this.redis.del(...userKeys)
    }
  }

  /**
   * Get all sessions
   */
  async getAll(): Promise<Session[]> {
    const sessions: Session[] = []

    if (this.useScan) {
      let cursor = '0'

      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.prefix}*`,
          'COUNT',
          this.scanCount
        )
        cursor = nextCursor

        for (const key of keys) {
          const data = await this.redis.get(key)
          if (data) {
            try {
              const session = this.deserialize(data)
              if (session.expiresAt > Date.now()) {
                sessions.push(session)
              }
            } catch {
              // Skip invalid sessions
            }
          }
        }
      } while (cursor !== '0')
    } else {
      const keys = await this.redis.keys(`${this.prefix}*`)

      for (const key of keys) {
        const data = await this.redis.get(key)
        if (data) {
          try {
            const session = this.deserialize(data)
            if (session.expiresAt > Date.now()) {
              sessions.push(session)
            }
          } catch {
            // Skip invalid sessions
          }
        }
      }
    }

    return sessions
  }

  /**
   * Get sessions for a specific user
   */
  async getByUserId(userId: string | number): Promise<Session[]> {
    const sessionIds = await this.redis.smembers(this.userKey(userId))
    const sessions: Session[] = []

    for (const id of sessionIds) {
      const session = await this.get(id)
      if (session) {
        sessions.push(session)
      } else {
        // Session expired or deleted, clean up index
        await this.redis.srem(this.userKey(userId), id)
      }
    }

    return sessions
  }

  /**
   * Delete all sessions for a user
   */
  async deleteByUserId(userId: string | number): Promise<void> {
    const sessionIds = await this.redis.smembers(this.userKey(userId))

    if (sessionIds.length > 0) {
      const sessionKeys = sessionIds.map((id) => this.sessionKey(id))
      await this.redis.del(...sessionKeys)
    }

    await this.redis.del(this.userKey(userId))
  }

  /**
   * Cleanup expired sessions
   *
   * Note: Redis TTL handles most cleanup automatically.
   * This method cleans up orphaned user index entries.
   */
  async cleanup(): Promise<number> {
    let cleanedCount = 0

    if (this.useScan) {
      let cursor = '0'

      // Clean up user indexes with orphaned session references
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${this.userPrefix}*`,
          'COUNT',
          this.scanCount
        )
        cursor = nextCursor

        for (const userKey of keys) {
          const sessionIds = await this.redis.smembers(userKey)
          const orphaned: string[] = []

          for (const id of sessionIds) {
            const exists = await this.redis.get(this.sessionKey(id))
            if (!exists) {
              orphaned.push(id)
            }
          }

          if (orphaned.length > 0) {
            await this.redis.srem(userKey, ...orphaned)
            cleanedCount += orphaned.length
          }

          // If user index is now empty, delete it
          const remaining = await this.redis.smembers(userKey)
          if (remaining.length === 0) {
            await this.redis.del(userKey)
          }
        }
      } while (cursor !== '0')
    }

    return cleanedCount
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Redis session store
 *
 * @param redis - Redis client instance
 * @param options - Store configuration
 * @returns SessionStore implementation
 *
 * @example
 * ```typescript
 * import { Redis } from 'ioredis'
 * import { createRedisSessionStore } from 'raffel/http/session-redis'
 *
 * const redis = new Redis()
 * const store = createRedisSessionStore(redis, {
 *   prefix: 'myapp:session:',
 *   ttl: 7200, // 2 hours
 * })
 * ```
 */
export function createRedisSessionStore(
  redis: RedisClient,
  options: RedisSessionStoreOptions = {}
): SessionStore {
  return new RedisSessionStore(redis, options)
}

export default { createRedisSessionStore, RedisSessionStore }
