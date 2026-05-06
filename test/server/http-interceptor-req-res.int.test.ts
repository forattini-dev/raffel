/**
 * HTTP-aware interceptors (#102).
 *
 * Verifies that an `Interceptor` running on an HTTP procedure can read
 * the raw `IncomingMessage` and write to `ServerResponse` via `ctx.http.req`
 * and `ctx.http.res`. Non-HTTP transports leave `ctx.http?.req` undefined,
 * so interceptors must guard with the optional chain.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (!address || typeof address === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

let server: ReturnType<typeof createServer> | null = null
afterEach(async () => {
  if (server) {
    await server.stop().catch(() => {})
    server = null
  }
})

describe('HTTP-aware interceptors (#102 — Option A)', () => {
  it('exposes ctx.http.req for cookie-style middleware', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.use(async (envelope, ctx, next) => {
      const req = ctx.http?.req
      const cookie = req?.headers.cookie ?? ''
      if (!cookie.includes('session=valid')) {
        throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED', status: 401 })
      }
      return next()
    })

    server.procedure('whoami').handler(async () => ({ ok: true }))
    await server.start()

    const ok = await fetch(`http://127.0.0.1:${port}/whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=valid' },
      body: '{}',
    })
    expect(ok.status).toBe(200)

    const denied = await fetch(`http://127.0.0.1:${port}/whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(denied.status).toBe(401)
  })

  it('exposes ctx.http.res for security-header middleware', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.use(async (envelope, ctx, next) => {
      ctx.http?.res?.setHeader('X-Content-Type-Options', 'nosniff')
      ctx.http?.res?.setHeader('Strict-Transport-Security', 'max-age=31536000')
      return next()
    })

    server.procedure('ping').handler(async () => ({ pong: true }))
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000')
  })
})
