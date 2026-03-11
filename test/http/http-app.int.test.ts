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
})
