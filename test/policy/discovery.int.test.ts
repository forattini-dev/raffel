/**
 * Discovery (T8.1, T8.2)
 *  - runtime-preview includes per-procedure authz metadata
 *  - MCP raffel://policies and raffel://policy/<id> resources
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import {
  getStaticResources,
  readResource,
  setPolicyProvider,
} from '../../src/mcp/resources/index.js'
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

const P: Principal = { id: 's1', tenantId: 't1', scopes: [], groups: [] }

describe('runtime-preview includes authz metadata (T8.1)', () => {
  let server: ReturnType<typeof createServer> | null = null
  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    setPolicyProvider(null)
  })

  it('procedure with .authz() shows authz fields in operation', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [],
      },
    })

    server
      .procedure('lead.read')
      .authz({
        action: 'lead.read.special',
        mode: 'any',
        resource: ({ id }: { id: string }) => ({ type: 'lead', id, tenantId: 't1' }),
      })
      .handler(async () => ({}))

    server.procedure('health.ping').handler(async () => ({ ok: true }))

    const graph = server.preview()
    const leadRead = graph.operations.find((o) => o.name === 'lead.read')
    const healthPing = graph.operations.find((o) => o.name === 'health.ping')

    expect(leadRead?.authz).toEqual({
      action: 'lead.read.special',
      mode: 'any',
      public: false,
      hasResolver: true,
    })

    expect(healthPing?.authz).toBeUndefined()
  })

  it('procedure with .authz({ public: true }) is flagged', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [],
      },
    })

    server
      .procedure('docs.fetch')
      .authz({ public: true })
      .handler(async () => ({ ok: true }))

    const graph = server.preview()
    const op = graph.operations.find((o) => o.name === 'docs.fetch')
    expect(op?.authz?.public).toBe(true)
    expect(op?.authz?.hasResolver).toBe(false)
  })
})

describe('MCP raffel://policies discovery (T8.2)', () => {
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    setPolicyProvider(null)
  })

  it('lists raffel://policies + raffel://policy/<id> in static resources', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'allow-read',
            effect: 'allow',
            principals: ['scope:lead.read'],
            actions: ['lead.read'],
            resources: ['lead:*'],
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

    const resources = getStaticResources()
    const uris = resources.map((r) => r.uri)
    expect(uris).toContain('raffel://policies')
    expect(uris).toContain('raffel://policy/allow-read')
    expect(uris).toContain('raffel://policy/deny-archived')
  })

  it('readResource("raffel://policies") returns JSON snapshot', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'p1',
            effect: 'allow',
            principals: ['*'],
            actions: ['*'],
            resources: ['*'],
          },
        ],
      },
    })

    const result = readResource('raffel://policies')
    expect(result).toBeDefined()
    expect(result?.contents[0]?.mimeType).toBe('application/json')
    const parsed = JSON.parse(result!.contents[0]!.text!) as Array<{ id: string }>
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('p1')
  })

  it('readResource("raffel://policy/<id>") returns single policy with sanitised condition', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: {
        principal: { from: 'custom', map: () => P },
        policies: [
          {
            id: 'with-cond',
            effect: 'allow',
            principals: ['*'],
            actions: ['*'],
            resources: ['*'],
            condition: () => true,
          },
          {
            id: 'with-match',
            effect: 'deny',
            principals: ['*'],
            actions: ['*'],
            resources: ['*'],
            match: { 'resource.status': 'archived' },
          },
        ],
      },
    })

    const cond = readResource('raffel://policy/with-cond')
    const condParsed = JSON.parse(cond!.contents[0]!.text!) as Record<string, unknown>
    expect(condParsed.id).toBe('with-cond')
    expect(condParsed.hasCondition).toBe(true)
    expect(condParsed.condition).toBeUndefined() // function NOT exposed

    const match = readResource('raffel://policy/with-match')
    const matchParsed = JSON.parse(match!.contents[0]!.text!) as Record<string, unknown>
    expect(matchParsed.match).toEqual({ 'resource.status': 'archived' })
  })

  it('returns null for unknown policy id', async () => {
    server = createServer({
      port: await getFreePort(),
      policy: { principal: { from: 'custom', map: () => P }, policies: [] },
    })
    expect(readResource('raffel://policy/unknown-id')).toBeNull()
  })

  it('does not list policies when policy not configured', () => {
    setPolicyProvider(null)
    const resources = getStaticResources()
    expect(resources.find((r) => r.uri === 'raffel://policies')).toBeUndefined()
  })
})
