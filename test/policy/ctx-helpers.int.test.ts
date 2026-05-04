/**
 * ctx.policy.{evaluate,filterResources} helpers (T5.1, T5.2)
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import type { Principal, Resource } from '../../src/middleware/policy/types.js'
import type { PolicyCtxHelpers } from '../../src/middleware/policy/index.js'

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

describe('ctx.policy helpers', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('ctx.policy.evaluate returns Decision for ad-hoc check inside handler', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'allow-l1',
            effect: 'allow',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:l1'],
          },
        ],
      },
    })

    server
      .procedure('test')
      .authz({ resource: () => ({ type: 'meta', id: 'gate', tenantId: 't1' }) })
      .handler(async (_input, ctx) => {
        const helpers = (ctx as unknown as { policy: PolicyCtxHelpers }).policy
        const allowed: Resource = { type: 'lead', id: 'l1', tenantId: 't1' }
        const denied: Resource = { type: 'lead', id: 'l2', tenantId: 't1' }
        return {
          a: (await helpers.evaluate('lead.read', allowed)).allowed,
          b: (await helpers.evaluate('lead.read', denied)).allowed,
        }
      })

    // Add a top-level policy so the gate procedure passes
    server.procedure // (no-op — gate uses authz with no matching policy)

    // Need top-level allow for gate too — use simpler setup with allow-all gate
    await server.stop()
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'allow-gate',
            effect: 'allow',
            principals: ['**'],
            actions: ['test'],
            resources: ['meta:gate'],
          },
          {
            id: 'allow-l1',
            effect: 'allow',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:l1'],
          },
        ],
      },
    })

    server
      .procedure('test')
      .authz({ resource: () => ({ type: 'meta', id: 'gate', tenantId: 't1' }) })
      .handler(async (_input, ctx) => {
        const helpers = (ctx as unknown as { policy: PolicyCtxHelpers }).policy
        const allowed: Resource = { type: 'lead', id: 'l1', tenantId: 't1' }
        const denied: Resource = { type: 'lead', id: 'l2', tenantId: 't1' }
        return {
          a: (await helpers.evaluate('lead.read', allowed)).allowed,
          b: (await helpers.evaluate('lead.read', denied)).allowed,
        }
      })

    await server.start()
    const port2 = server.addresses?.http?.port
    const res = await fetch(`http://127.0.0.1:${port2}/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { a: boolean; b: boolean }
    expect(body.a).toBe(true)
    expect(body.b).toBe(false)
  })

  it('ctx.policy.filterResources returns only allowed', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'allow-gate',
            effect: 'allow',
            principals: ['**'],
            actions: ['leads.list'],
            resources: ['meta:gate'],
          },
          {
            id: 'allow-l1-l3',
            effect: 'allow',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:l1', 'lead:l3'],
          },
        ],
      },
    })

    server
      .procedure('leads.list')
      .authz({ resource: () => ({ type: 'meta', id: 'gate', tenantId: 't1' }) })
      .handler(async (_input, ctx) => {
        const helpers = (ctx as unknown as { policy: PolicyCtxHelpers }).policy
        const all: Resource[] = ['l1', 'l2', 'l3', 'l4'].map((id) => ({
          type: 'lead',
          id,
          tenantId: 't1',
        }))
        const filtered = await helpers.filterResources('lead.read', all)
        return { ids: filtered.map((r) => r.id) }
      })

    await server.start()
    const res = await fetch(`http://127.0.0.1:${port}/leads.list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ids: string[] }
    expect(body.ids.sort()).toEqual(['l1', 'l3'])
  })

  it('dedup: evaluate twice with same (action, resource.id) calls engine once', async () => {
    const port = await getFreePort()

    // Wrap engine.evaluate via a custom engine that counts calls
    const calls = vi.fn()
    server = createServer({
      port,
      policy: {
        principal: { from: 'custom', map: () => P },
        engine: {
          evaluate: (input) => {
            calls(input)
            return {
              allowed: true,
              reason: 'allow' as const,
              matchedPolicyIds: ['x'],
              auditedPolicyIds: [],
              candidatePolicies: [],
            }
          },
          list: () => [],
        },
        policies: [],
      },
    })

    server
      .procedure('t')
      .authz({ resource: () => ({ type: 'g', id: '1', tenantId: 't1' }) })
      .handler(async (_input, ctx) => {
        const helpers = (ctx as unknown as { policy: PolicyCtxHelpers }).policy
        const r: Resource = { type: 'lead', id: 'l1', tenantId: 't1' }
        await helpers.evaluate('lead.read', r)
        await helpers.evaluate('lead.read', r) // same → dedup
        await helpers.evaluate('lead.read', r) // same → dedup
        await helpers.filterResources('lead.read', [r, r, r]) // also dedup
        return { ok: true }
      })

    await server.start()
    await fetch(`http://127.0.0.1:${port}/t`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    })

    // 1 call for the gate (action=t, resource g:1)
    // 1 call for action=lead.read, resource lead:l1 (deduplicated)
    expect(calls).toHaveBeenCalledTimes(2)
  })
})
