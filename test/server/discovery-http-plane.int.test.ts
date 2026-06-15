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
  it('serves ordinary Routes Root HTTP handlers with public prefix and internal namespace', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-http-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(path.join(routesDir, 'notifications'), { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications', 'get.js'),
      `export default async function () { return [{ id: 'n1' }] }`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never)
    await server.start()

    const proc = server.registry.listProcedures().find((p) => p.name === 'api/v1/leads/notifications/get')
    expect(proc?.httpMethod).toBe('GET')
    expect(proc?.httpPath).toBe('/api/v1/leads/notifications')

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'n1' }])
  })

  it('serves explicit .rest resource anchors from Routes Root and includes them in OpenAPI docs', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-rest-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(routesDir, { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `const notifications = new Map([['n1', { id: 'n1', title: 'Welcome' }]])

export const list = async () => Array.from(notifications.values())
export const get = async (id) => notifications.get(id) ?? null
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST', version: '1.0.0' },
    })
    await server.start()

    const list = server.registry.listProcedures().find((p) => p.name === 'api.v1.leads.notifications.list')
    const get = server.registry.listProcedures().find((p) => p.name === 'api.v1.leads.notifications.get')
    expect(list?.httpMethod).toBe('GET')
    expect(list?.httpPath).toBe('/api/v1/leads/notifications')
    expect(get?.httpMethod).toBe('GET')
    expect(get?.httpPath).toBe('/api/v1/leads/notifications/:id')

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'n1', title: 'Welcome' }])

    const openApi = server.getOpenAPIDocument()
    expect(openApi?.paths['/api/v1/leads/notifications']?.get?.operationId).toBe('apiV1LeadsNotificationsList')
    expect(openApi?.paths['/api/v1/leads/notifications/:id']?.get?.operationId).toBe('apiV1LeadsNotificationsGet')
  })

  it('serves schema-first .rest resource anchors from Routes Root and includes them in OpenAPI docs', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-rest-schema-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(routesDir, { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `import { z } from 'zod'

const notifications = new Map([['n1', { id: 'n1', title: 'Welcome' }]])

export const schema = z.object({
  id: z.string(),
  title: z.string(),
})

export const config = { operations: ['list', 'get'] }

export const adapter = {
  findMany: async () => Array.from(notifications.values()),
  count: async () => notifications.size,
  findUnique: async ({ where }) => notifications.get(where.id) ?? null,
}
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST Schema', version: '1.0.0' },
    })
    await server.start()

    const list = server.registry.listProcedures().find((p) => p.name === 'api.v1.leads.notifications.list')
    const get = server.registry.listProcedures().find((p) => p.name === 'api.v1.leads.notifications.get')
    expect(list).toBeDefined()
    expect(get).toBeDefined()

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'n1', title: 'Welcome' }])

    const openApi = server.getOpenAPIDocument()
    expect(openApi?.paths['/api/v1/leads/notifications']?.get?.operationId).toBe('api.v1.leads.notifications_list')
    expect(openApi?.paths['/api/v1/leads/notifications']?.get?.parameters).toBeUndefined()
    expect(
      openApi?.paths['/api/v1/leads/notifications']?.get?.responses['200'].content?.['application/json'].schema
    ).toMatchObject({ type: 'array' })
    expect(openApi?.paths['/api/v1/leads/notifications/{id}']?.get?.operationId).toBe('api.v1.leads.notifications_get')
  })

  it('serves schema-first .rest list pagination only when explicitly enabled', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-rest-pagination-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(routesDir, { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `import { z } from 'zod'

const notifications = [
  { id: 'n1', title: 'Welcome' },
  { id: 'n2', title: 'Follow up' },
]

export const schema = z.object({
  id: z.string(),
  title: z.string(),
})

export const config = { operations: ['list'], pagination: true }

export const adapter = {
  findMany: async (query = {}) => {
    const skip = query.skip ?? 0
    const take = query.take ?? notifications.length
    return notifications.slice(skip, skip + take)
  },
  count: async () => notifications.length,
}
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST Pagination', version: '1.0.0' },
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications?limit=1&page=2`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: [{ id: 'n2', title: 'Follow up' }],
      meta: {
        total: 2,
        limit: 1,
        offset: 1,
        page: 2,
        hasMore: false,
      },
    })

    const openApi = server.getOpenAPIDocument()
    const listOperation = openApi?.paths['/api/v1/leads/notifications']?.get
    expect(listOperation?.parameters?.map((param) => param.name)).toEqual(['limit', 'page', 'offset'])
    expect(
      listOperation?.responses['200'].content?.['application/json'].schema
    ).toMatchObject({
      type: 'object',
      properties: {
        data: { type: 'array' },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            page: { type: 'integer' },
            hasMore: { type: 'boolean' },
          },
        },
      },
    })
  })

  it('serves cursor pagination for schema-first .rest resources when configured', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-rest-cursor-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(routesDir, { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `import { z } from 'zod'

const notifications = [
  { id: 'n1', title: 'Welcome' },
  { id: 'n2', title: 'Follow up' },
]

export const schema = z.object({
  id: z.string(),
  title: z.string(),
})

export const config = {
  operations: ['list'],
  pagination: { style: 'cursor', defaultLimit: 1, maxLimit: 10, cursorField: 'id' },
}

export const adapter = {
  findMany: async (query = {}) => {
    const cursorId = query.cursor?.id
    const cursorIndex = cursorId ? notifications.findIndex((item) => item.id === cursorId) : -1
    const start = cursorIndex >= 0 ? cursorIndex + (query.skip ?? 0) : 0
    const take = query.take ?? notifications.length
    return notifications.slice(start, start + take)
  },
  count: async () => notifications.length,
}
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST Cursor', version: '1.0.0' },
    })
    await server.start()

    const first = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications`)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      data: [{ id: 'n1', title: 'Welcome' }],
      meta: {
        limit: 1,
        nextCursor: 'n1',
        hasMore: true,
      },
    })

    const next = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications?cursor=n1`)
    expect(next.status).toBe(200)
    expect(await next.json()).toEqual({
      data: [{ id: 'n2', title: 'Follow up' }],
      meta: {
        limit: 1,
        hasMore: false,
      },
    })

    const openApi = server.getOpenAPIDocument()
    const listOperation = openApi?.paths['/api/v1/leads/notifications']?.get
    expect(listOperation?.parameters?.map((param) => param.name)).toEqual(['limit', 'cursor'])
    expect(
      listOperation?.responses['200'].content?.['application/json'].schema
    ).toMatchObject({
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          properties: {
            limit: { type: 'integer' },
            nextCursor: { type: 'string' },
            hasMore: { type: 'boolean' },
          },
        },
      },
    })
  })

  it('serves schema-first .rest delete as 204 and documents 204', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-rest-delete-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(routesDir, { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `import { z } from 'zod'

const notifications = new Map([['n1', { id: 'n1', title: 'Welcome' }]])

export const schema = z.object({
  id: z.string(),
  title: z.string(),
})

export const config = { operations: ['get', 'delete'] }

export const adapter = {
  findUnique: async ({ where }) => notifications.get(where.id) ?? null,
  delete: async ({ where }) => { notifications.delete(where.id) },
}
`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST Delete', version: '1.0.0' },
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications/n1`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')

    const openApi = server.getOpenAPIDocument()
    const responses = openApi?.paths['/api/v1/leads/notifications/{id}']?.delete?.responses
    expect(responses?.['204']).toBeDefined()
    expect(responses?.['200']).toBeUndefined()
  })

  it('serves composed Resource Anchor actions from same-named directories', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-routes-root-actions-'))
    const routesDir = path.join(dir, 'domains', 'leads', 'routes')
    await mkdir(path.join(routesDir, 'notifications', '[id]', 'archive'), { recursive: true })
    await mkdir(path.join(routesDir, 'notifications', 'export'), { recursive: true })

    await writeFile(
      path.join(routesDir, 'notifications.rest.js'),
      `export const list = async () => [{ id: 'n1' }]`,
    )
    await writeFile(
      path.join(routesDir, '_meta.js'),
      `export default { tag: 'Leads', description: 'Lead domain routes' }`,
    )
    await writeFile(
      path.join(routesDir, 'notifications', 'export', 'get.js'),
      `export default async function () { return { exported: true } }`,
    )
    await writeFile(
      path.join(routesDir, 'notifications', '[id]', 'archive', 'post.js'),
      `export default async function (_input, ctx) { return { id: ctx.params.id, archived: true } }`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Routes Root REST Actions', version: '1.0.0' },
    })
    await server.start()

    const procedures = server.registry.listProcedures()
    expect(procedures.find((p) => p.name === 'api.v1.leads.notifications.export')?.httpPath)
      .toBe('/api/v1/leads/notifications/export')
    expect(procedures.find((p) => p.name === 'api.v1.leads.notifications.archive')?.httpPath)
      .toBe('/api/v1/leads/notifications/:id/archive')

    const exported = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications/export`)
    expect(exported.status).toBe(200)
    expect(await exported.json()).toEqual({ exported: true })

    const archived = await fetch(`http://127.0.0.1:${port}/api/v1/leads/notifications/n1/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(archived.status).toBe(200)
    expect(await archived.json()).toEqual({ id: 'n1', archived: true })

    const openApi = server.getOpenAPIDocument()
    expect(openApi?.paths['/api/v1/leads/notifications/export']?.get?.operationId)
      .toBe('apiV1LeadsNotificationsExport')
    expect(openApi?.paths['/api/v1/leads/notifications/export']?.get?.tags)
      .toEqual(['Leads'])
    expect(openApi?.paths['/api/v1/leads/notifications/:id/archive']?.post?.operationId)
      .toBe('apiV1LeadsNotificationsArchive')
    expect(openApi?.paths['/api/v1/leads/notifications/:id/archive']?.post?.tags)
      .toEqual(['Leads'])
  })

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
