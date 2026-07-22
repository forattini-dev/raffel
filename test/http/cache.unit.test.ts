import { describe, expect, it, vi } from 'vitest'

import { createHttpCacheMiddleware } from '../../src/http/cache.js'
import { HttpApp } from '../../src/http/app.js'
import { createMemoryCacheLayer, createTieredCache } from '../../src/cache/tiered.js'

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
    for (let index = 0; index < 10; index++) await Promise.resolve()
    const refreshed = await app.fetch(new Request('http://localhost/swr'))

    expect(await stale.json()).toEqual({ execution: 1 })
    expect(await refreshed.json()).toEqual({ execution: 2 })
    expect(executions).toBe(2)
    await cache.shutdown()
    vi.useRealTimers()
  })
})
