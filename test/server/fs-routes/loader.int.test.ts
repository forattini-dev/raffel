/**
 * File-System Discovery Loader Tests
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { loadDiscovery } from '../../../src/server/fs-routes/loader.js'
import { generateResourceRoutes } from '../../../src/server/fs-routes/resources/loader.js'
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
  it('loads ordinary HTTP handlers from an explicit Routes Root with prefix scoping', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/_middleware.js': {
        module: {
          default: async (_ctx: unknown, next: () => unknown) => next(),
        },
      },
      '/app/src/domains/leads/routes/notifications/get.js': {
        module: {
          default: async () => [{ id: 'n1' }],
        },
      },
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          config: { basePath: '/ignored-without-handlers' },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    expect(result.routes.map((route) => route.name)).toEqual([
      'api/v1/leads/notifications/get',
    ])
    expect(result.routes[0]?.meta?.httpMethod).toBe('GET')
    expect(result.routes[0]?.meta?.httpPath).toBe('/api/v1/leads/notifications')
    expect(result.routes[0]?.middlewares).toHaveLength(1)
    expect(result.stats.routes).toBe(1)
    expect(result.stats.total).toBe(1)
  })

  it('loads parameterized Routes Roots with :param prefixes and camelCase namespaces', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/crm-admin/routes/notifications/get.js': {
        module: {
          default: async () => [{ id: 'n1' }],
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/:domain/routes', prefix: '/api/:domain' }],
      },
      extensions: ['.js'],
      source,
    })

    expect(result.routes.map((route) => route.name)).toEqual([
      'api/crmAdmin/notifications/get',
    ])
    expect(result.routes[0]?.meta?.httpMethod).toBe('GET')
    expect(result.routes[0]?.meta?.httpPath).toBe('/api/crm-admin/notifications')
  })

  it('loads parameterized Routes Roots with * and params aliases', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/areas/sales-ops/routes/reports/get.js': {
        module: {
          default: async () => [{ id: 'r1' }],
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/areas/*/routes', params: ['area'], prefix: '/admin/:area' }],
      },
      extensions: ['.js'],
      source,
    })

    expect(result.routes.map((route) => route.name)).toEqual([
      'admin/salesOps/reports/get',
    ])
    expect(result.routes[0]?.meta?.httpPath).toBe('/admin/sales-ops/reports')
  })

  it('treats / as no prefix and does not deduplicate repeated prefix segments', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/root-routes/health/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/dup-routes/notifications/get.js': {
        module: {
          default: async () => [{ id: 'n1' }],
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [
          { dir: './src/root-routes', prefix: '/' },
          { dir: './src/dup-routes', prefix: '/notifications' },
        ],
      },
      extensions: ['.js'],
      source,
    })

    const byName = new Map(result.routes.map((route) => [route.name, route]))

    expect(byName.get('health/get')?.meta?.httpPath).toBe('/health')
    expect(byName.get('notifications/notifications/get')?.meta?.httpPath).toBe('/notifications/notifications')
  })

  it('loads explicit-handler .rest files from Routes Root as resources', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          list: async () => [{ id: 'n1' }],
          get: async (id: string) => ({ id }),
        },
      },
      '/app/src/resources/projects.js': {
        module: {
          list: async () => [],
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
        resources: true,
      },
      extensions: ['.js'],
      source,
    })

    const routesRootResource = result.resources.find((resource) => resource.name === 'api.v1.leads.notifications')

    expect(routesRootResource?.config.basePath).toBe('/api/v1/leads/notifications')
    expect(routesRootResource?.handlers.list).toBeTypeOf('function')
    expect(routesRootResource?.handlers.get).toBeTypeOf('function')
    expect(result.resources.map((resource) => resource.name).sort()).toEqual([
      'api.v1.leads.notifications',
      'projects',
    ])
    expect(result.routes).toHaveLength(0)
    expect(result.stats.resources).toBe(2)
    expect(result.stats.total).toBe(2)
  })

  it('loads schema-first .rest files from Routes Root as REST resources', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          schema: z.object({
            id: z.string(),
            title: z.string(),
          }),
          config: {
            operations: ['list', 'get', 'create', 'delete'],
          },
          adapter: {
            findMany: async () => [],
            count: async () => 0,
            findUnique: async () => null,
            create: async ({ data }: { data: unknown }) => data,
            update: async ({ data }: { data: unknown }) => data,
            delete: async () => undefined,
          },
          list: async () => ({ data: [], meta: { total: 0 } }),
          delete: false,
        },
      },
      '/app/src/rest/projects.js': {
        module: {
          schema: z.object({ id: z.string() }),
          adapter: {
            findMany: async () => [],
            count: async () => 0,
            findUnique: async () => null,
            create: async ({ data }: { data: unknown }) => data,
            update: async ({ data }: { data: unknown }) => data,
            delete: async () => undefined,
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
        rest: true,
      },
      extensions: ['.js'],
      source,
    })

    const routesRootResource = result.restResources.find((resource) => resource.name === 'api.v1.leads.notifications')

    expect(routesRootResource?.config.basePath).toBe('/api/v1/leads/notifications')
    expect(routesRootResource?.routes.map((route) => `${route.method} ${route.path} ${route.operation}`)).toEqual([
      'GET /api/v1/leads/notifications list',
      'POST /api/v1/leads/notifications create',
      'GET /api/v1/leads/notifications/:id get',
    ])
    expect(routesRootResource?.handlers.has('list')).toBe(true)
    expect(routesRootResource?.handlers.has('delete')).toBe(false)
    expect(result.restResources.map((resource) => resource.name).sort()).toEqual([
      'api.v1.leads.notifications',
      'projects',
    ])
    expect(result.stats.rest).toBe(2)
    expect(result.stats.total).toBe(2)
  })

  it('does not duplicate a Routes Root REST anchor when the prefix already ends with the resource segment', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/leads.rest.js': {
        module: {
          schema: z.object({ id: z.string() }),
          config: { operations: ['list', 'get'] },
          adapter: {
            findMany: async () => [],
            count: async () => 0,
            findUnique: async () => null,
            create: async ({ data }: { data: unknown }) => data,
            update: async ({ data }: { data: unknown }) => data,
            delete: async () => undefined,
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/:domain/routes', prefix: '/api/v1/:domain' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.restResources.find((item) => item.name === 'api.v1.leads')

    expect(resource?.config.basePath).toBe('/api/v1/leads')
    expect(resource?.routes.map((route) => `${route.method} ${route.path} ${route.operation}`)).toEqual([
      'GET /api/v1/leads list',
      'GET /api/v1/leads/:id get',
    ])
    expect(result.restResources.map((item) => item.name)).toEqual(['api.v1.leads'])
  })

  it('treats index.rest files in Routes Roots as resources mounted at the prefix root', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/accounts/routes/index.rest.js': {
        module: {
          schema: z.object({ id: z.string() }),
          config: { operations: ['list', 'create'] },
          adapter: {
            findMany: async () => [],
            count: async () => 0,
            findUnique: async () => null,
            create: async ({ data }: { data: unknown }) => data,
            update: async ({ data }: { data: unknown }) => data,
            delete: async () => undefined,
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/:domain/routes', prefix: '/api/v1/:domain' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.restResources.find((item) => item.name === 'api.v1.accounts')

    expect(resource?.config.basePath).toBe('/api/v1/accounts')
    expect(resource?.routes.map((route) => `${route.method} ${route.path} ${route.operation}`)).toEqual([
      'GET /api/v1/accounts list',
      'POST /api/v1/accounts create',
    ])
    expect(result.restResources.map((item) => item.name)).toEqual(['api.v1.accounts'])
  })

  it('composes same-named files and directories into explicit resource actions', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          list: async () => [{ id: 'n1' }],
        },
      },
      '/app/src/domains/leads/routes/notifications.js': {
        module: {
          default: async () => ({ ok: true }),
          meta: { httpMethod: 'POST', actionName: 'bulkRefresh' },
        },
      },
      '/app/src/domains/leads/routes/notifications/export/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/domains/leads/routes/notifications/[id]/archive/post.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/domains/leads/routes/orphans/export/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.resources.find((entry) => entry.name === 'api.v1.leads.notifications')
    expect(Object.keys(resource?.handlers.actions ?? {}).sort()).toEqual([
      'archive',
      'bulkRefresh',
      'export',
    ])

    const actionRoutes = generateResourceRoutes(resource ? [resource] : [])
      .filter((route) => route.isAction)
      .map((route) => `${route.method} ${route.path} ${route.operation}`)
      .sort()

    expect(actionRoutes).toEqual([
      'GET /api/v1/leads/notifications/export export',
      'POST /api/v1/leads/notifications bulkRefresh',
      'POST /api/v1/leads/notifications/:id/archive archive',
    ])
    expect(result.routes.map((route) => route.name)).toEqual([
      'api/v1/leads/orphans/export/get',
    ])
    expect(result.routes[0]?.meta?.httpPath).toBe('/api/v1/leads/orphans/export')
    expect(result.stats.routes).toBe(1)
  })

  it('composes same-named directories into schema-first REST resource actions', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          schema: z.object({
            id: z.string(),
            title: z.string(),
          }),
          config: { operations: ['list'] },
          adapter: {
            findMany: async () => [],
            count: async () => 0,
          },
        },
      },
      '/app/src/domains/leads/routes/notifications/export/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/domains/leads/routes/notifications/[id]/archive/post.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.restResources.find((entry) => entry.name === 'api.v1.leads.notifications')
    expect(Array.from(resource?.actions.keys() ?? []).sort()).toEqual(['archive', 'export'])
    expect(resource?.routes.map((route) => `${route.method} ${route.path} ${route.operation}`).sort()).toEqual([
      'GET /api/v1/leads/notifications list',
      'GET /api/v1/leads/notifications/export export',
      'POST /api/v1/leads/notifications/:id/archive archive',
    ])
    expect(result.routes).toHaveLength(0)
  })

  it('lets Resource Anchors opt out of same-named endpoint composition', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          config: { compose: false },
          list: async () => [{ id: 'n1' }],
        },
      },
      '/app/src/domains/leads/routes/notifications/export/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.resources.find((entry) => entry.name === 'api.v1.leads.notifications')
    expect(resource?.handlers.actions).toBeUndefined()
    expect(result.routes.map((route) => route.name)).toEqual([
      'api/v1/leads/notifications/export/get',
    ])
    expect(result.routes[0]?.meta?.httpPath).toBe('/api/v1/leads/notifications/export')
  })

  it('shadows composed endpoints when a Resource Anchor operation has the same method and path', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          list: async () => [{ id: 'n1' }],
          get: async (id: string) => ({ id }),
        },
      },
      '/app/src/domains/leads/routes/notifications/get.js': {
        module: {
          default: async () => ({ from: 'shadowed-list' }),
        },
      },
      '/app/src/domains/leads/routes/notifications/[id]/get.js': {
        module: {
          default: async () => ({ from: 'shadowed-get' }),
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    const resource = result.resources.find((entry) => entry.name === 'api.v1.leads.notifications')
    expect(resource?.handlers.actions).toBeUndefined()
    expect(result.routes).toHaveLength(0)
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ROUTES_ROOT_RESOURCE_ACTION_SHADOWED',
        severity: 'warning',
        shadowing: expect.objectContaining({
          operation: 'api.v1.leads.notifications.list',
          method: 'GET',
          path: '/api/v1/leads/notifications',
        }),
        shadowed: expect.objectContaining({
          filePath: '/app/src/domains/leads/routes/notifications/get.js',
          method: 'GET',
          path: '/api/v1/leads/notifications',
        }),
      }),
      expect.objectContaining({
        code: 'ROUTES_ROOT_RESOURCE_ACTION_SHADOWED',
        shadowing: expect.objectContaining({
          operation: 'api.v1.leads.notifications.get',
          method: 'GET',
          path: '/api/v1/leads/notifications/:id',
        }),
        shadowed: expect.objectContaining({
          filePath: '/app/src/domains/leads/routes/notifications/[id]/get.js',
          method: 'GET',
          path: '/api/v1/leads/notifications/:id',
        }),
      }),
    ]))
  })

  it('reports Routes Root overlap with legacy HTTP discovery as a configuration error', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/http/api/leads/ping/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/domains/leads/routes/ping/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
    })

    await expect(loadDiscovery({
      baseDir: '/app',
      discovery: {
        http: true,
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/leads' }],
      },
      extensions: ['.js'],
      source,
    })).rejects.toThrow(/discovery\.routes overlaps an existing discovered operation/)
  })

  it('reports Routes Root resource overlap with legacy resource discovery as a configuration error', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          list: async () => [{ id: 'n1' }],
        },
      },
      '/app/src/resources/api.v1.leads.notifications.js': {
        module: {
          list: async () => [],
        },
      },
    })

    await expect(loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
        resources: true,
      },
      extensions: ['.js'],
      source,
    })).rejects.toThrow(/discovery\.routes resource overlaps an existing discovered operation: api\.v1\.leads\.notifications\.list/)
  })

  it('cascades middleware, metadata, and policies onto Resource Anchors and composed actions', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/routes/_middleware.js': {
        module: {
          default: async (_ctx: unknown, next: () => unknown) => next(),
        },
      },
      '/app/src/domains/leads/routes/_meta.js': {
        module: {
          default: { tag: 'Leads', description: 'Lead domain routes' },
        },
      },
      '/app/src/domains/leads/routes/_policy.json': {
        text: JSON.stringify({
          id: 'leads-read',
          effect: 'allow',
          principals: ['*'],
          actions: ['*'],
          resources: ['lead:*'],
        }),
      },
      '/app/src/domains/leads/routes/notifications.rest.js': {
        module: {
          list: async () => [{ id: 'n1' }],
        },
      },
      '/app/src/domains/leads/routes/notifications/export/get.js': {
        module: {
          default: async () => ({ ok: true }),
        },
      },
      '/app/src/domains/leads/routes/reports.rest.js': {
        module: {
          schema: z.object({ id: z.string() }),
          config: { operations: ['list'] },
          adapter: {
            findMany: async () => [],
            count: async () => 0,
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        routes: [{ dir: './src/domains/leads/routes', prefix: '/api/v1/leads' }],
      },
      extensions: ['.js'],
      source,
    })

    const explicit = result.resources.find((resource) => resource.name === 'api.v1.leads.notifications')
    expect(explicit?.config.middleware).toHaveLength(1)
    expect(explicit?.directoryMeta).toMatchObject({ tag: 'Leads', description: 'Lead domain routes' })
    expect(explicit?.coLocatedPolicies?.map((policy) => policy.id)).toEqual(['leads-read'])

    const explicitAction = generateResourceRoutes(explicit ? [explicit] : [])
      .find((route) => route.operation === 'export')
    expect(explicitAction?.middleware.length).toBeGreaterThanOrEqual(1)

    const schemaFirst = result.restResources.find((resource) => resource.name === 'api.v1.leads.reports')
    expect(schemaFirst?.directoryMeta).toMatchObject({ tag: 'Leads', description: 'Lead domain routes' })
    expect(schemaFirst?.coLocatedPolicies?.map((policy) => policy.id)).toEqual(['leads-read'])
    expect(schemaFirst?.routes[0]?.middleware).toHaveLength(1)
  })

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
      '/app/src/graphql/leads.graphql.js': {
        module: {
          default: {
            name: 'Lead',
            schema: z.object({
              id: z.string(),
              title: z.string(),
            }),
            queries: {
              list: {
                field: 'leads',
                many: true,
                resolver: async () => [],
              },
            },
          },
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
    expect(result.graphqlResources.map((resource) => resource.name)).toEqual(['Lead'])
    expect(result.tcpHandlers.map((handler) => handler.name)).toEqual(['game'])
    expect(result.udpHandlers.map((handler) => handler.name)).toEqual(['metrics'])
    expect(result.stats).toMatchObject({
      http: 1,
      rpc: 1,
      streams: 1,
      channels: 1,
      rest: 1,
      resources: 1,
      graphql: 1,
      tcp: 1,
      udp: 1,
      total: 9,
    })
    expect(result.sourceStats.modulesImported).toBeGreaterThanOrEqual(10)
    expect(result.failures).toEqual([])
  })

  it('loads GraphQL resources from multiple source directories with namespaces', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/domains/leads/graphql/leads.graphql.js': {
        module: {
          default: {
            name: 'Lead',
            schema: z.object({ id: z.string() }),
          },
        },
      },
      '/app/src/domains/users/graphql/users.graphql.js': {
        module: {
          resource: {
            name: 'User',
            schema: z.object({ id: z.string() }),
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: {
        graphql: [
          { dir: './src/domains/leads/graphql', namespace: 'crm' },
          { dir: './src/domains/users/graphql', prefix: 'identity' },
        ],
      },
      extensions: ['.js'],
      source,
    })

    expect(result.graphqlResources.map((resource) => ({
      name: resource.name,
      namespace: resource.namespace,
    }))).toEqual([
      { name: 'Lead', namespace: 'crm' },
      { name: 'User', namespace: 'identity' },
    ])
    expect(result.stats.graphql).toBe(2)
    expect(result.stats.total).toBe(2)
  })

  it('attaches co-located policies to GraphQL resources', async () => {
    const source = createInMemoryDiscoverySource({
      '/app/src/graphql/_policy.json': {
        text: JSON.stringify({
          id: 'graphql-read',
          effect: 'allow',
          principals: ['scope:lead.read'],
          actions: ['lead.read'],
          resources: ['lead:*'],
        }),
      },
      '/app/src/graphql/leads.graphql.js': {
        module: {
          default: {
            name: 'Lead',
            schema: z.object({ id: z.string() }),
          },
        },
      },
    })

    const result = await loadDiscovery({
      baseDir: '/app',
      discovery: { graphql: true },
      extensions: ['.js'],
      source,
    })

    expect(result.graphqlResources[0]?.coLocatedPolicies?.map((policy) => policy.id)).toEqual([
      'graphql-read',
    ])
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
