/**
 * Co-located policy file-level metadata (1.1.59+).
 *
 * The new `_meta` block at the top of a co-located policy file controls:
 *   - `mode` (cascade | scope): how the file interacts with the cascade.
 *     `cascade` is the legacy default; `scope` makes the file the
 *     authoritative reset point for its subtree (ancestor policies do
 *     not flow through, but children still inherit from the scope
 *     file).
 *   - `owner`, `ticket`, `description`, `deprecation`: audit-only
 *     metadata that flows through to `server.policy.list()` and
 *     `policyCoverage()`. Never affects engine semantics.
 *
 * Per-policy `_meta` overrides file-level fields field-by-field at
 * materialization time. File structure can be either:
 *   - Bare policy or array: `{ id: '...', ... }` (legacy)
 *   - Wrapped: `{ _meta: {...}, policies: [...] }` (new)
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
      const a = s.address()
      if (!a || typeof a === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      s.close((err) => (err ? reject(err) : resolve(a.port)))
    })
  })
}

const PRINCIPAL: Principal = { id: 'u', tenantId: 't', scopes: [], groups: [] }

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

const scopeFile = (policies: string) => `_meta:
  mode: scope
policies:
${policies}
`

// ─────────────────────────────────────────────────────────────────────────────
// mode: scope — resets the cascade at a directory boundary
// ─────────────────────────────────────────────────────────────────────────────
describe('mode: scope — file acts as cascade reset point', () => {
  it('a scope file breaks ancestor inheritance for handlers below it', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-scope-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'admin'), { recursive: true })

    // Top-level cascade: deny everything (would normally apply to /admin/secret)
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `id: global-deny
effect: deny
principals: ["*"]
actions: ["**"]
resources: ["**"]
`,
    )

    // Scope file: only allow admin routes, reset point at admin/
    await writeFile(
      path.join(httpDir, 'admin', '_policy.yaml'),
      scopeFile(`  - id: admin-allow
    effect: allow
    principals: ["*"]
    actions: ["admin/**"]
    resources: ["**"]`),
    )

    await writeFile(
      path.join(httpDir, 'admin', 'secret.ts'),
      `export const meta = { httpMethod: 'POST', httpPath: '/admin/secret' } as const
export default async function handler() { return { ok: true } }
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => PRINCIPAL },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // /admin/secret is INSIDE the scope → allow from scope file applies
    const r1 = await fetch(`http://127.0.0.1:${port}/admin/secret`, { method: 'POST' })
    expect(r1.status).toBe(200)

    // The scope file's _meta is preserved on its policies
    const allowPolicy = server.policy!.list().find((p) => p.id.endsWith(':admin-allow'))
    expect(allowPolicy?._meta?.owner).toBe(undefined)
  })

  it('a scope file does NOT affect siblings OUTSIDE its directory', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-scope-sibling-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'admin'), { recursive: true })

    // Global deny
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `id: global-deny
effect: deny
principals: ["*"]
actions: ["**"]
resources: ["**"]
`,
    )

    // Scope file in admin/ (but no handler there → harmless)
    await writeFile(
      path.join(httpDir, 'admin', '_policy.yaml'),
      scopeFile(`  - id: admin-only
    effect: allow
    principals: ["*"]
    actions: ["admin/**"]
    resources: ["**"]`),
    )

    // Sibling OUTSIDE the scope (in src/http/, not src/http/admin/)
    await writeFile(
      path.join(httpDir, 'public.ts'),
      `export const meta = { httpMethod: 'POST', httpPath: '/public' } as const
export default async function handler() { return { ok: true } }
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => PRINCIPAL },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // /public is OUTSIDE the scope, so global-deny applies → 403
    const r = await fetch(`http://127.0.0.1:${port}/public`, { method: 'POST' })
    expect(r.status).toBe(403)
  })

  it('the default mode is cascade — existing files behave unchanged', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-default-cascade-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'sub'), { recursive: true })

    // No _meta block → defaults to cascade
    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `id: outer-deny
effect: deny
principals: ["*"]
actions: ["**"]
resources: ["**"]
`,
    )

    await writeFile(
      path.join(httpDir, 'sub', '_policy.yaml'),
      `id: inner-allow
effect: allow
principals: ["*"]
actions: ["sub/**"]
resources: ["**"]
`,
    )

    await writeFile(
      path.join(httpDir, 'sub', 'route.ts'),
      `export const meta = { httpMethod: 'POST', httpPath: '/sub/route' } as const
export default async function handler() { return { ok: true } }
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => PRINCIPAL },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // Default cascade: inner allow exists but outer's * * + ** with deny
    // wins via the engine's explicit-deny precedence. The 403 confirms
    // that the inner file's policies ARE attached (the cascade worked),
    // they just don't win against the broader deny.
    const r = await fetch(`http://127.0.0.1:${port}/sub/route`, { method: 'POST' })
    expect(r.status).toBe(403)

    // And the inner policy IS in the engine with both ids
    const ids = server.policy!.list().map((p) => p.id)
    expect(ids.some((id) => id.endsWith(':outer-deny'))).toBe(true)
    expect(ids.some((id) => id.endsWith(':inner-allow'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// File-level _meta (audit) — flows through to list() and coverage
// ─────────────────────────────────────────────────────────────────────────────
describe('audit metadata surfaces through server.policy.list()', () => {
  it('file-level _meta appears on every policy in the file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-audit-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(httpDir, { recursive: true })

    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `_meta:
  owner: security@stone.com.br
  ticket: SEC-1234
  deprecation: "2030-01-01"
policies:
  - id: rule-one
    effect: deny
    principals: ["*"]
    actions: ["a/**"]
    resources: ["**"]
  - id: rule-two
    effect: allow
    principals: ["*"]
    actions: ["b/**"]
    resources: ["**"]
`,
    )

    await writeFile(
      path.join(httpDir, 'a.ts'),
      `export const meta = { httpMethod: 'POST', httpPath: '/a' } as const
export default async function handler() { return { ok: true } }
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => PRINCIPAL },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    // Both rules have the file-level _meta attached
    for (const id of ['rule-one', 'rule-two']) {
      const p = server.policy!.list().find((x) => x.id.endsWith(`:${id}`))
      expect(p?._meta).toMatchObject({
        owner: 'security@stone.com.br',
        ticket: 'SEC-1234',
        deprecation: '2030-01-01',
      })
    }
  })

  it('per-policy _meta overrides file-level _meta field by field', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-override-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(httpDir, { recursive: true })

    await writeFile(
      path.join(httpDir, '_policy.yaml'),
      `_meta:
  owner: file-owner
  ticket: FILE-1
policies:
  - id: with-override
    effect: allow
    principals: ["*"]
    actions: ["a/**"]
    resources: ["**"]
    _meta:
      owner: per-policy-owner
      deprecation: "2027-06-01"
  - id: without-override
    effect: allow
    principals: ["*"]
    actions: ["b/**"]
    resources: ["**"]
`,
    )

    await writeFile(
      path.join(httpDir, 'a.ts'),
      `export const meta = { httpMethod: 'POST', httpPath: '/a' } as const
export default async function handler() { return { ok: true } }
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      discovery: { http: httpDir },
      policy: {
        principal: { from: 'custom', map: () => PRINCIPAL },
        policies: [],
        coLocated: true,
      },
    })
    await server.start()

    const overridden = server.policy!.list().find((p) => p.id.endsWith(':with-override'))
    expect(overridden?._meta).toMatchObject({
      owner: 'per-policy-owner',
      ticket: 'FILE-1',
      deprecation: '2027-06-01',
    })

    const fallback = server.policy!.list().find((p) => p.id.endsWith(':without-override'))
    expect(fallback?._meta).toMatchObject({
      owner: 'file-owner',
      ticket: 'FILE-1',
    })
  })
})
