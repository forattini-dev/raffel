/**
 * Verifies the policy module is fully opt-in: a server created without
 * `policy: { ... }` carries no policy state, exposes no policy namespace,
 * and behaves identically to a server built before the module existed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      if (!a || typeof a === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = a
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

describe('policy module is fully opt-in', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('createServer({}) without `policy` — server.policy is undefined', () => {
    server = createServer({ port: 19999 })
    expect(server.policy).toBeUndefined()
  })

  it('procedures work normally without any policy config', async () => {
    const port = await getFreePort()
    server = createServer({ port })

    server
      .procedure('hello')
      .handler(async () => ({ message: 'world' }))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/hello`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ message: 'world' })
  })

  it('.authz() throws helpful error when policy is not configured', () => {
    server = createServer({ port: 19998 })
    expect(() =>
      server!
        .procedure('lead.read')
        .authz({
          resource: () => ({ type: 'lead', id: 'l1', tenantId: 't1' }),
        }),
    ).toThrow(/requires `policy: \{ \.\.\. \}` on createServer/)
  })
})
