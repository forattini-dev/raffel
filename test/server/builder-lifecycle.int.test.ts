/**
 * Server Builder Tests: basic lifecycle and registration
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

describe('createServer: basic lifecycle and registration', () => {

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

  describe('basic lifecycle', () => {
    it('should create a server with default options', () => {
      server = createServer({ port: TEST_PORT })
      expect(server).toBeDefined()
      expect(server.isRunning).toBe(false)
    })

    it('should start and stop the server', async () => {
      server = createServer({ port: TEST_PORT })

      expect(server.isRunning).toBe(false)

      await server.start()
      expect(server.isRunning).toBe(true)
      expect(server.addresses).toBeDefined()
      expect(server.addresses?.http.port).toBe(TEST_PORT)

      await server.stop()
      expect(server.isRunning).toBe(false)
    })

    it('should restart the server', async () => {
      server = createServer({ port: TEST_PORT })

      await server.start()
      expect(server.isRunning).toBe(true)

      await server.restart()
      expect(server.isRunning).toBe(true)
    })

    it('should execute custom http middleware before the default procedure routing', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        http: {
          middleware: [
            async (req, res) => {
              if (req.method !== 'POST' || req.url !== '/teapot') {
                return false
              }

              res.statusCode = 418
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ intercepted: true }))
              return true
            },
          ],
        },
      })

      server.procedure('teapot').handler(async () => 'brewed')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/teapot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(418)
      expect(await response.json()).toEqual({ intercepted: true })
    })

    it('should restart the server with shared GraphQL and MCP middleware', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        basePath: '/api',
        graphql: true,
        mcp: true,
      })

      server
        .procedure('getHello')
        .description('Return a greeting')
        .output(z.string())
        .handler(async () => 'world')

      await server.start()
      await server.restart()

      const gqlResponse = await fetch(`http://127.0.0.1:${port}/api/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ getHello }' }),
      })

      expect(gqlResponse.status).toBe(200)
      const gqlBody = (await gqlResponse.json()) as { data: { getHello: string } }
      expect(gqlBody.data).toEqual({ getHello: 'world' })

      const mcpResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      })

      expect(mcpResponse.status).toBe(200)
      const mcpBody = (await mcpResponse.json()) as {
        result: { tools: Array<{ name: string }> }
      }
      const toolNames = mcpBody.result.tools.map((tool) => tool.name)
      expect(toolNames).toContain('getHello')
    })

    it('should throw error when starting already running server', async () => {
      server = createServer({ port: TEST_PORT })
      await server.start()

      await expect(server.start()).rejects.toThrow('Server is already running')
    })
  })

  describe('providers and preview warnings', () => {
    it('should resolve provider dependencies through ctx.services and keep compatibility aliases', async () => {
      server = createServer({ port: TEST_PORT })
        .provide('config', () => ({ prefix: 'Hello' }))
        .provide('greeter', ({ config }) => {
          const resolvedConfig = config as { prefix: string }
          return {
            greet(name: string) {
              return `${resolvedConfig.prefix}, ${name}!`
            },
          }
        })

      server.procedure('greet', async (input: { name: string }, ctx) => {
        const services = ctx.services as {
          config: { prefix: string }
          greeter: { greet: (name: string) => string }
        }

        return {
          message: services.greeter.greet(input.name),
          prefix: services.config.prefix,
          legacyGreeter: Boolean((ctx as Record<string, unknown>).greeter),
        }
      })

      await server.start()

      const result = (await server.router.handle(
        createTestEnvelope('greet', { name: 'Ada' })
      )) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toEqual({
        message: 'Hello, Ada!',
        prefix: 'Hello',
        legacyGreeter: true,
      })
    })

    it('should warn when providers rely on compatibility mirroring', () => {
      server = createServer({ port: TEST_PORT })
        .provide('config', () => ({ prefix: 'hello' }))

      const preview = server.previewConfig()

      expect(preview.warnings.join('\n')).toContain('Prefer ctx.services in new handlers')
    })

    it('should warn when front-door routing is enabled without trusted proxies', () => {
      server = createServer({
        port: TEST_PORT,
        frontDoor: { enabled: true },
      })

      const preview = server.previewConfig()

      expect(preview.warnings.join('\n')).toContain('without http.trustedProxies')
    })

    it('should warn when front-door routing uses wildcard CORS', () => {
      server = createServer({
        port: TEST_PORT,
        frontDoor: { enabled: true },
        cors: true,
      })

      const preview = server.previewConfig()

      expect(preview.warnings.join('\n')).toContain('wildcard CORS')
    })
  })

  describe('registerHandler() — single high-leverage entry point', () => {
    it('registers a procedure when kind defaults to procedure', async () => {
      server = createServer({ port: TEST_PORT })
      server.registerHandler('users.get', async (input: { id: string }) => ({ id: input.id }), {
        input: z.object({ id: z.string() }),
      })
      expect(server.registry.getProcedure('users.get')).toBeDefined()
    })

    it('routes kind: stream to addStream', async () => {
      server = createServer({ port: TEST_PORT })
      async function* stream() { yield 1; yield 2 }
      server.registerHandler('counter', stream as never, { kind: 'stream', direction: 'server' })
      expect(server.registry.getStream('counter')).toBeDefined()
    })

    it('routes kind: event to addEvent', async () => {
      server = createServer({ port: TEST_PORT })
      server.registerHandler('order.placed', async () => undefined, {
        kind: 'event',
        delivery: 'best-effort',
      })
      expect(server.registry.getEvent('order.placed')).toBeDefined()
    })

    it('returns the server for chaining', () => {
      server = createServer({ port: TEST_PORT })
      const result = server.registerHandler('a', async () => 1)
      expect(result).toBe(server)
    })
  })

  describe('fluent procedure registration', () => {
    it('should register a procedure with fluent API', async () => {
      server = createServer({ port: TEST_PORT })

      server
        .procedure('users.create')
        .input(z.object({ name: z.string() }))
        .output(z.object({ id: z.string() }))
        .description('Create a new user')
        .handler(async (input) => {
          return { id: `user-${input.name}` }
        })

      expect(server.registry.getProcedure('users.create')).toBeDefined()
    })

    it('should register a procedure with interceptor', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []
      const interceptor = async (
        _envelope: any,
        _ctx: any,
        next: () => Promise<unknown>
      ) => {
        calls.push('before')
        const result = await next()
        calls.push('after')
        return result
      }

      server
        .procedure('test')
        .use(interceptor)
        .handler(async () => {
          calls.push('handler')
          return 'done'
        })

      // Call the procedure directly via router
      const result = (await server.router.handle(createTestEnvelope('test'))) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toBe('done')
      expect(calls).toEqual(['before', 'handler', 'after'])
    })

    it('should validate input with schema', async () => {
      server = createServer({ port: TEST_PORT })

      server
        .procedure('validate')
        .input(z.object({ age: z.number().min(0) }))
        .handler(async (input) => {
          return { age: input.age }
        })

      // Valid input
      const validResult = (await server.router.handle(createTestEnvelope('validate', { age: 25 }))) as Envelope

      expect(validResult.type).toBe('response')
      expect(validResult.payload).toEqual({ age: 25 })

      // Invalid input
      const invalidResult = (await server.router.handle(createTestEnvelope('validate', { age: -5 }))) as Envelope

      expect(invalidResult.type).toBe('error')
    })

    it('should attach contract policy metadata through builders', () => {
      server = createServer({ port: TEST_PORT })

      server
        .procedure('secure.echo')
        .policy({
          auth: { mode: 'required', roles: ['admin'] },
          timeout: { timeoutMs: 250 },
          rateLimit: { windowMs: 1000, maxRequests: 5, key: 'client' },
        })
        .handler(async () => ({ ok: true }))

      server
        .stream('updates.feed')
        .policy({
          rateLimit: { windowMs: 5000, maxRequests: 3 },
        })
        .handler(async function* () {
          yield { ok: true }
        })

      server
        .event('audit.created')
        .policy({
          auth: { mode: 'optional' },
        })
        .handler(async () => {})

      expect(server.registry.getProcedure('secure.echo')?.meta.policies).toMatchObject({
        auth: { mode: 'required', roles: ['admin'] },
        timeout: { timeoutMs: 250 },
        rateLimit: { windowMs: 1000, maxRequests: 5, key: 'client' },
      })
      expect(server.registry.getStream('updates.feed')?.meta.policies).toMatchObject({
        rateLimit: { windowMs: 5000, maxRequests: 3 },
      })
      expect(server.registry.getEvent('audit.created')?.meta.policies).toMatchObject({
        auth: { mode: 'optional' },
      })
    })
  })

  describe('handler groups', () => {
    it('should create grouped procedures', async () => {
      server = createServer({ port: TEST_PORT })

      const users = server.group('users')

      users.procedure('create').handler(async () => ({ id: '1' }))
      users.procedure('get').handler(async () => ({ name: 'John' }))
      users.procedure('list').handler(async () => [])

      expect(server.registry.getProcedure('users.create')).toBeDefined()
      expect(server.registry.getProcedure('users.get')).toBeDefined()
      expect(server.registry.getProcedure('users.list')).toBeDefined()
    })

    it('should inherit middleware from group', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []
      const groupMiddleware = async (
        _envelope: any,
        _ctx: any,
        next: () => Promise<unknown>
      ) => {
        calls.push('group-middleware')
        return next()
      }

      const users = server.group('users').use(groupMiddleware)

      users.procedure('test').handler(async () => {
        calls.push('handler')
        return 'done'
      })

      await server.router.handle(createTestEnvelope('users.test'))

      expect(calls).toEqual(['group-middleware', 'handler'])
    })

    it('should support nested groups', async () => {
      server = createServer({ port: TEST_PORT })

      const users = server.group('users')
      const admin = users.group('admin')

      admin.procedure('ban').handler(async () => ({ banned: true }))
      admin.procedure('unban').handler(async () => ({ banned: false }))

      expect(server.registry.getProcedure('users.admin.ban')).toBeDefined()
      expect(server.registry.getProcedure('users.admin.unban')).toBeDefined()
    })

    it('should inherit middleware through nested groups', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []

      const users = server.group('users').use(async (_env, _ctx, next) => {
        calls.push('users-mw')
        return next()
      })

      const admin = users.group('admin').use(async (_env, _ctx, next) => {
        calls.push('admin-mw')
        return next()
      })

      admin.procedure('action').handler(async () => {
        calls.push('handler')
        return 'done'
      })

      await server.router.handle(createTestEnvelope('users.admin.action'))

      expect(calls).toEqual(['users-mw', 'admin-mw', 'handler'])
    })
  })

  describe('router modules', () => {
    it('should mount a module with prefix', async () => {
      server = createServer({ port: TEST_PORT })

      const users = createRouterModule('users')
      users.procedure('create').handler(async () => ({ id: '1' }))

      server.mount('admin', users)

      expect(server.registry.getProcedure('admin.users.create')).toBeDefined()
    })

    it('should compose prefixes across nested module groups', async () => {
      server = createServer({ port: TEST_PORT })

      const users = createRouterModule('users')
      const admin = users.group('admin')
      admin.procedure('ban').handler(async () => ({ banned: true }))

      server.mount('api', users)

      expect(server.registry.getProcedure('api.users.admin.ban')).toBeDefined()
    })

    it('should apply interceptors in deterministic order', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []
      const record = (label: string) => async (_env: any, _ctx: any, next: () => Promise<unknown>) => {
        calls.push(label)
        return next()
      }

      server.use(record('global'))

      const module = createRouterModule('users').use(record('module'))
      module
        .procedure('action')
        .use(record('handler'))
        .handler(async () => {
          calls.push('handler-fn')
          return 'ok'
        })

      server.mount('admin', module, { interceptors: [record('mount')] })

      await server.router.handle(createTestEnvelope('admin.users.action'))

      expect(calls).toEqual(['global', 'mount', 'module', 'handler', 'handler-fn'])
    })
  })

  describe('global middleware', () => {
    it('should apply global middleware to all procedures', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []

      server.use(async (_env, _ctx, next) => {
        calls.push('global')
        return next()
      })

      server.procedure('test1').handler(async () => {
        calls.push('handler1')
        return 'done1'
      })

      server.procedure('test2').handler(async () => {
        calls.push('handler2')
        return 'done2'
      })

      await server.router.handle(createTestEnvelope('test1'))

      calls.length = 0

      await server.router.handle(createTestEnvelope('test2'))

      expect(calls).toEqual(['global', 'handler2'])
    })

    it('should persist grpc namespace middleware across getter accesses', async () => {
      server = createServer({ port: TEST_PORT })

      const calls: string[] = []

      server.grpcNs.use(async (_env, _ctx, next) => {
        calls.push('grpc')
        return next()
      })

      server.grpcNs
        .service('UserService', { packageName: 'pkg' })
        .method('GetUser', async () => {
          calls.push('handler')
          return { id: 'user-1' }
        })
        .end()

      const result = await server.router.handle(createTestEnvelope('pkg.UserService.GetUser'))
      expect(result).toMatchObject({
        type: 'response',
        payload: { id: 'user-1' },
      })
      expect(calls).toEqual(['grpc', 'handler'])
    })

    it('should apply websocket namespace middleware only to websocket envelopes', async () => {
      const port = await getFreePort()
      let ws: WebSocket | null = null
      server = createServer({
        port,
        host: '127.0.0.1',
        websocket: { path: '/ws' },
      })

      const calls: string[] = []

      server.ws.use(async (envelope, ctx, next) => {
        calls.push(`ws:${ctx.ws?.kind}:${envelope.procedure}`)
        const result = await next()
        calls.push('ws:after')
        return result
      })

      server
        .procedure('ping')
        .http('/ping', 'POST')
        .handler(async () => {
          calls.push('handler')
          return 'pong'
        })

      await server.start()

      ws = await createWebSocket(`ws://127.0.0.1:${port}/ws`)
      const wsResponse = await sendWebSocketEnvelope(ws, {
        id: 'ws-1',
        type: 'request',
        procedure: 'ping',
        payload: {},
      })

      expect(wsResponse.type).toBe('response')
      expect(calls).toEqual(['ws:websocket:ping', 'handler', 'ws:after'])

      calls.length = 0

      const httpResponse = await fetch(`http://127.0.0.1:${port}/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(httpResponse.status).toBe(200)
      expect(calls).toEqual(['handler'])

      ws.close()
    })
  })

  describe('envelope option', () => {
    it('should bypass envelope when explicitly disabled', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        envelope: false,
      })

      server
        .procedure('raw')
        .handler(async () => ({ status: 'raw' }))

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/raw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { status?: string; success?: boolean }

      expect(body.status).toBe('raw')
      expect(body.success).toBeUndefined()
    })

    it('should wrap successful HTTP response when envelope is enabled', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        envelope: true,
      })

      server
        .procedure('hello')
        .output(z.string())
        .handler(async () => 'world')

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/hello`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        data: string
        meta: {
          requestId?: string
          timestamp?: string
          duration?: number
        }
      }

      expect(body.success).toBe(true)
      expect(body.data).toBe('world')
      expect(body.meta.requestId).toBeTypeOf('string')
      expect(body.meta.timestamp).toBeTypeOf('string')
      expect(body.meta.duration).toBeTypeOf('number')
    })

    it('should respect custom envelope config in standard integration', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        envelope: {
          includeRequestId: false,
          includeDuration: false,
          includeTimestamp: false,
          includeErrorDetails: false,
        },
      })

      server
        .procedure('ping')
        .handler(async () => ({ status: 'ok' }))

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        data: { status: string }
        meta: Record<string, unknown>
      }

      expect(body.success).toBe(true)
      expect(body.data.status).toBe('ok')
      expect(body.meta.requestId).toBeUndefined()
      expect(body.meta.timestamp).toBeUndefined()
      expect(body.meta.duration).toBeUndefined()
    })

    it('should support minimal preset via middleware', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        middleware: [createMinimalEnvelopeInterceptor()],
      })

      server
        .procedure('compact')
        .handler(async () => ({ message: 'ok' }))

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/compact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        data: { message: string }
        meta: Record<string, unknown>
      }

      expect(body.success).toBe(true)
      expect(body.data).toEqual({ message: 'ok' })
      expect(body.meta).toEqual({})
    })

    it('should support standard preset via middleware', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        middleware: [createStandardEnvelopeInterceptor()],
      })

      server
        .procedure('preset')
        .handler(async () => ({ message: 'ok' }))

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/preset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        data: { message: string }
        meta: {
          requestId: string
          timestamp: string
          duration: number
        }
      }

      expect(body.success).toBe(true)
      expect(body.data).toEqual({ message: 'ok' })
      expect(body.meta.requestId).toBeTypeOf('string')
      expect(body.meta.timestamp).toBeTypeOf('string')
      expect(body.meta.duration).toBeTypeOf('number')
    })

    it('should wrap errors using custom envelope config', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        envelope: {
          includeErrorDetails: true,
          includeRequestId: false,
        },
      })

      server
        .procedure('fail')
        .handler(async () => {
          const error = new Error('Invalid operation')
          ;(error as { code?: string }).code = 'INVALID_OPERATION'
          throw error
        })

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/fail`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        error: {
          message: string
          code: string
          details?: unknown
        }
      }

      expect(body.success).toBe(false)
      expect(body.error.message).toBe('Invalid operation')
      expect(body.error.code).toBe('INVALID_OPERATION')
    })

    it('should return envelope error payload for invalid input', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        envelope: true,
      })

      server
        .procedure('validateAndWrap')
        .input(z.object({ age: z.number().min(0).max(120) }))
        .handler(async (input) => {
          return `${input.age}`
        })

      await server.start()

      const response = await fetch(`http://127.0.0.1:${port}/validateAndWrap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ age: -1 }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        success: boolean
        error: {
          code: string
          message: string
          details?: unknown
        }
      }

      expect(body.success).toBe(false)
      expect(body.error.code).toBe('VALIDATION_ERROR')
      expect(body.error.message).toBe('Input validation failed')
    })
  })

  describe('direct registration (backwards compatible)', () => {
    it('should support direct procedure registration', async () => {
      server = createServer({ port: TEST_PORT })

      server.procedure('legacy', async () => 'legacy-result')

      const result = (await server.router.handle(
        createTestEnvelope('legacy')
      )) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toBe('legacy-result')
    })

    it('should route direct procedure registration through the canonical procedure pipeline', async () => {
      server = createServer({ port: TEST_PORT, basePath: '/api' })
      const calls: string[] = []

      const directInterceptor: Interceptor = async (_env, _ctx, next) => {
        calls.push('direct')
        return next()
      }

      server.use(async (_env, _ctx, next) => {
        calls.push('global')
        return next()
      })

      server.procedure(
        'legacy.typed',
        async (input: { name: string }) => ({ greeting: `hi ${input.name}` }),
        {
          summary: 'Legacy typed',
          description: 'Legacy direct registration',
          inputSchema: z.object({ name: z.string() }),
          outputSchema: z.object({ greeting: z.string() }),
          httpPath: '/legacy/typed',
          httpMethod: 'POST',
          interceptors: [directInterceptor],
        }
      )

      const result = (await server.router.handle(
        createTestEnvelope('legacy.typed', { name: 'Ada' })
      )) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toEqual({ greeting: 'hi Ada' })
      expect(calls).toEqual(['global', 'direct'])

      const invalidResult = (await server.router.handle(
        createTestEnvelope('legacy.typed', { name: 123 })
      )) as Envelope

      expect(invalidResult.type).toBe('error')

      const preview = server.preview()
      const operation = preview.operations.find((entry) => entry.name === 'legacy.typed')

      expect(operation).toMatchObject({
        name: 'legacy.typed',
        summary: 'Legacy typed',
        description: 'Legacy direct registration',
      })
      expect(operation?.schema.input.present).toBe(true)
      expect(operation?.schema.output.present).toBe(true)
      expect(operation?.transports).toEqual(expect.arrayContaining([
        expect.objectContaining({
          protocol: 'http',
          mode: 'rest',
          method: 'POST',
          path: '/api/legacy/typed',
        }),
      ]))
    })
  })
})
