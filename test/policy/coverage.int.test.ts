/**
 * Policy coverage report (issue #97).
 *
 * `server.policyCoverage()` returns a machine-readable summary of which
 * registered operations/channels have a policy attached and which do not.
 * `defaultMode: 'deny'` callers can pipe `gaps` through CI to fail builds
 * that ship un-policied surfaces.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../src/server/builder.js'

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

describe('server.policyCoverage (issue #97)', () => {
  it('flags procedures without a policy and excludes those with sibling policies', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-coverage-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'leads'), { recursive: true })
    await mkdir(path.join(httpDir, 'orders'), { recursive: true })

    // leads/get is policy-protected.
    await writeFile(path.join(httpDir, 'leads', 'get.ts'), HANDLER_TS)
    await writeFile(
      path.join(httpDir, 'leads', 'get.policy.yaml'),
      `
id: leads-allow
effect: allow
principals: ["*"]
actions: [leads/get]
resources: ["**"]
`.trim(),
    )

    // orders/list has NO sibling policy and no folder cascade.
    await writeFile(path.join(httpDir, 'orders', 'list.ts'), HANDLER_TS)

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => ({ id: 'u', tenantId: 't', scopes: [], groups: [] }) },
        policies: [],
      },
    })
    await server.start()

    const report = server.policyCoverage()
    expect(report).not.toBeNull()
    expect(report?.defaultMode).toBe('deny')
    expect(report?.gaps.map((g) => g.name)).toContain('orders/list')
    expect(report?.gaps.map((g) => g.name)).not.toContain('leads/get')
    expect(report?.covered).toBeGreaterThanOrEqual(1)
  })

  it('returns null when no policy is configured', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-coverage-nopolicy-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(httpDir, { recursive: true })
    await writeFile(path.join(httpDir, 'go.ts'), HANDLER_TS)

    const port = await getFreePort()
    server = createServer({ port, discovery: { http: httpDir } })
    await server.start()

    expect(server.policyCoverage()).toBeNull()
  })

  it('counts public-marked procedures separately from gaps', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-coverage-public-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(httpDir, { recursive: true })
    await writeFile(path.join(httpDir, 'health.ts'), HANDLER_TS)
    await writeFile(path.join(httpDir, 'protected.ts'), HANDLER_TS)
    await writeFile(
      path.join(httpDir, 'protected.policy.yaml'),
      `
id: protected-allow
effect: allow
principals: ["*"]
actions: [protected]
resources: ["**"]
`.trim(),
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        defaultMode: 'deny',
        principal: { from: 'custom', map: () => ({ id: 'u', tenantId: 't', scopes: [], groups: [] }) },
        policies: [],
      },
    })

    server.procedure('health').authz({ public: true }).handler(async () => ({ ok: true }))

    await server.start()

    const report = server.policyCoverage()
    expect(report).not.toBeNull()
    expect(report!.public).toBe(1)
    expect(report!.gaps.map((g) => g.name)).not.toContain('health')
    expect(report!.gaps.map((g) => g.name)).not.toContain('protected')
  })
})
