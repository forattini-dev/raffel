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
})
