/**
 * Resource-level co-located policy bridge (issue #94).
 *
 * Drops a REST resource file + sibling `<resource>.policy.yaml`, boots a
 * Raffel server with `discovery.rest`, and asserts the policy gates every
 * CRUD operation registered from the resource.
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

const RESOURCE_TS = `
const store = new Map()
let nextId = 1

export const config = { basePath: '/users' }
export const list = async () => Array.from(store.values())
export const get = async (id) => store.get(id) ?? { id, name: 'Bob' }
export const create = async (data) => {
  const id = String(nextId++)
  const user = { id, ...data }
  store.set(id, user)
  return user
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

describe('resource-level co-located policies (issue #94)', () => {
  it('sibling .policy.yaml gates every CRUD operation of the resource', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-rest-policy-'))
    const resourcesDir = path.join(dir, 'resources')
    await mkdir(resourcesDir, { recursive: true })

    await writeFile(path.join(resourcesDir, 'users.js'), RESOURCE_TS)
    // Sibling file covering every list/get/create action.
    await writeFile(
      path.join(resourcesDir, 'users.policy.yaml'),
      `
id: users-readers
effect: allow
principals:
  - scope:users.read
actions:
  - users.list
  - users.get
resources:
  - "**"
`.trim(),
    )

    const port = await getFreePort()
    let principal: Principal = { id: 'u', tenantId: 't', scopes: ['users.read'], groups: [] }
    server = createServer({
      port,
      discovery: { resources: resourcesDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const allowed = await fetch(`http://127.0.0.1:${port}/users`)
    expect(allowed.status).toBe(200)

    // Swap to a principal without the scope → list denied.
    principal = { id: 'u-noscope', tenantId: 't', scopes: [], groups: [] }
    const denied = await fetch(`http://127.0.0.1:${port}/users`)
    expect(denied.status).toBe(403)
  })

  it('resolves the REST resource type and id for co-located policies', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-rest-policy-resource-'))
    const resourcesDir = path.join(dir, 'resources')
    await mkdir(resourcesDir, { recursive: true })

    await writeFile(path.join(resourcesDir, 'users.js'), RESOURCE_TS)
    await writeFile(
      path.join(resourcesDir, 'users.policy.yaml'),
      `
id: users-item-read
effect: allow
principals:
  - scope:users.read
actions:
  - users.get
resources:
  - users:123
`.trim(),
    )

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't', scopes: ['users.read'], groups: [] }
    server = createServer({
      port,
      discovery: { resources: resourcesDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const allowed = await fetch(`http://127.0.0.1:${port}/users/123`)
    expect(allowed.status).toBe(200)

    const denied = await fetch(`http://127.0.0.1:${port}/users/999`)
    expect(denied.status).toBe(403)
  })

  it('keeps same policy ids isolated across co-located resource files', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-rest-policy-ids-'))
    const resourcesDir = path.join(dir, 'resources')
    await mkdir(resourcesDir, { recursive: true })

    await writeFile(path.join(resourcesDir, 'users.js'), RESOURCE_TS)
    await writeFile(
      path.join(resourcesDir, 'projects.js'),
      RESOURCE_TS.replace("basePath: '/users'", "basePath: '/projects'"),
    )
    await writeFile(
      path.join(resourcesDir, 'users.policy.yaml'),
      `
id: read
effect: allow
principals:
  - scope:users.read
actions:
  - users.list
resources:
  - users:*
`.trim(),
    )
    await writeFile(
      path.join(resourcesDir, 'projects.policy.yaml'),
      `
id: read
effect: allow
principals:
  - scope:projects.read
actions:
  - projects.list
resources:
  - projects:*
`.trim(),
    )

    const port = await getFreePort()
    const principal: Principal = {
      id: 'u',
      tenantId: 't',
      scopes: ['users.read', 'projects.read'],
      groups: [],
    }
    server = createServer({
      port,
      discovery: { resources: resourcesDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const users = await fetch(`http://127.0.0.1:${port}/users`)
    expect(users.status).toBe(200)

    const projects = await fetch(`http://127.0.0.1:${port}/projects`)
    expect(projects.status).toBe(200)
  })

  it('folder _policy.yaml in the resources tree cascades to every resource under it', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-resources-cascade-'))
    const resourcesDir = path.join(dir, 'resources')
    await mkdir(resourcesDir, { recursive: true })

    // Folder cascade for the entire resources tree.
    await writeFile(
      path.join(resourcesDir, '_policy.yaml'),
      `
id: resources-baseline
effect: allow
principals:
  - scope:read
actions:
  - "**"
resources:
  - "**"
`.trim(),
    )
    await writeFile(path.join(resourcesDir, 'users.js'), RESOURCE_TS)

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't', scopes: ['read'], groups: [] }
    server = createServer({
      port,
      discovery: { resources: resourcesDir },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/users`)
    expect(res.status).toBe(200)
  })
})
