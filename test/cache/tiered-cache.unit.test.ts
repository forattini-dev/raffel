import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createMemoryCacheLayer,
  createFileSystemCacheLayer,
  createTieredCache,
  type CacheLayer,
} from '../../src/cache/tiered.js'
import { createRedisCacheLayer } from '../../src/cache/redis-layer.js'

describe('TieredCache', () => {
  it('returns an L1 value by reference without consulting lower layers', async () => {
    const lowerGet = vi.fn<CacheLayer['get']>()
    const lower: CacheLayer = {
      id: 'l2',
      get: lowerGet,
      set: vi.fn(),
      delete: vi.fn(),
      clearNamespace: vi.fn(),
    }
    const cache = createTieredCache({
      namespace: 'catalog',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000, maxEntries: 10 }),
        lower,
      ],
    })
    const value = { id: 42, name: 'cached' }

    await cache.set('product:42', value)
    const result = await cache.get<typeof value>('product:42')

    expect(result?.value).toBe(value)
    expect(result?.layer).toBe('l1')
    expect(lowerGet).not.toHaveBeenCalled()

    await cache.shutdown()
  })

  it('promotes a lower-layer hit into L1 with a fresh L1 TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    const value = { id: 7 }
    const lowerGet = vi.fn<CacheLayer['get']>().mockResolvedValue({
      value,
      createdAt: Date.now() - 30_000,
      expiresAt: Date.now() + 60_000,
      version: 1,
    })
    const cache = createTieredCache({
      namespace: 'catalog',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 1_000, maxEntries: 10 }),
        {
          id: 'l2',
          ttlMs: 60_000,
          get: lowerGet,
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    expect((await cache.get('product:7'))?.layer).toBe('l2')
    vi.advanceTimersByTime(999)
    expect((await cache.get<typeof value>('product:7'))?.value).toBe(value)
    expect(lowerGet).toHaveBeenCalledTimes(1)

    await cache.shutdown()
    vi.useRealTimers()
  })

  it('prefers a fresh lower-layer value over a stale upper-layer fallback', async () => {
    const now = Date.now()
    const promote = vi.fn<CacheLayer['set']>()
    const cache = createTieredCache({
      namespace: 'freshest',
      layers: [
        {
          id: 'l1',
          ttlMs: 1_000,
          get: vi.fn().mockReturnValue({
            value: { version: 'stale' },
            createdAt: now - 2_000,
            expiresAt: now - 1_000,
            staleUntil: now + 10_000,
            version: 1,
          }),
          set: promote,
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
        {
          id: 'l2',
          ttlMs: 60_000,
          get: vi.fn().mockResolvedValue({
            value: { version: 'fresh' },
            createdAt: now,
            expiresAt: now + 60_000,
            version: 2,
          }),
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    expect((await cache.get<{ version: string }>('one'))?.value.version).toBe('fresh')
    expect(promote).toHaveBeenCalledOnce()
    await cache.shutdown()
  })

  it('evicts the least recently used value to stay within the logical byte budget', async () => {
    const cache = createTieredCache({
      namespace: 'budget',
      layers: [
        createMemoryCacheLayer({
          id: 'l1',
          ttlMs: 60_000,
          maxEntries: 10,
          maxMemoryBytes: 18,
        }),
      ],
    })

    await cache.set('a', 'value-a')
    await cache.set('b', 'value-b')
    await cache.get('a')
    await cache.set('c', 'value-c')

    expect((await cache.get('a'))?.value).toBe('value-a')
    expect(await cache.get('b')).toBeUndefined()
    expect((await cache.get('c'))?.value).toBe('value-c')

    await cache.shutdown()
  })

  it('releases generation metadata after high-cardinality operations settle', async () => {
    const cache = createTieredCache({
      namespace: 'metadata-budget',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000, maxEntries: 10 })],
    })

    for (let index = 0; index < 100; index++) {
      await cache.set(`key:${index}`, { index })
      await cache.delete(`key:${index}`)
    }

    expect(cache.stats()[0]?.trackedKeys).toBe(0)
    expect(cache.stats()[0]?.fencedKeys).toBe(0)
    await cache.shutdown()
  })

  it('reclaims expired L1 entries through one shared expiration scheduler', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    const layer = createMemoryCacheLayer({
      id: 'l1',
      ttlMs: 500,
      maxEntries: 10,
      expirationResolutionMs: 100,
    })
    const cache = createTieredCache({ namespace: 'ttl', layers: [layer] })

    await cache.set('short-lived', { ok: true })
    expect(layer.stats?.().totalItems).toBe(1)

    await vi.advanceTimersByTimeAsync(600)

    expect(layer.stats?.().totalItems).toBe(0)
    await cache.shutdown()
    vi.useRealTimers()
  })

  it('returns after writing L1 without waiting for lower-layer writes', async () => {
    let releaseLower!: () => void
    const lowerWrite = new Promise<void>((resolve) => {
      releaseLower = resolve
    })
    const lowerSet = vi.fn<CacheLayer['set']>().mockReturnValue(lowerWrite)
    const cache = createTieredCache({
      namespace: 'write-behind',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 }),
        {
          id: 'l2',
          ttlMs: 60_000,
          get: vi.fn(),
          set: lowerSet,
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    const completedFirst = await Promise.race([
      cache.set('fast', { ok: true }).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
    ])

    expect(completedFirst).toBe(true)
    expect(lowerSet).toHaveBeenCalledOnce()

    releaseLower()
    await cache.shutdown()
  })

  it('serializes writes for the same lower-layer key', async () => {
    let active = 0
    let maxActive = 0
    let releaseFirst!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const writes: unknown[] = []
    const lowerSet = vi.fn<CacheLayer['set']>(async (_key, record) => {
      active++
      maxActive = Math.max(maxActive, active)
      if (writes.length === 0) {
        markStarted()
        await firstGate
      }
      writes.push(record.value)
      active--
    })
    const cache = createTieredCache({
      namespace: 'ordered',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 }),
        {
          id: 'l2',
          ttlMs: 60_000,
          get: vi.fn(),
          set: lowerSet,
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    await cache.set('same', { version: 1 })
    await started
    await cache.set('same', { version: 2 })
    await Promise.resolve()

    expect(maxActive).toBe(1)
    releaseFirst()
    await cache.shutdown()
    expect(writes).toEqual([{ version: 1 }, { version: 2 }])
  })

  it('orders exact invalidation after an active write-behind task', async () => {
    let releaseWrite!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const stored = new Map<string, unknown>()
    const lower: CacheLayer = {
      id: 'l2',
      ttlMs: 60_000,
      get: vi.fn(),
      async set(key, record) {
        markStarted()
        await gate
        stored.set(key, record.value)
      },
      async delete(key) { stored.delete(key) },
      clearNamespace: vi.fn(),
    }
    const cache = createTieredCache({
      namespace: 'invalidation-order',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 }),
        lower,
      ],
    })

    await cache.set('same', { stale: true })
    await started
    const invalidation = cache.delete('same')
    await Promise.resolve()
    releaseWrite()
    await invalidation

    expect(stored.size).toBe(0)
    await cache.shutdown()
  })

  it('discards a lower-layer read that completes after exact invalidation', async () => {
    let releaseRead!: (record: Awaited<ReturnType<CacheLayer['get']>>) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const pendingRead = new Promise<Awaited<ReturnType<CacheLayer['get']>>>((resolve) => {
      releaseRead = resolve
    })
    const lowerGet = vi.fn<CacheLayer['get']>()
      .mockImplementationOnce(() => {
        markStarted()
        return pendingRead
      })
      .mockResolvedValue(undefined)
    const cache = createTieredCache({
      namespace: 'read-invalidation',
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 }),
        {
          id: 'l2',
          ttlMs: 60_000,
          get: lowerGet,
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    const lookup = cache.get('same')
    await started
    await cache.delete('same')
    releaseRead({
      value: { stale: true },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      version: 1,
    })

    expect(await lookup).toBeUndefined()
    expect(await cache.get('same')).toBeUndefined()
    await cache.shutdown()
  })

  it('waits for or fences an in-progress promotion before invalidating', async () => {
    let releasePromotion!: () => void
    let markPromotionStarted!: () => void
    const promotionStarted = new Promise<void>((resolve) => { markPromotionStarted = resolve })
    const promotionGate = new Promise<void>((resolve) => { releasePromotion = resolve })
    const promoted = new Map<string, unknown>()
    const upper: CacheLayer = {
      id: 'l1',
      ttlMs: 60_000,
      get: (key) => promoted.get(key) as ReturnType<CacheLayer['get']>,
      async set(key, record) {
        markPromotionStarted()
        await promotionGate
        promoted.set(key, record)
      },
      delete: (key) => { promoted.delete(key) },
      clearNamespace: () => { promoted.clear() },
    }
    const cache = createTieredCache({
      namespace: 'promotion-invalidation',
      operationTimeoutMs: 5,
      layers: [
        upper,
        {
          id: 'l2',
          ttlMs: 60_000,
          get: vi.fn().mockResolvedValue({
            value: { stale: true },
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            version: 1,
          }),
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    const lookup = cache.get('same')
    await promotionStarted
    await cache.delete('same')
    expect(await lookup).toBeUndefined()
    releasePromotion()
    await vi.waitFor(() => expect(promoted.size).toBe(0))
    await cache.shutdown()
  })

  it('does not let a timed-out lower write block or outlive invalidation', async () => {
    let releaseWrite!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const stored = new Map<string, unknown>()
    const cache = createTieredCache({
      namespace: 'timed-write',
      operationTimeoutMs: 5,
      layers: [
        createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 }),
        {
          id: 'l2',
          ttlMs: 60_000,
          get: (key) => stored.get(key) as ReturnType<CacheLayer['get']>,
          async set(key, record) {
            markStarted()
            await gate
            stored.set(key, record)
          },
          async delete(key) { stored.delete(key) },
          clearNamespace: vi.fn(),
        },
      ],
    })

    await cache.set('same', { stale: true })
    await started
    await expect(cache.delete('same')).resolves.toBeUndefined()
    releaseWrite()
    await vi.waitFor(() => expect(stored.size).toBe(0))
    await cache.shutdown()
  })

  it('fails a hanging layer invalidation within the operation deadline', async () => {
    const cache = createTieredCache({
      namespace: 'timed-delete',
      operationTimeoutMs: 5,
      layers: [{
        id: 'provider',
        get: vi.fn().mockResolvedValue({
          value: { stale: true },
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          version: 1,
        }),
        set: vi.fn(),
        delete: () => new Promise(() => undefined),
        clearNamespace: vi.fn(),
      }],
    })

    await expect(cache.delete('same')).rejects.toThrow(/invalidation failed/)
    expect(await cache.get('same')).toBeUndefined()
    await cache.shutdown()
  })

  it('reads a filesystem entry from a new cache instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'raffel-tiered-cache-'))
    try {
      const writer = createTieredCache({
        namespace: 'persistent',
        layers: [createFileSystemCacheLayer({ id: 'l2', directory, ttlMs: 60_000 })],
      })
      await writer.set('product:9', { id: 9, name: 'disk' })
      await writer.shutdown()

      const reader = createTieredCache({
        namespace: 'persistent',
        layers: [createFileSystemCacheLayer({ id: 'l2', directory, ttlMs: 60_000 })],
      })

      expect((await reader.get('product:9'))?.value).toEqual({ id: 9, name: 'disk' })
      await reader.shutdown()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails open to the next layer when a cache read fails', async () => {
    const expected = { source: 'provider' }
    const cache = createTieredCache({
      namespace: 'resilient',
      layers: [
        {
          id: 'l2',
          ttlMs: 60_000,
          get: vi.fn().mockRejectedValue(new Error('disk unavailable')),
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
        {
          id: 'l3',
          ttlMs: 60_000,
          get: vi.fn().mockResolvedValue({
            value: expected,
            createdAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            version: 1,
          }),
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    expect((await cache.get('available'))?.value).toBe(expected)
    await cache.shutdown()
  })

  it('times out a hanging lower read and opens its circuit', async () => {
    const hangingGet = vi.fn<CacheLayer['get']>(() => new Promise(() => undefined))
    const providerGet = vi.fn<CacheLayer['get']>().mockResolvedValue({
      value: { source: 'provider' },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      version: 1,
    })
    const cache = createTieredCache({
      namespace: 'read-timeout',
      layers: [
        {
          id: 'l2',
          ttlMs: 60_000,
          readTimeoutMs: 5,
          circuitBreaker: { failureThreshold: 1, cooldownMs: 60_000 },
          get: hangingGet,
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
        {
          id: 'l3',
          ttlMs: 60_000,
          get: providerGet,
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    expect((await cache.get('available'))?.value).toEqual({ source: 'provider' })
    expect((await cache.get('available'))?.value).toEqual({ source: 'provider' })
    expect(hangingGet).toHaveBeenCalledTimes(1)
    expect(providerGet).toHaveBeenCalledTimes(2)
    await cache.shutdown()
  })

  it('applies the tiered read timeout when a custom layer omits one', async () => {
    const providerGet = vi.fn<CacheLayer['get']>().mockResolvedValue({
      value: { source: 'provider' },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      version: 1,
    })
    const cache = createTieredCache({
      namespace: 'default-read-timeout',
      readTimeoutMs: 5,
      layers: [
        {
          id: 'custom',
          get: () => new Promise(() => undefined),
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
        {
          id: 'provider',
          get: providerGet,
          set: vi.fn(),
          delete: vi.fn(),
          clearNamespace: vi.fn(),
        },
      ],
    })

    expect((await cache.get('available'))?.value).toEqual({ source: 'provider' })
    await cache.shutdown()
  })

  it('rejects values that cannot round-trip consistently through lower layers', async () => {
    const cache = createTieredCache({
      namespace: 'json-safe',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
    })

    await cache.set('response', new Response('one-shot'))
    await cache.set('date', { createdAt: new Date() })

    expect(await cache.get('response')).toBeUndefined()
    expect(await cache.get('date')).toBeUndefined()
    await cache.shutdown()
  })

  it('surfaces namespace invalidation failures to the caller', async () => {
    const record = {
      value: { stillAvailable: true },
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      version: 1,
    }
    const cache = createTieredCache({
      namespace: 'clear-errors',
      layers: [{
        id: 'l1',
        get: vi.fn().mockReturnValue(record),
        set: vi.fn(),
        delete: vi.fn(),
        clearNamespace: vi.fn()
          .mockRejectedValueOnce(new Error('SCAN unavailable'))
          .mockResolvedValue(undefined),
      }],
    })

    await expect(cache.clearNamespace()).rejects.toThrow(/invalidation failed/)
    expect(await cache.get('one')).toBeUndefined()
    await expect(cache.clearNamespace()).resolves.toBeUndefined()
    expect((await cache.get('one'))?.value).toEqual({ stillAvailable: true })
    await cache.shutdown()
  })
})

describe('Redis/Valkey cache layer', () => {
  it('stores the physical stale window with native millisecond TTL', async () => {
    const values = new Map<string, string>()
    const sets: Array<[string, string, string, number]> = []
    const client = {
      async get(key: string) { return values.get(key) ?? null },
      async set(key: string, value: string, mode: string, duration: number) {
        values.set(key, value)
        sets.push([key, value, mode, duration])
      },
      async del(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key]) values.delete(item)
        return 1
      },
    }
    const layer = createRedisCacheLayer({ id: 'l3', client, ttlMs: 60_000 })
    const now = Date.now()

    await layer.set('catalog:one', {
      value: { id: 1 },
      createdAt: now,
      expiresAt: now,
      version: 1,
    }, 10_000, 5_000)

    expect(sets[0]?.[2]).toBe('PX')
    expect(sets[0]?.[3]).toBe(15_000)
    expect((await layer.get('catalog:one'))?.value).toEqual({ id: 1 })
  })

  it('uses pSetEx for node-redis compatible clients', async () => {
    const pSetEx = vi.fn(async () => 'OK')
    const client = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => { throw new Error('wrong set signature') }),
      pSetEx,
      del: vi.fn(async () => 1),
    }
    const layer = createRedisCacheLayer({ id: 'l3', client, ttlMs: 60_000 })

    await layer.set('one', {
      value: { ok: true },
      createdAt: Date.now(),
      expiresAt: Date.now(),
      version: 1,
    }, 2_000, 500)

    expect(pSetEx).toHaveBeenCalledWith('raffel:cache:one', 2_500, expect.any(String))
    expect(client.set).not.toHaveBeenCalled()
  })

  it('surfaces unsupported namespace invalidation', async () => {
    const layer = createRedisCacheLayer({
      id: 'l3',
      ttlMs: 60_000,
      client: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        del: vi.fn(async () => 0),
      },
    })

    await expect(layer.clearNamespace('catalog')).rejects.toThrow(/SCAN/)
  })

  it('ships safe read and operation timeouts for direct adapter usage', () => {
    const layer = createRedisCacheLayer({
      id: 'l3',
      ttlMs: 60_000,
      client: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        del: vi.fn(async () => 0),
      },
    })

    expect(layer.readTimeoutMs).toBeGreaterThan(0)
    expect(layer.operationTimeoutMs).toBeGreaterThan(0)
    expect(layer.circuitBreaker?.failureThreshold).toBeGreaterThan(0)
  })
})
