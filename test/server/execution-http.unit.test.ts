import { describe, expect, it, vi } from 'vitest'

import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createSchemaRegistry } from '../../src/validation/schema.js'
import type { ServerLifecycleExecutionContext } from '../../src/server/builder/execution-types.js'
import type { ServerLifecycleState, MutableRef } from '../../src/server/builder/state.js'
import type { ServerAddresses } from '../../src/server/types.js'
import type { HttpMiddleware } from '../../src/adapters/http.js'
import type { ServerRuntimePlan, ServerRuntimeHttpMiddlewareStep } from '../../src/server/runtime-plan.js'
import { createExecutionHttpBase } from '../../src/server/builder/execution-http-base.js'
import { createExecutionHttpDocs } from '../../src/server/builder/execution-http-docs.js'
import { createExecutionHttpGraphQL } from '../../src/server/builder/execution-http-graphql.js'
import { createExecutionHttpMcp } from '../../src/server/builder/execution-http-mcp.js'
import { createExecutionHttpResources } from '../../src/server/builder/execution-http-resources.js'
import { createServerLifecycleExecution } from '../../src/server/builder/execution.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ref<T>(value: T): MutableRef<T> {
  return { value }
}

function createMockState(): ServerLifecycleState {
  return {
    running: ref(false),
    addresses: ref<ServerAddresses | null>({
      http: { host: '127.0.0.1', port: 3000, source: 'native' },
    }),
    activeShutdownPlan: ref(null),
    providerMiddlewareInstalled: ref(false),
    portBinding: ref(null),
    singlePortTcpConnectionHandler: ref(null),
    singlePortGrpcConnectionHandler: ref(null),
    httpServer: ref(null),
    wsAdapter: ref(null),
    jsonRpcAdapter: ref(null),
    tcpAdapter: ref(null),
    grpcAdapter: ref(null),
    graphqlAdapter: ref(null),
    graphqlMiddleware: ref(null),
    graphqlSubscriptionServer: ref(null),
    usdDocsHandlers: ref(null),
  }
}

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createMinimalContext(overrides?: Partial<ServerLifecycleExecutionContext>): ServerLifecycleExecutionContext {
  const registry = createRegistry()
  const schemaRegistry = createSchemaRegistry()
  const router = createRouter(registry)

  return {
    logger: createMockLogger(),
    state: createMockState(),
    bootstrap: {
      discoveryBootstrap: {} as any,
      telemetryState: {} as any,
      applyDiscoveryResult: vi.fn(),
    },
    core: {
      protocolAdapters: new Map(),
      providerDefinitions: new Map(),
      resolvedProviders: {} as any,
      registry,
      schemaRegistry,
      router,
      globalInterceptors: [],
    },
    http: {
      channelRegistry: new Map(),
      restResourceRegistry: [],
      tcpHandlers: [],
      udpHandlers: [],
      tcpServers: [],
      udpServers: [],
      basePath: '',
      httpOptions: undefined,
      wsInterceptors: [],
      getWsSubscribeHandler: () => null,
      getWsMessageHandler: () => null,
      getWsUnsubscribeHandler: () => null,
    },
    routing: {
      getSinglePortAliasMode: () => 'standard',
      createFrontDoorDecisionMiddleware: () => null,
    },
    ...overrides,
  }
}

function createMinimalRuntimePlan(overrides?: Partial<ServerRuntimePlan>): ServerRuntimePlan {
  return {
    previewContext: {} as any,
    previewConfig: {} as any,
    protocols: {} as any,
    host: '127.0.0.1',
    basePath: '',
    effectiveHost: '127.0.0.1',
    effectivePort: 3000,
    frontDoorEnabled: false,
    frontDoorProtocols: [],
    singlePortConfig: { enabled: false } as any,
    singlePortSource: 'native',
    routeModes: { tcp: 'disabled', grpc: 'disabled' },
    entrypoint: {} as any,
    httpSharedFeatures: { override: { maxBodySize: 1024 * 1024 } },
    execution: {
      providers: [],
      telemetry: [],
      discovery: [],
      httpMiddleware: [],
      prePortBinding: [],
      entrypoint: [],
      postPortBinding: [],
      startup: [],
      shutdown: [],
    },
    bindings: {
      http: { host: '127.0.0.1', port: 3000 },
    },
    addresses: {
      http: { host: '127.0.0.1', port: 3000, source: 'native' },
    },
    describeUdpAddress: () => ({
      host: '127.0.0.1',
      port: 9000,
      source: 'native' as const,
    }),
    ...overrides,
  } as ServerRuntimePlan
}

// ---------------------------------------------------------------------------
// execution-http-base.ts
// ---------------------------------------------------------------------------

describe('createExecutionHttpBase', () => {
  describe('front-door-decision step', () => {
    it('pushes front-door middleware when createFrontDoorDecisionMiddleware returns a value', () => {
      const fakeMw: HttpMiddleware = () => false
      const ctx = createMinimalContext({
        routing: {
          getSinglePortAliasMode: () => 'standard',
          createFrontDoorDecisionMiddleware: () => fakeMw,
        },
      })
      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      executeHttpBaseStep({ kind: 'front-door-decision' }, middlewares)

      expect(middlewares).toHaveLength(1)
      expect(middlewares[0]).toBe(fakeMw)
    })

    it('does not push middleware when createFrontDoorDecisionMiddleware returns null', () => {
      const ctx = createMinimalContext({
        routing: {
          getSinglePortAliasMode: () => 'standard',
          createFrontDoorDecisionMiddleware: () => null,
        },
      })
      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      executeHttpBaseStep({ kind: 'front-door-decision' }, middlewares)

      expect(middlewares).toHaveLength(0)
    })
  })

  describe('custom step', () => {
    it('pushes all custom httpOptions.middleware when present', () => {
      const mw1: HttpMiddleware = () => false
      const mw2: HttpMiddleware = () => true
      const ctx = createMinimalContext()
      ctx.http.httpOptions = { middleware: [mw1, mw2] }

      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      executeHttpBaseStep({ kind: 'custom' }, middlewares)

      expect(middlewares).toHaveLength(2)
      expect(middlewares[0]).toBe(mw1)
      expect(middlewares[1]).toBe(mw2)
    })

    it('does nothing when httpOptions is undefined', () => {
      const ctx = createMinimalContext()
      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      executeHttpBaseStep({ kind: 'custom' }, middlewares)

      expect(middlewares).toHaveLength(0)
    })

    it('does nothing when httpOptions.middleware is empty', () => {
      const ctx = createMinimalContext()
      ctx.http.httpOptions = { middleware: [] }

      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      executeHttpBaseStep({ kind: 'custom' }, middlewares)

      expect(middlewares).toHaveLength(0)
    })
  })

  describe('jsonrpc step', () => {
    it('pushes a JSON-RPC middleware for the given options', () => {
      const ctx = createMinimalContext()
      const { executeHttpBaseStep } = createExecutionHttpBase(ctx)
      const middlewares: HttpMiddleware[] = []

      const step: ServerRuntimeHttpMiddlewareStep = {
        kind: 'jsonrpc',
        feature: {
          path: '/rpc',
          options: {
            timeout: 5000,
            maxBodySize: 2048,
            codecs: undefined,
          } as any,
        },
      }

      executeHttpBaseStep(step as any, middlewares)

      expect(middlewares).toHaveLength(1)
      expect(typeof middlewares[0]).toBe('function')
    })
  })
})

// ---------------------------------------------------------------------------
// execution-http-docs.ts
// ---------------------------------------------------------------------------

describe('createExecutionHttpDocs', () => {
  it('creates USD handlers, sets state, and pushes docs middleware', () => {
    const ctx = createMinimalContext()
    const { executeHttpDocsStep } = createExecutionHttpDocs(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'docs' }> = {
      kind: 'docs',
      feature: {
        basePath: '/docs',
        config: {
          info: { title: 'Test', version: '1.0.0' },
        } as any,
      },
    }

    executeHttpDocsStep(runtimePlan, step, middlewares)

    // It should have set state.usdDocsHandlers
    expect(ctx.state.usdDocsHandlers.value).not.toBeNull()
    expect(ctx.state.usdDocsHandlers.value).toHaveProperty('serveUI')
    expect(ctx.state.usdDocsHandlers.value).toHaveProperty('serveUSD')
    expect(ctx.state.usdDocsHandlers.value).toHaveProperty('serveUSDYaml')
    expect(ctx.state.usdDocsHandlers.value).toHaveProperty('serveOpenAPI')

    // It should have pushed exactly one middleware (the docs route middleware)
    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')

    // Logger should have been called
    expect(ctx.logger.info).toHaveBeenCalledWith(
      { basePath: '/docs' },
      'USD Documentation middleware registered'
    )
  })

  it('uses the basePath from the step feature', () => {
    const ctx = createMinimalContext()
    const { executeHttpDocsStep } = createExecutionHttpDocs(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    executeHttpDocsStep(runtimePlan, {
      kind: 'docs',
      feature: {
        basePath: '/api-docs',
        config: {
          info: { title: 'Custom', version: '2.0.0' },
        } as any,
      },
    }, middlewares)

    expect(ctx.logger.info).toHaveBeenCalledWith(
      { basePath: '/api-docs' },
      'USD Documentation middleware registered'
    )
  })
})

// ---------------------------------------------------------------------------
// execution-http-graphql.ts
// ---------------------------------------------------------------------------

describe('createExecutionHttpGraphQL', () => {
  it('creates graphql middleware and sets state.graphqlMiddleware and state.graphqlAdapter', () => {
    const ctx = createMinimalContext()
    const { executeHttpGraphQLStep } = createExecutionHttpGraphQL(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'graphql' }> = {
      kind: 'graphql',
      feature: {
        path: '/graphql',
        options: {
          playground: true,
          introspection: true,
        } as any,
      },
    }

    executeHttpGraphQLStep(runtimePlan, step, middlewares)

    // GraphQL middleware should be set
    expect(ctx.state.graphqlMiddleware.value).not.toBeNull()
    expect(ctx.state.graphqlMiddleware.value).toHaveProperty('middleware')
    expect(ctx.state.graphqlMiddleware.value).toHaveProperty('schema')
    expect(ctx.state.graphqlMiddleware.value).toHaveProperty('createSubscriptionServer')

    // Should push the middleware function
    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')

    // GraphQL adapter should be set with address info
    expect(ctx.state.graphqlAdapter.value).not.toBeNull()
    expect(ctx.state.graphqlAdapter.value!.address).toEqual({
      host: '127.0.0.1',
      port: 3000,
      path: '/graphql',
    })
  })

  it('graphqlAdapter.start is a no-op when httpServer is null', async () => {
    const ctx = createMinimalContext()
    const { executeHttpGraphQLStep } = createExecutionHttpGraphQL(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    executeHttpGraphQLStep(runtimePlan, {
      kind: 'graphql',
      feature: { path: '/graphql', options: {} as any },
    }, middlewares)

    // httpServer is null, so start() should be a no-op
    await expect(ctx.state.graphqlAdapter.value!.start()).resolves.toBeUndefined()
    expect(ctx.state.graphqlSubscriptionServer.value).toBeNull()
  })

  it('graphqlAdapter.stop cleans up subscription server if present', async () => {
    const ctx = createMinimalContext()
    const { executeHttpGraphQLStep } = createExecutionHttpGraphQL(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    executeHttpGraphQLStep(runtimePlan, {
      kind: 'graphql',
      feature: { path: '/graphql', options: {} as any },
    }, middlewares)

    // Simulate a subscription server being set
    const mockClose = vi.fn()
    ctx.state.graphqlSubscriptionServer.value = { close: mockClose } as any

    await ctx.state.graphqlAdapter.value!.stop()

    expect(mockClose).toHaveBeenCalled()
    expect(ctx.state.graphqlSubscriptionServer.value).toBeNull()
  })

  it('graphqlAdapter.stop is safe when no subscription server exists', async () => {
    const ctx = createMinimalContext()
    const { executeHttpGraphQLStep } = createExecutionHttpGraphQL(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    executeHttpGraphQLStep(runtimePlan, {
      kind: 'graphql',
      feature: { path: '/graphql', options: {} as any },
    }, middlewares)

    // subscription server is null
    await expect(ctx.state.graphqlAdapter.value!.stop()).resolves.toBeUndefined()
  })

  it('graphqlAdapter exposes schema and schemaInfo from underlying middleware', () => {
    const ctx = createMinimalContext()
    const { executeHttpGraphQLStep } = createExecutionHttpGraphQL(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    executeHttpGraphQLStep(runtimePlan, {
      kind: 'graphql',
      feature: { path: '/graphql', options: {} as any },
    }, middlewares)

    const adapter = ctx.state.graphqlAdapter.value!
    // schema and schemaInfo are getters that delegate to graphqlMiddleware
    expect(adapter.schema).toBeDefined()
    expect(adapter.schema).toBe(ctx.state.graphqlMiddleware.value!.schema)
    // schemaInfo may be null when no procedures are registered
    expect(adapter.schemaInfo).toBe(ctx.state.graphqlMiddleware.value!.schemaInfo)
  })
})

// ---------------------------------------------------------------------------
// execution-http-resources.ts
// ---------------------------------------------------------------------------

describe('createExecutionHttpResources', () => {
  describe('override step', () => {
    it('pushes an override middleware', () => {
      const ctx = createMinimalContext()
      const { executeHttpResourceStep } = createExecutionHttpResources(ctx)
      const middlewares: HttpMiddleware[] = []

      const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'override' }> = {
        kind: 'override',
        feature: {
          maxBodySize: 1024 * 1024,
          contextFactory: undefined,
          codecs: undefined,
          trustedProxies: undefined,
        },
      }

      executeHttpResourceStep(step, middlewares)

      expect(middlewares).toHaveLength(1)
      expect(typeof middlewares[0]).toBe('function')
    })
  })

  describe('rest step', () => {
    it('pushes a rest middleware when there are rest resources', () => {
      const ctx = createMinimalContext()
      ctx.http.restResourceRegistry = [
        {
          name: 'users',
          basePath: '/users',
          procedures: {},
        } as any,
      ]
      const { executeHttpResourceStep } = createExecutionHttpResources(ctx)
      const middlewares: HttpMiddleware[] = []

      const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'rest' }> = {
        kind: 'rest',
        feature: {
          maxBodySize: 1024 * 1024,
          contextFactory: undefined,
          codecs: undefined,
          trustedProxies: undefined,
        },
      }

      executeHttpResourceStep(step, middlewares)

      expect(middlewares).toHaveLength(1)
      expect(typeof middlewares[0]).toBe('function')
    })

    it('pushes a rest middleware even when rest resources are empty', () => {
      const ctx = createMinimalContext()
      const { executeHttpResourceStep } = createExecutionHttpResources(ctx)
      const middlewares: HttpMiddleware[] = []

      const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'rest' }> = {
        kind: 'rest',
        feature: {
          maxBodySize: 2048,
          contextFactory: undefined,
          codecs: undefined,
          trustedProxies: undefined,
        },
      }

      executeHttpResourceStep(step, middlewares)

      // rest middleware is always created, regardless of whether there are resources
      expect(middlewares).toHaveLength(1)
      expect(typeof middlewares[0]).toBe('function')
    })
  })
})

// ---------------------------------------------------------------------------
// execution-http-mcp.ts (uses dynamic imports, must be async)
// ---------------------------------------------------------------------------

describe('createExecutionHttpMcp', () => {
  it('creates MCP transport, registers tools, pushes middleware, and sets protocol address', async () => {
    const ctx = createMinimalContext()
    const { executeHttpMcpStep } = createExecutionHttpMcp(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()
    const stopTasks: Array<{ name: string; stop: () => Promise<void> }> = []

    const step: Extract<ServerRuntimeHttpMiddlewareStep, { kind: 'mcp' }> = {
      kind: 'mcp',
      feature: {
        path: '/mcp',
        options: {
          name: 'test-mcp',
          version: '2.0.0',
        } as any,
      },
    }

    await executeHttpMcpStep(runtimePlan, step, middlewares, (task) => {
      stopTasks.push(task)
    })

    // Should push MCP middleware
    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')

    // Should register a stop task
    expect(stopTasks).toHaveLength(1)
    expect(stopTasks[0].name).toBe('mcp')

    // Should set protocol address in state.addresses
    expect(ctx.state.addresses.value?.protocols?.mcp).toEqual({
      host: '127.0.0.1',
      port: 3000,
      path: '/mcp',
    })

    // Should log the MCP startup
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/mcp' }),
      'MCP protocol adapter started'
    )
  })

  it('uses default name and version when not provided', async () => {
    const ctx = createMinimalContext()
    const { executeHttpMcpStep } = createExecutionHttpMcp(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    await executeHttpMcpStep(runtimePlan, {
      kind: 'mcp',
      feature: {
        path: '/mcp',
        options: {} as any,
      },
    }, middlewares, vi.fn())

    // Should not throw; defaults are used internally
    expect(middlewares).toHaveLength(1)
  })

  it('registers custom tools, resources, resourceTemplates, and prompts', async () => {
    const ctx = createMinimalContext()
    const { executeHttpMcpStep } = createExecutionHttpMcp(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan()

    const mockTool = {
      name: 'my-tool',
      description: 'A test tool',
      inputSchema: { type: 'object' as const, properties: {} },
      handler: vi.fn(),
    }
    const mockResource = {
      uri: 'test://resource',
      name: 'test-resource',
      handler: vi.fn(),
    }
    const mockTemplate = {
      uriTemplate: 'test://template/{id}',
      name: 'test-template',
      handler: vi.fn(),
    }
    const mockPrompt = {
      name: 'test-prompt',
      handler: vi.fn(),
    }

    await executeHttpMcpStep(runtimePlan, {
      kind: 'mcp',
      feature: {
        path: '/mcp',
        options: {
          tools: [mockTool],
          resources: [mockResource],
          resourceTemplates: [mockTemplate],
          prompts: [mockPrompt],
        } as any,
      },
    }, middlewares, vi.fn())

    // Should not throw; custom registrations are processed
    expect(middlewares).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// execution.ts (orchestrator - executeStartupPhase with 'http-middleware')
// ---------------------------------------------------------------------------

describe('createServerLifecycleExecution (HTTP middleware dispatch)', () => {
  it('returns resetRuntimeState and executeStartupPhase', () => {
    const ctx = createMinimalContext()
    const execution = createServerLifecycleExecution(ctx)

    expect(execution).toHaveProperty('resetRuntimeState')
    expect(execution).toHaveProperty('executeStartupPhase')
    expect(typeof execution.executeStartupPhase).toBe('function')
  })

  it('dispatches front-door-decision step via executeStartupPhase', async () => {
    const fakeMw: HttpMiddleware = () => false
    const ctx = createMinimalContext({
      routing: {
        getSinglePortAliasMode: () => 'standard',
        createFrontDoorDecisionMiddleware: () => fakeMw,
      },
    })
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{ kind: 'front-door-decision' }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(middlewares[0]).toBe(fakeMw)
  })

  it('dispatches custom step via executeStartupPhase', async () => {
    const mw: HttpMiddleware = () => true
    const ctx = createMinimalContext()
    ctx.http.httpOptions = { middleware: [mw] }

    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{ kind: 'custom' }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(middlewares[0]).toBe(mw)
  })

  it('dispatches jsonrpc step via executeStartupPhase', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'jsonrpc',
          feature: {
            path: '/rpc',
            options: { timeout: 5000, maxBodySize: 1024 } as any,
          },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')
  })

  it('dispatches override step via executeStartupPhase', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'override',
          feature: { maxBodySize: 1024 },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')
  })

  it('dispatches rest step via executeStartupPhase', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'rest',
          feature: { maxBodySize: 1024 },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(typeof middlewares[0]).toBe('function')
  })

  it('dispatches docs step via executeStartupPhase', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'docs',
          feature: {
            basePath: '/docs',
            config: { info: { title: 'Test', version: '1.0.0' } } as any,
          },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(ctx.state.usdDocsHandlers.value).not.toBeNull()
  })

  it('dispatches graphql step via executeStartupPhase', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'graphql',
          feature: { path: '/graphql', options: {} as any },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(1)
    expect(ctx.state.graphqlMiddleware.value).not.toBeNull()
    expect(ctx.state.graphqlAdapter.value).not.toBeNull()
  })

  it('dispatches mcp step via executeStartupPhase (async)', async () => {
    const ctx = createMinimalContext()
    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const stopTasks: Array<{ name: string; stop: () => Promise<void> }> = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [{
          kind: 'mcp',
          feature: { path: '/mcp', options: {} as any },
        }],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, (_phase, task) => {
      stopTasks.push(task)
    })

    expect(middlewares).toHaveLength(1)
    expect(stopTasks).toHaveLength(1)
    expect(stopTasks[0].name).toBe('mcp')
  })

  it('accumulates middlewares across multiple steps in a single phase', async () => {
    const fakeFrontDoor: HttpMiddleware = () => false
    const customMw: HttpMiddleware = () => true
    const ctx = createMinimalContext({
      routing: {
        getSinglePortAliasMode: () => 'standard',
        createFrontDoorDecisionMiddleware: () => fakeFrontDoor,
      },
    })
    ctx.http.httpOptions = { middleware: [customMw] }

    const { executeStartupPhase } = createServerLifecycleExecution(ctx)
    const middlewares: HttpMiddleware[] = []
    const runtimePlan = createMinimalRuntimePlan({
      execution: {
        providers: [],
        telemetry: [],
        discovery: [],
        httpMiddleware: [
          { kind: 'front-door-decision' },
          { kind: 'custom' },
          { kind: 'override', feature: { maxBodySize: 1024 } },
        ],
        prePortBinding: [],
        entrypoint: [],
        postPortBinding: [],
        startup: ['http-middleware'],
        shutdown: [],
      },
    } as any)

    await executeStartupPhase(runtimePlan, 'http-middleware', middlewares, vi.fn())

    expect(middlewares).toHaveLength(3)
    expect(middlewares[0]).toBe(fakeFrontDoor)
    expect(middlewares[1]).toBe(customMw)
    expect(typeof middlewares[2]).toBe('function')
  })
})
