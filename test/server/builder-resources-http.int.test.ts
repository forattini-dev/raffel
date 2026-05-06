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
