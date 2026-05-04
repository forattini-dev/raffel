/**
 * End-to-end loader integration: server boot loads policies from JSON dir.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import type { Principal } from '../../src/middleware/policy/types.js'

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

const P: Principal = { id: 's1', tenantId: 't1', scopes: ['lead.read'], groups: [] }

describe('loader integration with createServer', () => {
  let dir: string
  let server: ReturnType<typeof createServer> | null = null

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-policy-'))
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    await rm(dir, { recursive: true, force: true })
  })

  it('loads policies from dir and applies them', async () => {
    await writeFile(
      path.join(dir, 'leads.json'),
      JSON.stringify([
        {
          id: 'allow-active-leads',
          effect: 'allow',
          principals: ['scope:lead.read'],
          actions: ['lead.read'],
          resources: ['lead:*'],
          match: { 'resource.status': 'active' },
        },
      ]),
    )

    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        loadFromDir: dir,
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string; status: string }) => ({
          type: 'lead',
          id: input.id,
          tenantId: 't1',
          attrs: { status: input.status },
        }),
      })
      .handler(async (input: { id: string }) => ({ id: input.id }))

    await server.start()

    // active lead → 200
    const ok = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1', status: 'active' }),
    })
    expect(ok.status).toBe(200)

    // archived lead → no policy matches → implicit_deny → 403
    const denied = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l2', status: 'archived' }),
    })
    expect(denied.status).toBe(403)
  })

  it('customCondition from JSON resolves at boot', async () => {
    await writeFile(
      path.join(dir, 'biz.json'),
      JSON.stringify({
        id: 'allow-managers',
        effect: 'allow',
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        customCondition: 'isManager',
      }),
    )

    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => ({ ...P, attrs: { role: 'manager' } }) },
        loadFromDir: dir,
        customConditions: {
          isManager: ({ principal }) => principal.attrs?.role === 'manager',
        },
      },
    })

    server
      .procedure('lead.read')
      .authz({
        resource: (input: { id: string }) => ({ type: 'lead', id: input.id, tenantId: 't1' }),
      })
      .handler(async ({ id }: { id: string }) => ({ id }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/lead.read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })
    expect(res.status).toBe(200)
  })

  it('createServer throws on schema-invalid JSON in loadFromDir', async () => {
    await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ id: 'x' /* missing fields */ }))

    expect(() =>
      createServer({
        port: 19999,
        policy: {
          principal: { from: 'custom', map: () => P },
          loadFromDir: dir,
        },
      }),
    ).toThrow(/schema validation failed/)
  })
})
