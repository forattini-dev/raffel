/**
 * Server Builder Tests: shared-port and front-door routing
 */

import {
  afterEach,
  bindTestPort,
  beforeEach,
  closeTestServer,
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
  path,
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

describe('createServer: shared-port and front-door routing', () => {

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

  describe('shared protocol ports', () => {
    it('should reject HTTP traffic when front-door protocol list excludes http', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        frontDoor: {
          enabled: true,
          port,
          protocols: ['jsonrpc'],
        },
        jsonrpc: { path: '/rpc' },
      })

      server
        .procedure('getHello')
        .output(z.string())
        .handler(async () => 'world')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
      })
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: { code: string; details?: { protocol: string } } }
      expect(body.error.code).toBe('UNSUPPORTED_PROTOCOL')
      expect(body.error.details?.protocol).toBe('http')
    })

    it('should rollback startup when a dedicated protocol fails to bind', async () => {
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()
      const blocker = await bindTestPort(tcpPort)
      try {
        server = createServer({
          port: frontDoorPort,
          frontDoor: {
            enabled: true,
            port: frontDoorPort,
            host: '127.0.0.1',
          },
          tcp: { port: tcpPort },
        })

        await expect(server.start()).rejects.toThrow()
        expect(server.isRunning).toBe(false)
        expect(server.addresses).toBeNull()

        const reusableServer = await bindTestPort(frontDoorPort)
        await closeTestServer(reusableServer)
      } finally {
        await closeTestServer(blocker)
      }
    })

    it('should rollback startup in reverse phase order before provider shutdown', async () => {
      const port = await getFreePort()
      const events: string[] = []

      server = createServer({
        port,
        providers: {
          config: {
            factory: () => {
              events.push('provider:init')
              return { ok: true }
            },
            onShutdown: async () => {
              events.push('provider:shutdown')
            },
          },
        },
        protocolExtensions: [
          {
            name: 'ready',
            factory: async () => ({
              async start() {
                events.push('extension:ready:start')
              },
              async stop() {
                events.push('extension:ready:stop')
              },
            }),
          },
          {
            name: 'broken',
            factory: async () => ({
              async start() {
                events.push('extension:broken:start')
                throw new Error('broken extension startup')
              },
              async stop() {},
            }),
          },
        ],
      })

      await expect(server.start()).rejects.toThrow('broken extension startup')
      expect(server.isRunning).toBe(false)
      expect(server.addresses).toBeNull()
      expect(events).toEqual([
        'provider:init',
        'extension:ready:start',
        'extension:broken:start',
        'extension:ready:stop',
        'provider:shutdown',
      ])
    })

    it('should return deterministic 4xx for non-routed shared HTTP request', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        frontDoor: {
          enabled: true,
          port,
        },
      })

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/not-a-procedure`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBeGreaterThanOrEqual(400)

      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should allow valid HTTP through single-port connection sniffing', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        singlePort: {
          protocolFusion: true,
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )

      expect(response).toContain('HTTP/1.1 200')
      expect(response).toContain('ok')
    })

    it('should apply fluent shared-port config to lifecycle startup decisions', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
      }).enableSharedPort({
        protocolFusion: true,
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )

      expect(response).toContain('HTTP/1.1 200')
      expect(response).toContain('ok')

      const state = server.getProtocolFusionState()
      const decision = state.recentDecisions.find((entry) => entry.layer === 'shared-port')

      expect(state.mode).toBe('shared-port')
      expect(decision).toMatchObject({
        protocol: 'http',
        outcome: 'route',
        detector: 'http-method',
      })
    })

    it('should honor websocket onMessage registered after server construction', async () => {
      const port = await getFreePort()
      let ws: WebSocket | null = null
      let publishedMessageTimeout: ReturnType<typeof setTimeout> | null = null
      server = createServer({
        port,
        host: '127.0.0.1',
        websocket: { path: '/ws' },
      })

      const publishedMessage = new Promise<{
        channel: string
        event: string
        data: unknown
      }>((resolve, reject) => {
        publishedMessageTimeout = setTimeout(() => {
          reject(new Error('WebSocket onMessage handler was not invoked'))
        }, 2000)

        server.ws
          .channel('chat-room', { type: 'public' })
          .onMessage((channel, event, data) => {
            if (publishedMessageTimeout) {
              clearTimeout(publishedMessageTimeout)
              publishedMessageTimeout = null
            }
            resolve({ channel, event, data })
          })
      })

      try {
        await server.start()

        ws = await createWebSocket(`ws://127.0.0.1:${port}/ws`)
        const subscribed = await sendWebSocketEnvelope(ws, {
          id: 'sub-1',
          type: 'subscribe',
          channel: 'chat-room',
        })

        expect(subscribed.type).toBe('subscribed')

        ws.send(JSON.stringify({
          id: 'pub-1',
          type: 'publish',
          channel: 'chat-room',
          event: 'message',
          data: { text: 'hello' },
        }))

        await expect(publishedMessage).resolves.toEqual({
          channel: 'chat-room',
          event: 'message',
          data: { text: 'hello' },
        })
      } finally {
        if (publishedMessageTimeout) {
          clearTimeout(publishedMessageTimeout)
          publishedMessageTimeout = null
        }
        ws?.close()
      }
    })

    it('should honor websocket subscribe and unsubscribe handlers registered after channel definition', async () => {
      const port = await getFreePort()
      let ws: WebSocket | null = null
      let subscribeTimeout: ReturnType<typeof setTimeout> | null = null
      let unsubscribeTimeout: ReturnType<typeof setTimeout> | null = null
      server = createServer({
        port,
        host: '127.0.0.1',
        websocket: { path: '/ws' },
      })

      let resolveSubscribed!: (channel: string) => void
      let resolveUnsubscribed!: (channel: string) => void
      const subscribed = new Promise<string>((resolve, reject) => {
        subscribeTimeout = setTimeout(() => {
          reject(new Error('WebSocket onSubscribe handler was not invoked'))
        }, 2000)
        resolveSubscribed = resolve
      })
      const unsubscribed = new Promise<string>((resolve, reject) => {
        unsubscribeTimeout = setTimeout(() => {
          reject(new Error('WebSocket onUnsubscribe handler was not invoked'))
        }, 2000)
        resolveUnsubscribed = resolve
      })

      server.ws
        .channel('chat-room', { type: 'public' })
        .onSubscribe((channel) => {
          if (subscribeTimeout) {
            clearTimeout(subscribeTimeout)
            subscribeTimeout = null
          }
          resolveSubscribed(channel)
        })
        .onUnsubscribe((channel) => {
          if (unsubscribeTimeout) {
            clearTimeout(unsubscribeTimeout)
            unsubscribeTimeout = null
          }
          resolveUnsubscribed(channel)
        })

      try {
        await server.start()

        ws = await createWebSocket(`ws://127.0.0.1:${port}/ws`)
        const subscribeResponse = await sendWebSocketEnvelope(ws, {
          id: 'sub-1',
          type: 'subscribe',
          channel: 'chat-room',
        })

        expect(subscribeResponse.type).toBe('subscribed')
        await expect(subscribed).resolves.toBe('chat-room')

        const unsubscribeResponse = await sendWebSocketEnvelope(ws, {
          id: 'unsub-1',
          type: 'unsubscribe',
          channel: 'chat-room',
        })

        expect(unsubscribeResponse.type).toBe('unsubscribed')
        await expect(unsubscribed).resolves.toBe('chat-room')
      } finally {
        if (subscribeTimeout) {
          clearTimeout(subscribeTimeout)
          subscribeTimeout = null
        }
        if (unsubscribeTimeout) {
          clearTimeout(unsubscribeTimeout)
          unsubscribeTimeout = null
        }
        ws?.close()
      }
    })

    it('should return unsupported response for unknown single-port protocol', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        singlePort: {
          protocolFusion: true,
        },
      })

      await server.start()

      const response = await sendRawPayload(port, 'HELLO_NOT_HTTP')

      expect(response).toContain('HTTP/1.1 400 Bad Request')
      expect(response).toContain('UNSUPPORTED_PROTOCOL')
    })

    it('should route TCP frames through single-port to router', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
        singlePort: {
          protocolFusion: true,
        },
        tcp: {
          port,
          host: '127.0.0.1',
        },
      })

      server
        .procedure('ping')
        .output(z.string())
        .handler(async () => 'pong')

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port,
        frontDoor: false,
        strategy: 'native',
        source: 'singlePort',
      })

      const response = await receiveSinglePortTcpResponse(port, {
        id: 'tcp-1',
        procedure: 'ping',
        type: 'request',
        payload: {},
      })

      expect(response.id).toBe('tcp-1:response')
      expect(response.procedure).toBe('ping')
      expect(response.type).toBe('response')
      expect(response.payload).toBe('pong')
    })

    it('should route TCP aliases in single-port protocol allowlist', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
        protocolAliasMode: 'extended',
        singlePort: {
          protocolFusion: true,
          protocols: ['whois'],
        },
        tcp: {
          port,
          host: '127.0.0.1',
        },
      })

      server
        .procedure('ping')
        .output(z.string())
        .handler(async () => 'pong')

      await server.start()

      const response = await receiveSinglePortTcpResponse(port, {
        id: 'tcp-2',
        procedure: 'ping',
        type: 'request',
        payload: {},
      })

      expect(response.id).toBe('tcp-2:response')
      expect(response.procedure).toBe('ping')
      expect(response.type).toBe('response')
      expect(response.payload).toBe('pong')
    })

    it('should expose single-port UDP handlers bound to the same host/port', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
        singlePort: {
          protocolFusion: true,
        },
      })

      server.udp
        .handler('ping', { port, host: '127.0.0.1' })
        .onMessage((data) => {
          if (data.toString() === 'ping') {
            return Buffer.from('pong')
          }
          return undefined
        })
        .end()

      await server.start()

      expect(server.addresses?.udp).toMatchObject({
        host: '127.0.0.1',
        port,
        frontDoor: false,
        strategy: 'native',
        source: 'singlePort',
      })

      const response = await sendRawUdpPayload(port, 'ping')
      expect(response.toString()).toBe('pong')
    })

    it('should route h2c gRPC through single-port to the shared listener', async () => {
      const port = await getFreePort()
      const protoPath = await createGrpcSinglePortProto()
      let client: (grpc.Client & Record<string, Function>) | null = null

      try {
        server = createServer({
          port,
          host: '127.0.0.1',
          singlePort: {
            protocolFusion: true,
            protocols: ['grpc'],
          },
          grpc: {
            port,
            host: '127.0.0.1',
            protoPath,
          },
        })

        server.grpcNs
          .service('SharedGreeter', { packageName: 'demo' })
          .method(
            'Greet',
            {
              input: z.object({ name: z.string() }),
              output: z.object({ message: z.string() }),
            },
            async (input) => ({
              message: `Hello ${input.name}`,
            })
          )
          .end()

        await server.start()

        expect(server.addresses?.grpc).toMatchObject({
          host: '127.0.0.1',
          port,
          shared: true,
          source: 'singlePort',
        })

        client = createDynamicGrpcClient(protoPath, `127.0.0.1:${port}`)

        const response = await new Promise<{ message: string }>((resolve, reject) => {
          client!.Greet({ name: 'Ada' }, (error: Error | null, result: { message: string }) => {
            if (error) {
              reject(error)
              return
            }
            resolve(result)
          })
        })

        expect(response).toEqual({ message: 'Hello Ada' })

        const state = server.getProtocolFusionState()
        const decision = state.recentDecisions.find((entry) => entry.layer === 'shared-port' && entry.protocol === 'grpc')
        expect(decision).toMatchObject({
          protocol: 'grpc',
          outcome: 'route',
          detector: 'http2-preface',
        })
      } finally {
        client?.close()
        await rm(path.dirname(protoPath), { recursive: true, force: true })
      }
    })

    it('should honor single-port alias mode override independently from global mode', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        host: '127.0.0.1',
        protocolAliasMode: 'standard',
        singlePort: {
          protocolFusion: true,
          protocolAliasMode: 'extended',
          protocols: ['icmp'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )

      expect(response).toContain('HTTP/1.1 200')
      expect(response).toContain('ok')
    })

    it('should honor singlePort protocol allowlist and skip unmatched built-ins', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        sharedPort: {
          protocolFusion: true,
          protocols: ['grpc'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )

      expect(response).toContain('HTTP/1.1 400 Bad Request')
      expect(response).toContain('UNSUPPORTED_PROTOCOL')
      expect(response).toContain('"protocol":"http"')

      const state = server.getProtocolFusionState()
      const decision = state.recentDecisions.find((entry) => entry.layer === 'shared-port')
      expect(state.mode).toBe('shared-port')
      expect(decision).toMatchObject({
        protocol: 'http',
        outcome: 'reject',
        detector: 'http-method',
        reason: 'unsupported',
        allowedProtocols: ['grpc'],
      })
    })

    it('should map single-port protocol aliases for detection and keep unsupported behavior when mapped stack is absent', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
        protocolAliasMode: 'extended',
        singlePort: {
          protocolFusion: true,
          protocols: ['icmp'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const healthResponse = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )
      expect(healthResponse).toContain('HTTP/1.1 200')
      expect(healthResponse).toContain('ok')

      const whoisResponse = await sendRawPayload(
        port,
        'example.com\r\n'
      )

      expect(whoisResponse).toContain('HTTP/1.1 400 Bad Request')
      expect(whoisResponse).toContain('UNSUPPORTED_PROTOCOL')
    })

    it('does not map icmp aliases in single-port protocol detection with standard mode', async () => {
      const port = await getFreePort()
      server = createServer({
        port,
        host: '127.0.0.1',
        sharedPort: {
          protocolFusion: true,
          protocols: ['icmp'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await sendRawPayload(
        port,
        'GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'
      )

      expect(response).toContain('HTTP/1.1 400 Bad Request')
      expect(response).toContain('UNSUPPORTED_PROTOCOL')
      expect(response).toContain('"protocol":"http"')
    })

    it('should expose runtime protocol fusion diagnostics across shared-port and front-door', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        frontDoor: {
          enabled: true,
          port,
          protocols: ['jsonrpc'],
        },
        sharedPort: {
          enabled: true,
          protocols: ['http'],
        },
        jsonrpc: { path: '/rpc' },
      })

      server.procedure('ping').handler(async () => 'pong')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/health`)
      expect(response.status).toBe(400)

      const state = server.getProtocolFusionState()
      const sharedPortDecision = state.recentDecisions.find((entry) => entry.layer === 'shared-port')
      const frontDoorDecision = state.recentDecisions.find((entry) => entry.layer === 'front-door')

      expect(state.mode).toBe('front-door+shared-port')
      expect(state.entrypoint).toBe('tcp')
      expect(sharedPortDecision).toMatchObject({
        protocol: 'http',
        outcome: 'route',
        allowedProtocols: ['http'],
      })
      expect(frontDoorDecision).toMatchObject({
        protocol: 'http',
        outcome: 'reject',
        request: {
          method: 'GET',
          path: '/health',
        },
        allowedProtocols: ['jsonrpc'],
      })
    })

    it('should serve JSON-RPC and GraphQL over the HTTP port with basePath', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        basePath: '/api',
        jsonrpc: { path: '/rpc' },
        graphql: { path: '/graphql' },
      })

      server
        .procedure('getHello')
        .output(z.string())
        .handler(async () => 'world')

      await server.start()

      expect(server.addresses?.jsonrpc?.port).toBe(port)
      expect(server.addresses?.jsonrpc?.shared).toBe(true)
      expect(server.addresses?.jsonrpc?.path).toBe('/api/rpc')
      expect(server.addresses?.graphql?.port).toBe(port)
      expect(server.addresses?.graphql?.shared).toBe(true)
      expect(server.addresses?.graphql?.path).toBe('/api/graphql')

      const rpcResponse = await fetch(`http://localhost:${port}/api/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHello',
          params: {},
        }),
      })

      expect(rpcResponse.status).toBe(200)
      const rpcBody = (await rpcResponse.json()) as { result: string }
      expect(rpcBody.result).toBe('world')

      const gqlResponse = await fetch(`http://localhost:${port}/api/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ getHello }' }),
      })

      expect(gqlResponse.status).toBe(200)
      const gqlBody = (await gqlResponse.json()) as { data: { getHello: string } }
      expect(gqlBody.data).toEqual({ getHello: 'world' })
    })

    it('should expose front-door metadata when sharing HTTP/WSS/JSON-RPC/GraphQL on a dedicated front door port', async () => {
      const frontDoorPort = await getFreePort()
      const serverPort = await getFreePort()

      server = createServer({
        port: serverPort,
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
        },
        jsonrpc: { path: '/rpc' },
        graphql: { path: '/graphql' },
        websocket: {
          path: '/ws',
        },
      })

      server
        .procedure('getHello')
        .output(z.string())
        .handler(async () => 'world')

      await server.start()

      expect(server.addresses?.http.port).toBe(frontDoorPort)
      expect(server.addresses?.http.host).toBe('127.0.0.1')
      expect(server.addresses?.http.frontDoor).toBe(true)
      expect(server.addresses?.http.strategy).toBe('shared')
      expect(server.addresses?.jsonrpc).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        frontDoor: true,
        shared: true,
        strategy: 'shared',
      })
      expect(server.addresses?.graphql).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        frontDoor: true,
        shared: true,
        strategy: 'shared',
      })
      expect(server.addresses?.websocket).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        frontDoor: true,
        shared: true,
        strategy: 'shared',
      })

      const rpcResponse = await fetch(`http://127.0.0.1:${frontDoorPort}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getHello',
          params: {},
        }),
      })
      expect(rpcResponse.status).toBe(200)
      const rpcBody = (await rpcResponse.json()) as { result: string }
      expect(rpcBody.result).toBe('world')

      const gqlResponse = await fetch(`http://127.0.0.1:${frontDoorPort}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ getHello }' }),
      })

      expect(gqlResponse.status).toBe(200)
      const gqlBody = (await gqlResponse.text()) as string
      expect(gqlBody).toContain('\"getHello\":\"world\"')
    })

    it('should route HTTP + WebSocket + JSON-RPC together through front-door', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['http', 'websocket', 'jsonrpc'],
        },
        websocket: { path: '/ws' },
        jsonrpc: { path: '/rpc' },
      })

      server.procedure('ping').handler(async () => 'pong')

      await server.start()

      expect(server.addresses?.http).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        frontDoor: true,
        strategy: 'shared',
      })
      expect(server.addresses?.websocket).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        path: '/ws',
        shared: true,
        frontDoor: true,
        strategy: 'shared',
      })
      expect(server.addresses?.jsonrpc).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        path: '/rpc',
        shared: true,
        frontDoor: true,
        strategy: 'shared',
      })

      const ws = await createWebSocket(`ws://127.0.0.1:${frontDoorPort}/ws`)
      const response = await sendWebSocketEnvelope(ws, {
        id: '1',
        type: 'request',
        procedure: 'ping',
        payload: {},
      })
      ws.close()

      expect(response.type).toBe('response')
      expect(response.id).toBe('1:response')
      expect(response.procedure).toBe('ping')

      const rpcResponse = await fetch(`http://127.0.0.1:${frontDoorPort}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
          params: {},
        }),
      })
      expect(rpcResponse.status).toBe(200)
      const rpcBody = (await rpcResponse.json()) as { result: string }
      expect(rpcBody.result).toBe('pong')

      const httpResponse = await fetch(`http://127.0.0.1:${frontDoorPort}/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(httpResponse.status).toBe(200)
      expect(await httpResponse.json()).toBe('pong')
    })

    it('should treat rpc and jrpc as jsonrpc aliases in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['jrpc'],
        },
        jsonrpc: { path: '/rpc' },
      })

      server.procedure('ping').handler(async () => 'pong')

      await server.start()

      expect(server.addresses?.jsonrpc).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        path: '/rpc',
        shared: true,
        frontDoor: true,
        strategy: 'shared',
      })

      const rpcResponse = await fetch(`http://127.0.0.1:${frontDoorPort}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
          params: {},
        }),
      })
      expect(rpcResponse.status).toBe(200)
      const rpcBody = (await rpcResponse.json()) as { result: string }
      expect(rpcBody.result).toBe('pong')
    })

    it('should treat icmp as http alias in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['icmp'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${frontDoorPort}/health`)
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).toBe('"ok"')
      expect(server.addresses?.http).toMatchObject({
        host: '127.0.0.1',
        port: frontDoorPort,
        frontDoor: true,
        strategy: 'shared',
      })
    })

    it('should treat ping as http alias in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['ping'],
        },
      })

      server.get('/health', async () => 'ok')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${frontDoorPort}/health`)
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).toBe('"ok"')
    })

    it('should prioritize front-door alias mode override over server default', async () => {
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'standard',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocolAliasMode: 'extended',
          protocols: ['ftp'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })

    it('should keep front-door alias mode in standard when overriding a global extended default', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocolAliasMode: 'standard',
          protocols: ['ftp'],
        },
      })

      await server.start()

      const response = await fetch(`http://127.0.0.1:${frontDoorPort}/health`)
      const body = await response.text()

      expect(response.status).toBe(400)
      expect(body).toContain('UNSUPPORTED_PROTOCOL')
    })

    it('should treat whois as tcp alias in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['whois'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })

    it('should treat ftp as tcp alias in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['ftp'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })

    it('should treat telnet as tcp alias in front-door protocol list', async () => {
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        protocolAliasMode: 'extended',
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['telnet'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })

    it('should not treat icmp alias as http when front-door protocol alias mode is standard', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['icmp'],
        },
      })
      server.get('/health', async () => 'ok')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${frontDoorPort}/health`)
      const body = await response.text()
      expect(response.status).toBe(400)
      expect(body).toContain('UNSUPPORTED_PROTOCOL')
      expect(body).toContain('"protocol":"http"')
    })

    it('should reject unknown front-door protocol upgrades', async () => {
      const frontDoorPort = await getFreePort()

      server = createServer({
        port: await getFreePort(),
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host: '127.0.0.1',
          protocols: ['websocket'],
        },
        websocket: { path: '/ws' },
      })

      await server.start()

      await expect(createWebSocket(`ws://127.0.0.1:${frontDoorPort}/wrong-ws-path`)).rejects.toThrow()
    })

    it('should allow unknown front-door protocol names without validation failure', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        frontDoor: {
          enabled: true,
          port,
          protocols: ['http', 'mystery-protocol'],
        },
      })

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/__does-not-exist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(404)
    })

    it('should validate startup address fixture for front-door protocol mix', async () => {
      const frontDoorPort = await getFreePort()
      const serverPort = await getFreePort()
      const tcpPort = await getFreePort()
      const udpPort = await getFreePort()
      const host = '127.0.0.1'

      server = createServer({
        port: serverPort,
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          host,
          protocols: ['http', 'websocket', 'jsonrpc', 'graphql', 'tcp', 'udp'],
        },
        websocket: { path: '/ws' },
        jsonrpc: { path: '/rpc' },
        graphql: { path: '/graphql' },
        tcp: {
          port: tcpPort,
          host,
        },
      })

      server.udp
        .handler('metrics', { port: udpPort, host })
        .onMessage(() => {})
        .end()

      await server.start()

      expect(server.addresses).toMatchObject(frontDoorStartupAddressFixture(host, frontDoorPort, tcpPort, udpPort))
    })

    it('should preserve non-front-door shared-mode defaults for protocol sharing', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        host: '127.0.0.1',
        websocket: {
          path: '/ws',
        },
        jsonrpc: {
          path: '/rpc',
        },
        graphql: {
          path: '/graphql',
        },
      })

      await server.start()

      expect(server.addresses?.http).toMatchObject({
        host: '127.0.0.1',
        port,
        frontDoor: false,
        strategy: 'native',
      })
      expect(server.addresses?.websocket).toMatchObject({
        host: '127.0.0.1',
        port,
        path: '/ws',
        shared: true,
        frontDoor: false,
        strategy: 'native',
      })
      expect(server.addresses?.jsonrpc).toMatchObject({
        host: '127.0.0.1',
        port,
        path: '/rpc',
        shared: true,
        frontDoor: false,
        strategy: 'native',
      })
      expect(server.addresses?.graphql).toMatchObject({
        host: '127.0.0.1',
        port,
        path: '/graphql',
        shared: true,
        frontDoor: false,
        strategy: 'native',
      })
    })

    it('should keep TCP on native strategy in front-door mode unless explicitly requested', async () => {
      const serverPort = await getFreePort()
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: serverPort,
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          protocols: ['http'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: false,
        strategy: 'native',
      })
    })

    it('should mark TCP as offload when explicitly included in front-door protocols', async () => {
      const serverPort = await getFreePort()
      const frontDoorPort = await getFreePort()
      const tcpPort = await getFreePort()

      server = createServer({
        port: serverPort,
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          protocols: ['http', 'tcp'],
        },
        tcp: {
          port: tcpPort,
          host: '127.0.0.1',
        },
      })

      await server.start()

      expect(server.addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port: tcpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })

    it('should mark UDP as offload when explicitly included in front-door protocols', async () => {
      const serverPort = await getFreePort()
      const frontDoorPort = await getFreePort()
      const udpPort = await getFreePort()

      server = createServer({
        port: serverPort,
        frontDoor: {
          enabled: true,
          port: frontDoorPort,
          protocols: ['http', 'udp'],
        },
      })

      server.udp
        .handler('echo', { port: udpPort, host: '127.0.0.1' })
        .onMessage(() => {})
        .end()

      await server.start()

      expect(server.addresses?.udp).toMatchObject({
        host: '127.0.0.1',
        port: udpPort,
        frontDoor: true,
        strategy: 'offload',
      })
    })
  })
})
