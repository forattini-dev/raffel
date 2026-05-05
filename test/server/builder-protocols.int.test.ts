/**
 * Server Builder Tests: protocol configuration, runtime preview, and plugins
 */

import {
  afterEach,
  beforeEach,
  createServer,
  createRouterModule,
  createDynamicGrpcClient,
  createGrpcSinglePortProto,
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
  createTempDir,
  createTestEnvelope,
  createWebSocket,
  createZodAdapter,
  describe,
  expect,
  frontDoorStartupAddressFixture,
  getFreePort,
  grpc,
  it,
  loadDiscovery,
  receiveSinglePortTcpResponse,
  registerValidator,
  resetValidation,
  rm,
  sendRawPayload,
  sendRawUdpPayload,
  sendWebSocketEnvelope,
  TEST_PORT,
  WebSocket,
  writeFixture,
  z,
  type Context,
  type Interceptor,
} from './builder/helpers.js'

describe('createServer: protocol configuration, runtime preview, and plugins', () => {

  let server: ReturnType<typeof createServer> | null = null

  beforeEach(() => {
    // Register Zod adapter for validation tests
    resetValidation()
    registerValidator(createZodAdapter(z))
  })

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
  })

  describe('protocol configuration', () => {
    it('should enable WebSocket', () => {
      server = createServer({ port: TEST_PORT })
      server.enableWebSocket('/ws')

      // Can't test actual WebSocket without starting, but we can verify it's configured
      expect(server).toBeDefined()
    })

    it('should apply protocol presets quickly', () => {
      server = createServer({ port: TEST_PORT })
        .withPreset('dev')

      const preview = server.previewConfig()

      expect(preview.protocols.websocket?.enabled).toBe(true)
      expect(preview.protocols.jsonrpc?.enabled).toBe(true)
      expect(preview.protocols.graphql?.enabled).toBe(true)
    })

    it('should allow realtime preset with custom websocket path', () => {
      server = createServer({ port: TEST_PORT })
        .withPreset('realtime', { websocketPath: '/realtime' })

      const preview = server.previewConfig()

      expect(preview.protocols.websocket?.path).toBe('/realtime')
      expect(preview.protocols.jsonrpc).toBeUndefined()
      expect(preview.protocols.graphql).toBeUndefined()
    })

    it('should enable JSON-RPC', () => {
      server = createServer({ port: TEST_PORT })
      server.enableJsonRpc('/rpc')

      expect(server).toBeDefined()
    })

    it('should configure TCP', () => {
      server = createServer({ port: TEST_PORT })
      server.tcp({ port: TEST_PORT + 10 })

      expect(server).toBeDefined()
    })

    it('should chain protocol configurations', () => {
      server = createServer({ port: TEST_PORT })
        .enableWebSocket()
        .enableJsonRpc()
        .tcp({ port: TEST_PORT + 10 })

      expect(server).toBeDefined()
    })

    it('should configure single-port with fluent API', () => {
      server = createServer({ port: TEST_PORT, protocolAliasMode: 'extended' })
        .enableSinglePort({
          protocolFusion: true,
          protocols: ['icmp', 'tcp'],
          protocolAliasMode: 'extended',
        })

      const preview = server.previewConfig()
      expect(preview.singlePort.enabled).toBe(true)
      expect(preview.singlePort.protocolAliasMode).toBe('extended')
      expect(preview.singlePort.protocols).toEqual(expect.arrayContaining(['icmp', 'tcp']))
    })

    it('should expose shared-port as the canonical protocol fusion preview surface', () => {
      server = createServer({
        port: TEST_PORT,
        frontDoor: {
          enabled: true,
          port: TEST_PORT + 1,
        },
        sharedPort: {
          enabled: true,
          protocols: ['http', 'tcp'],
        },
      })

      const preview = server.previewConfig()
      expect(preview.protocolFusion).toMatchObject({
        enabled: true,
        mode: 'front-door+shared-port',
        entrypoint: 'tcp',
      })
      expect(preview.sharedPort.enabled).toBe(true)
      expect(preview.sharedPort.protocols).toEqual(expect.arrayContaining(['http', 'tcp']))
      expect(preview.singlePort).toEqual(preview.sharedPort)
    })

    it('should disable fluent single-port override in preview', () => {
      server = createServer({ port: TEST_PORT, singlePort: { protocolFusion: true } })
        .enableSinglePort(false)

      const preview = server.previewConfig()
      expect(preview.singlePort.enabled).toBe(false)
    })

    it('should expose bind-time warnings in preview', () => {
      server = createServer({ port: TEST_PORT, tcp: { port: TEST_PORT } })
      const preview = server.previewConfig()

      expect(preview.warnings.join('\n')).toContain('single-port transport')
      expect(preview.protocols.tcp?.enabled).toBe(true)
    })
  })

  describe('runtime inspection preview', () => {
    it('should mark gRPC as single-port in preview when it shares the entrypoint', () => {
      server = createServer({
        port: TEST_PORT,
        host: '127.0.0.1',
        singlePort: {
          protocolFusion: true,
          protocols: ['grpc'],
        },
        grpc: { port: TEST_PORT, host: '127.0.0.1', protoPath: 'virtual.proto' },
      })

      server.grpcNs
        .service('UserService', { packageName: 'pkg' })
        .method(
          'GetUser',
          {
            input: z.object({ id: z.string() }),
            output: z.object({ id: z.string() }),
          },
          async (input) => input
        )
        .end()

      const preview = server.preview()
      const grpcTransport = preview.transports.find((transport) => transport.protocol === 'grpc')

      expect(grpcTransport).toMatchObject({
        protocol: 'grpc',
        host: '127.0.0.1',
        port: TEST_PORT,
        source: 'singlePort',
      })
    })

    it('should expose a canonical multi-protocol inspection graph', () => {
      server = createServer({
        port: TEST_PORT,
        basePath: '/api',
        websocket: { path: '/ws' },
        jsonrpc: { path: '/rpc' },
        grpc: { port: TEST_PORT + 1, protoPath: 'virtual.proto' },
      })

      server
        .procedure('users.list')
        .input(z.object({ cursor: z.string().optional() }))
        .output(z.array(z.object({ id: z.string() })))
        .http('/users', 'GET')
        .policy({ auth: { roles: ['admin'] } })
        .handler(async () => [{ id: 'user-1' }])

      server
        .stream('logs.tail')
        .input(z.object({ service: z.string() }))
        .output(z.object({ line: z.string() }))
        .handler(async function* () {
          yield { line: 'ok' }
        })

      server.grpcNs
        .service('UserService', { packageName: 'pkg' })
        .method(
          'GetUser',
          {
            input: z.object({ id: z.string() }),
            output: z.object({ id: z.string() }),
          },
          async (input) => input
        )
        .end()

      server.ws.channel('presence-users', {
        type: 'presence',
        description: 'User presence',
        tags: ['presence'],
      })

      const preview = server.preview()

      expect(preview.version).toBe(1)
      expect(preview.transports.map((transport) => transport.protocol)).toEqual(
        expect.arrayContaining(['http', 'websocket', 'jsonrpc', 'grpc'])
      )

      const usersList = preview.operations.find((operation) => operation.name === 'users.list')
      expect(usersList).toMatchObject({
        service: 'users',
        kind: 'procedure',
        source: { kind: 'programmatic', location: '<programmatic>' },
      })
      expect(usersList?.policies.effective?.auth?.roles).toEqual(['admin'])
      expect(usersList?.schema.input.present).toBe(true)
      expect(usersList?.schema.output.present).toBe(true)
      expect(usersList?.transports).toEqual(expect.arrayContaining([
        expect.objectContaining({
          protocol: 'http',
          mode: 'rest',
          method: 'GET',
          path: '/api/users',
        }),
        expect.objectContaining({
          protocol: 'websocket',
          mode: 'request',
          path: '/api/ws',
        }),
        expect.objectContaining({
          protocol: 'jsonrpc',
          mode: 'request',
          path: '/api/rpc',
        }),
      ]))

      const grpcMethod = preview.operations.find((operation) => operation.name === 'pkg.UserService.GetUser')
      expect(grpcMethod?.transports).toEqual(expect.arrayContaining([
        expect.objectContaining({
          protocol: 'grpc',
          service: 'pkg.UserService',
          operation: 'GetUser',
          mode: 'unary',
        }),
      ]))

      const channel = preview.channels.find((entry) => entry.name === 'presence-users')
      expect(channel).toMatchObject({
        type: 'presence',
        auth: 'required',
        description: 'User presence',
        tags: ['presence'],
        transport: {
          protocol: 'websocket',
          mode: 'channel',
          path: '/api/ws',
        },
      })
    })

    it('should emit structured conflict and configuration diagnostics', () => {
      server = createServer({ port: TEST_PORT, tcp: { port: TEST_PORT } })

      server
        .procedure('users.first')
        .http('/users', 'GET')
        .handler(async () => 'first')

      server
        .procedure('users.second')
        .http('/users', 'GET')
        .handler(async () => 'second')

      const preview = server.preview()

      expect(preview.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'CONFIG_WARNING',
          severity: 'warning',
          subject: expect.objectContaining({
            kind: 'server',
          }),
        }),
        expect.objectContaining({
          code: 'CONFLICTING_HTTP_EXPOSURE',
          severity: 'error',
          subject: expect.objectContaining({
            kind: 'binding',
            id: 'GET:/users',
          }),
          data: expect.objectContaining({
            operations: expect.arrayContaining(['users.first', 'users.second']),
          }),
        }),
      ]))
    })

    it('should surface missing auth and output-schema diagnostics for public operations', () => {
      server = createServer({ port: TEST_PORT })
      server.procedure('public.ping').handler(async () => 'pong')

      const preview = server.preview()
      const warnings = preview.diagnostics.filter((diagnostic) => diagnostic.subject.id === 'public.ping')

      expect(warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_AUTH_POLICY',
          severity: 'warning',
        }),
        expect.objectContaining({
          code: 'MISSING_OUTPUT_SCHEMA',
          severity: 'warning',
        }),
      ]))
    })

    it('should let plugins contribute custom runtime inspection extensions', () => {
      server = createServer({ port: TEST_PORT })
        .usePlugin({
          name: 'purple-inspect',
          inspect: ({ preview }) => ({
            namespace: 'purple',
            title: 'Purple Runtime',
            nodes: [
              {
                id: 'purple:summary',
                kind: 'summary',
                label: 'Purple Summary',
                data: {
                  operationCount: preview.operations.length,
                },
              },
            ],
          }),
        })

      server.procedure('public.ping').handler(async () => 'pong')

      const preview = server.preview()

      expect(preview.extensions).toEqual([
        expect.objectContaining({
          namespace: 'purple',
          title: 'Purple Runtime',
          nodes: [
            expect.objectContaining({
              id: 'purple:summary',
              kind: 'summary',
              label: 'Purple Summary',
              data: {
                operationCount: 1,
              },
            }),
          ],
        }),
      ])
    })
  })

  describe('server plugins', () => {
    it('should allow plugins to register handlers during setup', () => {
      server = createServer({ port: TEST_PORT }).usePlugin({
        name: 'purple-routes',
        register: ({ server }) => {
          server.procedure('purple.health').handler(async () => 'ok')
        },
      })

      const preview = server.preview()

      expect(preview.operations.some((operation) => operation.name === 'purple.health')).toBe(true)
    })

    it('should run plugin lifecycle hooks around server start and stop', async () => {
      const events: string[] = []

      server = createServer({
        port: TEST_PORT,
        plugins: [
          {
            name: 'alpha',
            beforeStart: () => { events.push('alpha:beforeStart') },
            afterStart: () => { events.push('alpha:afterStart') },
            beforeStop: () => { events.push('alpha:beforeStop') },
            afterStop: () => { events.push('alpha:afterStop') },
          },
          {
            name: 'beta',
            beforeStart: () => { events.push('beta:beforeStart') },
            afterStart: () => { events.push('beta:afterStart') },
            beforeStop: () => { events.push('beta:beforeStop') },
            afterStop: () => { events.push('beta:afterStop') },
          },
        ],
      })

      await server.start()
      await server.stop()

      expect(events).toEqual([
        'alpha:beforeStart',
        'beta:beforeStart',
        'alpha:afterStart',
        'beta:afterStart',
        'beta:beforeStop',
        'alpha:beforeStop',
        'beta:afterStop',
        'alpha:afterStop',
      ])
    })

    it('should reject duplicate plugin names', () => {
      server = createServer({ port: TEST_PORT }).usePlugin({ name: 'purple-plugin' })

      expect(() => {
        server!.usePlugin({ name: 'purple-plugin' })
      }).toThrow('Plugin "purple-plugin" already registered')
    })
  })
})
