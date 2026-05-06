/**
 * Policy `scope` end-to-end (issue #96).
 *
 * Verifies the scope filter participates in real request flow through the
 * policy interceptor: `scope.protocols: ['http']` lets a co-located policy
 * apply only when the request arrives via HTTP.
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
export default async function handler() { return { ok: true } }
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

describe('co-located scope filter (issue #96)', () => {
  it('scope.protocols restricts a sibling policy to HTTP requests', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-scope-protocol-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(httpDir, { recursive: true })

    await writeFile(path.join(httpDir, 'go.ts'), HANDLER_TS)
    // Allow only when the request arrived via HTTP.
    await writeFile(
      path.join(httpDir, 'go.policy.yaml'),
      `
id: http-only-allow
effect: allow
principals:
  - "*"
actions:
  - go
resources:
  - "**"
scope:
  protocols:
    - http
`.trim(),
    )

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

    const httpRes = await fetch(`http://127.0.0.1:${port}/go`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(httpRes.status).toBe(200)
  })

  it('scope.routes narrows a folder cascade to a name pattern', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-scope-route-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'admin'), { recursive: true })
    await mkdir(path.join(httpDir, 'public'), { recursive: true })

    // Folder cascade — baseline allow + scoped deny on admin/* only.
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `
- id: baseline-allow
  effect: allow
  principals:
    - "*"
  actions:
    - "**"
  resources:
    - "**"
- id: admin-deny
  effect: deny
  principals:
    - "*"
  actions:
    - "**"
  resources:
    - "**"
  scope:
    routes:
      - "admin/*"
`.trim(),
    )

    await writeFile(path.join(httpDir, 'admin', 'reset.ts'), HANDLER_TS)
    await writeFile(path.join(httpDir, 'public', 'health.ts'), HANDLER_TS)

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

    // /admin/reset is denied (matches scope.routes).
    const adminRes = await fetch(`http://127.0.0.1:${port}/admin/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(adminRes.status).toBe(403)

    // /public/health is unaffected (scope filters out the policy).
    const publicRes = await fetch(`http://127.0.0.1:${port}/public/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(publicRes.status).toBe(200)
  })
})
