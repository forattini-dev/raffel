/**
 * Integration tests for configurable HTTP success status codes.
 *
 * Covers issue #101:
 *   - HttpRouteOptions.successStatus override on server.http.*
 *   - REST conventions on resource auto-CRUD: 201 create, 204 delete
 *   - 204 emits empty body
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

async function createUserResourceFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-status-'))
  await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })

  const userResource = `
const store = new Map()
let nextId = 1

export const config = { basePath: '/users' }

export const list = async () => Array.from(store.values())

export const get = async (id) => store.get(id) ?? null

export const create = async (data) => {
  const id = String(nextId++)
  const user = { id, ...data }
  store.set(id, user)
  return user
}

const _delete = async (id) => {
  store.delete(id)
}

export { _delete as delete }
`

  await writeFile(
    path.join(tempDir, 'src', 'resources', 'users.js'),
    userResource
  )

  return tempDir
}

describe('HTTP success status (issue #101)', () => {
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

  it('honors HttpRouteOptions.successStatus on server.http.post', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.post(
      '/widgets',
      { successStatus: 201 },
      async () => ({ ok: true })
    )

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('honors HttpRouteOptions.successStatus = 202 on server.http.put', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.put(
      '/jobs/:id',
      { successStatus: 202 },
      async (_input: unknown, ctx: any) => ({ id: ctx.params?.id, queued: true })
    )

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/jobs/job-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(202)
  })

  it('defaults to 200 when no successStatus is configured', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    server.http.get('/health', async () => ({ ok: true }))

    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/health`)
    expect(response.status).toBe(200)
  })

  it('resource create returns 201 by default', async () => {
    tempDir = await createUserResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada' }),
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ name: 'Ada' })
  })

  it('resource delete returns 204 with empty body by default', async () => {
    tempDir = await createUserResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const created = await fetch(`http://127.0.0.1:${port}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    const { id } = (await created.json()) as { id: string }

    const response = await fetch(`http://127.0.0.1:${port}/users/${id}`, {
      method: 'DELETE',
    })
    expect(response.status).toBe(204)
    const text = await response.text()
    expect(text).toBe('')
  })

  it('resource list/get keep returning 200', async () => {
    tempDir = await createUserResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    const listRes = await fetch(`http://127.0.0.1:${port}/users`)
    expect(listRes.status).toBe(200)
  })
})
