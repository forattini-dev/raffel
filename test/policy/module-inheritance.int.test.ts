/**
 * Module-level authz inheritance (T4.1)
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import { createRouterModule } from '../../src/server/router-module.js'
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

describe('module-level authz inheritance (T4.1)', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('module default authz applies to procedures without their own .authz()', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [
          {
            id: 'allow-leads-read',
            effect: 'allow',
            principals: ['scope:lead.read'],
            actions: ['leads.list'],
            resources: ['leadbag:*'],
          },
        ],
      },
    })

    const leadsModule = createRouterModule('leads', {
      authz: {
        resource: () => ({ type: 'leadbag', id: 'all', tenantId: 't1' }),
      },
    })

    leadsModule
      .procedure('list')
      .handler(async () => ({ leads: [] }))

    server.mount('', leadsModule)

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/leads.list`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })

  it('module default authz denies when policy fails', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    const leadsModule = createRouterModule('leads', {
      authz: {
        resource: () => ({ type: 'leadbag', id: 'all', tenantId: 't1' }),
      },
    })

    leadsModule.procedure('list').handler(async () => ({ leads: [] }))

    server.mount('', leadsModule)
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/leads.list`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(403)
  })

  it('per-procedure .authz() overrides module default', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [
          {
            id: 'allow-only-explicit-action',
            effect: 'allow',
            principals: ['**'],
            actions: ['leads.special.read'],
            resources: ['lead:l1'],
          },
        ],
      },
    })

    const leadsModule = createRouterModule('leads', {
      authz: {
        // Module default points at a "leadbag" resource — won't match
        resource: () => ({ type: 'leadbag', id: 'all', tenantId: 't1' }),
      },
    })

    leadsModule
      .procedure('special.read')
      .authz({
        // Per-procedure: different resource pattern
        resource: () => ({ type: 'lead', id: 'l1', tenantId: 't1' }),
      })
      .handler(async () => ({ ok: 'overridden' }))

    server.mount('', leadsModule)
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/leads.special.read`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
  })

  it('procedure without .authz() in module + no module default + defaultMode deny → 403', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => SAMPLE_PRINCIPAL },
        policies: [],
      },
    })

    const m = createRouterModule('m')
    m.procedure('foo').handler(async () => ({ ok: true }))
    server.mount('', m)
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/m.foo`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(403)
  })
})
