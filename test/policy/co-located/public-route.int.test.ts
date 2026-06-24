/**
 * Public-route cascade interaction (regression test).
 *
 * Background — K8s readiness/liveness probes against a route declared as
 * `meta.auth: 'none'` started failing with HTTP 500 INTERNAL_ERROR as soon
 * as a folder-cascade `_policy.yaml` was added anywhere above the handler.
 *
 * Root cause was a double bug:
 *   1. The default principal resolvers (oauth2/oidc/session) used to throw
 *      a plain `Error` when `ctx.auth.authenticated` was false. The throw
 *      escaped the route handler chain and the router mapped it to
 *      `INTERNAL_ERROR` (500).
 *   2. Co-located policies were attached to every discovered route under
 *      the cascade, ignoring `meta.auth === 'none'`.
 *
 * Fix:
 *   1. Resolvers now return `ANONYMOUS_PRINCIPAL` instead of throwing.
 *   2. `discovery-utils` marks the co-located policy interceptor as
 *      `public: true` whenever the route is `meta.auth: 'none'`.
 *
 * These tests pin both behaviours end-to-end against a real HTTP server
 * (anonymous requests, no principal override).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../../src/server/builder.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (address && typeof address !== 'string') {
        s.close((err) => (err ? reject(err) : resolve(address.port)))
      } else {
        s.close(() => reject(new Error('no port')))
      }
    })
  })
}

const PUBLIC_HANDLER_TS = `
export const meta = { auth: 'none' } as const
export default async function handler(_input, _ctx) {
  return { ok: true }
}
`

const PROTECTED_HANDLER_TS = `
export default async function handler(_input, _ctx) {
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

async function setupCascade(handlers: Record<string, string>) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-public-route-'))
  const httpDir = path.join(dir, 'http')
  await mkdir(httpDir, { recursive: true })

  // Folder cascade that would otherwise deny everything.
  await writeFile(
    path.join(httpDir, '_policy.yaml'),
    `
id: deny-all
effect: deny
principals:
  - "*"
actions:
  - "**"
resources:
  - "**"
`.trim(),
  )

  for (const [name, body] of Object.entries(handlers)) {
    const filePath = path.join(httpDir, name)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, body)
  }

  return httpDir
}

describe('co-located policy + meta.auth = "none" (K8s probe regression)', () => {
  it('public route (meta.auth: "none") under a denying cascade still answers 200 to anonymous probes', async () => {
    const httpDir = await setupCascade({
      // next.js-style verb convention: name maps to `live/get` → GET /live/get
      // ... but we want /health/live so we hand-write the meta too.
      'health/live/get.ts': `
export const meta = { auth: 'none', httpMethod: 'GET', httpPath: '/health/live' } as const
export default async function handler(_input, _ctx) {
  return { ok: true }
}
`,
    })

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        // Use the default oauth2 principal resolver so we exercise the
        // real anonymous path (no `custom` map short-circuiting it).
        principal: { from: 'oauth2' },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // K8s probe — anonymous GET.
    const res = await fetch(`http://127.0.0.1:${port}/health/live`, { method: 'GET' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('protected route under the same cascade still denies anonymous requests (no 500)', async () => {
    const httpDir = await setupCascade({
      'admin/reset/post.ts': `
export const meta = { httpMethod: 'POST', httpPath: '/admin/reset' } as const
export default async function handler(_input, _ctx) {
  return { ok: true }
}
`,
    })

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'oauth2' },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // Anonymous → policy evaluates against anonymous principal → matches
    // `principals: ['*']` → deny → 403. The crucial thing is that this is
    // a clean policy decision (403), NOT a 500 INTERNAL_ERROR from a
    // crashed principal resolver.
    const res = await fetch(`http://127.0.0.1:${port}/admin/reset`, { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('public route keeps working when cascade is missing (no policy at all)', async () => {
    // No _policy.yaml anywhere — baseline check that the public-route
    // machinery does not regress the no-policy case.
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-public-route-nopolicy-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'health'), { recursive: true })
    await writeFile(
      path.join(httpDir, 'health', 'live.ts'),
      `
export const meta = { auth: 'none', httpMethod: 'GET', httpPath: '/health/live' } as const
export default async function handler(_input, _ctx) {
  return { ok: true }
}
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      // No policy config at all.
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/health/live`, { method: 'GET' })
    expect(res.status).toBe(200)
  })
})
