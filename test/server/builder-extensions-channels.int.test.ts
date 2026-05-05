/**
 * Server Builder Tests: protocol extensions, channel auth discovery, and fluent profiles
 */

import {
  afterEach,
  beforeEach,
  createServer,
  createContext,
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

describe('createServer: protocol extensions, channel auth discovery, and fluent profiles', () => {

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

  describe('protocol extensions', () => {
    it('should start and stop custom protocol adapters', async () => {
      const port = await getFreePort()
      let started = false
      let stopped = false
      let receivedOptions: unknown = null

      server = createServer({
        port,
        protocolExtensions: [
          {
            name: 'custom',
            options: { mode: 'test' },
            factory: async (ctx, options) => {
              receivedOptions = options
              return {
                async start() {
                  started = true
                },
                async stop() {
                  stopped = true
                },
                address: {
                  host: ctx.host,
                  port: ctx.port,
                  path: '/custom',
                  shared: true,
                },
              }
            },
          },
        ],
      })

      await server.start()

      expect(started).toBe(true)
      expect(receivedOptions).toEqual({ mode: 'test' })
      expect(server.addresses?.protocols?.custom?.path).toBe('/custom')
      expect(server.addresses?.protocols?.custom?.port).toBe(port)

      await server.stop()
      expect(stopped).toBe(true)
    })
  })

  describe('channel auth discovery', () => {
    let tempDir: string | null = null

    afterEach(async () => {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true })
        tempDir = null
      }
    })

    it('should apply the closest _auth config for optional channels', async () => {
      tempDir = await createTempDir()

      await writeFixture(
        tempDir,
        'src/channels/_auth.js',
        `export default { anonymous: { principal: 'root-guest' } }\n`
      )

      await writeFixture(
        tempDir,
        'src/channels/private/_auth.js',
        `export default { anonymous: { principal: 'private-guest' } }\n`
      )

      await writeFixture(
        tempDir,
        'src/channels/private/room.js',
        `export const auth = 'optional'\n`
      )

      const discovery = await loadDiscovery({
        baseDir: tempDir,
        discovery: { channels: true },
        extensions: ['.js'],
      })

      const port = await getFreePort()
      let observedAuth: Context['auth'] | undefined

      server = createServer({
        port,
        websocket: {
          channels: {
            authorize: async (_socketId, _channel, ctx) => {
              observedAuth = ctx.auth
              return true
            },
          },
        },
      })

      server.addDiscovery(discovery)
      await server.start()

      const ctx = createContext('socket-test')
      const result = await server.channels!.subscribe('socket-1', 'private/room', ctx)

      expect(result.success).toBe(true)
      expect(observedAuth?.principal).toBe('private-guest')
    })

    it('should enforce auth for required channels with _auth config', async () => {
      tempDir = await createTempDir()

      await writeFixture(
        tempDir,
        'src/channels/_auth.js',
        `export default { anonymous: { principal: 'guest' } }\n`
      )

      await writeFixture(
        tempDir,
        'src/channels/secure.js',
        `export const auth = 'required'\n`
      )

      const discovery = await loadDiscovery({
        baseDir: tempDir,
        discovery: { channels: true },
        extensions: ['.js'],
      })

      const port = await getFreePort()

      server = createServer({
        port,
        websocket: { channels: {} },
      })

      server.addDiscovery(discovery)
      await server.start()

      const ctx = createContext('socket-test')
      const result = await server.channels!.subscribe('socket-1', 'secure', ctx)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
    })
  })

  describe('accessors', () => {
    it('should provide access to registry', () => {
      server = createServer({ port: TEST_PORT })
      expect(server.registry).toBeDefined()
    })

    it('should provide access to router', () => {
      server = createServer({ port: TEST_PORT })
      expect(server.router).toBeDefined()
    })
  })

  // ===== withProtocols() =====

  describe('withProtocols()', () => {
    it('should enable websocket via { enabled: true, path }', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ websocket: { enabled: true, path: '/ws' } })
      const preview = server.previewConfig()
      expect(preview.protocols.websocket?.enabled).toBe(true)
    })

    it('should skip websocket when enabled: false', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ websocket: { enabled: false } })
      const preview = server.previewConfig()
      expect(preview.protocols.websocket).toBeUndefined()
    })

    it('should enable websocket via boolean true', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ websocket: true })
      const preview = server.previewConfig()
      expect(preview.protocols.websocket?.enabled).toBe(true)
    })

    it('should enable jsonrpc via boolean true', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ jsonrpc: true })
      const preview = server.previewConfig()
      expect(preview.protocols.jsonrpc?.enabled).toBe(true)
    })

    it('should enable graphql via boolean true', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ graphql: true })
      const preview = server.previewConfig()
      expect(preview.protocols.graphql?.enabled).toBe(true)
    })

    it('should skip tcp when enabled: false', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ tcp: { enabled: false } })
      const preview = server.previewConfig()
      expect(preview.protocols.tcp).toBeUndefined()
    })

    it('should enable tcp via options object', () => {
      server = createServer({ port: TEST_PORT })
        .withProtocols({ tcp: { port: 9000 } })
      const preview = server.previewConfig()
      expect(preview.protocols.tcp?.enabled).toBe(true)
    })

    it('should work after withPreset (last call wins)', () => {
      server = createServer({ port: TEST_PORT })
        .withPreset('api')
        .withProtocols({ tcp: { port: 9000 } })
      const preview = server.previewConfig()
      expect(preview.protocols.websocket?.enabled).toBe(true)
      expect(preview.protocols.jsonrpc?.enabled).toBe(true)
      expect(preview.protocols.tcp?.enabled).toBe(true)
    })
  })

  // ===== withProfile() =====

  describe('withProfile()', () => {
    it('should set protocolAliasMode to extended for local profile', () => {
      server = createServer({ port: TEST_PORT, singlePort: true })
        .withProfile('local')
      const preview = server.previewConfig()
      expect(preview.singlePort.protocolAliasMode).toBe('extended')
    })

    it('should set protocolAliasMode to standard for staging profile', () => {
      server = createServer({ port: TEST_PORT, singlePort: { enabled: true, protocolAliasMode: 'extended' } })
        .withProfile('staging')
      const preview = server.previewConfig()
      expect(preview.singlePort.protocolAliasMode).toBe('standard')
    })

    it('should set protocolAliasMode to standard for production profile', () => {
      server = createServer({ port: TEST_PORT, singlePort: true })
        .withProfile('production')
      const preview = server.previewConfig()
      expect(preview.singlePort.protocolAliasMode).toBe('standard')
    })

    it('should apply protocol overrides when passed to withProfile', () => {
      server = createServer({ port: TEST_PORT })
        .withProfile('local', { protocols: { tcp: { port: 9000 } } })
      const preview = server.previewConfig()
      expect(preview.protocols.tcp?.enabled).toBe(true)
    })

    it('should return server for chaining', () => {
      server = createServer({ port: TEST_PORT })
      const result = server.withProfile('staging')
      expect(result).toBe(server)
    })
  })
})
