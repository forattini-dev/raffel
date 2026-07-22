import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createServer } from '../../src/server/builder.js'
import { createRouterModule } from '../../src/server/router-module.js'
import { createInMemoryDiscoverySource } from '../../src/server/fs-routes/discovery-source.js'
import { loadDiscovery } from '../../src/server/fs-routes/loader.js'
import { createContext } from '../../src/types/context.js'
import type { Envelope } from '../../src/types/index.js'
import { createZodAdapter } from '../../src/validation/adapters/zod.js'
import { registerValidator } from '../../src/validation/index.js'

beforeAll(() => registerValidator(createZodAdapter(z)))

function request(
  procedure: string,
  payload: unknown,
  auth?: { principal: string; tenantId?: string },
): Envelope {
  const context = createContext(`request-${Math.random()}`, {
    auth: auth ? { authenticated: true, ...auth } : undefined,
  })
  return {
    id: context.requestId,
    procedure,
    type: 'request',
    payload,
    metadata: {},
    context,
  }
}

describe('server tiered cache', () => {
  it('applies an enabled global rule to a declared procedure', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'server-test',
        layers: [{ id: 'l1', driver: 'memory', enabled: true, ttlMs: 60_000 }],
        rules: [{ match: 'catalog.**', enabled: true }],
      },
    })
    server.procedure('catalog.list').handler(async () => ({ execution: ++executions }))

    const first = await server.router.handle(request('catalog.list', { page: 1 }))
    const second = await server.router.handle(request('catalog.list', { page: 1 }))

    expect(first.payload).toEqual({ execution: 1 })
    expect(second.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    await server.stop()
  })

  it('allows a declared procedure to opt in with .cache()', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'route-override',
        layers: [{ id: 'l1', driver: 'memory', enabled: true }],
      },
    })
    server
      .procedure('catalog.hot')
      .cache({ enabled: true, ttlMs: 60_000 })
      .handler(async () => ({ execution: ++executions }))

    await server.router.handle(request('catalog.hot', {}))
    const cached = await server.router.handle(request('catalog.hot', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    await server.stop()
  })

  it('reads the cache override exported by a filesystem-discovered route', async () => {
    let executions = 0
    const source = createInMemoryDiscoverySource({
      '/app/src/http/catalog/get.js': {
        module: {
          meta: { cache: { enabled: true, ttlMs: 60_000 } },
          default: async () => ({ execution: ++executions }),
        },
      },
    })
    const discovery = await loadDiscovery({
      baseDir: '/app',
      discovery: { http: true },
      extensions: ['.js'],
      source,
    })
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'discovered-route',
        layers: [{ id: 'l1', driver: 'memory', enabled: true }],
      },
    })
    server.addDiscovery(discovery)

    await server.router.handle(request('catalog/get', {}))
    const cached = await server.router.handle(request('catalog/get', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    await server.stop()
  })

  it('supports cache overrides in declarative procedure maps', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'procedure-map',
        layers: [{ id: 'l1', driver: 'memory', enabled: true }],
      },
    })
    server.procedures({
      'catalog.map': {
        cache: { enabled: true },
        handler: async () => ({ execution: ++executions }),
      },
    })

    await server.router.handle(request('catalog.map', {}))
    const cached = await server.router.handle(request('catalog.map', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    await server.stop()
  })

  it('preserves a procedure cache override when mounting a router module', async () => {
    let executions = 0
    const module = createRouterModule('catalog')
    module.procedure('mounted').cache().handler(async () => ({ execution: ++executions }))
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'mounted-module',
        layers: [{ id: 'l1', driver: 'memory', enabled: true }],
      },
    })
    server.mount('api', module)

    await server.router.handle(request('api.catalog.mounted', {}))
    const cached = await server.router.handle(request('api.catalog.mounted', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    await server.stop()
  })

  it('exposes namespace invalidation without leaking layer details', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        namespace: 'invalidation',
        layers: [{ id: 'l1', driver: 'memory', enabled: true }],
        rules: [{ match: 'catalog.invalidate', enabled: true }],
      },
    })
    server.procedure('catalog.invalidate').handler(async () => ({ execution: ++executions }))

    await server.router.handle(request('catalog.invalidate', {}))
    await server.router.handle(request('catalog.invalidate', {}))
    await server.cache?.clear()
    const refreshed = await server.router.handle(request('catalog.invalidate', {}))

    expect(refreshed.payload).toEqual({ execution: 2 })
    await server.stop()
  })

  it('assigns stable layer ids when only driver and enabled are configured', async () => {
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [
          { driver: 'memory', enabled: true },
          { driver: 'fs', enabled: false },
        ],
      },
    })

    expect(server.cache?.stats().map((layer) => layer.id)).toEqual(['l1'])
    await server.stop()
  })

  it('stores the validated output so cache hits skip output parsing', async () => {
    let executions = 0
    let outputParses = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ driver: 'memory' }],
      },
    })
    server.procedure('catalog.validated')
      .output(z.object({ execution: z.number() }).transform((value) => {
        outputParses++
        return { ...value, validated: true }
      }))
      .cache()
      .handler(async () => ({ execution: ++executions }))

    await server.router.handle(request('catalog.validated', {}))
    const cached = await server.router.handle(request('catalog.validated', {}))

    expect(cached.payload).toEqual({ execution: 1, validated: true })
    expect(outputParses).toBe(1)
    await server.stop()
  })

  it('partitions auto-scoped entries by tenant and principal', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ driver: 'memory' }],
        rules: [{ match: 'catalog.private', enabled: true }],
      },
    })
    server.procedure('catalog.private').handler(async () => ({ execution: ++executions }))

    await server.router.handle(request('catalog.private', {}, { principal: 'ana', tenantId: 'one' }))
    const ana = await server.router.handle(request('catalog.private', {}, { principal: 'ana', tenantId: 'one' }))
    const bia = await server.router.handle(request('catalog.private', {}, { principal: 'bia', tenantId: 'one' }))

    expect(ana.payload).toEqual({ execution: 1 })
    expect(bia.payload).toEqual({ execution: 2 })
    await server.stop()
  })
})
