/**
 * defaultMode + public escape (T4.5)
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import type { Principal } from '../../src/middleware/policy/types.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

const SAMPLE_PRINCIPAL: Principal = {
  id: 's1',
  tenantId: 't1',
  scopes: [],
  groups: [],
}

describe('defaultMode (T4.5)', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it("defaultMode: 'allow' (default) — undecorated procedure passes", async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    server.procedure('health.ping').handler(async () => ({ ok: true }))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/health.ping`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })

  it("defaultMode: 'deny' — undecorated procedure returns 403", async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    server.procedure('health.ping').handler(async () => ({ ok: true }))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/health.ping`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string; details?: { code: string } } }
    expect(body.error.code).toBe('PERMISSION_DENIED')
    // Inner body (verbose dev mode) carries the specific NO_POLICY_DECLARED code
    expect(body.error.details?.code).toBe('NO_POLICY_DECLARED')
  })

  it("defaultMode: 'deny' — .authz({ public: true }) opts out", async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    server
      .procedure('health.ping')
      .authz({ public: true })
      .handler(async () => ({ ok: true }))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/health.ping`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })

  it("defaultMode: 'deny' — declared .authz() with allow policy passes", async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [
          {
            id: 'allow-all',
            effect: 'allow',
            principals: ['**'],
            actions: ['**'],
            resources: ['**'],
          },
        ],
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
        }),
      })
      .handler(async ({ id }: { id: string }) => ({ id }))

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      body: JSON.stringify({ id: 'l1' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })
})
