/**
 * USD ↔ authz integration: per-operation `x-raffel-authz` and document-level
 * `x-usd.authz` catalog must be present when policies are configured, and
 * fully absent when they aren't.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { z } from 'zod'
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

interface USDDoc {
  paths?: Record<string, Record<string, { 'x-raffel-authz'?: Record<string, unknown> }>>
  'x-usd'?: Record<string, unknown>
  'x-raffel-authz'?: {
    'default-mode': 'allow' | 'deny'
    policies: Array<{
      id: string
      effect: string
      principals: string[]
      actions: string[]
      resources: string[]
      'has-condition': boolean
      match?: unknown
    }>
  }
}

describe('USD ↔ authz integration', () => {
  let server: ReturnType<typeof createServer> | null = null
  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
  })

  it('document includes x-usd.authz with sanitised policy catalog', async () => {
    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'allow-read',
            effect: 'allow',
            principals: ['scope:lead.read'],
            actions: ['lead.read'],
            resources: ['lead:*'],
            match: { 'resource.status': 'active' },
          },
          {
            id: 'deny-archived',
            effect: 'deny',
            principals: ['**'],
            actions: ['lead.read'],
            resources: ['lead:*'],
            condition: () => true,
          },
        ],
      },
    })

    server.enableUSD({ basePath: '/docs', info: { title: 'T', version: '1' } })

    server
      .procedure('lead.read')
      .input(z.object({ id: z.string() }))
      .authz({
        action: 'lead.read',
        resource: ({ id }) => ({ type: 'lead', id, tenantId: 't1' }),
      })
      .handler(async ({ id }) => ({ id }))

    server
      .procedure('docs.fetch')
      .authz({ public: true })
      .handler(async () => ({ ok: true }))

    await server.start()

    const usd = (await fetch(`http://127.0.0.1:${port}/docs/usd.json`).then((r) =>
      r.json(),
    )) as USDDoc


    // Document-level catalog (top-level x-raffel-authz, kebab-case fields)
    const catalog = usd['x-raffel-authz']
    expect(catalog).toBeDefined()
    expect(catalog?.['default-mode']).toBe('deny')
    expect(catalog?.policies).toHaveLength(2)

    const allow = catalog!.policies.find((p) => p.id === 'allow-read')!
    expect(allow.effect).toBe('allow')
    expect(allow.match).toEqual({ 'resource.status': 'active' })
    expect(allow['has-condition']).toBe(false)

    const deny = catalog!.policies.find((p) => p.id === 'deny-archived')!
    expect(deny['has-condition']).toBe(true)
    expect((deny as Record<string, unknown>).condition).toBeUndefined() // NEVER serialised
    expect((deny as Record<string, unknown>).match).toBeUndefined()

    // The catalog is NOT inside x-usd anymore
    expect((usd['x-usd'] ?? {})['authz']).toBeUndefined()

    // Operation-level reference (procedure name dot → slash in path)
    const op = usd.paths?.['/lead/read']?.post
    expect(op?.['x-raffel-authz']).toMatchObject({
      action: 'lead.read',
      mode: 'enforce',
      public: false,
      'has-resolver': true,
    })

    // public: true operation reflects the flag
    const docsOp = usd.paths?.['/docs/fetch']?.post
    expect(docsOp?.['x-raffel-authz']).toMatchObject({
      action: 'docs.fetch',
      public: true,
      'has-resolver': false,
    })
  })

  it('document does NOT include x-usd.authz when policy is not configured', async () => {
    const port = await getFreePort()
    server = createServer({ port })
    server.enableUSD({ basePath: '/docs', info: { title: 'T', version: '1' } })

    server
      .procedure('hello')
      .input(z.object({}))
      .handler(async () => ({ ok: true }))

    await server.start()

    const usd = (await fetch(`http://127.0.0.1:${port}/docs/usd.json`).then((r) =>
      r.json(),
    )) as USDDoc

    expect(usd['x-raffel-authz']).toBeUndefined()
    expect(usd.paths?.['/hello']?.post?.['x-raffel-authz']).toBeUndefined()
    // Sanity: procedure exists
    expect(usd.paths?.['/hello']).toBeDefined()
  })
})
