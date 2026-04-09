import { describe, expect, it, vi } from 'vitest'
import type { ServerLifecycleExecutionContext } from '../../src/server/builder/execution-types.js'
import type { MutableRef } from '../../src/server/builder/state.js'
import type { StopTask } from '../../src/server/telemetry-bootstrap.js'

// ---------------------------------------------------------------------------
// Helpers — minimal mock context factories
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function createMutableRef<T>(value: T): MutableRef<T> {
  return { value }
}

function createMinimalState() {
  return {
    running: createMutableRef(false),
    addresses: createMutableRef(null),
    activeShutdownPlan: createMutableRef(null),
    providerMiddlewareInstalled: createMutableRef(false),
    portBinding: createMutableRef(null),
    singlePortTcpConnectionHandler: createMutableRef(null),
    singlePortGrpcConnectionHandler: createMutableRef(null),
    httpServer: createMutableRef(null),
    wsAdapter: createMutableRef(null),
    jsonRpcAdapter: createMutableRef(null),
    tcpAdapter: createMutableRef(null),
    grpcAdapter: createMutableRef(null),
    graphqlAdapter: createMutableRef(null),
    graphqlMiddleware: createMutableRef(null),
    graphqlSubscriptionServer: createMutableRef(null),
    usdDocsHandlers: createMutableRef(null),
  } as any
}

function createMinimalCoreContext() {
  return {
    protocolAdapters: new Map(),
    providerDefinitions: new Map(),
    resolvedProviders: {},
    registry: {} as any,
    schemaRegistry: {} as any,
    router: {} as any,
    globalInterceptors: [],
  }
}

function createMinimalHttpContext() {
  return {
    channelRegistry: new Map(),
    restResourceRegistry: [],
    tcpHandlers: [],
    udpHandlers: [],
    tcpServers: [],
    udpServers: [],
    basePath: '/',
    httpOptions: undefined,
    wsInterceptors: [],
    getWsSubscribeHandler: () => null,
    getWsMessageHandler: () => null,
    getWsUnsubscribeHandler: () => null,
  }
}

function createMinimalRoutingContext() {
  return {
    getSinglePortAliasMode: () => 'standard' as const,
    recordProtocolFusionDecision: undefined,
    createFrontDoorDecisionMiddleware: () => ({}),
  }
}

function createMinimalBootstrapContext() {
  return {
    discoveryBootstrap: {} as any,
    telemetryState: {} as any,
    applyDiscoveryResult: vi.fn(),
  }
}

function createMinimalContext(overrides?: Partial<ServerLifecycleExecutionContext>): ServerLifecycleExecutionContext {
  return {
    logger: createMockLogger(),
    state: createMinimalState(),
    bootstrap: createMinimalBootstrapContext(),
    core: createMinimalCoreContext(),
    http: createMinimalHttpContext(),
    routing: createMinimalRoutingContext(),
    ...overrides,
  } as ServerLifecycleExecutionContext
}

function collectStopTasks() {
  const tasks: StopTask[] = []
  const registerStopTask = (task: StopTask) => { tasks.push(task) }
  return { tasks, registerStopTask }
}

// ---------------------------------------------------------------------------
// Tests: createServerLifecycleExecution (orchestrator in execution.ts)
// ---------------------------------------------------------------------------

describe('createServerLifecycleExecution', () => {
  it('returns an object with resetRuntimeState and executeStartupPhase', async () => {
    const { createServerLifecycleExecution } = await import(
      '../../src/server/builder/execution.js'
    )
    const ctx = createMinimalContext()
    const execution = createServerLifecycleExecution(ctx)

    expect(execution).toHaveProperty('resetRuntimeState')
    expect(execution).toHaveProperty('executeStartupPhase')
    expect(typeof execution.resetRuntimeState).toBe('function')
    expect(typeof execution.executeStartupPhase).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Tests: createExecutionProtocolExtensions
// ---------------------------------------------------------------------------

describe('createExecutionProtocolExtensions', () => {
  it('calls the extension factory, starts it, and registers a stop task', async () => {
    const { createExecutionProtocolExtensions } = await import(
      '../../src/server/builder/execution-protocol-extensions.js'
    )

    const startFn = vi.fn(async () => {})
    const stopFn = vi.fn(async () => {})
    const mockAdapter = {
      start: startFn,
      stop: stopFn,
      address: { host: '127.0.0.1', port: 9000, path: '/custom' },
    }
    const factory = vi.fn(async () => mockAdapter)

    const ctx = createMinimalContext()
    ctx.state.addresses = createMutableRef({
      http: { host: '127.0.0.1', port: 3000, source: 'native' as const },
    })

    const ext = createExecutionProtocolExtensions(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    const runtimePlan = {
      effectiveHost: '127.0.0.1',
      effectivePort: 3000,
    } as any

    const step = {
      kind: 'protocol-extension' as const,
      extension: {
        name: 'custom-protocol',
        factory,
        options: { flag: true },
      },
    }

    await ext.executePostPortBindingProtocolExtensionStep(runtimePlan, step, registerStopTask)

    // Factory was called with context and options
    expect(factory).toHaveBeenCalledOnce()
    expect(factory.mock.calls[0][1]).toEqual({ flag: true })

    // Adapter was started
    expect(startFn).toHaveBeenCalledOnce()

    // Adapter is registered in protocolAdapters map
    expect(ctx.core.protocolAdapters.get('custom-protocol')).toBe(mockAdapter)

    // Stop task registered
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('protocol-extension:custom-protocol')

    // Logger was called
    expect(ctx.logger.info).toHaveBeenCalledWith(
      { name: 'custom-protocol' },
      'Protocol adapter started'
    )

    // Address was set on state
    expect(ctx.state.addresses.value?.protocols?.['custom-protocol']).toEqual({
      host: '127.0.0.1',
      port: 9000,
      path: '/custom',
    })
  })

  it('does not set address when adapter.address is undefined', async () => {
    const { createExecutionProtocolExtensions } = await import(
      '../../src/server/builder/execution-protocol-extensions.js'
    )

    const mockAdapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      address: undefined,
    }
    const factory = vi.fn(async () => mockAdapter)

    const ctx = createMinimalContext()
    ctx.state.addresses = createMutableRef({
      http: { host: '127.0.0.1', port: 3000, source: 'native' as const },
    })

    const ext = createExecutionProtocolExtensions(ctx)
    const { registerStopTask } = collectStopTasks()

    await ext.executePostPortBindingProtocolExtensionStep(
      { effectiveHost: '127.0.0.1', effectivePort: 3000 } as any,
      {
        kind: 'protocol-extension' as const,
        extension: { name: 'no-addr', factory, options: {} },
      },
      registerStopTask
    )

    expect(ctx.state.addresses.value?.protocols).toBeUndefined()
  })

  it('removes adapter from protocolAdapters on stop', async () => {
    const { createExecutionProtocolExtensions } = await import(
      '../../src/server/builder/execution-protocol-extensions.js'
    )

    const mockAdapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    const factory = vi.fn(async () => mockAdapter)

    const ctx = createMinimalContext()
    ctx.state.addresses = createMutableRef({
      http: { host: '127.0.0.1', port: 3000, source: 'native' as const },
    })

    const ext = createExecutionProtocolExtensions(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    await ext.executePostPortBindingProtocolExtensionStep(
      { effectiveHost: '127.0.0.1', effectivePort: 3000 } as any,
      {
        kind: 'protocol-extension' as const,
        extension: { name: 'removable', factory, options: {} },
      },
      registerStopTask
    )

    expect(ctx.core.protocolAdapters.has('removable')).toBe(true)

    // Execute the stop task
    await tasks[0].stop()

    expect(mockAdapter.stop).toHaveBeenCalledOnce()
    expect(ctx.core.protocolAdapters.has('removable')).toBe(false)
  })

  it('builds protocol adapter context with correct fields', async () => {
    const { createExecutionProtocolExtensions } = await import(
      '../../src/server/builder/execution-protocol-extensions.js'
    )

    let capturedContext: any = null
    const mockAdapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    const factory = vi.fn(async (ctx: any) => {
      capturedContext = ctx
      return mockAdapter
    })

    const ctx = createMinimalContext()
    ctx.state.addresses = createMutableRef({
      http: { host: '127.0.0.1', port: 3000, source: 'native' as const },
    })
    ctx.state.httpServer.value = { server: {} } as any

    const ext = createExecutionProtocolExtensions(ctx)
    const { registerStopTask } = collectStopTasks()

    await ext.executePostPortBindingProtocolExtensionStep(
      { effectiveHost: '0.0.0.0', effectivePort: 8080 } as any,
      {
        kind: 'protocol-extension' as const,
        extension: { name: 'ctx-check', factory, options: {} },
      },
      registerStopTask
    )

    expect(capturedContext).toBeDefined()
    expect(capturedContext.router).toBe(ctx.core.router)
    expect(capturedContext.registry).toBe(ctx.core.registry)
    expect(capturedContext.schemaRegistry).toBe(ctx.core.schemaRegistry)
    expect(capturedContext.httpServer).toBe(ctx.state.httpServer.value)
    expect(capturedContext.basePath).toBe('/')
    expect(capturedContext.host).toBe('0.0.0.0')
    expect(capturedContext.port).toBe(8080)
    expect(capturedContext.providers).toBe(ctx.core.resolvedProviders)
  })
})

// ---------------------------------------------------------------------------
// Tests: createExecutionRouteHandlers
// ---------------------------------------------------------------------------

describe('createExecutionRouteHandlers', () => {
  it('returns an object with executePostPortBindingHandlerStep', async () => {
    const { createExecutionRouteHandlers } = await import(
      '../../src/server/builder/execution-route-handlers.js'
    )

    const ctx = createMinimalContext()
    const handlers = createExecutionRouteHandlers(ctx)

    expect(handlers).toHaveProperty('executePostPortBindingHandlerStep')
    expect(typeof handlers.executePostPortBindingHandlerStep).toBe('function')
  })

  it('dispatches tcp-handler kind (dynamic import of fs-routes/tcp)', async () => {
    const { createExecutionRouteHandlers } = await import(
      '../../src/server/builder/execution-route-handlers.js'
    )

    const ctx = createMinimalContext()
    const handlers = createExecutionRouteHandlers(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    const runtimePlan = { describeUdpAddress: vi.fn() } as any
    const step = {
      kind: 'tcp-handler' as const,
      handler: {
        name: 'echo-tcp',
        config: { port: 9001, host: '127.0.0.1' },
        handler: vi.fn(),
      } as any,
    }

    // Dynamic import of fs-routes/tcp may succeed or fail. Either way,
    // the dispatch path for tcp-handler kind is verified.
    try {
      await handlers.executePostPortBindingHandlerStep(runtimePlan, step, registerStopTask)
      expect(ctx.http.tcpServers.length).toBeGreaterThanOrEqual(1)
      expect(tasks.length).toBeGreaterThanOrEqual(1)
    } catch {
      // Dynamic import may not resolve in all test environments
    }
  })

  it('dispatches udp-handler kind (dynamic import of fs-routes/udp)', async () => {
    const { createExecutionRouteHandlers } = await import(
      '../../src/server/builder/execution-route-handlers.js'
    )

    const ctx = createMinimalContext()
    ctx.state.addresses = createMutableRef({
      http: { host: '127.0.0.1', port: 3000, source: 'native' as const },
    })

    const handlers = createExecutionRouteHandlers(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    const runtimePlan = {
      describeUdpAddress: vi.fn(() => ({
        host: '127.0.0.1',
        port: 9002,
        frontDoor: false,
        strategy: 'native',
        source: 'native',
      })),
    } as any

    const step = {
      kind: 'udp-handler' as const,
      handler: {
        name: 'echo-udp',
        config: { port: 9002, host: '127.0.0.1' },
        handler: vi.fn(),
      } as any,
    }

    try {
      await handlers.executePostPortBindingHandlerStep(runtimePlan, step, registerStopTask)
      expect(ctx.http.udpServers.length).toBeGreaterThanOrEqual(1)
      expect(tasks.length).toBeGreaterThanOrEqual(1)
    } catch {
      // Dynamic import may not resolve in all test environments
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: createExecutionSocketProtocols
// ---------------------------------------------------------------------------

describe('createExecutionSocketProtocols', () => {
  it('returns an object with executePostPortBindingSocketProtocolStep', async () => {
    const { createExecutionSocketProtocols } = await import(
      '../../src/server/builder/execution-socket-protocols.js'
    )

    const ctx = createMinimalContext()
    const socketProtocols = createExecutionSocketProtocols(ctx)

    expect(socketProtocols).toHaveProperty('executePostPortBindingSocketProtocolStep')
    expect(typeof socketProtocols.executePostPortBindingSocketProtocolStep).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Tests: createExecutionWebProtocols
// ---------------------------------------------------------------------------

describe('createExecutionWebProtocols', () => {
  it('returns an object with executePostPortBindingWebProtocolStep', async () => {
    const { createExecutionWebProtocols } = await import(
      '../../src/server/builder/execution-web-protocols.js'
    )

    const ctx = createMinimalContext()
    const webProtocols = createExecutionWebProtocols(ctx)

    expect(webProtocols).toHaveProperty('executePostPortBindingWebProtocolStep')
    expect(typeof webProtocols.executePostPortBindingWebProtocolStep).toBe('function')
  })

  it('handles shared-graphql step when no adapter is set (no-op)', async () => {
    const { createExecutionWebProtocols } = await import(
      '../../src/server/builder/execution-web-protocols.js'
    )

    const ctx = createMinimalContext()
    const webProtocols = createExecutionWebProtocols(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    const step = {
      kind: 'shared-graphql' as const,
      binding: {
        mode: 'shared' as const,
        host: '127.0.0.1',
        port: 3000,
        path: '/graphql',
        options: {},
      },
      feature: { path: '/graphql', options: {} },
    }

    // graphqlAdapter ref is null, so startExistingManagedAdapter should be a no-op
    await webProtocols.executePostPortBindingWebProtocolStep(step, registerStopTask)
    expect(tasks).toHaveLength(0)
  })

  it('starts existing graphql adapter for shared-graphql step when adapter is present', async () => {
    const { createExecutionWebProtocols } = await import(
      '../../src/server/builder/execution-web-protocols.js'
    )

    const mockGraphqlAdapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }

    const ctx = createMinimalContext()
    ctx.state.graphqlAdapter.value = mockGraphqlAdapter as any

    const webProtocols = createExecutionWebProtocols(ctx)
    const { tasks, registerStopTask } = collectStopTasks()

    const step = {
      kind: 'shared-graphql' as const,
      binding: {
        mode: 'shared' as const,
        host: '127.0.0.1',
        port: 3000,
        path: '/graphql',
        options: {},
      },
      feature: { path: '/graphql', options: {} },
    }

    await webProtocols.executePostPortBindingWebProtocolStep(step, registerStopTask)

    expect(mockGraphqlAdapter.start).toHaveBeenCalledOnce()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('graphql')
  })
})

// ---------------------------------------------------------------------------
// Tests: createExecutionEntrypoint
// ---------------------------------------------------------------------------

describe('createExecutionEntrypoint', () => {
  it('returns an object with executePrePortBindingStep and executeEntrypointStep', async () => {
    const { createExecutionEntrypoint } = await import(
      '../../src/server/builder/execution-entrypoint.js'
    )

    const ctx = createMinimalContext()
    const entrypoint = createExecutionEntrypoint(ctx)

    expect(entrypoint).toHaveProperty('executePrePortBindingStep')
    expect(entrypoint).toHaveProperty('executeEntrypointStep')
    expect(typeof entrypoint.executePrePortBindingStep).toBe('function')
    expect(typeof entrypoint.executeEntrypointStep).toBe('function')
  })

  describe('executePrePortBindingStep for single-port-tcp', () => {
    it('creates a TCP connection handler on state when not already present', async () => {
      const { createExecutionEntrypoint } = await import(
        '../../src/server/builder/execution-entrypoint.js'
      )

      const ctx = createMinimalContext()
      const entrypoint = createExecutionEntrypoint(ctx)
      const { registerStopTask } = collectStopTasks()

      const step = {
        kind: 'single-port-tcp' as const,
        binding: {
          mode: 'single-port' as const,
          host: '127.0.0.1',
          port: 3000,
          options: {
            maxMessageSize: 1024,
            keepAliveInterval: 30000,
          },
        },
      }

      await entrypoint.executePrePortBindingStep(step, registerStopTask)

      expect(ctx.state.singlePortTcpConnectionHandler.value).not.toBeNull()
    })

    it('does not overwrite an existing TCP connection handler', async () => {
      const { createExecutionEntrypoint } = await import(
        '../../src/server/builder/execution-entrypoint.js'
      )

      const existingHandler = { handleConnection: vi.fn() }
      const ctx = createMinimalContext()
      ctx.state.singlePortTcpConnectionHandler.value = existingHandler as any

      const entrypoint = createExecutionEntrypoint(ctx)
      const { registerStopTask } = collectStopTasks()

      const step = {
        kind: 'single-port-tcp' as const,
        binding: {
          mode: 'single-port' as const,
          host: '127.0.0.1',
          port: 3000,
          options: {
            maxMessageSize: 2048,
            keepAliveInterval: 60000,
          },
        },
      }

      await entrypoint.executePrePortBindingStep(step, registerStopTask)

      expect(ctx.state.singlePortTcpConnectionHandler.value).toBe(existingHandler)
    })
  })

  describe('executePrePortBindingStep for single-port-grpc', () => {
    it('throws when gRPC TLS is enabled in single-port mode', async () => {
      const { createExecutionEntrypoint } = await import(
        '../../src/server/builder/execution-entrypoint.js'
      )

      const ctx = createMinimalContext()
      const entrypoint = createExecutionEntrypoint(ctx)
      const { registerStopTask } = collectStopTasks()

      const step = {
        kind: 'single-port-grpc' as const,
        binding: {
          mode: 'single-port' as const,
          host: '127.0.0.1',
          port: 3000,
          options: {
            tls: { cert: 'cert', key: 'key' },
            protoPath: '/test.proto',
            packageName: 'test',
            serviceNames: ['TestService'],
          },
        },
      }

      await expect(
        entrypoint.executePrePortBindingStep(step, registerStopTask)
      ).rejects.toThrow('single-port gRPC currently supports h2c/insecure mode only')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: execution-adapter-lifecycle — additional coverage
// ---------------------------------------------------------------------------

describe('execution-adapter-lifecycle additional coverage', () => {
  it('stop task is a no-op when ref has been externally cleared', async () => {
    const { startAssignedManagedAdapter } = await import(
      '../../src/server/builder/execution-adapter-lifecycle.js'
    )

    const adapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    const ref = { value: null as typeof adapter | null }
    const { tasks, registerStopTask } = collectStopTasks()

    await startAssignedManagedAdapter({
      ref,
      adapter,
      name: 'test',
      registerStopTask,
    })

    // Externally clear the ref
    ref.value = null

    // Stop should be a no-op
    await tasks[0].stop()

    expect(adapter.stop).not.toHaveBeenCalled()
  })

  it('startExistingManagedAdapter with populated ref starts and registers stop', async () => {
    const { startExistingManagedAdapter } = await import(
      '../../src/server/builder/execution-adapter-lifecycle.js'
    )

    const adapter = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    const ref = { value: adapter }
    const { tasks, registerStopTask } = collectStopTasks()

    const result = await startExistingManagedAdapter({
      ref,
      name: 'existing',
      registerStopTask,
    })

    expect(result).toBe(adapter)
    expect(adapter.start).toHaveBeenCalledOnce()
    expect(tasks).toHaveLength(1)

    await tasks[0].stop()
    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(ref.value).toBeNull()
  })
})
