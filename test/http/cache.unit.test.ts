import { describe, expect, it } from 'vitest'

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
})
