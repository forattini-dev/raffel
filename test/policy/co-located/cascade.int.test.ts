/**
 * Folder cascade `_policy.yaml` (issue #93).
 *
 * `_policy.{yaml,yml,json}` placed in any directory under the discovery tree
 * applies to every handler discovered under it. Sibling files (#92) still
 * win for their specific handler.
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
  return { ok: true }
}
`

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

describe('folder cascade _policy.yaml (issue #93)', () => {
  it('cascades to descendants and lets siblings override per-handler', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-cascade-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'leads'), { recursive: true })
    await mkdir(path.join(httpDir, 'orders'), { recursive: true })

    // Folder cascade — applies to every handler under httpDir.
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `
id: tenant-isolation
effect: allow
principals:
  - scope:read
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    // Two handlers covered by the cascade.
    await writeFile(path.join(httpDir, 'leads', 'get.ts'), HANDLER_TS)
    await writeFile(path.join(httpDir, 'orders', 'list.ts'), HANDLER_TS)

    // Per-handler sibling that augments the cascade with a stricter scope.
    await writeFile(
      path.join(httpDir, 'orders', 'list.policy.yaml'),
      `
id: orders-list-extra
effect: deny
principals:
  - scope:read
actions:
  - orders/list
resources:
  - "**"
`.trim(),
    )

    const port = await getFreePort()
    let principal: Principal = { id: 'u', tenantId: 't1', scopes: ['read'], groups: [] }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    // leads/get → only the cascade applies → allowed
    const leadsAllowed = await fetch(`http://127.0.0.1:${port}/leads/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(leadsAllowed.status).toBe(200)

    // orders/list → cascade allow + sibling deny → deny wins per engine semantics
    const ordersDenied = await fetch(`http://127.0.0.1:${port}/orders/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(ordersDenied.status).toBe(403)
  })

  it('nearer cascade wins when ancestor and descendant define conflicting policies for same id', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-cascade-near-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'admin'), { recursive: true })

    // Broader: deny everything.
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `
id: rule-x
effect: deny
principals:
  - "*"
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    // Closer: same id, allow. addPolicies dedupes by id and replaces.
    await writeFile(
      path.join(httpDir, 'admin', '_policy.yaml'),
      `
id: rule-x
effect: allow
principals:
  - scope:admin
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    await writeFile(path.join(httpDir, 'admin', 'reset.ts'), HANDLER_TS)

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't', scopes: ['admin'], groups: [] }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/admin/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
  })

  it('scopes cascaded policies per discovered operation after local overrides', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-cascade-scoped-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'admin'), { recursive: true })
    await mkdir(path.join(httpDir, 'public'), { recursive: true })

    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `
id: rule-x
effect: deny
principals:
  - "*"
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    await writeFile(
      path.join(httpDir, 'admin', '_policy.yaml'),
      `
id: rule-x
effect: allow
principals:
  - scope:admin
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    await writeFile(path.join(httpDir, 'admin', 'reset.ts'), HANDLER_TS)
    await writeFile(path.join(httpDir, 'public', 'health.ts'), HANDLER_TS)

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't', scopes: ['admin'], groups: [] }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const publicRes = await fetch(`http://127.0.0.1:${port}/public/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(publicRes.status).toBe(403)

    const adminRes = await fetch(`http://127.0.0.1:${port}/admin/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(adminRes.status).toBe(200)
  })

  it('does not read _policy.* outside the discovery root', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-cascade-root-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'foo'), { recursive: true })

    // _policy.yaml ABOVE the discovery root — must be ignored.
    await writeFile(
      path.join(dir, '_policy.yaml'),
      `
id: out-of-tree
effect: deny
principals:
  - "*"
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )

    await writeFile(path.join(httpDir, 'foo', 'go.ts'), HANDLER_TS)

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't', scopes: [], groups: [] }
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/foo/go`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    // No co-located policy reached → route un-gated → 200.
    expect(res.status).toBe(200)
  })
})
