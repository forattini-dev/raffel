import { describe, expect, it } from 'vitest'
import { HttpApp } from '../../src/http/app.js'

describe('HttpApp routing contract', () => {
  it('matches optional segments when omitted', async () => {
    const app = new HttpApp()
    app.get('/users/:id?', (c) => c.json({ id: c.req.param('id') ?? null }))

    const response = await app.fetch(new Request('http://localhost/users'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: null })
  })

  it('matches optional segments when present', async () => {
    const app = new HttpApp()
    app.get('/users/:id?', (c) => c.json({ id: c.req.param('id') ?? null }))

    const response = await app.fetch(new Request('http://localhost/users/123'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: '123' })
  })

  it('matches terminal wildcard routes for nested paths and empty remainder', async () => {
    const app = new HttpApp()
    app.get('/assets/*', (c) => c.json({ path: c.req.param('*') ?? null }))

    const nestedResponse = await app.fetch(new Request('http://localhost/assets/css/main.css'))
    const emptyResponse = await app.fetch(new Request('http://localhost/assets'))

    expect(nestedResponse.status).toBe(200)
    expect(await nestedResponse.json()).toEqual({ path: 'css/main.css' })
    expect(emptyResponse.status).toBe(200)
    expect(await emptyResponse.json()).toEqual({ path: null })
  })

  it('prefers exact routes over dynamic matches', async () => {
    const app = new HttpApp()
    app.get('/users/:id', (c) => c.text(`dynamic:${c.req.param('id')}`))
    app.get('/users/new', (c) => c.text('exact:new'))

    const response = await app.fetch(new Request('http://localhost/users/new'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('exact:new')
  })

  it('keeps dynamic route precedence in registration order', async () => {
    const app = new HttpApp()
    app.get('/:scope/:id', (c) => c.text(`generic:${c.req.param('scope')}`))
    app.get('/users/:id', (c) => c.text(`users:${c.req.param('id')}`))

    const response = await app.fetch(new Request('http://localhost/users/42'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('generic:users')
  })

  it('supports catch-all routes registered with *', async () => {
    const app = new HttpApp()
    app.all('*', (c) => c.text(c.req.param('*') ?? 'root'))

    const nestedResponse = await app.fetch(new Request('http://localhost/system/health'))
    const rootResponse = await app.fetch(new Request('http://localhost/'))

    expect(nestedResponse.status).toBe(200)
    expect(await nestedResponse.text()).toBe('system/health')
    expect(rootResponse.status).toBe(200)
    expect(await rootResponse.text()).toBe('')
  })

  it('runs matching global and route middlewares around the route handler', async () => {
    const app = new HttpApp()
    const order: string[] = []

    app.use('*', async (_c, next) => {
      order.push('global:before')
      await next()
      order.push('global:after')
    })
    app.get('/users/:id', async (_c, next) => {
      order.push('route:before')
      await next()
      order.push('route:after')
    }, (c) => {
      order.push('handler')
      return c.text(c.req.param('id') ?? '')
    })

    const response = await app.fetch(new Request('http://localhost/users/42'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('42')
    expect(order).toEqual(['global:before', 'route:before', 'handler', 'route:after', 'global:after'])
  })

  it('allows middleware responses to short-circuit route execution', async () => {
    const app = new HttpApp()
    let handlerCalled = false

    app.use('/admin/*', (c) => c.text('blocked', 403))
    app.get('/admin/panel', (c) => {
      handlerCalled = true
      return c.text('ok')
    })

    const response = await app.fetch(new Request('http://localhost/admin/panel'))

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('blocked')
    expect(handlerCalled).toBe(false)
  })

  it('runs matching middleware before custom not found handling', async () => {
    const app = new HttpApp()

    app.use('/api/*', async (c, next) => {
      c.set('scope', 'api')
      await next()
    })
    app.notFound((c) => c.json({ scope: c.get('scope') ?? null }, 404))

    const response = await app.fetch(new Request('http://localhost/api/missing'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ scope: 'api' })
  })

  it('mounts sub-app routes and middleware through the route table', async () => {
    const app = new HttpApp<{ scope: string }>()
    const admin = new HttpApp<{ scope: string }>()

    admin.use('*', async (c, next) => {
      c.set('scope', 'admin')
      await next()
    })
    admin.get('/health', (c) => c.text(c.get('scope') ?? 'missing'))
    app.route('/admin', admin)

    const response = await app.fetch(new Request('http://localhost/admin/health'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('admin')
  })

  it('shares route table state for base path apps', async () => {
    const app = new HttpApp()
    const api = app.basePathApp('/api')

    api.get('/health', (c) => c.text('ok'))

    const response = await app.fetch(new Request('http://localhost/api/health'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(app.getRoutes()).toEqual([{ method: 'GET', path: '/api/health' }])
  })

  it('preserves custom error handling for matched routes', async () => {
    const app = new HttpApp()

    app.get('/boom', () => {
      throw new Error('boom')
    })
    app.onError((err, c) => c.json({ message: err.message }, 500))

    const response = await app.fetch(new Request('http://localhost/boom'))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'boom' })
  })
})
