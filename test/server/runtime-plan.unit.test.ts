import { describe, expect, it } from 'vitest'
import { createServerPlanner } from '../../src/server/planner.js'
import { createServerRuntimePlanBuilder } from '../../src/server/runtime-plan.js'
import type { LoadedTcpHandler, LoadedUdpHandler } from '../../src/server/fs-routes/index.js'
import type { ProtocolExtensionConfig, USDDocsConfig } from '../../src/server/types.js'

describe('server runtime plan', () => {
  it('derives preview and planned addresses from the same snapshot', () => {
    const planner = createServerPlanner({
      port: 4100,
      host: '127.0.0.1',
      cors: false,
      frontDoor: {
        enabled: true,
        host: '0.0.0.0',
        port: 5100,
        protocols: ['websocket', 'jsonrpc', 'graphql'],
      },
      websocket: { path: '/ws' },
      jsonrpc: true,
      graphql: true,
    })

    const runtimePlan = createServerRuntimePlanBuilder({
      host: '127.0.0.1',
      basePath: '/api',
      protocols: planner.protocols,
      previewContext: planner.createPreviewContext(),
      cors: false,
      isSinglePortTcpRouteEnabled: () => planner.isSinglePortTcpRouteEnabled(),
      isSinglePortGrpcRouteEnabled: () => planner.isSinglePortGrpcRouteEnabled(),
      isSinglePortUdpRouteEnabled: (handler) => planner.isSinglePortUdpRouteEnabled(handler),
    }).build()

    expect(runtimePlan.previewConfig.entrypoint).toEqual({
      host: '0.0.0.0',
      port: 5100,
      source: 'frontDoor',
    })
    const query = runtimePlan.query

    expect(query.getProtocolBinding('http')).toEqual({
      host: '0.0.0.0',
      port: 5100,
    })
    expect(query.getEntrypoint().portBinding).toEqual({
      host: '0.0.0.0',
      port: 5100,
      attachTcpHandler: false,
      attachGrpcHandler: false,
    })
    expect(query.getEntrypoint().httpAdapter).toMatchObject({
      host: '0.0.0.0',
      port: 5100,
      basePath: '/api',
      cors: false,
      listenOnStart: false,
    })
    expect(runtimePlan.execution.entrypoint).toEqual([
      {
        kind: 'shared-listener',
        entrypoint: runtimePlan.entrypoint,
      },
    ])
    expect(query.getHttpMiddlewareKinds()).toEqual([
      'front-door-decision',
      'override',
      'jsonrpc',
      'graphql',
    ])
    expect(query.getStartupOrder()).toEqual([
      'providers',
      'telemetry',
      'discovery',
      'http-middleware',
      'pre-port-binding',
      'entrypoint',
      'post-port-binding',
    ])
    expect(query.getShutdownOrder()).toEqual([
      'post-port-binding',
      'entrypoint',
      'pre-port-binding',
      'http-middleware',
      'discovery',
      'telemetry',
      'providers',
    ])
    expect(query.getProtocolAddress('http')).toMatchObject({
      host: '0.0.0.0',
      port: 5100,
      frontDoor: true,
      strategy: 'shared',
    })
    expect(runtimePlan.previewConfig.protocols.websocket?.path).toBe('/ws')
    expect(query.getProtocolBinding('websocket')).toMatchObject({
      mode: 'shared',
      host: '0.0.0.0',
      port: 5100,
      path: '/ws',
    })
    expect(query.getProtocolAddress('websocket')).toMatchObject({
      host: '0.0.0.0',
      port: 5100,
      path: '/ws',
      shared: true,
      frontDoor: true,
    })
    expect(runtimePlan.previewConfig.protocols.jsonrpc?.path).toBe('/rpc')
    expect(query.getProtocolBinding('jsonrpc')).toMatchObject({
      mode: 'shared',
      host: '0.0.0.0',
      port: 5100,
      path: '/api/rpc',
    })
    expect(query.getProtocolAddress('jsonrpc')).toMatchObject({
      host: '0.0.0.0',
      port: 5100,
      path: '/api/rpc',
      shared: true,
      frontDoor: true,
    })
    expect(runtimePlan.previewConfig.protocols.graphql?.path).toBe('/graphql')
    expect(query.getProtocolBinding('graphql')).toMatchObject({
      mode: 'shared',
      host: '0.0.0.0',
      port: 5100,
      path: '/api/graphql',
    })
    expect(query.getProtocolAddress('graphql')).toMatchObject({
      host: '0.0.0.0',
      port: 5100,
      path: '/api/graphql',
      shared: true,
      frontDoor: true,
    })
  })

  it('keeps route modes and planned addresses live when shared-port config changes', () => {
    const planner = createServerPlanner({
      port: 3200,
      host: '127.0.0.1',
      cors: false,
      tcp: { port: 3200 },
      grpc: { port: 3200, protoPath: './test.proto' },
    })

    const runtimePlanBuilder = createServerRuntimePlanBuilder({
      host: '127.0.0.1',
      basePath: '/',
      protocols: planner.protocols,
      previewContext: planner.createPreviewContext(),
      cors: false,
      isSinglePortTcpRouteEnabled: () => planner.isSinglePortTcpRouteEnabled(),
      isSinglePortGrpcRouteEnabled: () => planner.isSinglePortGrpcRouteEnabled(),
      isSinglePortUdpRouteEnabled: (handler) => planner.isSinglePortUdpRouteEnabled(handler),
    })

    let runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.previewConfig.singlePort.enabled).toBe(false)
    expect(runtimePlan.query.getStartupOrder()).toEqual([
      'providers',
      'telemetry',
      'discovery',
      'http-middleware',
      'pre-port-binding',
      'entrypoint',
      'post-port-binding',
    ])
    expect(runtimePlan.query.getShutdownOrder()).toEqual([
      'post-port-binding',
      'entrypoint',
      'pre-port-binding',
      'http-middleware',
      'discovery',
      'telemetry',
      'providers',
    ])
    expect(runtimePlan.execution.entrypoint).toEqual([
      {
        kind: 'shared-listener',
        entrypoint: runtimePlan.entrypoint,
      },
    ])
    expect(runtimePlan.query.getEntrypoint().portBinding).toEqual({
      host: '127.0.0.1',
      port: 3200,
      attachTcpHandler: false,
      attachGrpcHandler: false,
    })
    expect(runtimePlan.routeModes).toEqual({
      tcp: 'dedicated',
      grpc: 'dedicated',
    })
    expect(runtimePlan.query.getProtocolBinding('tcp')).toMatchObject({
      mode: 'dedicated',
      host: '127.0.0.1',
      port: 3200,
    })
    expect(runtimePlan.query.getProtocolBinding('grpc')).toMatchObject({
      mode: 'dedicated',
      host: '127.0.0.1',
      port: 3200,
    })
    expect(runtimePlan.query.getProtocolAddress('tcp')).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      source: 'native',
    })
    expect(runtimePlan.query.getProtocolAddress('grpc')).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      source: 'native',
    })

    planner.updateSinglePortConfig({
      enabled: true,
      protocolFusion: true,
      protocols: ['tcp', 'grpc'],
    })

    runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.previewConfig.singlePort.enabled).toBe(true)
    expect(runtimePlan.query.getEntrypoint().portBinding).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      attachTcpHandler: true,
      attachGrpcHandler: true,
      singlePortConfig: {
        enabled: true,
        protocolFusion: true,
        protocols: ['tcp', 'grpc'],
      },
    })
    expect(runtimePlan.routeModes).toEqual({
      tcp: 'single-port',
      grpc: 'single-port',
    })
    expect(runtimePlan.query.getProtocolBinding('tcp')).toMatchObject({
      mode: 'single-port',
      host: '127.0.0.1',
      port: 3200,
    })
    expect(runtimePlan.query.getProtocolBinding('grpc')).toMatchObject({
      mode: 'single-port',
      host: '127.0.0.1',
      port: 3200,
    })
    expect(runtimePlan.query.getProtocolAddress('tcp')).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      source: 'singlePort',
    })
    expect(runtimePlan.query.getProtocolAddress('grpc')).toMatchObject({
      host: '127.0.0.1',
      port: 3200,
      source: 'singlePort',
      shared: true,
    })
  })

  it('plans shared HTTP features from live docs, rest, graphql and mcp config', () => {
    const planner = createServerPlanner({
      port: 3300,
      host: '127.0.0.1',
      cors: false,
      httpOptions: {
        maxBodySize: 2048,
        trustedProxies: ['127.0.0.1'],
        middleware: [
          async () => false,
        ],
      },
      graphql: true,
    })

    let docsConfig: USDDocsConfig | null = null
    let hasRestResources = false

    const runtimePlanBuilder = createServerRuntimePlanBuilder({
      host: '127.0.0.1',
      basePath: '/api',
      protocols: planner.protocols,
      previewContext: planner.createPreviewContext(),
      cors: true,
      httpOptions: {
        maxBodySize: 2048,
        trustedProxies: ['127.0.0.1'],
        middleware: [
          async () => false,
        ],
      },
      getUsdDocsConfig: () => docsConfig,
      hasRestResources: () => hasRestResources,
      getMcpOptions: () => ({ path: '/mcp-tools', name: 'raffel-test' }),
      isSinglePortTcpRouteEnabled: () => planner.isSinglePortTcpRouteEnabled(),
      isSinglePortGrpcRouteEnabled: () => planner.isSinglePortGrpcRouteEnabled(),
      isSinglePortUdpRouteEnabled: (handler) => planner.isSinglePortUdpRouteEnabled(handler),
    })

    let runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.query.getStartupOrder()).toEqual([
      'providers',
      'telemetry',
      'discovery',
      'http-middleware',
      'pre-port-binding',
      'entrypoint',
      'post-port-binding',
    ])
    expect(runtimePlan.query.getShutdownOrder()).toEqual([
      'post-port-binding',
      'entrypoint',
      'pre-port-binding',
      'http-middleware',
      'discovery',
      'telemetry',
      'providers',
    ])
    expect(runtimePlan.query.getEntrypoint().portBinding).toEqual({
      host: '127.0.0.1',
      port: 3300,
      attachTcpHandler: false,
      attachGrpcHandler: false,
    })
    expect(runtimePlan.execution.entrypoint).toEqual([
      {
        kind: 'shared-listener',
        entrypoint: runtimePlan.entrypoint,
      },
    ])
    expect(runtimePlan.query.getEntrypoint().httpAdapter).toMatchObject({
      host: '127.0.0.1',
      port: 3300,
      basePath: '/api',
      maxBodySize: 2048,
      trustedProxies: ['127.0.0.1'],
      listenOnStart: false,
      cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
      },
    })
    expect(runtimePlan.httpSharedFeatures.override).toMatchObject({
      maxBodySize: 2048,
      trustedProxies: ['127.0.0.1'],
    })
    expect(runtimePlan.query.getHttpMiddlewareKinds()).toEqual([
      'custom',
      'override',
      'graphql',
      'mcp',
    ])
    expect(runtimePlan.query.hasHttpMiddleware('docs')).toBe(false)
    expect(runtimePlan.httpSharedFeatures.rest).toBeUndefined()
    expect(runtimePlan.httpSharedFeatures.docs).toBeUndefined()
    expect(runtimePlan.httpSharedFeatures.graphql).toMatchObject({
      path: '/api/graphql',
    })
    expect(runtimePlan.httpSharedFeatures.mcp).toMatchObject({
      path: '/mcp-tools',
    })

    docsConfig = { basePath: '/docs' }
    hasRestResources = true

    runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.query.getHttpMiddlewareKinds()).toEqual([
      'custom',
      'docs',
      'override',
      'rest',
      'graphql',
      'mcp',
    ])
    expect(runtimePlan.query.hasHttpMiddleware('docs')).toBe(true)
    expect(runtimePlan.query.getHttpMiddlewarePipeline().find((step) => step.kind === 'docs')).toMatchObject({
      kind: 'docs',
      feature: {
        basePath: '/docs',
      },
    })
    expect(runtimePlan.httpSharedFeatures.rest).toMatchObject({
      maxBodySize: 2048,
      trustedProxies: ['127.0.0.1'],
    })
    expect(runtimePlan.httpSharedFeatures.docs).toMatchObject({
      basePath: '/docs',
    })
  })

  it('plans startup execution steps from live protocol, extension and handler state', () => {
    const planner = createServerPlanner({
      port: 3400,
      host: '127.0.0.1',
      cors: false,
      websocket: { port: 3401, path: '/live' },
      jsonrpc: { port: 3402, path: '/rpc' },
      graphql: { port: 3403, path: '/graphql' },
      tcp: { port: 3400 },
      grpc: { port: 3400, protoPath: './test.proto' },
    })

    const protocolExtensions: ProtocolExtensionConfig[] = []
    const tcpHandlers: LoadedTcpHandler[] = []
    const udpHandlers: LoadedUdpHandler[] = []

    const runtimePlanBuilder = createServerRuntimePlanBuilder({
      host: '127.0.0.1',
      basePath: '/api',
      protocols: planner.protocols,
      previewContext: planner.createPreviewContext(),
      cors: false,
      getProtocolExtensionConfigs: () => protocolExtensions,
      getTcpHandlers: () => tcpHandlers,
      getUdpHandlers: () => udpHandlers,
      isSinglePortTcpRouteEnabled: () => planner.isSinglePortTcpRouteEnabled(),
      isSinglePortGrpcRouteEnabled: () => planner.isSinglePortGrpcRouteEnabled(),
      isSinglePortUdpRouteEnabled: (handler) => planner.isSinglePortUdpRouteEnabled(handler),
    })

    let runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.execution.providers.map((step) => step.kind)).toEqual(['providers'])
    expect(runtimePlan.execution.telemetry.map((step) => step.kind)).toEqual(['telemetry'])
    expect(runtimePlan.execution.discovery.map((step) => step.kind)).toEqual(['discovery'])
    expect(runtimePlan.query.getStartupOrder()).toEqual([
      'providers',
      'telemetry',
      'discovery',
      'http-middleware',
      'pre-port-binding',
      'entrypoint',
      'post-port-binding',
    ])
    expect(runtimePlan.execution.prePortBinding.map((step) => step.kind)).toEqual([])
    expect(runtimePlan.execution.postPortBinding.map((step) => step.kind)).toEqual([
      'websocket',
      'jsonrpc',
      'tcp',
      'grpc',
      'graphql',
    ])

    planner.updateSinglePortConfig({
      enabled: true,
      protocolFusion: true,
      protocols: ['tcp', 'grpc'],
    })
    protocolExtensions.push({
      name: 'custom',
      factory: async () => ({
        async start() {},
        async stop() {},
      }),
    })
    tcpHandlers.push({
      name: 'echo',
      filePath: '/tmp/echo.ts',
      config: {
        port: 3410,
        host: '127.0.0.1',
        keepAlive: true,
        keepAliveInitialDelay: 30000,
        timeout: 0,
        maxConnections: 1024,
        noDelay: true,
        framing: null,
      },
      handlers: {} as LoadedTcpHandler['handlers'],
    })
    udpHandlers.push({
      name: 'metrics',
      filePath: '/tmp/metrics.ts',
      config: {
        port: 3411,
        host: '127.0.0.1',
        type: 'udp4',
        reuseAddr: true,
        reusePort: false,
        recvBufferSize: 0,
        sendBufferSize: 0,
        ipv6Only: false,
        multicast: null,
      },
      handlers: {} as LoadedUdpHandler['handlers'],
    })

    runtimePlan = runtimePlanBuilder.build()
    expect(runtimePlan.execution.prePortBinding.map((step) => step.kind)).toEqual([
      'single-port-tcp',
      'single-port-grpc',
    ])
    expect(runtimePlan.execution.postPortBinding.map((step) => step.kind)).toEqual([
      'websocket',
      'jsonrpc',
      'graphql',
      'protocol-extension',
      'tcp-handler',
      'udp-handler',
    ])
  })
})
