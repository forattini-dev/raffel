/**
 * Co-located sibling policy bridge (issue #92).
 *
 * Drops a handler + sibling `<file>.policy.{yaml,json}` in a temp dir, boots a
 * Raffel server with FS discovery + policy bootstrap, and asserts the policy
 * gates the route end-to-end.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../../src/server/builder.js'
import type { Principal } from '../../../src/middleware/policy/types.js'

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

const HANDLER_TS = `
export default async function handler(input, ctx) {
  return { ok: true, input }
}
`

const POLICY_YAML = `
id: leads-read-allow
effect: allow
principals:
  - scope:lead.read
actions:
  - leads/get
resources:
  - "**"
`

const POLICY_JSON = JSON.stringify({
  id: 'orders-list-allow',
  effect: 'allow',
  principals: ['scope:order.read'],
  actions: ['orders/list'],
  resources: ['**'],
})

let dir: string
let server: ReturnType<typeof createServer> | null = null

afterEach(async () => {
  if (server) {
    await server.stop().catch(() => {})
    server = null
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = ''
  }
})

async function setupTree(): Promise<{ baseDir: string; httpDir: string }> {
  dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-colocated-'))
  const httpDir = path.join(dir, 'http')
  await mkdir(path.join(httpDir, 'leads'), { recursive: true })
  await mkdir(path.join(httpDir, 'orders'), { recursive: true })

  // Sibling YAML policy for leads/get
  await writeFile(path.join(httpDir, 'leads', 'get.ts'), HANDLER_TS)
  await writeFile(path.join(httpDir, 'leads', 'get.policy.yaml'), POLICY_YAML)

  // Sibling JSON policy for orders/list
  await writeFile(path.join(httpDir, 'orders', 'list.ts'), HANDLER_TS)
  await writeFile(path.join(httpDir, 'orders', 'list.policy.json'), POLICY_JSON)

  return { baseDir: dir, httpDir }
}

describe('co-located sibling policies (issue #92)', () => {
  it('YAML sibling allows authorised request and denies unauthorised', async () => {
    const { httpDir } = await setupTree()
    const port = await getFreePort()
    let principal: Principal = {
      id: 'u-allowed',
      tenantId: 't1',
      scopes: ['lead.read'],
      groups: [],
    }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })

    await server.start()

    const allowed = await fetch(`http://127.0.0.1:${port}/leads/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })
    expect(allowed.status).toBe(200)

    // Swap principal to one without the required scope.
    principal = { id: 'u-denied', tenantId: 't1', scopes: [], groups: [] }
    const denied = await fetch(`http://127.0.0.1:${port}/leads/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'l1' }),
    })
    expect(denied.status).toBe(403)
  })

  it('JSON sibling auto-loads alongside YAML', async () => {
    const { httpDir } = await setupTree()
    const port = await getFreePort()
    const principal: Principal = {
      id: 'u-orders',
      tenantId: 't1',
      scopes: ['order.read'],
      groups: [],
    }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const allowed = await fetch(`http://127.0.0.1:${port}/orders/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(allowed.status).toBe(200)
  })

  it('explicit .authz() takes precedence over co-located policy', async () => {
    const { httpDir } = await setupTree()
    const port = await getFreePort()
    // Principal lacks the scope the sibling YAML would require, but the
    // explicit policy below is going to be allow-* → builder must win.
    const principal: Principal = {
      id: 'u-direct',
      tenantId: 't1',
      scopes: [],
      groups: [],
    }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [
          {
            id: 'leads-get-public',
            effect: 'allow',
            principals: ['*'],
            actions: ['leads/get'],
            resources: ['**'],
          },
        ],
      },
    })

    server
      .procedure('leads/get')
      .authz({ public: false })
      .handler(async () => ({ source: 'explicit-builder' }))

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/leads/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ source: 'explicit-builder' })
  })

  it('opts out when policy.coLocated === false', async () => {
    const { httpDir } = await setupTree()
    const port = await getFreePort()
    const principal: Principal = {
      id: 'u-noscope',
      tenantId: 't1',
      scopes: [],
      groups: [],
    }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
        coLocated: false,
      },
    })
    await server.start()

    // Without co-located bridging the route is unguarded → 200.
    const res = await fetch(`http://127.0.0.1:${port}/leads/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('does not regress projects that only use loadFromDir', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-colocated-loadfrom-'))
    const policiesDir = path.join(dir, 'policies')
    await mkdir(policiesDir, { recursive: true })
    await writeFile(
      path.join(policiesDir, 'allow-all.json'),
      JSON.stringify({
        id: 'public-all',
        effect: 'allow',
        principals: ['*'],
        actions: ['*'],
        resources: ['**'],
      }),
    )

    const port = await getFreePort()
    server = createServer({
      port,
      policy: {
        principal: {
          from: 'custom',
          map: () => ({ id: 'u', tenantId: null, scopes: [], groups: [] }),
        },
        loadFromDir: policiesDir,
      },
    })

    server.procedure('ping').handler(async () => ({ ok: true }))
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })
})
