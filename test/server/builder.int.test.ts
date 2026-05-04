/**
 * Server Builder Tests
 *
 * Tests for the unified server API.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createConnection } from 'node:net'
import { createSocket } from 'node:dgram'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { z } from 'zod'
import { WebSocket } from 'ws'
import { createServer } from '../../src/server/builder.js'
import { createRouterModule } from '../../src/server/router-module.js'
import { createContext, type Context, type Envelope, type Interceptor } from '../../src/types/index.js'
import { registerValidator, resetValidation, createZodAdapter } from '../../src/validation/index.js'
import { loadDiscovery } from '../../src/server/fs-routes/loader.js'
import {
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
} from '../../src/middleware/interceptors/envelope.js'

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

async function sendRawPayload(port: number, payload: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(payload)
    })
    const timeout = setTimeout(() => {
      socket.end()
      reject(new Error('Raw payload response timeout'))
    }, 2000)

    const finish = (error?: Error) => {
      clearTimeout(timeout)
      if (error) {
        reject(error)
      } else {
        resolve(Buffer.concat(chunks).toString())
      }
    }

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (Buffer.concat(chunks).includes(Buffer.from('\r\n\r\n'))) {
        socket.end()
      }
    })

    socket.on('end', () => {
      finish()
    })

    socket.on('error', (error) => {
      finish(error)
    })
  })
}

function sendRawUdpPayload(port: number, payload: string | Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4')
    const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)

    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('UDP response timeout'))
    }, 2000)

    socket.once('message', (message) => {
      clearTimeout(timer)
      socket.close()
      resolve(message)
    })

    socket.once('error', (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })

    socket.send(buffer, port, '127.0.0.1', (error) => {
      if (error) {
        clearTimeout(timer)
        socket.close()
        reject(error)
      }
    })
  })
}

function encodeSinglePortTcpPayload(payload: object): Buffer {
  const data = Buffer.from(JSON.stringify(payload), 'utf-8')
  const frame = Buffer.allocUnsafe(4 + data.length)
  frame.writeUInt32BE(data.length, 0)
  data.copy(frame, 4)
  return frame
}

function receiveSinglePortTcpResponse(port: number, payload: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const frame = encodeSinglePortTcpPayload(payload)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Single-port TCP response timeout'))
    }, 5000)

    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])

      if (buffer.length < 4) {
        return
      }

      const responseLength = buffer.readUInt32BE(0)
      const totalLength = 4 + responseLength
      if (buffer.length < totalLength) {
        return
      }

      clearTimeout(timer)
      socket.off('data', onData)
      socket.destroy()

      const data = buffer.subarray(4, totalLength)
      try {
        resolve(JSON.parse(data.toString('utf-8')) as Record<string, unknown>)
      } catch (error) {
        reject(error as Error)
      }
    }

    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.on('data', onData)
    socket.on('connect', () => {
      socket.write(frame)
    })
  })
}

const GRPC_SINGLE_PORT_PROTO = `syntax = "proto3";

package demo;

service SharedGreeter {
  rpc Greet (GreetRequest) returns (GreetReply);
}

message GreetRequest { string name = 1; }
message GreetReply { string message = 1; }
`

async function createGrpcSinglePortProto(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-shared-grpc-'))
  const filePath = path.join(dir, 'shared.proto')
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, GRPC_SINGLE_PORT_PROTO, 'utf-8')
  return filePath
}

function createDynamicGrpcClient(protoPath: string, address: string): grpc.Client & Record<string, Function> {
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const proto = grpc.loadPackageDefinition(definition) as Record<string, unknown>
  const Client = ((proto.demo as Record<string, unknown>).SharedGreeter as grpc.ServiceClientConstructor)
  return new Client(address, grpc.credentials.createInsecure()) as grpc.Client & Record<string, Function>
}

async function bindTestPort(
  port: number,
  host = '127.0.0.1'
): Promise<ReturnType<typeof createHttpServer>> {
  const server = createHttpServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve(server)
    })
  })
}

function closeTestServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

function createWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function sendWebSocketEnvelope(
  ws: WebSocket,
  envelope: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket response timeout')), 5000)
    const offMessage = (data: unknown) => {
      clearTimeout(timeout)
      ws.off('message', offMessage)
      try {
        const payload = typeof data === 'string'
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data).toString()
            : data instanceof ArrayBuffer
              ? Buffer.from(data).toString()
              : Buffer.from(data as Uint8Array).toString()
        resolve(JSON.parse(payload) as Record<string, unknown>)
      } catch (error) {
        reject(error as Error)
      }
    }
    ws.on('message', offMessage)
    ws.send(JSON.stringify(envelope))
  })
}

function frontDoorStartupAddressFixture(host: string, port: number, tcpPort: number, udpPort: number) {
  return {
    http: {
      host,
      port,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    websocket: {
      host,
      port,
      path: '/ws',
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    jsonrpc: {
      host,
      port,
      path: '/rpc',
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    graphql: {
      host,
      port,
      path: '/graphql',
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    tcp: {
      host,
      port: tcpPort,
      frontDoor: true,
      strategy: 'offload' as const,
    },
    udp: {
      host,
      port: udpPort,
      frontDoor: true,
      strategy: 'offload' as const,
    },
  }
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
