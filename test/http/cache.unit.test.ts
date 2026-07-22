import { describe, expect, it, vi } from 'vitest'

import { createHttpCacheMiddleware } from '../../src/http/cache.js'
import { HttpApp } from '../../src/http/app.js'
import {
  createMemoryCacheLayer,
  createTieredCache,
  type CacheLayer,
} from '../../src/cache/tiered.js'
import type { Codec } from '../../src/utils/content-codecs.js'

function testCache() {
  return createTieredCache({
    namespace: `http-test-${Math.random()}`,
    layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
  })
}

describe('HttpApp cache middleware', () => {
  it('caches successful GET responses and keeps query variants separate', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('/catalog/*', createHttpCacheMiddleware(cache))
    app.get('/catalog/items', (c) => c.json({ execution: ++executions }))

    const first = await app.fetch(new Request('http://localhost/catalog/items?page=1'))
    const second = await app.fetch(new Request('http://localhost/catalog/items?page=1'))
    const other = await app.fetch(new Request('http://localhost/catalog/items?page=2'))

    expect(await first.json()).toEqual({ execution: 1 })
    expect(await second.json()).toEqual({ execution: 1 })
    expect(await other.json()).toEqual({ execution: 2 })
    await cache.shutdown()
  })

  it('composes a readable v2 key with query parameters ordered by name', async () => {
    let executions = 0
    const storedKeys: string[] = []
    const memory = createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })
    const layer: CacheLayer = {
      ...memory,
      set(key, record, ttlMs, staleMs) {
        storedKeys.push(key)
        return memory.set(key, record, ttlMs, staleMs)
      },
    }
    const cache = createTieredCache({ namespace: 'http-key', layers: [layer] })
    const app = new HttpApp()
    app.use('/catalog/*', createHttpCacheMiddleware(cache, { keyFormat: 'v2' }))
    app.get('/catalog/items', (c) => c.json({ execution: ++executions }))

    await app.fetch(new Request('http://localhost/catalog/items?status=open&page=2'))
    await app.fetch(new Request('http://localhost/catalog/items?page=2&status=open'))

    expect(executions).toBe(1)
    expect(storedKeys).toEqual([
      'http-key:http:%2Fcatalog%2Fitems:k2:v1:anonymous:m.method=s:GET|u.origin=s:http%3A%2F%2Flocalhost|q.page=s:2|q.status=s:open',
    ])
    await cache.shutdown()
  })

  it('preserves the order of repeated query values', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, { keyFormat: 'v2' }))
    app.get('/items', (c) => c.json({ execution: ++executions }))

    await app.fetch(new Request('http://localhost/items?tag=b&tag=a&page=1'))
    await app.fetch(new Request('http://localhost/items?page=1&tag=b&tag=a'))
    await app.fetch(new Request('http://localhost/items?page=1&tag=a&tag=b'))

    expect(executions).toBe(2)
    await cache.shutdown()
  })

  it('does not collide repeated query values with bracket-named parameters', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, { keyFormat: 'v2' }))
    app.get('/items', (c) => c.json({ execution: ++executions }))

    await app.fetch(new Request('http://localhost/items?a=x&a=y'))
    await app.fetch(new Request('http://localhost/items?a%5B0%5D=x&a%5B1%5D=y'))

    expect(executions).toBe(2)
    await cache.shutdown()
  })

  it('sorts repeated query values only for explicitly order-insensitive parameters', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, {
      keyFormat: 'v2',
      orderInsensitiveQueryParams: ['tag'],
    }))
    app.get('/items', (c) => c.json({ execution: ++executions }))

    await app.fetch(new Request('http://localhost/items?tag=b&tag=a&sort=name&sort=date'))
    await app.fetch(new Request('http://localhost/items?tag=a&tag=b&sort=name&sort=date'))
    await app.fetch(new Request('http://localhost/items?tag=a&tag=b&sort=date&sort=name'))

    expect(executions).toBe(2)
    await cache.shutdown()
  })

  it('keeps legacy vary-header order and duplicates byte-identical', async () => {
    const storedKeys: string[] = []
    const memory = createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })
    const layer: CacheLayer = {
      ...memory,
      set(key, record, ttlMs, staleMs) {
        storedKeys.push(key)
        return memory.set(key, record, ttlMs, staleMs)
      },
    }
    const cache = createTieredCache({ namespace: 'legacy-http', layers: [layer] })
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, {
      varyHeaders: ['x-b', 'x-a', 'x-b'],
    }))
    app.get('/items', (c) => c.json({ ok: true }))

    await app.fetch(new Request('http://localhost/items', {
      headers: { 'x-a': 'A', 'x-b': 'B' },
    }))

    expect(storedKeys).toEqual([
      'legacy-http:http:v1:anonymous:Z5egKnnU1Hawwqr5lCq14U71___evHuPlgcWep2K8dc',
    ])
    await cache.shutdown()
  })

  it('keys Accept by the resolved representation instead of the raw header', async () => {
    let executions = 0
    const cache = testCache()
    const codecs: Codec[] = [
      {
        name: 'json',
        contentTypes: ['application/json'],
        encode: JSON.stringify,
        decode: JSON.parse,
      },
      {
        name: 'toon',
        contentTypes: ['application/toon', 'text/toon'],
        encode: String,
        decode: String,
      },
    ]
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, {
      keyFormat: 'v2',
      varyHeaders: ['accept'],
      representationCodecs: codecs,
    }))
    app.get('/report', (c) => {
      executions++
      const toon = c.req.header('accept')?.startsWith('application/toon')
      return c.body(toon ? 'toon-body' : 'json-body', 200, {
        'content-type': toon ? 'application/toon' : 'application/json',
        vary: 'Accept',
      })
    })

    const json = await app.fetch(new Request('http://localhost/report', {
      headers: { accept: 'application/json' },
    }))
    const equivalentJson = await app.fetch(new Request('http://localhost/report', {
      headers: { accept: 'application/json, text/toon;q=0.1' },
    }))
    const toon = await app.fetch(new Request('http://localhost/report', {
      headers: { accept: 'application/toon' },
    }))

    expect(await json.text()).toBe('json-body')
    expect(await equivalentJson.text()).toBe('json-body')
    expect(await toon.text()).toBe('toon-body')
    expect(executions).toBe(2)
    await cache.shutdown()
  })

  it('normalizes an explicitly configured custom vary header', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, {
      keyFormat: 'v2',
      varyHeaders: ['x-export-format'],
      varyHeaderNormalizers: {
        'x-export-format': (value) => value.trim().toLowerCase(),
      },
    }))
    app.get('/export', (c) => {
      executions++
      return c.body(c.req.header('x-export-format')?.trim().toLowerCase() ?? 'json', 200, {
        vary: 'X-Export-Format',
      })
    })

    const upper = await app.fetch(new Request('http://localhost/export', {
      headers: { 'x-export-format': ' JSON ' },
    }))
    const lower = await app.fetch(new Request('http://localhost/export', {
      headers: { 'x-export-format': 'json' },
    }))

    expect(await upper.text()).toBe('json')
    expect(await lower.text()).toBe('json')
    expect(executions).toBe(1)
    await cache.shutdown()
  })

  it('bypasses caching when a custom vary normalizer fails', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, {
      keyFormat: 'v2',
      varyHeaders: ['x-cohort'],
      varyHeaderNormalizers: {
        'x-cohort': () => { throw new Error('invalid cohort') },
      },
    }))
    app.get('/cohort', (c) => c.json({ execution: ++executions }))

    const first = await app.fetch(new Request('http://localhost/cohort'))
    const second = await app.fetch(new Request('http://localhost/cohort'))

    expect(await first.json()).toEqual({ execution: 1 })
    expect(await second.json()).toEqual({ execution: 2 })
    expect(cache.stats()[0]?.totalItems).toBe(0)
    await cache.shutdown()
  })

  it('does not cache private, cookie-setting, or authenticated responses without identity', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache))
    app.get('/me', (c) => c.json({ execution: ++executions }, 200, {
      'set-cookie': 'session=secret',
    }))

    await app.fetch(new Request('http://localhost/me'))
    await app.fetch(new Request('http://localhost/me'))
    await app.fetch(new Request('http://localhost/me', {
      headers: { authorization: 'Bearer secret' },
    }))

    expect(executions).toBe(3)
    await cache.shutdown()
  })

  it('recreates cached no-body success responses safely', async () => {
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache))
    app.get('/empty', () => {
      executions++
      return new Response(null, { status: 204 })
    })

    await app.fetch(new Request('http://localhost/empty'))
    const cached = await app.fetch(new Request('http://localhost/empty'))

    expect(cached.status).toBe(204)
    expect(executions).toBe(1)
    await cache.shutdown()
  })

  it('bypasses a response stream that does not finish within the body deadline', async () => {
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, { bodyReadTimeoutMs: 5 }))
    app.get('/stream', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
      },
    })))

    const response = await app.fetch(new Request('http://localhost/stream'))

    expect(response.status).toBe(200)
    expect(cache.stats()[0]?.totalItems).toBe(0)
    void response.body?.cancel()
    await cache.shutdown()
  }, 100)

  it('serves stale immediately while a single background refresh runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
    let executions = 0
    const cache = testCache()
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, { ttlMs: 10, staleMs: 100 }))
    app.get('/swr', (c) => c.json({ execution: ++executions }))

    await app.fetch(new Request('http://localhost/swr'))
    vi.advanceTimersByTime(20)
    const stale = await app.fetch(new Request('http://localhost/swr'))
    for (let index = 0; index < 50; index++) await Promise.resolve()
    const refreshed = await app.fetch(new Request('http://localhost/swr'))

    expect(await stale.json()).toEqual({ execution: 1 })
    expect(await refreshed.json()).toEqual({ execution: 2 })
    expect(executions).toBe(2)
    await cache.shutdown()
    vi.useRealTimers()
  })

  it('does not join an HTTP single-flight that predates invalidation', async () => {
    let executions = 0
    let announceFirst!: () => void
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const cache = createTieredCache({
      namespace: 'http-race',
      layers: [createMemoryCacheLayer({ id: 'l1', ttlMs: 60_000 })],
    })
    const app = new HttpApp()
    app.use('*', createHttpCacheMiddleware(cache, { keyFormat: 'v2' }))
    app.get('/items', async (c) => {
      const execution = ++executions
      if (execution === 1) {
        announceFirst()
        await firstGate
      }
      return c.json({ execution })
    })

    const first = app.fetch(new Request('http://localhost/items'))
    await firstStarted
    await cache.delete(
      'http:%2Fitems:k2:v1:anonymous:m.method=s:GET|u.origin=s:http%3A%2F%2Flocalhost',
    )
    const second = app.fetch(new Request('http://localhost/items'))
    let secondStarted = false
    try {
      await vi.waitFor(() => expect(executions).toBe(2), { interval: 5, timeout: 500 })
      secondStarted = true
    } finally {
      releaseFirst()
    }
    const [firstResponse, secondResponse] = await Promise.all([first, second])
    const cached = await app.fetch(new Request('http://localhost/items'))

    expect(secondStarted).toBe(true)
    expect(await firstResponse.json()).toEqual({ execution: 1 })
    expect(await secondResponse.json()).toEqual({ execution: 2 })
    expect(await cached.json()).toEqual({ execution: 2 })
    await cache.shutdown()
  })
})
