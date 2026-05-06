/**
 * File-System Discovery Loader Tests
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { loadDiscovery } from '../../../src/server/fs-routes/loader.js'
import { createInMemoryDiscoverySource } from '../../../src/server/fs-routes/discovery-source.js'

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

describe('loadDiscovery with DiscoverySource', () => {
  it('maps in-memory route, channel, REST, resource, TCP, and UDP modules', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/http/_middleware.js': {
        module: {
          config: { matcher: ['users/*'] },
          default: async (_ctx: unknown, next: () => unknown) => next(),
        },
      },
      '/app/src/http/users/get.js': {
        module: {
          meta: { summary: 'Get user' },
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/http/users/get.md': {
        text: 'Rich user description',
      },
      '/app/src/rpc/ping.js': {
        module: {
          default: async () => 'pong',
        },
      },
      '/app/src/streams/logs/tail.js': {
        module: {
          default: async function * stream() {
            yield 'line'
          },
        },
      },
      '/app/src/channels/_auth.js': {
        module: {
          default: { anonymous: { principal: 'guest' } },
        },
      },
      '/app/src/channels/room.js': {
        module: {
          auth: 'optional',
        },
      },
      '/app/src/rest/users.js': {
        module: {
          schema: z.object({ id: z.string() }),
        },
      },
      '/app/src/resources/projects.js': {
        module: {
          list: async () => [],
        },
      },
      '/app/src/tcp/game.js': {
        module: {
          onData: async () => {},
        },
      },
      '/app/src/udp/metrics.js': {
        module: {
          onMessage: async () => {},
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: true,
      extensions: ['.js'],
      source,
    })

    expect(result.routes.map((route) => `${route.kind}:${route.name}`)).toEqual([
      'procedure:users/get',
      'procedure:ping',
      'stream:logs/tail',
    ])
    expect(result.routes.find((route) => route.name === 'users/get')?.middlewares).toHaveLength(1)
    expect(result.routes.find((route) => route.name === 'users/get')?.meta?.description).toBe('Rich user description')
    expect(result.channels.map((channel) => channel.name)).toEqual(['room'])
    expect(result.restResources.map((resource) => resource.name)).toEqual(['users'])
    expect(result.resources.map((resource) => resource.name)).toEqual(['projects'])
    expect(result.tcpHandlers.map((handler) => handler.name)).toEqual(['game'])
    expect(result.udpHandlers.map((handler) => handler.name)).toEqual(['metrics'])
    expect(result.stats).toMatchObject({
      http: 1,
      rpc: 1,
      streams: 1,
      channels: 1,
      rest: 1,
      resources: 1,
      tcp: 1,
      udp: 1,
      total: 8,
    })
    expect(result.sourceStats.modulesImported).toBeGreaterThanOrEqual(9)
    expect(result.failures).toEqual([])
  })

  it('reports import failures through DiscoverySource without aborting discovery', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/http/broken.js': {
        importError: new Error('boom'),
      },
      '/app/src/http/ok.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: { http: true },
      extensions: ['.js'],
      source,
    })

    expect(result.routes.map((route) => route.name)).toEqual(['ok'])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toMatchObject({
      operation: 'import',
      path: '/app/src/http/broken.js',
      message: 'boom',
    })
    expect(result.sourceStats.failures).toBe(1)
  })
})
