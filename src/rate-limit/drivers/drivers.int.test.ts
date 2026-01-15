/**
 * Rate Limit Drivers Integration Tests
 *
 * Tests for all rate limit driver implementations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRateLimitDriver } from './memory.js'
import { FilesystemRateLimitDriver } from './filesystem.js'
import { RedisRateLimitDriver } from './redis.js'
import type { RateLimitDriver, RedisLikeClient } from '../types.js'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================================
// Memory Driver Tests
// ============================================================================

describe('MemoryRateLimitDriver', () => {
  let driver: MemoryRateLimitDriver

  beforeEach(() => {
    driver = new MemoryRateLimitDriver({ cleanupInterval: 0 }) // Disable auto cleanup
  })

  afterEach(async () => {
    await driver.shutdown()
  })

  describe('increment', () => {
    it('should increment count for new key', async () => {
      const record = await driver.increment('user:1', 60000)

      expect(record.count).toBe(1)
      expect(record.resetAt).toBeGreaterThan(Date.now())
      expect(record.resetAt).toBeLessThanOrEqual(Date.now() + 60000)
    })

    it('should increment count for existing key', async () => {
      await driver.increment('user:2', 60000)
      await driver.increment('user:2', 60000)
      const record = await driver.increment('user:2', 60000)

      expect(record.count).toBe(3)
    })

    it('should reset count after window expires', async () => {
      // First increment with a very short window
      await driver.increment('user:3', 1)

      // Wait for window to expire
      await new Promise(r => setTimeout(r, 10))

      // Next increment should reset
      const record = await driver.increment('user:3', 60000)
      expect(record.count).toBe(1)
    })

    it('should handle multiple keys independently', async () => {
      await driver.increment('user:a', 60000)
      await driver.increment('user:a', 60000)
      await driver.increment('user:b', 60000)

      const recordA = await driver.increment('user:a', 60000)
      const recordB = await driver.increment('user:b', 60000)

      expect(recordA.count).toBe(3)
      expect(recordB.count).toBe(2)
    })
  })

  describe('decrement', () => {
    it('should decrement count', async () => {
      await driver.increment('user:dec', 60000)
      await driver.increment('user:dec', 60000)
      await driver.increment('user:dec', 60000)

      await driver.decrement('user:dec')

      const record = await driver.increment('user:dec', 60000)
      expect(record.count).toBe(3) // Was 3, decremented to 2, then incremented to 3
    })

    it('should not go below zero', async () => {
      await driver.increment('user:zero', 60000)
      await driver.decrement('user:zero')
      await driver.decrement('user:zero')
      await driver.decrement('user:zero')

      const record = await driver.increment('user:zero', 60000)
      expect(record.count).toBe(1)
    })

    it('should handle non-existent key', async () => {
      // Should not throw
      await driver.decrement('nonexistent')
    })
  })

  describe('reset', () => {
    it('should remove key', async () => {
      await driver.increment('user:reset', 60000)
      await driver.increment('user:reset', 60000)

      await driver.reset('user:reset')

      const record = await driver.increment('user:reset', 60000)
      expect(record.count).toBe(1)
    })

    it('should handle non-existent key', async () => {
      // Should not throw
      await driver.reset('nonexistent')
    })
  })

  describe('maxKeys eviction', () => {
    it('should evict oldest keys when maxKeys is reached', async () => {
      const smallDriver = new MemoryRateLimitDriver({ maxKeys: 3, cleanupInterval: 0 })

      await smallDriver.increment('key:1', 60000)
      await smallDriver.increment('key:2', 60000)
      await smallDriver.increment('key:3', 60000)

      // This should evict key:1
      await smallDriver.increment('key:4', 60000)

      // key:1 should be gone, so incrementing it should start fresh
      const record = await smallDriver.increment('key:1', 60000)
      expect(record.count).toBe(1)

      await smallDriver.shutdown()
    })
  })

  describe('cleanup', () => {
    it('should cleanup expired records', async () => {
      const cleanupDriver = new MemoryRateLimitDriver({ cleanupInterval: 50 })

      // Create a record with very short window
      await cleanupDriver.increment('expire:1', 1)

      // Wait for cleanup
      await new Promise(r => setTimeout(r, 100))

      // Record should be cleaned up, so this should start fresh
      const record = await cleanupDriver.increment('expire:1', 60000)
      expect(record.count).toBe(1)

      await cleanupDriver.shutdown()
    })
  })

  describe('shutdown', () => {
    it('should stop cleanup interval', async () => {
      const cleanupDriver = new MemoryRateLimitDriver({ cleanupInterval: 100 })

      await cleanupDriver.shutdown()

      // Should not throw and cleanup should be stopped
      expect(true).toBe(true)
    })
  })
})

// ============================================================================
// Filesystem Driver Tests
// ============================================================================

describe('FilesystemRateLimitDriver', () => {
  const TEST_DIR = '.rate-limit-test'
  let driver: FilesystemRateLimitDriver

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
    driver = new FilesystemRateLimitDriver({ directory: TEST_DIR, cleanupInterval: 0 })
  })

  afterEach(async () => {
    await driver.shutdown()
    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true })
    }
  })

  describe('increment', () => {
    it('should increment count for new key', async () => {
      const record = await driver.increment('fs:user:1', 60000)

      expect(record.count).toBe(1)
      expect(record.resetAt).toBeGreaterThan(Date.now())
    })

    it('should increment count for existing key', async () => {
      await driver.increment('fs:user:2', 60000)
      await driver.increment('fs:user:2', 60000)
      const record = await driver.increment('fs:user:2', 60000)

      expect(record.count).toBe(3)
    })

    it('should persist to file', async () => {
      await driver.increment('fs:persist', 60000)

      const files = fs.readdirSync(TEST_DIR)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/\.json$/)
    })

    it('should reset count after window expires', async () => {
      await driver.increment('fs:user:3', 1)
      await new Promise(r => setTimeout(r, 10))

      const record = await driver.increment('fs:user:3', 60000)
      expect(record.count).toBe(1)
    })
  })

  describe('decrement', () => {
    it('should decrement count', async () => {
      await driver.increment('fs:dec', 60000)
      await driver.increment('fs:dec', 60000)
      await driver.increment('fs:dec', 60000)

      await driver.decrement('fs:dec')

      const record = await driver.increment('fs:dec', 60000)
      expect(record.count).toBe(3)
    })

    it('should not go below zero', async () => {
      await driver.increment('fs:zero', 60000)
      await driver.decrement('fs:zero')
      await driver.decrement('fs:zero')

      const record = await driver.increment('fs:zero', 60000)
      expect(record.count).toBe(1)
    })
  })

  describe('reset', () => {
    it('should remove file', async () => {
      await driver.increment('fs:reset', 60000)

      let files = fs.readdirSync(TEST_DIR)
      expect(files.length).toBe(1)

      await driver.reset('fs:reset')

      files = fs.readdirSync(TEST_DIR)
      expect(files.length).toBe(0)
    })
  })

  describe('directory creation', () => {
    it('should create directory if not exists', async () => {
      const newDir = '.rate-limit-new-test'
      if (fs.existsSync(newDir)) {
        fs.rmSync(newDir, { recursive: true })
      }

      const newDriver = new FilesystemRateLimitDriver({ directory: newDir, cleanupInterval: 0 })
      await newDriver.increment('test', 60000)

      expect(fs.existsSync(newDir)).toBe(true)

      await newDriver.shutdown()
      fs.rmSync(newDir, { recursive: true })
    })
  })

  describe('cleanup', () => {
    it('should cleanup expired files', async () => {
      const cleanupDir = '.rate-limit-cleanup-test'
      if (fs.existsSync(cleanupDir)) {
        fs.rmSync(cleanupDir, { recursive: true })
      }

      const cleanupDriver = new FilesystemRateLimitDriver({
        directory: cleanupDir,
        cleanupInterval: 50,
      })

      await cleanupDriver.increment('cleanup:1', 1)

      // Wait for cleanup
      await new Promise(r => setTimeout(r, 150))

      const files = fs.readdirSync(cleanupDir)
      expect(files.length).toBe(0)

      await cleanupDriver.shutdown()
      fs.rmSync(cleanupDir, { recursive: true })
    })
  })
})

// ============================================================================
// Redis Driver Tests (with mock)
// ============================================================================

describe('RedisRateLimitDriver', () => {
  // Mock Redis client
  function createMockRedisClient(): RedisLikeClient & { store: Map<string, { value: number; ttl: number }> } {
    const store = new Map<string, { value: number; ttl: number }>()

    return {
      store,

      async incr(key: string): Promise<number> {
        const existing = store.get(key)
        if (existing) {
          existing.value += 1
          return existing.value
        }
        store.set(key, { value: 1, ttl: 0 })
        return 1
      },

      async decr(key: string): Promise<number> {
        const existing = store.get(key)
        if (existing) {
          existing.value = Math.max(0, existing.value - 1)
          return existing.value
        }
        return 0
      },

      async pexpire(key: string, ttlMs: number): Promise<number> {
        const existing = store.get(key)
        if (existing) {
          existing.ttl = Date.now() + ttlMs
          return 1
        }
        return 0
      },

      async pttl(key: string): Promise<number> {
        const existing = store.get(key)
        if (existing && existing.ttl > 0) {
          return Math.max(0, existing.ttl - Date.now())
        }
        return -1
      },

      async del(key: string): Promise<number> {
        return store.delete(key) ? 1 : 0
      },
    }
  }

  describe('constructor', () => {
    it('should throw if client not provided', () => {
      expect(() => {
        new RedisRateLimitDriver({ client: null as unknown as RedisLikeClient })
      }).toThrow('[RedisRateLimitDriver] Redis client is required')
    })

    it('should use default prefix', () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      expect(driver.name).toBe('redis')
    })

    it('should use custom prefix', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient, prefix: 'custom:' })

      await driver.increment('test', 60000)

      expect(mockClient.store.has('custom:test')).toBe(true)
    })
  })

  describe('increment', () => {
    it('should increment count for new key', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      const record = await driver.increment('redis:user:1', 60000)

      expect(record.count).toBe(1)
      expect(record.resetAt).toBeGreaterThan(Date.now())
    })

    it('should increment count for existing key', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:user:2', 60000)
      await driver.increment('redis:user:2', 60000)
      const record = await driver.increment('redis:user:2', 60000)

      expect(record.count).toBe(3)
    })

    it('should set expiry on first increment', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:expire', 60000)

      const key = 'raffel:rate-limit:redis:expire'
      expect(mockClient.store.get(key)?.ttl).toBeGreaterThan(Date.now())
    })

    it('should not reset expiry on subsequent increments', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:noexpire', 60000)
      const key = 'raffel:rate-limit:redis:noexpire'
      const firstTtl = mockClient.store.get(key)?.ttl

      await new Promise(r => setTimeout(r, 10))

      await driver.increment('redis:noexpire', 60000)
      const secondTtl = mockClient.store.get(key)?.ttl

      // TTL should be approximately the same (first set only)
      expect(secondTtl).toBe(firstTtl)
    })
  })

  describe('decrement', () => {
    it('should decrement count', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:dec', 60000)
      await driver.increment('redis:dec', 60000)

      await driver.decrement('redis:dec')

      const key = 'raffel:rate-limit:redis:dec'
      expect(mockClient.store.get(key)?.value).toBe(1)
    })

    it('should handle client without decr method', async () => {
      const mockClient = createMockRedisClient()
      delete (mockClient as any).decr

      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:nodecr', 60000)

      // Should not throw
      await driver.decrement('redis:nodecr')
    })
  })

  describe('reset', () => {
    it('should delete key', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:reset', 60000)
      await driver.reset('redis:reset')

      const key = 'raffel:rate-limit:redis:reset'
      expect(mockClient.store.has(key)).toBe(false)
    })

    it('should handle client without del method', async () => {
      const mockClient = createMockRedisClient()
      delete (mockClient as any).del

      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('redis:nodel', 60000)

      // Should not throw
      await driver.reset('redis:nodel')
    })
  })

  describe('prefix handling', () => {
    it('should use default prefix', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient })

      await driver.increment('mykey', 60000)

      expect(mockClient.store.has('raffel:rate-limit:mykey')).toBe(true)
    })

    it('should use custom prefix', async () => {
      const mockClient = createMockRedisClient()
      const driver = new RedisRateLimitDriver({ client: mockClient, prefix: 'app:ratelimit:' })

      await driver.increment('mykey', 60000)

      expect(mockClient.store.has('app:ratelimit:mykey')).toBe(true)
    })
  })
})

// ============================================================================
// Driver Interface Compliance Tests
// ============================================================================

describe('Driver Interface Compliance', () => {
  const drivers: { name: string; create: () => RateLimitDriver }[] = [
    {
      name: 'MemoryRateLimitDriver',
      create: () => new MemoryRateLimitDriver({ cleanupInterval: 0 }),
    },
    {
      name: 'FilesystemRateLimitDriver',
      create: () => {
        const dir = `.rate-limit-compliance-test-${Date.now()}`
        return new FilesystemRateLimitDriver({ directory: dir, cleanupInterval: 0 })
      },
    },
    {
      name: 'RedisRateLimitDriver',
      create: () => {
        const store = new Map<string, { value: number; ttl: number }>()
        const client: RedisLikeClient = {
          async incr(key: string) {
            const existing = store.get(key)
            if (existing) {
              existing.value += 1
              return existing.value
            }
            store.set(key, { value: 1, ttl: 0 })
            return 1
          },
          async pexpire(key: string, ttlMs: number) {
            const existing = store.get(key)
            if (existing) existing.ttl = Date.now() + ttlMs
            return 1
          },
          async pttl(key: string) {
            const existing = store.get(key)
            return existing?.ttl ? Math.max(0, existing.ttl - Date.now()) : -1
          },
        }
        return new RedisRateLimitDriver({ client })
      },
    },
  ]

  for (const { name, create } of drivers) {
    describe(name, () => {
      let driver: RateLimitDriver

      beforeEach(() => {
        driver = create()
      })

      afterEach(async () => {
        await driver.shutdown?.()
        // Cleanup filesystem driver directory
        if (driver.name === 'filesystem') {
          const dir = (driver as FilesystemRateLimitDriver)['directory']
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true })
          }
        }
      })

      it('should have name property', () => {
        expect(typeof driver.name).toBe('string')
        expect(driver.name.length).toBeGreaterThan(0)
      })

      it('should implement increment', async () => {
        const record = await driver.increment(`${name}:compliance:1`, 60000)

        expect(typeof record.count).toBe('number')
        expect(typeof record.resetAt).toBe('number')
        expect(record.count).toBe(1)
        expect(record.resetAt).toBeGreaterThan(Date.now())
      })

      it('should return consistent record format', async () => {
        const record1 = await driver.increment(`${name}:compliance:2`, 60000)
        const record2 = await driver.increment(`${name}:compliance:2`, 60000)

        expect(record1).toHaveProperty('count')
        expect(record1).toHaveProperty('resetAt')
        expect(record2).toHaveProperty('count')
        expect(record2).toHaveProperty('resetAt')

        expect(record2.count).toBe(record1.count + 1)
      })
    })
  }
})
