/**
 * End-to-end test for Phase 1 (T1.4): full HTTP server with .authz() gate.
 *
 * Boots a real HTTP server, sends POST requests, asserts 200 vs 403 by policy.
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
  scopes: ['lead.read'],
  groups: [],
}

describe('end-to-end Phase 1 (T1.4)', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('allow path: HTTP POST returns 200 when policy allows', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [
          {
            id: 'allow-read',
            effect: 'allow',
            principals: ['scope:lead.read'],
            actions: ['lead.read'],
            resources: ['lead:*'],
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
      .handler(async ({ id }: { id: string }) => ({ id, name: `lead-${id}` }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: 'l1', name: 'lead-l1' })
  })

  it('deny path: HTTP POST returns 403 when no policy matches', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })

    expect(res.status).toBe(403)
  })

  it('procedure WITHOUT .authz() runs unguarded (defaultMode: allow)', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    server
      .procedure('health.ping')
      .handler(async () => ({ ok: true }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/health.ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(200)
  })

  it('.authz() without server-level policy config throws at registration', () => {
    const port = 19999
    const s = createServer({ port })

    expect(() =>
      s
        .procedure('lead.read')
        .authz({
          resource: () => ({ type: 'lead', id: 'l1', tenantId: 't1' }),
        }),
    ).toThrow(/requires `policy: \{ \.\.\. \}` on createServer/)
  })
})
