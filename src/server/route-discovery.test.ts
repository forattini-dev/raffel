/**
 * Route Discovery Tests
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from './builder.js'
import { loadRouterModule } from './route-discovery.js'

const TEST_PORT = 24010

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'raffel-routes-'))
}

async function writeRouteFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

describe('loadRouterModule', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('should map file paths to handler names', async () => {
    tempDir = await createTempDir()

    await writeRouteFile(
      path.join(tempDir, 'users', 'create.js'),
      "export const route = { kind: 'procedure', handler: async () => ({ ok: true }) }"
    )

    const module = await loadRouterModule({ rootDir: tempDir })
    const server = createServer({ port: TEST_PORT })
    server.mount('api', module)

    expect(server.registry.getProcedure('api.users.create')).toBeDefined()
  })

  it('should map nested index routes to parent namespace', async () => {
    tempDir = await createTempDir()

    await writeRouteFile(
      path.join(tempDir, 'users', 'index.js'),
      "export const route = { kind: 'procedure', handler: async () => ({ ok: true }) }"
    )

    const module = await loadRouterModule({ rootDir: tempDir })
    const server = createServer({ port: TEST_PORT })
    server.mount('', module)

    expect(server.registry.getProcedure('users')).toBeDefined()
  })

  it('should reject duplicate handler names', async () => {
    tempDir = await createTempDir()

    await writeRouteFile(
      path.join(tempDir, 'users', 'index.js'),
      "export const route = { kind: 'procedure', handler: async () => ({ ok: true }) }"
    )

    await writeRouteFile(
      path.join(tempDir, 'users.js'),
      "export const route = { kind: 'procedure', handler: async () => ({ ok: true }) }"
    )

    await expect(loadRouterModule({ rootDir: tempDir })).rejects.toThrow('Duplicate route name')
  })
})
