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
  it('keeps arbitrary service namespaces structurally isolated', async () => {
    const layer = createMemoryCacheLayer({ id: 'shared', ttlMs: 60_000 })
    const billing = createTieredCache({ namespace: 'billing', layers: [layer] })
    const billingV2 = createTieredCache({ namespace: 'billing:v2', layers: [layer] })

    await billing.set('v2:item', { service: 'billing' })

    expect(await billingV2.get('item')).toBeUndefined()
    expect((await billing.get('v2:item'))?.value).toEqual({ service: 'billing' })
    await Promise.all([billing.shutdown(), billingV2.shutdown()])
  })

  it('rejects duplicate physical layer ids in the core factory', () => {
    expect(() => createTieredCache({
      namespace: 'duplicate-layers',
      layers: [
        createMemoryCacheLayer({ id: 'same', ttlMs: 60_000 }),
        createMemoryCacheLayer({ id: 'same', ttlMs: 60_000 }),
      ],
    })).toThrow('Cache layer id "same" is duplicated')
  })

  it('invalidates tagged entries without removing unrelated entries', async () => {
    const cache = createTieredCache({
      namespace: 'tagged',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
    })
    await cache.set('leads:list', { ids: [1] }, { tags: ['node:stone'] })
    await cache.set('leads:detail:1', { id: 1 }, { tags: ['lead:1'] })

    const result = await cache.invalidateTag('node:stone')

    expect(result).toEqual({
      mode: 'physical',
      deleted: 1,
      layers: { l1: { mode: 'physical', deleted: 1 } },
    })
    expect(await cache.get('leads:list')).toBeUndefined()
    expect((await cache.get('leads:detail:1'))?.value).toEqual({ id: 1 })
    await cache.shutdown()
  })

  it('counts tag metadata against the configured L1 byte budget', () => {
    const layer = createMemoryCacheLayer({
      id: 'l1',
      ttlMs: 60_000,
      maxMemoryBytes: 64,
    })
    const now = Date.now()

    layer.set('catalog:one', {
      value: 1,
      tags: ['x'.repeat(100)],
      createdAt: now,
      expiresAt: now,
      version: 1,
    }, 60_000)

    expect(layer.stats?.().totalItems).toBe(0)
    expect(layer.stats?.().memoryUsageBytes).toBe(0)
    layer.shutdown?.()
  })

  it('persists tag invalidation metadata in the filesystem layer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'raffel-tagged-fs-'))
    const cache = createTieredCache({
      namespace: 'tagged-fs',
      layers: [createFileSystemCacheLayer({ id: 'l2', directory, ttlMs: 60_000 })],
    })
    try {
      await cache.set('leads:list', { ids: [1] }, { tags: ['node:stone'] })
      await cache.set('leads:detail:1', { id: 1 }, { tags: ['lead:1'] })

      const result = await cache.invalidateTag('node:stone')

      expect(result.deleted).toBe(1)
      expect(await cache.get('leads:list')).toBeUndefined()
      expect((await cache.get('leads:detail:1'))?.value).toEqual({ id: 1 })
    } finally {
      await cache.shutdown()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('invalidates a namespace-scoped logical key prefix', async () => {
    const cache = createTieredCache({
      namespace: 'prefix',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
    })
    await cache.set('leads:list:open', { status: 'open' })
    await cache.set('leads:list:closed', { status: 'closed' })
    await cache.set('leads:detail:1', { id: 1 })

    const result = await cache.invalidatePrefix('leads:list:')

    expect(result.deleted).toBe(2)
    expect(await cache.get('leads:list:open')).toBeUndefined()
    expect(await cache.get('leads:list:closed')).toBeUndefined()
    expect((await cache.get('leads:detail:1'))?.value).toEqual({ id: 1 })
    await cache.shutdown()
  })

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

  it('serializes a provider used as lower and profile-first layer', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    let releaseFirst!: () => void
    let announceFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let stored: unknown
    const provider: CacheLayer = {
      id: 'shared',
      async get() { return undefined },
      async set(_key, record) {
        const call = ++calls
        active++
        maxActive = Math.max(maxActive, active)
        if (call === 1) {
          announceFirst()
          await firstGate
        }
        stored = record.value
        active--
      },
      async delete() {},
      async clearNamespace() {},
    }
    const cache = createTieredCache({
      namespace: 'profile-ordering',
      layers: [
        createMemoryCacheLayer({ id: 'local', ttlMs: 60_000 }),
        provider,
      ],
    })
    const shared = cache.selectLayers(['shared'])

    await cache.set('same', { version: 1 })
    await firstStarted
    const second = shared.set('same', { version: 2 })
    await Promise.resolve()

    expect(maxActive).toBe(1)
    releaseFirst()
    await second
    await cache.shutdown()
    expect(stored).toEqual({ version: 2 })
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

  it('orders exact invalidation after an active asynchronous first-layer write', async () => {
    let releaseWrite!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const stored = new Map<string, unknown>()
    const cache = createTieredCache({
      namespace: 'first-layer-delete-order',
      layers: [{
        id: 'shared',
        get: vi.fn(),
        async set(key, record) {
          markStarted()
          await gate
          stored.set(key, record.value)
        },
        async delete(key) { stored.delete(key) },
        async clearNamespace() { stored.clear() },
      }],
    })

    const write = cache.set('same', { stale: true })
    await started
    const invalidation = cache.delete('same')
    releaseWrite()
    await Promise.all([write, invalidation])

    expect(stored.size).toBe(0)
    await cache.shutdown()
  })

  it('drains an active asynchronous first-layer write before clearing a namespace', async () => {
    let releaseWrite!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const stored = new Map<string, unknown>()
    const cache = createTieredCache({
      namespace: 'first-layer-clear-order',
      layers: [{
        id: 'shared',
        get: vi.fn(),
        async set(key, record) {
          markStarted()
          await gate
          stored.set(key, record.value)
        },
        async delete(key) { stored.delete(key) },
        async clearNamespace() { stored.clear() },
      }],
    })

    const write = cache.set('same', { stale: true })
    await started
    const invalidation = cache.clearNamespace()
    releaseWrite()
    await Promise.all([write, invalidation])

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

    await cache.set('date', { createdAt: new Date() })

    expect(await cache.get('date')).toBeUndefined()
    await cache.shutdown()
  })

  it('accepts Response values, sized by content-length or buffered clone', async () => {
    const cache = createTieredCache({
      namespace: 'response-values',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
    })

    // Sized via declared content-length.
    const declared = new Response('sized', { headers: { 'content-length': '5' } })
    await cache.set('declared', declared)
    expect((await cache.get('declared'))?.value).toBeInstanceOf(Response)

    // No content-length: sized by buffering a clone, without consuming the
    // cached body.
    const buffered = new Response('buffered-body')
    await cache.set('buffered', buffered)
    const hit = await cache.get('buffered')
    expect(hit?.value).toBeInstanceOf(Response)
    await expect((hit!.value as Response).clone().text()).resolves.toBe('buffered-body')

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
  it('does not publish a rejected distributed fill to upper local layers', async () => {
    const local = createMemoryCacheLayer({ id: 'local', ttlMs: 60_000 })
    const shared: CacheLayer = {
      id: 'shared',
      capabilities: { distributedFillFencing: true },
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      clearNamespace: vi.fn(),
      beginFill: vi.fn(async () => 'old-generation'),
      isFillCurrent: vi.fn(async () => true),
      commitFill: vi.fn(async () => false),
      bumpGeneration: vi.fn(async () => undefined),
    }
    const cache = createTieredCache({
      namespace: 'distributed-rejection',
      layers: [local, shared],
    })

    const ticket = cache.beginFill('catalog:item')
    await ticket.ready
    const committed = await cache.commitFill(ticket, { stale: true })

    expect(committed).toBe(false)
    expect(await local.get('distributed-rejection:catalog:item')).toBeUndefined()
    await cache.shutdown()
  })

  it('rejects a fill in one process after another process invalidates the namespace', async () => {
    const values = new Map<string, string>()
    const client = {
      async get(key: string) { return values.get(key) ?? null },
      async set(key: string, value: string) { values.set(key, value); return 'OK' },
      async del(key: string | string[]) {
        const keys = Array.isArray(key) ? key : [key]
        let deleted = 0
        for (const item of keys) deleted += values.delete(item) ? 1 : 0
        return deleted
      },
      incr: vi.fn(async (key: string) => {
        const next = Number(values.get(key) ?? '0') + 1
        values.set(key, String(next))
        return next
      }),
      async eval(_script: string, ...args: any[]) {
        const nodeStyle = typeof args[0] === 'object'
        const keys = nodeStyle ? args[0].keys as string[] : args.slice(1, 3) as string[]
        const argv = nodeStyle ? args[0].arguments as string[] : args.slice(3) as string[]
        const current = values.get(keys[0]!) ?? '0'
        if (current !== argv[0]) return 0
        values.set(keys[1]!, argv[1]!)
        return 1
      },
    }
    const first = createTieredCache({
      namespace: 'shared-service',
      layers: [createRedisCacheLayer({ id: 'shared', client, ttlMs: 60_000 })],
    })
    const second = createTieredCache({
      namespace: 'shared-service',
      layers: [createRedisCacheLayer({ id: 'shared', client, ttlMs: 60_000 })],
    })

    const ticket = first.beginFill('catalog:item')
    await ticket.ready
    await second.delete('catalog:item')
    const committed = await first.commitFill(ticket, { stale: true })

    expect(committed).toBe(false)
    expect(await first.get('catalog:item')).toBeUndefined()
    expect(client.incr).toHaveBeenCalledWith(
      'raffel:cache:m:g:c2hhcmVkLXNlcnZpY2U',
    )
    await Promise.all([first.shutdown(), second.shutdown()])
  })

  it('composes an arbitrary provider prefix with an isolated service namespace', async () => {
    const scan = vi.fn(async () => ['0', []] as [string, string[]])
    const layer = createRedisCacheLayer({
      id: 'shared',
      ttlMs: 60_000,
      prefix: 'prod:closer:',
      client: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        del: vi.fn(async () => 0),
        scan,
      },
    })

    await layer.clearNamespace('billing-api')

    expect(scan).toHaveBeenCalledWith(
      '0',
      'MATCH', 'p12:prod:closer:d:billing-api:*',
      'COUNT', 100,
    )
  })

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

    expect(pSetEx).toHaveBeenCalledWith('raffel:cache:d:one', 2_500, expect.any(String))
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
    expect(layer.capabilities?.tagInvalidation).toBe(false)
    expect(layer.capabilities?.prefixInvalidation).toBe(false)
  })

  it('invalidates a logical prefix through non-blocking SCAN', async () => {
    const scan = vi.fn(async () => [
      '0',
      [
        'raffel:cache:d:catalog:leads:list:open',
        'raffel:cache:d:catalog:leads:list:closed',
      ],
    ] as [string, string[]])
    const del = vi.fn(async (keys: string | string[]) => (
      Array.isArray(keys) ? keys.length : 1
    ))
    const layer = createRedisCacheLayer({
      id: 'l3',
      ttlMs: 60_000,
      client: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        del,
        scan,
      },
    })

    const result = await layer.invalidatePrefix?.('leads:list:', 'catalog')

    expect(result).toEqual({ mode: 'physical', deleted: 2 })
    expect(scan).toHaveBeenCalledWith(
      '0',
      'MATCH', 'raffel:cache:d:catalog:leads:list:*',
      'COUNT', 100,
    )
    expect(del).toHaveBeenCalledOnce()
  })

  it('scans every configured Redis Cluster master for prefix invalidation', async () => {
    const firstScan = vi.fn(async () => [
      '0',
      ['raffel:cache:{catalog}:d:catalog:leads:list:one'],
    ] as [string, string[]])
    const secondScan = vi.fn(async () => [
      '0',
      ['raffel:cache:{catalog}:d:catalog:leads:list:two'],
    ] as [string, string[]])
    const firstDel = vi.fn(async () => 1)
    const secondDel = vi.fn(async () => 1)
    const master = (scan: typeof firstScan, del: typeof firstDel) => ({
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del,
      scan,
    })
    const masters = [master(firstScan, firstDel), master(secondScan, secondDel)]
    const layer = createRedisCacheLayer({
      id: 'cluster',
      ttlMs: 60_000,
      client: masters[0]!,
      clusterHashTag: 'catalog',
      scanClients: () => masters,
    })

    const result = await layer.invalidatePrefix?.('leads:list:', 'catalog')

    expect(result).toEqual({ mode: 'physical', deleted: 2 })
    expect(firstScan).toHaveBeenCalledOnce()
    expect(secondScan).toHaveBeenCalledOnce()
    expect(firstScan).toHaveBeenCalledWith(
      '0',
      'MATCH', 'raffel:cache:{catalog}:d:catalog:leads:list:*',
      'COUNT', 100,
    )
    expect(firstDel).toHaveBeenCalledWith('raffel:cache:{catalog}:d:catalog:leads:list:one')
    expect(secondDel).toHaveBeenCalledWith('raffel:cache:{catalog}:d:catalog:leads:list:two')
  })

  it('rejects partial Redis Cluster configuration', () => {
    const client = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 0),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
    }

    expect(() => createRedisCacheLayer({
      id: 'cluster',
      ttlMs: 60_000,
      client,
      clusterHashTag: 'catalog',
    })).toThrow(/requires both clusterHashTag and scanClients/)

    expect(() => createRedisCacheLayer({
      id: 'cluster',
      ttlMs: 60_000,
      client,
      scanClients: () => [client],
    })).toThrow(/requires both clusterHashTag and scanClients/)
  })

  it('treats Redis glob characters in namespaces and logical prefixes literally', async () => {
    const scan = vi.fn(async () => ['0', []] as [string, string[]])
    const layer = createRedisCacheLayer({
      id: 'l3',
      ttlMs: 60_000,
      client: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        del: vi.fn(async () => 0),
        scan,
      },
    })

    await layer.invalidatePrefix?.('leads:*', 'catalog[blue]')

    expect(scan).toHaveBeenCalledWith(
      '0',
      'MATCH', 'raffel:cache:d:catalog%5Bblue%5D:leads:\\**',
      'COUNT', 100,
    )
  })

  it('invalidates tagged Redis records through non-blocking SCAN', async () => {
    const now = Date.now()
    const values = new Map<string, string>([
      ['raffel:cache:d:catalog:list', JSON.stringify({
        value: { ids: [1] },
        tags: ['node:stone'],
        createdAt: now,
        expiresAt: now + 60_000,
        version: 1,
      })],
      ['raffel:cache:d:catalog:detail', JSON.stringify({
        value: { id: 1 },
        tags: ['lead:1'],
        createdAt: now,
        expiresAt: now + 60_000,
        version: 2,
      })],
    ])
    const scan = vi.fn(async () => ['0', [...values.keys()]] as [string, string[]])
    const del = vi.fn(async (keys: string | string[]) => {
      const selected = Array.isArray(keys) ? keys : [keys]
      for (const key of selected) values.delete(key)
      return selected.length
    })
    const layer = createRedisCacheLayer({
      id: 'l3',
      ttlMs: 60_000,
      client: {
        get: async (key) => values.get(key) ?? null,
        set: vi.fn(async () => 'OK'),
        del,
        scan,
      },
    })

    const result = await layer.invalidateTag?.('node:stone', 'catalog')

    expect(result).toEqual({ mode: 'physical', deleted: 1 })
    expect(values.has('raffel:cache:d:catalog:list')).toBe(false)
    expect(values.has('raffel:cache:d:catalog:detail')).toBe(true)
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
