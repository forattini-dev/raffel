/**
 * Integration tests for resource files reaching the HTTP plane.
 *
 * Covers issue #100: registerResource must forward httpPath/httpMethod so
 * file-discovered resources are visible to createHttpOverrideMiddleware.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { createServer } from '../../src/server/builder.js'
import { loadDiscovery } from '../../src/server/fs-routes/index.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

async function createResourceFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-resource-'))
  await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })

  const userResource = `
const store = new Map()
let nextId = 1

export const config = { basePath: '/users' }

export const list = async () => Array.from(store.values())

export const get = async (id) => {
  const user = store.get(id)
  if (!user) throw Object.assign(new Error('not found'), { status: 404, code: 'NOT_FOUND' })
  return user
}

export const create = async (data) => {
  const id = String(nextId++)
  const user = { id, ...data }
  store.set(id, user)
  return user
}

export const update = async (id, data) => {
  const user = { id, ...data }
  store.set(id, user)
  return user
}

export const patch = async (id, data) => {
  const existing = store.get(id) ?? { id }
  const user = { ...existing, ...data }
  store.set(id, user)
  return user
}

const _delete = async (id) => {
  store.delete(id)
  return { ok: true }
}

export { _delete as delete }
`

  await writeFile(
    path.join(tempDir, 'src', 'resources', 'users.js'),
    userResource
  )

  return tempDir
}

describe('Resource files via HTTP override middleware (issue #100)', () => {
  let server: ReturnType<typeof createServer> | null = null
  let tempDir: string | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('exposes registered resource as procedure with httpPath/httpMethod metadata', async () => {
    tempDir = await createResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)

    const procedures = server.registry.listProcedures()
    const list = procedures.find((p) => p.name === 'users.list')
    const get = procedures.find((p) => p.name === 'users.get')
    const create = procedures.find((p) => p.name === 'users.create')
    const del = procedures.find((p) => p.name === 'users.delete')

    expect(list?.httpMethod).toBe('GET')
    expect(list?.httpPath).toBe('/users')
    expect(get?.httpMethod).toBe('GET')
    expect(get?.httpPath).toBe('/users/:id')
    expect(create?.httpMethod).toBe('POST')
    expect(create?.httpPath).toBe('/users')
    expect(del?.httpMethod).toBe('DELETE')
    expect(del?.httpPath).toBe('/users/:id')
  })

  it('projects discovered resource schemas and REST success statuses into OpenAPI', async () => {
    tempDir = await createResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })
    const users = discovery.resources.find((resource) => resource.name === 'users')
    if (!users) throw new Error('users resource was not discovered')

    users.handlers.schema = z.object({
      id: z.string(),
      name: z.string(),
    })
    users.handlers.inputSchema = z.object({ name: z.string() })
    users.handlers.actions = {
      summary: {
        method: 'GET',
        collection: true,
        output: z.object({ count: z.number() }),
        handler: async () => ({ count: 0 }),
      },
    }

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' }).enableUSD({
      info: { title: 'Resource discovery contract', version: 'test' },
    })
    server.addDiscovery(discovery)
    await server.start()

    const document = server.getOpenAPIDocument()
    if (!document) throw new Error('OpenAPI document was not generated')

    const listSchema = document.paths['/users']?.get?.responses['200']?.content?.['application/json']?.schema
    expect(listSchema).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    })

    expect(document.paths['/users']?.post?.requestBody?.content['application/json']?.schema)
      .toMatchObject({
        type: 'object',
        properties: { name: { type: 'string' } },
      })
    expect(document.paths['/users']?.post?.responses['201']?.content?.['application/json']?.schema)
      .toMatchObject({
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      })
    expect(document.paths['/users']?.post?.responses['200']).toBeUndefined()
    expect(document.paths['/users/{id}']?.delete?.responses['204']).toEqual({
      description: 'Successful response',
      headers: expect.any(Object),
    })
    expect(document.paths['/users/summary']?.get?.responses['200']?.content?.['application/json']?.schema)
      .toMatchObject({
        type: 'object',
        properties: { count: { type: 'number' } },
      })
  })

  it('projects an explicit list output override into OpenAPI', async () => {
    tempDir = await createResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })
    const users = discovery.resources.find((resource) => resource.name === 'users')
    if (!users) throw new Error('users resource was not discovered')
    const list = users.handlers.list
    if (typeof list !== 'function') throw new Error('users list handler was not discovered')

    const userSchema = z.object({ id: z.string(), name: z.string() })
    users.handlers.schema = userSchema
    users.handlers.list = {
      handler: list,
      output: z.object({
        data: z.array(userSchema),
        hasMore: z.boolean(),
      }),
    }

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' }).enableUSD({
      info: { title: 'Resource discovery contract', version: 'test' },
    })
    server.addDiscovery(discovery)
    await server.start()

    const document = server.getOpenAPIDocument()
    if (!document) throw new Error('OpenAPI document was not generated')
    expect(document.paths['/users']?.get?.responses['200']?.content?.['application/json']?.schema)
      .toMatchObject({
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, name: { type: 'string' } },
            },
          },
          hasMore: { type: 'boolean' },
        },
      })
  })

  it('decodes resource path params and preserves malformed percent-encoding (issue #182)', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-resource-encoded-param-'))
    await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })
    await writeFile(
      path.join(tempDir, 'src', 'resources', 'things.js'),
      `export const config = { basePath: '/things' }
export const get = async (id) => ({ id })
`,
    )

    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const base = `http://127.0.0.1:${port}/things`
    for (const [encoded, decoded] of [
      ['a%40b', 'a@b'],
      ['a%2Fb', 'a/b'],
      ['Gustavo%20Vieira', 'Gustavo Vieira'],
      ['%E2%9C%93', '✓'],
      ['%ZZ', '%ZZ'],
    ]) {
      const response = await fetch(`${base}/${encoded}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: decoded })
    }
  })

  it('per-action middleware composes after config.middleware (issue #115)', async () => {
    // One global middleware (A) gates every action; one per-action
    // middleware (B) gates only `create`. `list` and `get` should run A but
    // never B; `create` should run A then B; if B rejects, the create
    // handler must never execute.
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-resource-mw-'))
    await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })

    const resource = `
const calls = []
globalThis.__raffelMwCalls__ = calls

const tag = (ctx) => (ctx?.http?.path ?? '') + ' ' + (ctx?.http?.method ?? '')
const requireAuth = async (ctx, next) => {
  calls.push('A:' + tag(ctx))
  return next()
}

const requireAdmin = async (ctx, next) => {
  calls.push('B:' + tag(ctx))
  if (ctx?.http?.headers?.['x-role'] !== 'admin') {
    const err = new Error('forbidden')
    err.status = 403
    err.code = 'FORBIDDEN'
    throw err
  }
  return next()
}

export const config = { basePath: '/things', middleware: [requireAuth] }

const store = new Map()
let next = 1

export const list = async () => Array.from(store.values())
export const get = async (id) => store.get(id) ?? null

export const create = {
  middleware: [requireAdmin],
  handler: async (data) => {
    const id = String(next++)
    const thing = { id, ...data }
    store.set(id, thing)
    return thing
  },
}
`

    await writeFile(path.join(tempDir, 'src', 'resources', 'things.js'), resource)

    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const calls = (globalThis as { __raffelMwCalls__?: string[] }).__raffelMwCalls__ ?? []
    calls.length = 0

    const base = `http://127.0.0.1:${port}`

    // GET /things (list) — only A runs
    const listRes = await fetch(`${base}/things`)
    expect(listRes.status).toBe(200)

    // GET /things/missing — only A runs
    await fetch(`${base}/things/missing`)

    // POST /things without admin header — A runs, B rejects
    const createForbidden = await fetch(`${base}/things`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(createForbidden.status).toBe(403)

    // POST /things with admin header — A then B then handler
    const createOk = await fetch(`${base}/things`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'admin' },
      body: JSON.stringify({ name: 'ok' }),
    })
    expect(createOk.status).toBeLessThan(300)
    expect(await createOk.json()).toMatchObject({ name: 'ok' })

    // A must have run on every operation (4 requests)
    const aCalls = calls.filter((c) => c.startsWith('A:'))
    expect(aCalls.length).toBe(4)

    // B must have run only on the two POST /things attempts
    const bCalls = calls.filter((c) => c.startsWith('B:'))
    expect(bCalls.length).toBe(2)

    // Read-side ops must not see B at all
    const bList = calls.filter((c) => c.startsWith('B:') && c.endsWith('GET'))
    expect(bList).toEqual([])
  })

  it('per-action middleware on actions{} entry only runs for that action', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-resource-actions-mw-'))
    await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })

    const resource = `
const calls = []
globalThis.__raffelActionMw__ = calls

const tagOf = (ctx) => (ctx?.http?.path ?? '') + ' ' + (ctx?.http?.method ?? '')
const requireAuth = async (ctx, next) => { calls.push('A:' + tagOf(ctx)); return next() }
const requireAdmin = async (ctx, next) => {
  calls.push('B:' + tagOf(ctx))
  if (ctx?.http?.headers?.['x-role'] !== 'admin') {
    const e = new Error('forbidden'); e.status = 403; e.code = 'FORBIDDEN'; throw e
  }
  return next()
}

export const config = { basePath: '/teams', middleware: [requireAuth] }

const members = new Map([['t1', ['ada']]])

export const get = async (id) => ({ id, members: members.get(id) ?? [] })

export const actions = {
  members: {
    method: 'GET',
    collection: false,
    handler: async (_input, id) => members.get(id) ?? [],
  },
  invite: {
    method: 'POST',
    collection: false,
    middleware: [requireAdmin],
    handler: async (data, id) => {
      const list = members.get(id) ?? []
      list.push(data?.user ?? 'unknown')
      members.set(id, list)
      return { ok: true, members: list }
    },
  },
}
`

    await writeFile(path.join(tempDir, 'src', 'resources', 'teams.js'), resource)

    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const calls = (globalThis as { __raffelActionMw__?: string[] }).__raffelActionMw__ ?? []
    calls.length = 0

    const base = `http://127.0.0.1:${port}`

    // members action: only A
    const m = await fetch(`${base}/teams/t1/members`)
    expect(m.status).toBe(200)

    // invite without admin: A then B (rejects)
    const inviteForbidden = await fetch(`${base}/teams/t1/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'lin' }),
    })
    expect(inviteForbidden.status).toBe(403)

    // invite with admin: A then B then handler
    const inviteOk = await fetch(`${base}/teams/t1/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'admin' },
      body: JSON.stringify({ user: 'lin' }),
    })
    expect(inviteOk.status).toBeLessThan(300)

    // members action must NOT have triggered B
    expect(calls.filter((c) => c.startsWith('B:') && c.includes('/members')).length).toBe(0)
    // invite must have triggered B twice (once forbidden, once admin)
    expect(calls.filter((c) => c.startsWith('B:') && c.includes('/invite')).length).toBe(2)
    // A must have run on every request (members + 2x invite = 3)
    expect(calls.filter((c) => c.startsWith('A:')).length).toBe(3)
  })

  it('responds end-to-end on the auto-CRUD HTTP routes', async () => {
    tempDir = await createResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const base = `http://127.0.0.1:${port}`

    // POST /users
    const createRes = await fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    })
    expect(createRes.status).toBeLessThan(300)
    const created = await createRes.json()
    expect(created).toMatchObject({ name: 'Ada' })
    const id = (created as { id: string }).id

    // GET /users
    const listRes = await fetch(`${base}/users`)
    expect(listRes.status).toBe(200)
    const listed = await listRes.json()
    expect(Array.isArray(listed)).toBe(true)
    expect(listed).toContainEqual(expect.objectContaining({ name: 'Ada' }))

    // GET /users/:id
    const getRes = await fetch(`${base}/users/${id}`)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toMatchObject({ id, name: 'Ada' })

    // PUT /users/:id
    const putRes = await fetch(`${base}/users/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada Lovelace' }),
    })
    expect(putRes.status).toBe(200)
    expect(await putRes.json()).toMatchObject({ id, name: 'Ada Lovelace' })

    // PATCH /users/:id
    const patchRes = await fetch(`${base}/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(patchRes.status).toBe(200)
    expect(await patchRes.json()).toMatchObject({ id, role: 'admin' })

    // DELETE /users/:id
    const delRes = await fetch(`${base}/users/${id}`, { method: 'DELETE' })
    expect(delRes.status).toBeLessThan(300)
  })
})
