/**
 * Redis Session Store Integration Tests
 *
 * Tests the Redis session store with a mock Redis client.
 * For real Redis integration tests, use a test container or Redis instance.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRedisSessionStore, RedisSessionStore } from './session-redis.js'
import type { Session, SessionStore } from './session.js'
import type { RedisClient, RedisMulti } from './session-redis.js'

// ─────────────────────────────────────────────────────────────────────────────
// Mock Redis Client
// ─────────────────────────────────────────────────────────────────────────────

function createMockRedis(): RedisClient & { _data: Map<string, string>; _sets: Map<string, Set<string>> } {
  const data = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  const ttls = new Map<string, number>()

  return {
    _data: data,
    _sets: sets,

    async get(key: string): Promise<string | null> {
      // Check TTL
      const expiry = ttls.get(key)
      if (expiry && expiry < Date.now()) {
        data.delete(key)
        ttls.delete(key)
        return null
      }
      return data.get(key) ?? null
    },

    async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
      data.set(key, value)

      // Handle EX argument for TTL
      const exIndex = args.indexOf('EX')
      if (exIndex !== -1 && typeof args[exIndex + 1] === 'number') {
        const ttl = args[exIndex + 1] as number
        ttls.set(key, Date.now() + ttl * 1000)
      }

      return 'OK'
    },

    async del(...keys: string[]): Promise<number> {
      let count = 0
      for (const key of keys) {
        if (data.has(key) || sets.has(key)) {
          data.delete(key)
          sets.delete(key)
          ttls.delete(key)
          count++
        }
      }
      return count
    },

    async expire(key: string, seconds: number): Promise<number> {
      if (data.has(key) || sets.has(key)) {
        ttls.set(key, Date.now() + seconds * 1000)
        return 1
      }
      return 0
    },

    async ttl(key: string): Promise<number> {
      const expiry = ttls.get(key)
      if (!expiry) return -2 // Key doesn't exist
      const remaining = Math.ceil((expiry - Date.now()) / 1000)
      return remaining > 0 ? remaining : -2
    },

    async keys(pattern: string): Promise<string[]> {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return [...data.keys(), ...sets.keys()].filter((k) => regex.test(k))
    },

    async sadd(key: string, ...members: string[]): Promise<number> {
      let set = sets.get(key)
      if (!set) {
        set = new Set()
        sets.set(key, set)
      }
      let added = 0
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member)
          added++
        }
      }
      return added
    },

    async srem(key: string, ...members: string[]): Promise<number> {
      const set = sets.get(key)
      if (!set) return 0
      let removed = 0
      for (const member of members) {
        if (set.delete(member)) {
          removed++
        }
      }
      return removed
    },

    async smembers(key: string): Promise<string[]> {
      return [...(sets.get(key) ?? [])]
    },

    async scan(cursor: string | number, ...args: unknown[]): Promise<[string, string[]]> {
      // Simple implementation: return all matching keys on first scan
      if (cursor === '0' || cursor === 0) {
        const matchIndex = args.indexOf('MATCH')
        const pattern = matchIndex !== -1 ? (args[matchIndex + 1] as string) : '*'
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
        const allKeys = [...data.keys(), ...sets.keys()].filter((k) => regex.test(k))
        return ['0', allKeys]
      }
      return ['0', []]
    },

    multi(): RedisMulti {
      const operations: Array<() => void> = []
      const self = this as RedisClient

      const multi: RedisMulti = {
        del(...keys: string[]): RedisMulti {
          operations.push(async () => {
            await self.del(...keys)
          })
          return multi
        },

        srem(key: string, ...members: string[]): RedisMulti {
          operations.push(async () => {
            await self.srem(key, ...members)
          })
          return multi
        },

        async exec(): Promise<unknown[]> {
          const results: unknown[] = []
          for (const op of operations) {
            results.push(await (op as () => Promise<unknown>)())
          }
          return results
        },
      }

      return multi
    },
  }
}

function createTestSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now()
  return {
    id: 'test-session-1',
    userId: 'user-123',
    createdAt: now,
    lastAccessedAt: now,
    expiresAt: now + 3600000, // 1 hour
    ip: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
    data: { foo: 'bar' },
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('RedisSessionStore', () => {
  let redis: ReturnType<typeof createMockRedis>
  let store: SessionStore

  beforeEach(() => {
    redis = createMockRedis()
    store = createRedisSessionStore(redis)
  })

  describe('get()', () => {
    it('should return undefined for non-existent session', async () => {
      const session = await store.get('non-existent')
      expect(session).toBeUndefined()
    })

    it('should get an existing session', async () => {
      const testSession = createTestSession()
      await store.set(testSession.id, testSession)

      const session = await store.get(testSession.id)
      expect(session).toBeDefined()
      expect(session?.id).toBe(testSession.id)
      expect(session?.userId).toBe(testSession.userId)
      expect(session?.data).toEqual(testSession.data)
    })

    it('should return undefined for expired session', async () => {
      const expiredSession = createTestSession({
        expiresAt: Date.now() - 1000, // Expired 1 second ago
      })
      await store.set(expiredSession.id, expiredSession)

      const session = await store.get(expiredSession.id)
      expect(session).toBeUndefined()
    })

    it('should handle invalid JSON gracefully', async () => {
      // Directly set invalid data
      await redis.set('raffel:session:invalid', 'not-json')

      const session = await store.get('invalid')
      expect(session).toBeUndefined()
    })
  })

  describe('set()', () => {
    it('should store a session', async () => {
      const testSession = createTestSession()
      await store.set(testSession.id, testSession)

      const stored = await redis.get(`raffel:session:${testSession.id}`)
      expect(stored).not.toBeNull()

      const parsed = JSON.parse(stored!)
      expect(parsed.id).toBe(testSession.id)
    })

    it('should add session to user index when userId is present', async () => {
      const testSession = createTestSession({ userId: 'user-456' })
      await store.set(testSession.id, testSession)

      const userSessions = await redis.smembers('raffel:user_sessions:user-456')
      expect(userSessions).toContain(testSession.id)
    })

    it('should not add to user index when userId is undefined', async () => {
      const testSession = createTestSession({ userId: undefined })
      await store.set(testSession.id, testSession)

      const userSessions = await redis.smembers('raffel:user_sessions:undefined')
      expect(userSessions).toHaveLength(0)
    })

    it('should update existing session', async () => {
      const testSession = createTestSession()
      await store.set(testSession.id, testSession)

      const updatedSession = { ...testSession, data: { updated: true } }
      await store.set(testSession.id, updatedSession)

      const session = await store.get(testSession.id)
      expect(session?.data).toEqual({ updated: true })
    })
  })

  describe('delete()', () => {
    it('should delete a session', async () => {
      const testSession = createTestSession()
      await store.set(testSession.id, testSession)

      await store.delete(testSession.id)

      const session = await store.get(testSession.id)
      expect(session).toBeUndefined()
    })

    it('should remove session from user index', async () => {
      const testSession = createTestSession({ userId: 'user-789' })
      await store.set(testSession.id, testSession)

      await store.delete(testSession.id)

      const userSessions = await redis.smembers('raffel:user_sessions:user-789')
      expect(userSessions).not.toContain(testSession.id)
    })

    it('should handle deleting non-existent session gracefully', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow()
    })
  })

  describe('clear()', () => {
    it('should clear all sessions', async () => {
      // Create multiple sessions
      await store.set('session-1', createTestSession({ id: 'session-1' }))
      await store.set('session-2', createTestSession({ id: 'session-2' }))
      await store.set('session-3', createTestSession({ id: 'session-3' }))

      await store.clear()

      const sessions = await store.getAll()
      expect(sessions).toHaveLength(0)
    })

    it('should clear user indexes', async () => {
      await store.set('session-1', createTestSession({ id: 'session-1', userId: 'user-1' }))
      await store.set('session-2', createTestSession({ id: 'session-2', userId: 'user-1' }))

      await store.clear()

      const userSessions = await redis.smembers('raffel:user_sessions:user-1')
      expect(userSessions).toHaveLength(0)
    })
  })

  describe('getAll()', () => {
    it('should return empty array when no sessions exist', async () => {
      const sessions = await store.getAll()
      expect(sessions).toEqual([])
    })

    it('should return all active sessions', async () => {
      await store.set('session-1', createTestSession({ id: 'session-1' }))
      await store.set('session-2', createTestSession({ id: 'session-2' }))

      const sessions = await store.getAll()
      expect(sessions).toHaveLength(2)
    })

    it('should not include expired sessions', async () => {
      await store.set('active', createTestSession({ id: 'active' }))
      await store.set('expired', createTestSession({
        id: 'expired',
        expiresAt: Date.now() - 1000,
      }))

      const sessions = await store.getAll()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('active')
    })
  })

  describe('getByUserId()', () => {
    it('should return empty array for user with no sessions', async () => {
      const sessions = await store.getByUserId('unknown-user')
      expect(sessions).toEqual([])
    })

    it('should return all sessions for a user', async () => {
      await store.set('session-1', createTestSession({
        id: 'session-1',
        userId: 'user-multi',
      }))
      await store.set('session-2', createTestSession({
        id: 'session-2',
        userId: 'user-multi',
      }))
      await store.set('session-3', createTestSession({
        id: 'session-3',
        userId: 'other-user',
      }))

      const sessions = await store.getByUserId('user-multi')
      expect(sessions).toHaveLength(2)
      expect(sessions.every((s) => s.userId === 'user-multi')).toBe(true)
    })

    it('should clean up orphaned index entries', async () => {
      // Add session to index but not to storage (simulating Redis TTL expiry)
      await redis.sadd('raffel:user_sessions:orphan-user', 'orphan-session')

      const sessions = await store.getByUserId('orphan-user')
      expect(sessions).toHaveLength(0)

      // Index should be cleaned up
      const remaining = await redis.smembers('raffel:user_sessions:orphan-user')
      expect(remaining).not.toContain('orphan-session')
    })
  })

  describe('deleteByUserId()', () => {
    it('should delete all sessions for a user', async () => {
      await store.set('session-1', createTestSession({
        id: 'session-1',
        userId: 'target-user',
      }))
      await store.set('session-2', createTestSession({
        id: 'session-2',
        userId: 'target-user',
      }))
      await store.set('session-3', createTestSession({
        id: 'session-3',
        userId: 'other-user',
      }))

      await store.deleteByUserId('target-user')

      const targetSessions = await store.getByUserId('target-user')
      expect(targetSessions).toHaveLength(0)

      const otherSessions = await store.getByUserId('other-user')
      expect(otherSessions).toHaveLength(1)
    })

    it('should handle user with no sessions', async () => {
      await expect(store.deleteByUserId('no-sessions')).resolves.not.toThrow()
    })
  })

  describe('cleanup()', () => {
    it('should return count of cleaned entries', async () => {
      // Add orphaned index entries
      await redis.sadd('raffel:user_sessions:cleanup-user', 'orphan-1', 'orphan-2')

      const count = await store.cleanup()
      expect(count).toBe(2)
    })

    it('should clean up empty user indexes', async () => {
      // Add orphaned entry
      await redis.sadd('raffel:user_sessions:empty-user', 'orphan')

      await store.cleanup()

      // User index should be deleted since it's empty
      const keys = await redis.keys('raffel:user_sessions:empty-user')
      expect(keys).toHaveLength(0)
    })

    it('should not remove valid index entries', async () => {
      const session = createTestSession({ id: 'valid-session', userId: 'valid-user' })
      await store.set(session.id, session)

      await store.cleanup()

      const userSessions = await redis.smembers('raffel:user_sessions:valid-user')
      expect(userSessions).toContain('valid-session')
    })
  })

  describe('configuration', () => {
    it('should use custom prefix', async () => {
      const customStore = createRedisSessionStore(redis, {
        prefix: 'custom:sess:',
      })

      const session = createTestSession({ id: 'custom-prefix' })
      await customStore.set(session.id, session)

      const stored = await redis.get('custom:sess:custom-prefix')
      expect(stored).not.toBeNull()
    })

    it('should use custom user prefix', async () => {
      const customStore = createRedisSessionStore(redis, {
        userPrefix: 'custom:users:',
      })

      const session = createTestSession({ id: 'custom-user', userId: 'user-custom' })
      await customStore.set(session.id, session)

      const userSessions = await redis.smembers('custom:users:user-custom')
      expect(userSessions).toContain('custom-user')
    })

    it('should use custom serializer', async () => {
      const serialize = vi.fn(JSON.stringify)
      const deserialize = vi.fn(JSON.parse)

      const customStore = createRedisSessionStore(redis, {
        serialize,
        deserialize,
      })

      const session = createTestSession({ id: 'custom-serial' })
      await customStore.set(session.id, session)
      await customStore.get(session.id)

      expect(serialize).toHaveBeenCalled()
      expect(deserialize).toHaveBeenCalled()
    })

    it('should work with useScan: false', async () => {
      const noScanStore = createRedisSessionStore(redis, {
        useScan: false,
      })

      await noScanStore.set('scan-test-1', createTestSession({ id: 'scan-test-1' }))
      await noScanStore.set('scan-test-2', createTestSession({ id: 'scan-test-2' }))

      const sessions = await noScanStore.getAll()
      expect(sessions).toHaveLength(2)

      await noScanStore.clear()

      const remaining = await noScanStore.getAll()
      expect(remaining).toHaveLength(0)
    })
  })

  describe('TTL handling', () => {
    it('should calculate TTL from session expiry', async () => {
      const session = createTestSession({
        expiresAt: Date.now() + 7200000, // 2 hours
      })

      await store.set(session.id, session)

      // Check that TTL was set (should be around 7200 seconds)
      const ttl = await redis.ttl(`raffel:session:${session.id}`)
      expect(ttl).toBeGreaterThan(7100)
      expect(ttl).toBeLessThanOrEqual(7200)
    })

    it('should use minimum TTL of 1 second for nearly expired sessions', async () => {
      const session = createTestSession({
        expiresAt: Date.now() + 100, // 100ms from now
      })

      await store.set(session.id, session)

      const ttl = await redis.ttl(`raffel:session:${session.id}`)
      expect(ttl).toBeGreaterThanOrEqual(1)
    })
  })

  describe('edge cases', () => {
    it('should handle session with numeric userId', async () => {
      const session = createTestSession({
        id: 'numeric-user',
        userId: 12345,
      })

      await store.set(session.id, session)

      const sessions = await store.getByUserId(12345)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].userId).toBe(12345)
    })

    it('should handle large session data', async () => {
      const largeData: Record<string, string> = {}
      for (let i = 0; i < 1000; i++) {
        largeData[`key-${i}`] = `value-${i}`.repeat(10)
      }

      const session = createTestSession({
        id: 'large-data',
        data: largeData,
      })

      await store.set(session.id, session)
      const retrieved = await store.get(session.id)

      expect(retrieved?.data).toEqual(largeData)
    })

    it('should handle special characters in session ID', async () => {
      const session = createTestSession({
        id: 'session:with:colons:and-dashes_and_underscores',
      })

      await store.set(session.id, session)
      const retrieved = await store.get(session.id)

      expect(retrieved?.id).toBe(session.id)
    })

    it('should handle concurrent operations', async () => {
      const sessions = Array.from({ length: 10 }, (_, i) =>
        createTestSession({
          id: `concurrent-${i}`,
          userId: 'concurrent-user',
        })
      )

      // Set all sessions concurrently
      await Promise.all(sessions.map((s) => store.set(s.id, s)))

      const userSessions = await store.getByUserId('concurrent-user')
      expect(userSessions).toHaveLength(10)

      // Delete all concurrently
      await Promise.all(sessions.map((s) => store.delete(s.id)))

      const remaining = await store.getByUserId('concurrent-user')
      expect(remaining).toHaveLength(0)
    })
  })
})

describe('createRedisSessionStore factory', () => {
  it('should create a SessionStore instance', () => {
    const redis = createMockRedis()
    const store = createRedisSessionStore(redis)

    expect(store).toBeDefined()
    expect(typeof store.get).toBe('function')
    expect(typeof store.set).toBe('function')
    expect(typeof store.delete).toBe('function')
    expect(typeof store.clear).toBe('function')
    expect(typeof store.getAll).toBe('function')
    expect(typeof store.getByUserId).toBe('function')
    expect(typeof store.deleteByUserId).toBe('function')
    expect(typeof store.cleanup).toBe('function')
  })

  it('should use default options when none provided', () => {
    const redis = createMockRedis()
    const store = createRedisSessionStore(redis)

    expect(store).toBeInstanceOf(RedisSessionStore)
  })
})
