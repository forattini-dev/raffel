/**
 * Server Builder Tests
 *
 * Tests for the unified server API.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'
import { createServer } from './builder.js'
import { createRouterModule } from './router-module.js'
import { createContext, type Context, type Envelope } from '../types/index.js'
import { registerValidator, resetValidation, createZodAdapter } from '../validation/index.js'
import { loadDiscovery } from './fs-routes/loader.js'

// Helper to create test envelope with context
function createTestEnvelope(
  procedure: string,
  payload: unknown = {},
  type: 'request' | 'stream:start' | 'event' = 'request'
): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    type,
    payload,
    metadata: {},
    context: createContext('test-id'),
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      server.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve(port)
        }
      })
    })
  })
}

async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'raffel-channels-'))
}

async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

const TEST_PORT = 24000

describe('createServer', () => {
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

    it('should throw error when starting already running server', async () => {
      server = createServer({ port: TEST_PORT })
      await server.start()

      await expect(server.start()).rejects.toThrow('Server is already running')
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
  })

  describe('protocol configuration', () => {
    it('should enable WebSocket', () => {
      server = createServer({ port: TEST_PORT })
      server.enableWebSocket('/ws')

      // Can't test actual WebSocket without starting, but we can verify it's configured
      expect(server).toBeDefined()
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
  })

  describe('shared protocol ports', () => {
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
})
