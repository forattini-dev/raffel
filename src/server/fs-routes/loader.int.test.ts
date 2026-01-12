/**
 * File-System Discovery Loader Tests
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadDiscovery } from './loader.js'

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'raffel-discovery-'))
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

describe('loadDiscovery middleware filtering', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('should apply matcher and exclude patterns to route names', async () => {
    tempDir = await createTempDir()

    await writeFixture(
      tempDir,
      'src/http/_middleware.js',
      `export const config = { matcher: ['users/*'], exclude: ['users/internal/*'] }
export default async function middleware(ctx, next) { return next() }
`
    )

    await writeFixture(
      tempDir,
      'src/http/users/get.js',
      'export default async function handler() { return { ok: true } }'
    )

    await writeFixture(
      tempDir,
      'src/http/users/internal/stats.js',
      'export default async function handler() { return { ok: true } }'
    )

    await writeFixture(
      tempDir,
      'src/http/admin/get.js',
      'export default async function handler() { return { ok: true } }'
    )

    const result = await loadDiscovery({
      baseDir: tempDir,
      discovery: { http: true },
    })

    const usersGet = result.routes.find((route) => route.name === 'users/get')
    const usersInternal = result.routes.find((route) => route.name === 'users/internal/stats')
    const adminGet = result.routes.find((route) => route.name === 'admin/get')

    expect(usersGet).toBeDefined()
    expect(usersInternal).toBeDefined()
    expect(adminGet).toBeDefined()

    expect(usersGet?.middlewares.length).toBe(1)
    expect(usersInternal?.middlewares.length).toBe(0)
    expect(adminGet?.middlewares.length).toBe(0)
  })
})
