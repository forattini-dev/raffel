/**
 * Integration tests for server.http.* namespace path matching.
 *
 * Covers issue #99: createHttpOverrideMiddleware must support :param routes.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

describe('server.http.* namespace path matching', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
  })

  it('resolves single :param routes registered via server.http.get', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get('/users/:id', async (_input: unknown, ctx: any) => ({
      id: ctx.params?.id,
    }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/users/abc-123`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ id: 'abc-123' })
  })

  it('resolves nested multi :param routes', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get(
      '/orgs/:orgId/tokens/:tokenId',
      async (_input: unknown, ctx: any) => ({
        orgId: ctx.params?.orgId,
        tokenId: ctx.params?.tokenId,
      })
    )

    await server.start()

    const response = await fetch(
      `http://127.0.0.1:${port}/orgs/acme/tokens/tok_42`
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      orgId: 'acme',
      tokenId: 'tok_42',
    })
  })

  it('still resolves static paths without params', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get('/health', async () => ({ ok: true }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('tolerates trailing slash on static and param paths', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get('/health', async () => ({ ok: true }))
    server.http.get('/users/:id', async (_input: unknown, ctx: any) => ({
      id: ctx.params?.id,
    }))

    await server.start()

    const staticRes = await fetch(`http://127.0.0.1:${port}/health/`)
    expect(staticRes.status).toBe(200)

    const paramRes = await fetch(`http://127.0.0.1:${port}/users/xyz/`)
    expect(paramRes.status).toBe(200)
    expect(await paramRes.json()).toEqual({ id: 'xyz' })
  })

  it('does not match a static prefix when :param segment expected', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get('/users/:id', async (_input: unknown, ctx: any) => ({
      id: ctx.params?.id,
    }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/users`)
    expect(response.status).not.toBe(200)
  })

  it('respects basePath when matching :param routes', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', basePath: '/api' })

    server.http.get('/users/:id', async (_input: unknown, ctx: any) => ({
      id: ctx.params?.id,
    }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/api/users/abc`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'abc' })
  })

  it('keeps route params authoritative when body keys collide', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.patch('/items/:id', async (input: any, ctx: any) => ({
      inputId: input.id,
      bodyName: input.name,
      ctxParamId: ctx.params?.id,
      ctxInputParamId: ctx.input.params.id,
      ctxInputBodyId: (ctx.input.body as any).id,
    }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/items/abc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'from-body', name: 'x' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      inputId: 'abc',
      bodyName: 'x',
      ctxParamId: 'abc',
      ctxInputParamId: 'abc',
      ctxInputBodyId: 'from-body',
    })
  })
})
