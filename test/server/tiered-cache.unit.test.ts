import { beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createServer } from '../../src/server/builder.js'
import { createRouterModule } from '../../src/server/router-module.js'
import { createInMemoryDiscoverySource } from '../../src/server/fs-routes/discovery-source.js'
import { loadDiscovery } from '../../src/server/fs-routes/loader.js'
import { createContext } from '../../src/types/context.js'
import type { Envelope } from '../../src/types/index.js'
import { createZodAdapter } from '../../src/validation/adapters/zod.js'
import { registerValidator } from '../../src/validation/index.js'
import { ServerCacheRuntime } from '../../src/cache/server-runtime.js'
import { createMemoryCacheLayer } from '../../src/cache/tiered.js'
import type { CacheLayer } from '../../src/cache/tiered.js'

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
  it('keeps non-fencing provider fills on the lower-layer write-behind queue', async () => {
    let releaseProvider!: () => void
    const providerWrite = new Promise<void>((resolve) => { releaseProvider = resolve })
    const provider: CacheLayer = {
      id: 'provider',
      get: async () => undefined,
      set: async () => providerWrite,
      delete: async () => undefined,
      clearNamespace: async () => undefined,
    }
    const runtime = new ServerCacheRuntime({
      enabled: true,
      layers: [
        { id: 'local', driver: 'memory' },
        { id: 'shared', driver: 'provider', provider: 'sharedCache' },
      ],
    })
    runtime.bind({ sharedCache: provider })

    const completed = await Promise.race([
      runtime.executeOnce('fast', async () => ({ ok: true }), {}).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ])

    expect(completed).toBe(true)
    releaseProvider()
    await runtime.stop()
  })

  it('gives each single-flight waiter its own Response body', async () => {
    const runtime = new ServerCacheRuntime({
      enabled: true,
      layers: [{ driver: 'memory' }],
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const next = async () => {
      await gate
      return new Response('shared body')
    }

    const first = runtime.executeOnce('response', next, {})
    const second = runtime.executeOnce('response', next, {})
    release()
    const [firstResponse, secondResponse] = await Promise.all([first, second]) as Response[]

    expect(firstResponse).not.toBe(secondResponse)
    expect(await firstResponse.text()).toBe('shared body')
    expect(await secondResponse.text()).toBe('shared body')
    await runtime.stop()
  })

  it('releases a fill ticket when downstream throws synchronously', async () => {
    const runtime = new ServerCacheRuntime({
      enabled: true,
      layers: [{ driver: 'memory' }],
    })

    await expect(runtime.executeOnce('sync-error', () => {
      throw new Error('sync failure')
    }, {})).rejects.toThrow('sync failure')

    expect(runtime.cache.stats()[0]?.trackedKeys).toBe(0)
    await expect(runtime.executeOnce('sync-error', async () => ({ ok: true }), {}))
      .resolves.toEqual({ ok: true })
    await runtime.stop()
  })

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

  it('uses only the layers selected by a route cache profile', async () => {
    let executions = 0
    const sharedCache = createMemoryCacheLayer({
      id: 'shared-store',
      ttlMs: 60_000,
    })
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [
          { id: 'local', driver: 'memory', ttlMs: 60_000 },
          { id: 'shared', driver: 'provider', provider: 'sharedCache' },
        ],
        profiles: {
          shared: { layers: ['shared'] },
        },
      },
    })
    server.provide('sharedCache', () => sharedCache)
    server.procedure('catalog.shared')
      .cache({ profile: 'shared' })
      .handler(async () => ({ execution: ++executions }))
    await server.start()

    await server.router.handle(request('catalog.shared', {}))
    const cached = await server.router.handle(request('catalog.shared', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(executions).toBe(1)
    expect(server.cache?.stats().find((layer) => layer.id === 'local')?.totalItems).toBe(0)
    expect(sharedCache.stats?.().totalItems).toBe(1)
    await server.stop()
  })

  it('validates every named cache profile when the runtime starts', () => {
    expect(() => new ServerCacheRuntime({
      enabled: true,
      layers: [{ id: 'local', driver: 'memory' }],
      profiles: {
        invalid: { layers: ['missing'] },
      },
    })).toThrow('Cache layer "missing" does not exist')
  })

  it('rejects coherence profiles whose configured topology cannot honor the contract', () => {
    expect(() => new ServerCacheRuntime({
      enabled: true,
      layers: [{ id: 'local', driver: 'memory' }],
      profiles: {
        invalidatable: {
          layers: ['local'],
          coherence: 'shared-invalidation',
        },
      },
    })).toThrow(/can only use provider layers/)

    expect(() => new ServerCacheRuntime({
      enabled: true,
      layers: [{ id: 'local', driver: 'memory' }],
      profiles: {
        tiered: { layers: ['local'], coherence: 'backplane' },
      },
    })).toThrow(/requires an invalidation backplane/)
  })

  it('rejects a shared-invalidation provider without fencing and invalidation capabilities', () => {
    const runtime = new ServerCacheRuntime({
      enabled: true,
      layers: [{ id: 'shared', driver: 'provider', provider: 'sharedCache' }],
      profiles: {
        invalidatable: {
          layers: ['shared'],
          coherence: 'shared-invalidation',
        },
      },
    })
    const memory = createMemoryCacheLayer({ id: 'provider', ttlMs: 60_000 })
    const provider: CacheLayer = {
      ...memory,
      capabilities: {
        ...memory.capabilities,
        distributedFillFencing: false,
      },
      beginFill: vi.fn(async () => 'generation'),
      isFillCurrent: vi.fn(async () => true),
      commitFill: vi.fn(async () => true),
      bumpGeneration: vi.fn(async () => undefined),
      invalidateTag: undefined,
      invalidatePrefix: undefined,
    }

    expect(() => runtime.bind({ sharedCache: provider })).toThrow(/distributed fill fencing/)

    const invalidationRuntime = new ServerCacheRuntime({
      enabled: true,
      layers: [{ id: 'shared', driver: 'provider', provider: 'sharedCache' }],
      profiles: {
        invalidatable: {
          layers: ['shared'],
          coherence: 'shared-invalidation',
        },
      },
    })
    const declaredOnly: CacheLayer = {
      ...memory,
      capabilities: {
        distributedFillFencing: true,
        tagInvalidation: 'scan',
        prefixInvalidation: 'scan',
      },
      beginFill: vi.fn(async () => 'generation'),
      isFillCurrent: vi.fn(async () => true),
      commitFill: vi.fn(async () => true),
      bumpGeneration: vi.fn(async () => undefined),
      invalidateTag: undefined,
      invalidatePrefix: undefined,
    }

    expect(() => invalidationRuntime.bind({ sharedCache: declaredOnly }))
      .toThrow(/tag and prefix invalidation/)
  })

  it('validates shared provider capabilities during server startup', async () => {
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ id: 'shared', driver: 'provider', provider: 'sharedCache' }],
        profiles: {
          invalidatable: {
            layers: ['shared'],
            coherence: 'shared-invalidation',
          },
        },
      },
    })
    server.provide('sharedCache', () => (
      createMemoryCacheLayer({ id: 'provider', ttlMs: 60_000 })
    ))

    await expect(server.start()).rejects.toThrow(/distributed fill fencing/)
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

  it('applies the same cache profile to a filesystem-discovered route', async () => {
    let executions = 0
    const sharedCache = createMemoryCacheLayer({ id: 'shared-store', ttlMs: 60_000 })
    const source = createInMemoryDiscoverySource({
      '/app/src/http/catalog/shared.js': {
        module: {
          meta: { cache: { profile: 'shared' } },
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
        layers: [
          { id: 'local', driver: 'memory' },
          { id: 'shared', driver: 'provider', provider: 'sharedCache' },
        ],
        profiles: { shared: { layers: ['shared'] } },
      },
    })
    server.provide('sharedCache', () => sharedCache)
    server.addDiscovery(discovery)
    await server.start()

    await server.router.handle(request('catalog/shared', {}))
    const cached = await server.router.handle(request('catalog/shared', {}))

    expect(cached.payload).toEqual({ execution: 1 })
    expect(server.cache?.stats().find((layer) => layer.id === 'local')?.totalItems).toBe(0)
    expect(sharedCache.stats?.().totalItems).toBe(1)
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

  it('does not cache a fill invalidated while its handler is running', async () => {
    let executions = 0
    let announceStarted!: () => void
    let releaseHandler!: () => void
    const started = new Promise<void>((resolve) => { announceStarted = resolve })
    const gate = new Promise<void>((resolve) => { releaseHandler = resolve })
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ id: 'local', driver: 'memory' }],
        rules: [{ match: 'catalog.race', enabled: true }],
      },
    })
    server.procedure('catalog.race').handler(async () => {
      const execution = ++executions
      announceStarted()
      await gate
      return { execution }
    })
    const firstRequest = request('catalog.race', {})

    const inFlight = server.router.handle(firstRequest)
    await started
    const key = server.cache?.keyForProcedure(
      'catalog.race',
      {},
      firstRequest.context!,
    )
    expect(key).toBeDefined()
    await server.cache?.invalidate(key!)
    releaseHandler()
    await inFlight
    const refreshed = await server.router.handle(request('catalog.race', {}))

    expect(refreshed.payload).toEqual({ execution: 2 })
    expect(executions).toBe(2)
    await server.stop()
  })

  it('does not join a single-flight that predates an invalidation', async () => {
    let executions = 0
    let announceFirst!: () => void
    let releaseFirst!: () => void
    const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve })
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ id: 'local', driver: 'memory' }],
        rules: [{ match: 'catalog.single-flight-race', enabled: true }],
      },
    })
    server.procedure('catalog.single-flight-race').handler(async () => {
      const execution = ++executions
      if (execution === 1) {
        announceFirst()
        await firstGate
      }
      return { execution }
    })
    const firstRequest = request('catalog.single-flight-race', {})

    const first = server.router.handle(firstRequest)
    await firstStarted
    const key = server.cache?.keyForProcedure(
      'catalog.single-flight-race',
      {},
      firstRequest.context!,
    )
    await server.cache?.invalidate(key!)
    const second = server.router.handle(request('catalog.single-flight-race', {}))
    let secondStarted = false
    try {
      await vi.waitFor(() => expect(executions).toBe(2), { interval: 5, timeout: 500 })
      secondStarted = true
    } finally {
      releaseFirst()
    }
    const [firstResult, secondResult] = await Promise.all([first, second])
    const cached = await server.router.handle(request('catalog.single-flight-race', {}))

    expect(secondStarted).toBe(true)
    expect(firstResult.payload).toEqual({ execution: 1 })
    expect(secondResult.payload).toEqual({ execution: 2 })
    expect(cached.payload).toEqual({ execution: 2 })
    await server.stop()
  })

  it('derives cache tags from the validated procedure result', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ id: 'local', driver: 'memory' }],
      },
    })
    server.procedure('leads.get')
      .cache({
        tags: (_input, _ctx, result) => [`lead:${(result as { id: number }).id}`],
      })
      .handler(async () => ({ id: 1, execution: ++executions }))

    await server.router.handle(request('leads.get', {}))
    await server.router.handle(request('leads.get', {}))
    const invalidation = await server.cache?.invalidateTag('lead:1')
    const refreshed = await server.router.handle(request('leads.get', {}))

    expect(invalidation?.deleted).toBe(1)
    expect(refreshed.payload).toEqual({ id: 1, execution: 2 })
    await server.stop()
  })

  it('returns the handler result without caching when tag derivation fails', async () => {
    let executions = 0
    const server = createServer({
      port: 0,
      cache: {
        enabled: true,
        layers: [{ id: 'local', driver: 'memory' }],
      },
    })
    server.procedure('leads.unsafe-tags')
      .cache({
        tags: () => { throw new Error('tag resolver failed') },
      })
      .handler(async () => ({ execution: ++executions }))

    const first = await server.router.handle(request('leads.unsafe-tags', {}))
    const second = await server.router.handle(request('leads.unsafe-tags', {}))

    expect(first.payload).toEqual({ execution: 1 })
    expect(second.payload).toEqual({ execution: 2 })
    expect(server.cache?.stats()[0]?.totalItems).toBe(0)
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
