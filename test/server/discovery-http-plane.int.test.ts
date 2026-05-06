/**
 * `discovery.http` plane wiring (issue #110).
 *
 * Verifies the two paths a `./src/http/<...>` file can become an HTTP
 * endpoint:
 *
 * 1. Explicit override: `export const meta = { httpPath, httpMethod }`
 *    is forwarded by discovery-utils into the registry meta and picked up
 *    by the HTTP override middleware.
 * 2. Convention: a route name whose final segment is an HTTP verb
 *    (`users/get`, `auth/[id]/patch`) auto-derives `httpMethod` and
 *    `httpPath` from the discovered name.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../src/server/builder.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNodeHttpServer()
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

describe('discovery.http plane (issue #110)', () => {
  it('forwards explicit `meta.httpPath` / `meta.httpMethod` from a discovered file', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-http-meta-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'auth'), { recursive: true })

    await writeFile(
      path.join(httpDir, 'auth', 'login.js'),
      `export default async function login() { return { ok: true, route: 'auth/login' } }
export const meta = { httpPath: '/auth/login', httpMethod: 'POST' }
`,
    )

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', discovery: { http: httpDir }, extensions: ['.js'] } as never)
    await server.start()

    // Procedure registered with http meta.
    const proc = server.registry.listProcedures().find((p) => p.name === 'auth/login')
    expect(proc?.httpPath).toBe('/auth/login')
    expect(proc?.httpMethod).toBe('POST')

    // And the HTTP plane actually serves it.
    const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, route: 'auth/login' })
  })

  it('derives `httpMethod` and `httpPath` from filename verb convention', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-http-conv-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'users'), { recursive: true })

    // `users/get.js` → GET /users
    await writeFile(
      path.join(httpDir, 'users', 'get.js'),
      `export default async function () { return [{ id: '1' }] }`,
    )
    // `users/[id]/patch.js` → PATCH /users/:id
    await mkdir(path.join(httpDir, 'users', '[id]'), { recursive: true })
    await writeFile(
      path.join(httpDir, 'users', '[id]', 'patch.js'),
      `export default async function (input, ctx) { return { id: ctx.params.id, patched: true } }`,
    )

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', discovery: { http: httpDir }, extensions: ['.js'] } as never)
    await server.start()

    const list = server.registry.listProcedures().find((p) => p.name === 'users/get')
    const patch = server.registry.listProcedures().find((p) => p.name === 'users/:id/patch')
    expect(list?.httpMethod).toBe('GET')
    expect(list?.httpPath).toBe('/users')
    expect(patch?.httpMethod).toBe('PATCH')
    expect(patch?.httpPath).toBe('/users/:id')

    // End-to-end on both.
    const listRes = await fetch(`http://127.0.0.1:${port}/users`)
    expect(listRes.status).toBe(200)
    expect(await listRes.json()).toEqual([{ id: '1' }])

    const patchRes = await fetch(`http://127.0.0.1:${port}/users/abc-123`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(patchRes.status).toBe(200)
    expect(await patchRes.json()).toMatchObject({ id: 'abc-123', patched: true })
  })

  it('explicit meta.httpMethod always wins over the verb convention', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-http-override-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'users'), { recursive: true })

    // Filename suggests GET, but the meta forces POST and overrides path.
    await writeFile(
      path.join(httpDir, 'users', 'get.js'),
      `export default async function () { return { ok: true } }
export const meta = { httpMethod: 'POST', httpPath: '/users.search' }
`,
    )

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', discovery: { http: httpDir }, extensions: ['.js'] } as never)
    await server.start()

    const proc = server.registry.listProcedures().find((p) => p.name === 'users/get')
    expect(proc?.httpMethod).toBe('POST')
    expect(proc?.httpPath).toBe('/users.search')
  })

  it('does NOT apply the verb convention to RPC procedures', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-rpc-noconv-'))
    const rpcDir = path.join(dir, 'rpc')
    await mkdir(rpcDir, { recursive: true })

    // `users.get.js` would look verb-suffixed, but discovery.rpc must not
    // synthesise httpMethod for it — RPC is procedure-style, not REST.
    await writeFile(
      path.join(rpcDir, 'get.js'),
      `export default async function () { return { ok: true } }`,
    )

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1', discovery: { rpc: rpcDir }, extensions: ['.js'] } as never)
    await server.start()

    const proc = server.registry.listProcedures().find((p) => p.name === 'get')
    expect(proc?.httpMethod).toBeUndefined()
    expect(proc?.httpPath).toBeUndefined()
  })
})
