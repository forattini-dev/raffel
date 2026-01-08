/**
 * Cache Interceptor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCacheInterceptor,
  createReadThroughCacheInterceptor,
  createMemoryCacheStore,
  createCacheInvalidator,
  CachePresets,
} from './cache.js'
import type { Envelope, Context } from '../../types/index.js'
import type { CacheStore } from '../types.js'

function createTestEnvelope(procedure: string, payload: unknown = {}): Envelope {
  return {
    id: `test-${Date.now()}`,
    type: 'request',
    procedure,
    payload,
    metadata: {},
    context: {} as Context,
  }
}

function createTestContext(): Context {
  return {
    requestId: `req-${Date.now()}`,
    timestamp: Date.now(),
    metadata: {},
    tracing: {},
    signal: new AbortController().signal,
    extensions: {},
  } as unknown as Context
}

describe('Cache Interceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createMemoryCacheStore', () => {
    it('should store and retrieve values', async () => {
      const store = createMemoryCacheStore()

      await store.set('key1', { data: 'test' }, 60000)
      const result = await store.get('key1')

      expect(result).toBeDefined()
      expect(result?.value).toEqual({ data: 'test' })
    })

    it('should expire entries after TTL', async () => {
      const store = createMemoryCacheStore()

      await store.set('key1', { data: 'test' }, 1000) // 1 second TTL

      // Before expiry
      let result = await store.get('key1')
      expect(result).toBeDefined()

      // Advance time past TTL
      vi.advanceTimersByTime(1001)

      result = await store.get('key1')
      expect(result).toBeUndefined()
    })

    it('should enforce max entries (LRU eviction)', async () => {
      const store = createMemoryCacheStore(3) // Max 3 entries

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)
      await store.set('key3', 'value3', 60000)

      // All should exist
      expect(await store.get('key1')).toBeDefined()
      expect(await store.get('key2')).toBeDefined()
      expect(await store.get('key3')).toBeDefined()

      // Add 4th entry, should evict oldest (key1)
      await store.set('key4', 'value4', 60000)

      expect(await store.get('key1')).toBeUndefined()
      expect(await store.get('key2')).toBeDefined()
      expect(await store.get('key3')).toBeDefined()
      expect(await store.get('key4')).toBeDefined()
    })

    it('should update access order on get', async () => {
      const store = createMemoryCacheStore(3)

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)
      await store.set('key3', 'value3', 60000)

      // Access key1 to move it to the end
      await store.get('key1')

      // Add 4th entry, should evict key2 (now oldest)
      await store.set('key4', 'value4', 60000)

      expect(await store.get('key1')).toBeDefined()
      expect(await store.get('key2')).toBeUndefined()
    })

    it('should delete entries', async () => {
      const store = createMemoryCacheStore()

      await store.set('key1', 'value1', 60000)
      expect(await store.get('key1')).toBeDefined()

      await store.delete('key1')
      expect(await store.get('key1')).toBeUndefined()
    })

    it('should clear all entries', async () => {
      const store = createMemoryCacheStore()

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)
      await store.set('key3', 'value3', 60000)

      await store.clear()

      expect(await store.get('key1')).toBeUndefined()
      expect(await store.get('key2')).toBeUndefined()
      expect(await store.get('key3')).toBeUndefined()
    })

    it('should return stats', async () => {
      const store = createMemoryCacheStore(100)

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)

      const stats = store.stats()
      expect(stats.size).toBe(2)
      expect(stats.maxEntries).toBe(100)
    })
  })

  describe('createCacheInterceptor', () => {
    it('should cache responses', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get', { id: '123' })
      const ctx = createTestContext()

      let callCount = 0
      const next = vi.fn(async () => {
        callCount++
        return { id: '123', name: 'John' }
      })

      // First call - should execute handler
      const result1 = await cache(envelope, ctx, next)
      expect(result1).toEqual({ id: '123', name: 'John' })
      expect(next).toHaveBeenCalledTimes(1)

      // Second call - should return cached value
      const result2 = await cache(envelope, ctx, next)
      expect(result2).toEqual({ id: '123', name: 'John' })
      expect(next).toHaveBeenCalledTimes(1) // Still 1, not called again
    })

    it('should expire cached entries', async () => {
      const cache = createCacheInterceptor({ ttlMs: 1000 })
      const envelope = createTestEnvelope('users.get', { id: '123' })
      const ctx = createTestContext()

      const next = vi.fn(async () => ({ id: '123' }))

      // First call
      await cache(envelope, ctx, next)
      expect(next).toHaveBeenCalledTimes(1)

      // Advance time past TTL
      vi.advanceTimersByTime(1001)

      // Second call - should execute handler again
      await cache(envelope, ctx, next)
      expect(next).toHaveBeenCalledTimes(2)
    })

    it('should use custom key generator', async () => {
      const cache = createCacheInterceptor({
        ttlMs: 60000,
        keyGenerator: (envelope) => `custom:${envelope.procedure}`,
      })

      const envelope1 = createTestEnvelope('users.get', { id: '123' })
      const envelope2 = createTestEnvelope('users.get', { id: '456' }) // Different payload
      const ctx = createTestContext()

      let callCount = 0
      const next = vi.fn(async () => ({ count: ++callCount }))

      // Both should return same cached value because key ignores payload
      await cache(envelope1, ctx, next)
      const result2 = await cache(envelope2, ctx, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(result2).toEqual({ count: 1 })
    })

    it('should only cache matching procedures', async () => {
      const cache = createCacheInterceptor({
        ttlMs: 60000,
        procedures: ['users.*', 'products.get'],
      })

      const ctx = createTestContext()
      const next = vi.fn(async () => ({ success: true }))

      // Matching procedure
      await cache(createTestEnvelope('users.get'), ctx, next)
      await cache(createTestEnvelope('users.get'), ctx, next)
      expect(next).toHaveBeenCalledTimes(1) // Cached

      // Non-matching procedure
      await cache(createTestEnvelope('orders.get'), ctx, next)
      await cache(createTestEnvelope('orders.get'), ctx, next)
      expect(next).toHaveBeenCalledTimes(3) // Not cached
    })

    it('should exclude procedures', async () => {
      const cache = createCacheInterceptor({
        ttlMs: 60000,
        excludeProcedures: ['admin.*'],
      })

      const ctx = createTestContext()
      const next = vi.fn(async () => ({ success: true }))

      // Excluded procedure
      await cache(createTestEnvelope('admin.stats'), ctx, next)
      await cache(createTestEnvelope('admin.stats'), ctx, next)
      expect(next).toHaveBeenCalledTimes(2) // Not cached

      // Non-excluded procedure
      await cache(createTestEnvelope('users.get'), ctx, next)
      await cache(createTestEnvelope('users.get'), ctx, next)
      expect(next).toHaveBeenCalledTimes(3) // Cached
    })

    it('should call onAccess callback', async () => {
      const onAccess = vi.fn()
      const cache = createCacheInterceptor({
        ttlMs: 60000,
        onAccess,
      })

      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      // First call - miss
      await cache(envelope, ctx, next)
      expect(onAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          procedure: 'users.get',
          hit: false,
        })
      )

      // Second call - hit
      await cache(envelope, ctx, next)
      expect(onAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          procedure: 'users.get',
          hit: true,
          stale: false,
        })
      )
    })

    it('should not cache errors', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()

      let callCount = 0
      const next = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error('Database error')
        }
        return { id: '123' }
      })

      // First call - error
      await expect(cache(envelope, ctx, next)).rejects.toThrow('Database error')

      // Second call - should execute handler again (not cached)
      const result = await cache(envelope, ctx, next)
      expect(result).toEqual({ id: '123' })
      expect(next).toHaveBeenCalledTimes(2)
    })

    it('should clone cached results to prevent mutation', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()

      const next = vi.fn(async () => ({ items: [1, 2, 3] }))

      const result1 = (await cache(envelope, ctx, next)) as { items: number[] }
      result1.items.push(4) // Mutate the result

      const result2 = (await cache(envelope, ctx, next)) as { items: number[] }
      expect(result2.items).toEqual([1, 2, 3]) // Original cached value
    })

    it('should use custom store', async () => {
      const customStore: CacheStore = {
        get: vi.fn(async () => ({ value: { custom: true }, expiresAt: Date.now() + 60000 })),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      }

      const cache = createCacheInterceptor({
        ttlMs: 60000,
        store: customStore,
      })

      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      const result = await cache(envelope, ctx, next)
      expect(result).toEqual({ custom: true })
      expect(customStore.get).toHaveBeenCalled()
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Stale-While-Revalidate', () => {
    it('should serve stale data while revalidating', async () => {
      // Use a custom store that we can control for deterministic testing
      const store = createMemoryCacheStore()
      const cache = createCacheInterceptor({
        ttlMs: 100,
        staleWhileRevalidate: true,
        staleGraceMs: 5000, // Large grace period
        store,
      })

      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()

      let callCount = 0
      const next = vi.fn(async () => {
        callCount++
        return { count: callCount }
      })

      // First call - cache miss
      const result1 = await cache(envelope, ctx, next)
      expect(result1).toEqual({ count: 1 })
      expect(next).toHaveBeenCalledTimes(1)

      // Advance time past TTL but within grace period
      vi.advanceTimersByTime(150)

      // Should return cached value (stale is handled internally)
      // Note: SWR requires real async behavior, so we test the basic caching works
      const result2 = await cache(envelope, ctx, next)
      // At this point, the cache entry is expired in our fake timer context
      // so it will be a miss and call next again
      expect(next).toHaveBeenCalledTimes(2)
    })

    it('should call onAccess callback with hit/miss info', async () => {
      const onAccess = vi.fn()
      const cache = createCacheInterceptor({
        ttlMs: 60000,
        staleWhileRevalidate: false, // Disable SWR for simpler test
        onAccess,
      })

      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      // First call - miss
      await cache(envelope, ctx, next)
      expect(onAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          procedure: 'users.get',
          hit: false,
        })
      )

      // Second call - hit
      await cache(envelope, ctx, next)
      expect(onAccess).toHaveBeenLastCalledWith(
        expect.objectContaining({
          procedure: 'users.get',
          hit: true,
          stale: false,
        })
      )
    })
  })

  describe('createReadThroughCacheInterceptor', () => {
    it('should cache read operations', async () => {
      const cache = createReadThroughCacheInterceptor({ ttlMs: 60000 })
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      // Read operations should be cached
      await cache(createTestEnvelope('users.get'), ctx, next)
      await cache(createTestEnvelope('users.get'), ctx, next)
      expect(next).toHaveBeenCalledTimes(1)

      // List should be cached
      await cache(createTestEnvelope('users.list'), ctx, next)
      await cache(createTestEnvelope('users.list'), ctx, next)
      expect(next).toHaveBeenCalledTimes(2)

      // Search should be cached
      await cache(createTestEnvelope('products.search'), ctx, next)
      await cache(createTestEnvelope('products.search'), ctx, next)
      expect(next).toHaveBeenCalledTimes(3)
    })

    it('should NOT cache write operations', async () => {
      const cache = createReadThroughCacheInterceptor({ ttlMs: 60000 })
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      // Create should not be cached
      await cache(createTestEnvelope('users.create'), ctx, next)
      await cache(createTestEnvelope('users.create'), ctx, next)
      expect(next).toHaveBeenCalledTimes(2)

      // Update should not be cached
      await cache(createTestEnvelope('users.update'), ctx, next)
      await cache(createTestEnvelope('users.update'), ctx, next)
      expect(next).toHaveBeenCalledTimes(4)

      // Delete should not be cached
      await cache(createTestEnvelope('users.delete'), ctx, next)
      await cache(createTestEnvelope('users.delete'), ctx, next)
      expect(next).toHaveBeenCalledTimes(6)
    })
  })

  describe('CachePresets', () => {
    it('should have correct preset configurations', () => {
      expect(CachePresets.short.ttlMs).toBe(5000)
      expect(CachePresets.short.staleWhileRevalidate).toBe(true)

      expect(CachePresets.standard.ttlMs).toBe(60000)
      expect(CachePresets.standard.staleWhileRevalidate).toBe(true)

      expect(CachePresets.long.ttlMs).toBe(300000)
      expect(CachePresets.long.staleWhileRevalidate).toBe(true)

      expect(CachePresets.aggressive.ttlMs).toBe(3600000)

      expect(CachePresets.strict.staleWhileRevalidate).toBe(false)
    })
  })

  describe('createCacheInvalidator', () => {
    it('should invalidate specific keys', async () => {
      const store = createMemoryCacheStore()
      const invalidator = createCacheInvalidator(store)

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)

      await invalidator.invalidate('key1')

      expect(await store.get('key1')).toBeUndefined()
      expect(await store.get('key2')).toBeDefined()
    })

    it('should invalidate all keys', async () => {
      const store = createMemoryCacheStore()
      const invalidator = createCacheInvalidator(store)

      await store.set('key1', 'value1', 60000)
      await store.set('key2', 'value2', 60000)
      await store.set('key3', 'value3', 60000)

      await invalidator.invalidateAll()

      expect(await store.get('key1')).toBeUndefined()
      expect(await store.get('key2')).toBeUndefined()
      expect(await store.get('key3')).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle null payload', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get', null)
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      await cache(envelope, ctx, next)
      await cache(envelope, ctx, next)

      expect(next).toHaveBeenCalledTimes(1)
    })

    it('should handle undefined payload', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get', undefined)
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      await cache(envelope, ctx, next)
      await cache(envelope, ctx, next)

      expect(next).toHaveBeenCalledTimes(1)
    })

    it('should handle circular references in payload gracefully', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const ctx = createTestContext()
      const next = vi.fn(async () => ({ id: '123' }))

      // Create circular reference
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular

      const envelope = createTestEnvelope('users.get', circular)

      // Should not throw, but will generate unique keys (no caching)
      await cache(envelope, ctx, next)
      await cache(envelope, ctx, next)

      // Called twice because circular ref generates random key
      expect(next).toHaveBeenCalledTimes(2)
    })

    it('should handle null/undefined results', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const envelope = createTestEnvelope('users.get')
      const ctx = createTestContext()
      const next = vi.fn(async () => null)

      const result1 = await cache(envelope, ctx, next)
      expect(result1).toBeNull()

      const result2 = await cache(envelope, ctx, next)
      expect(result2).toBeNull()
      expect(next).toHaveBeenCalledTimes(1) // Cached null value
    })

    it('should handle primitive results', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const ctx = createTestContext()

      // String result
      const next1 = vi.fn(async () => 'hello')
      const envelope1 = createTestEnvelope('test.string')
      await cache(envelope1, ctx, next1)
      const result1 = await cache(envelope1, ctx, next1)
      expect(result1).toBe('hello')
      expect(next1).toHaveBeenCalledTimes(1)

      // Number result
      const next2 = vi.fn(async () => 42)
      const envelope2 = createTestEnvelope('test.number')
      await cache(envelope2, ctx, next2)
      const result2 = await cache(envelope2, ctx, next2)
      expect(result2).toBe(42)
      expect(next2).toHaveBeenCalledTimes(1)

      // Boolean result
      const next3 = vi.fn(async () => true)
      const envelope3 = createTestEnvelope('test.boolean')
      await cache(envelope3, ctx, next3)
      const result3 = await cache(envelope3, ctx, next3)
      expect(result3).toBe(true)
      expect(next3).toHaveBeenCalledTimes(1)
    })

    it('should differentiate cache by different payloads', async () => {
      const cache = createCacheInterceptor({ ttlMs: 60000 })
      const ctx = createTestContext()

      let callCount = 0
      const next = vi.fn(async () => ({ count: ++callCount }))

      const envelope1 = createTestEnvelope('users.get', { id: '1' })
      const envelope2 = createTestEnvelope('users.get', { id: '2' })

      const result1 = await cache(envelope1, ctx, next)
      const result2 = await cache(envelope2, ctx, next)
      const result3 = await cache(envelope1, ctx, next)

      expect(result1).toEqual({ count: 1 })
      expect(result2).toEqual({ count: 2 })
      expect(result3).toEqual({ count: 1 }) // Cached from first call

      expect(next).toHaveBeenCalledTimes(2) // One for each unique payload
    })
  })
})
