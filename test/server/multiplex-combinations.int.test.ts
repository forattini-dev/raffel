/**
 * Single-Port Multiplex Combinations — Exhaustive Integration Tests
 *
 * Tests ALL valid combinations of protocols multiplexed on a single port.
 * Protocols under test:
 *   - HTTP   (always on, base protocol)
 *   - WS     (WebSocket — HTTP upgrade, rides on HTTP)
 *   - JSONRPC (JSON-RPC — HTTP POST to /rpc path, rides on HTTP)
 *   - TCP    (raw TCP with length-prefix framing, separate detection)
 *   - gRPC   (HTTP/2 h2c, separate detection via PRI preface)
 *
 * Each combination starts a server in singlePort mode, exercises every
 * enabled protocol, and verifies they all work without interference.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { createConnection } from 'node:net'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { WebSocket } from 'ws'
import { createServer } from '../../src/server/builder.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        if (err) reject(err)
        else resolve(port)
      })
    })
  })
}

// --- HTTP helpers ---

async function testHttp(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/ping`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body).toBe('pong')
}

// --- WebSocket helpers ---

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('WebSocket open timeout'))
    }, 5000)
    ws.once('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function sendWsEnvelope(
  ws: WebSocket,
  envelope: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket response timeout')), 5000)
    const handler = (data: unknown) => {
      clearTimeout(timeout)
      ws.off('message', handler)
      try {
        const text =
          typeof data === 'string'
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data).toString()
              : data instanceof ArrayBuffer
                ? Buffer.from(data).toString()
                : Buffer.from(data as Uint8Array).toString()
        resolve(JSON.parse(text) as Record<string, unknown>)
      } catch (error) {
        reject(error as Error)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify(envelope))
  })
}

async function testWebSocket(port: number): Promise<void> {
  const ws = await openWebSocket(`ws://127.0.0.1:${port}/ws`)
  try {
    const response = await sendWsEnvelope(ws, {
      id: 'ws-test-1',
      type: 'request',
      procedure: 'ping',
      payload: {},
    })
    expect(response.type).toBe('response')
    expect(response.procedure).toBe('ping')
  } finally {
    ws.close()
  }
}

// --- JSON-RPC helpers ---

async function testJsonRpc(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: {},
    }),
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { result: string }
  expect(body.result).toBe('pong')
}

// --- TCP helpers ---

function encodeTcpFrame(payload: object): Buffer {
  const data = Buffer.from(JSON.stringify(payload), 'utf-8')
  const frame = Buffer.allocUnsafe(4 + data.length)
  frame.writeUInt32BE(data.length, 0)
  data.copy(frame, 4)
  return frame
}

function sendTcpFrame(port: number, payload: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const frame = encodeTcpFrame(payload)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('TCP response timeout'))
    }, 5000)

    let buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])

      if (buffer.length < 4) return

      const responseLength = buffer.readUInt32BE(0)
      const totalLength = 4 + responseLength
      if (buffer.length < totalLength) return

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

async function testTcp(port: number): Promise<void> {
  const response = await sendTcpFrame(port, {
    id: 'tcp-1',
    procedure: 'ping',
    type: 'request',
    payload: {},
  })
  expect(response.procedure).toBe('ping')
  expect(response.type).toBe('response')
  expect(response.payload).toBe('pong')
}

// --- gRPC helpers ---

const GRPC_PROTO = `syntax = "proto3";

package multiplex;

service TestService {
  rpc Ping (PingRequest) returns (PingReply);
}

message PingRequest { string name = 1; }
message PingReply { string message = 1; }
`

let grpcProtoDir: string | null = null

async function getGrpcProtoPath(): Promise<string> {
  if (!grpcProtoDir) {
    grpcProtoDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-mplex-grpc-'))
  }
  const filePath = path.join(grpcProtoDir, 'multiplex.proto')
  await mkdir(grpcProtoDir, { recursive: true })
  await writeFile(filePath, GRPC_PROTO, 'utf-8')
  return filePath
}

function createGrpcClient(
  protoPath: string,
  address: string
): grpc.Client & Record<string, Function> {
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const proto = grpc.loadPackageDefinition(definition) as Record<string, unknown>
  const Client = (proto.multiplex as Record<string, unknown>)
    .TestService as grpc.ServiceClientConstructor
  return new Client(
    address,
    grpc.credentials.createInsecure()
  ) as grpc.Client & Record<string, Function>
}

async function testGrpc(port: number, protoPath: string): Promise<void> {
  const client = createGrpcClient(protoPath, `127.0.0.1:${port}`)
  try {
    const response = await new Promise<{ message: string }>((resolve, reject) => {
      client.Ping({ name: 'test' }, (err: Error | null, res: { message: string }) => {
        if (err) reject(err)
        else resolve(res)
      })
    })
    expect(response.message).toBe('pong')
  } finally {
    client.close()
  }
}

// ---------------------------------------------------------------------------
// Protocol combination types
// ---------------------------------------------------------------------------

type OptionalProtocol = 'ws' | 'jsonrpc' | 'tcp' | 'grpc'

const OPTIONAL_PROTOCOLS: OptionalProtocol[] = ['ws', 'jsonrpc', 'tcp', 'grpc']

/** Generate all subsets (power set) of the optional protocols. */
function generateCombinations(): OptionalProtocol[][] {
  const result: OptionalProtocol[][] = []
  const n = OPTIONAL_PROTOCOLS.length
  // 2^n subsets, from 0 (empty = HTTP-only) to 2^n - 1 (all protocols)
  for (let mask = 0; mask < (1 << n); mask++) {
    const combo: OptionalProtocol[] = []
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        combo.push(OPTIONAL_PROTOCOLS[i])
      }
    }
    result.push(combo)
  }
  return result
}

function comboLabel(protocols: OptionalProtocol[]): string {
  const all = ['http', ...protocols]
  return all.join(' + ')
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Single-port multiplex combinations', () => {
  let server: ReturnType<typeof createServer> | null = null
  let grpcCleanupPath: string | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
  })

  // Clean up proto files after all tests
  afterEach(async () => {
    if (grpcProtoDir) {
      await rm(grpcProtoDir, { recursive: true, force: true }).catch(() => {})
      grpcProtoDir = null
    }
  })

  const combinations = generateCombinations()

  for (const combo of combinations) {
    const hasWs = combo.includes('ws')
    const hasJsonRpc = combo.includes('jsonrpc')
    const hasTcp = combo.includes('tcp')
    const hasGrpc = combo.includes('grpc')
    const label = comboLabel(combo)

    describe(label, () => {
      it(
        'all enabled protocols work on a single port without interference',
        { timeout: 15000 },
        async () => {
          const port = await getFreePort()
          let protoPath: string | undefined

          // Build server options
          const singlePortProtocols: string[] = ['http']
          if (hasTcp) singlePortProtocols.push('tcp')
          if (hasGrpc) singlePortProtocols.push('grpc')

          const options: Parameters<typeof createServer>[0] = {
            port,
            host: '127.0.0.1',
            singlePort: {
              protocolFusion: true,
              protocols: singlePortProtocols,
            },
          }

          if (hasWs) {
            options.websocket = { path: '/ws' }
          }

          if (hasJsonRpc) {
            options.jsonrpc = { path: '/rpc' }
          }

          if (hasTcp) {
            options.tcp = { port, host: '127.0.0.1' }
          }

          if (hasGrpc) {
            protoPath = await getGrpcProtoPath()
            options.grpc = {
              port,
              host: '127.0.0.1',
              protoPath,
              packageName: 'multiplex',
              serviceNames: ['TestService'],
            }
          }

          server = createServer(options)

          // Register a universal 'ping' procedure
          server.procedure('ping').handler(async () => 'pong')

          // For gRPC we also need to handle Ping via the grpc service mapping
          // gRPC maps service methods to procedures like "multiplex.TestService.Ping"
          server.procedure('multiplex.TestService.Ping').handler(async (input: any) => {
            return { message: 'pong' }
          })

          await server.start()

          // Test HTTP (always)
          await testHttp(port)

          // Test WebSocket
          if (hasWs) {
            await testWebSocket(port)
          }

          // Test JSON-RPC
          if (hasJsonRpc) {
            await testJsonRpc(port)
          }

          // Test TCP
          if (hasTcp) {
            await testTcp(port)
          }

          // Test gRPC
          if (hasGrpc && protoPath) {
            await testGrpc(port, protoPath)
          }
        },
      )

      // Cross-protocol interference test: run each protocol twice in interleaved order
      if (combo.length >= 2) {
        it(
          'protocols do not interfere when used in interleaved order',
          { timeout: 20000 },
          async () => {
            const port = await getFreePort()
            let protoPath: string | undefined

            const singlePortProtocols: string[] = ['http']
            if (hasTcp) singlePortProtocols.push('tcp')
            if (hasGrpc) singlePortProtocols.push('grpc')

            const options: Parameters<typeof createServer>[0] = {
              port,
              host: '127.0.0.1',
              singlePort: {
                protocolFusion: true,
                protocols: singlePortProtocols,
              },
            }

            if (hasWs) options.websocket = { path: '/ws' }
            if (hasJsonRpc) options.jsonrpc = { path: '/rpc' }
            if (hasTcp) options.tcp = { port, host: '127.0.0.1' }
            if (hasGrpc) {
              protoPath = await getGrpcProtoPath()
              options.grpc = {
                port,
                host: '127.0.0.1',
                protoPath,
                packageName: 'multiplex',
                serviceNames: ['TestService'],
              }
            }

            server = createServer(options)
            server.procedure('ping').handler(async () => 'pong')
            server.procedure('multiplex.TestService.Ping').handler(async () => ({ message: 'pong' }))

            await server.start()

            // Build ordered test functions for enabled protocols
            const tests: Array<() => Promise<void>> = []
            tests.push(() => testHttp(port))
            if (hasWs) tests.push(() => testWebSocket(port))
            if (hasJsonRpc) tests.push(() => testJsonRpc(port))
            if (hasTcp) tests.push(() => testTcp(port))
            if (hasGrpc && protoPath) {
              const pp = protoPath
              tests.push(() => testGrpc(port, pp))
            }

            // Round 1: forward order
            for (const test of tests) {
              await test()
            }

            // Round 2: reverse order
            for (const test of [...tests].reverse()) {
              await test()
            }
          },
        )
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Concurrent protocol access
  // ---------------------------------------------------------------------------

  describe('concurrent access across all protocols', () => {
    it(
      'handles simultaneous requests on HTTP + WS + JSON-RPC + TCP + gRPC',
      { timeout: 15000 },
      async () => {
        const port = await getFreePort()
        const protoPath = await getGrpcProtoPath()

        server = createServer({
          port,
          host: '127.0.0.1',
          singlePort: {
            protocolFusion: true,
            protocols: ['http', 'tcp', 'grpc'],
          },
          websocket: { path: '/ws' },
          jsonrpc: { path: '/rpc' },
          tcp: { port, host: '127.0.0.1' },
          grpc: {
            port,
            host: '127.0.0.1',
            protoPath,
            packageName: 'multiplex',
            serviceNames: ['TestService'],
          },
        })

        server.procedure('ping').handler(async () => 'pong')
        server.procedure('multiplex.TestService.Ping').handler(async () => ({ message: 'pong' }))

        await server.start()

        // Fire all protocols concurrently
        await Promise.all([
          testHttp(port),
          testWebSocket(port),
          testJsonRpc(port),
          testTcp(port),
          testGrpc(port, protoPath),
        ])
      },
    )
  })

  // ---------------------------------------------------------------------------
  // Address metadata verification
  // ---------------------------------------------------------------------------

  describe('address metadata', () => {
    it('all protocols report singlePort source and shared port', async () => {
      const port = await getFreePort()
      const protoPath = await getGrpcProtoPath()

      server = createServer({
        port,
        host: '127.0.0.1',
        singlePort: {
          protocolFusion: true,
          protocols: ['http', 'tcp', 'grpc'],
        },
        websocket: { path: '/ws' },
        jsonrpc: { path: '/rpc' },
        tcp: { port, host: '127.0.0.1' },
        grpc: {
          port,
          host: '127.0.0.1',
          protoPath,
          packageName: 'multiplex',
          serviceNames: ['TestService'],
        },
      })

      server.procedure('ping').handler(async () => 'pong')
      server.procedure('multiplex.TestService.Ping').handler(async () => ({ message: 'pong' }))

      await server.start()

      const addresses = server.addresses

      // HTTP always present
      expect(addresses?.http).toMatchObject({
        host: '127.0.0.1',
        port,
      })

      // WebSocket shares the HTTP port
      expect(addresses?.websocket).toMatchObject({
        host: '127.0.0.1',
        port,
        path: '/ws',
        shared: true,
      })

      // JSON-RPC shares the HTTP port
      expect(addresses?.jsonrpc).toMatchObject({
        host: '127.0.0.1',
        port,
        path: '/rpc',
        shared: true,
      })

      // TCP on single port
      expect(addresses?.tcp).toMatchObject({
        host: '127.0.0.1',
        port,
        source: 'singlePort',
      })

      // gRPC on single port
      expect(addresses?.grpc).toMatchObject({
        host: '127.0.0.1',
        port,
        source: 'singlePort',
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Clean shutdown under active connections
  // ---------------------------------------------------------------------------

  describe('clean shutdown', () => {
    it('server stops cleanly after multi-protocol activity', async () => {
      const port = await getFreePort()

      server = createServer({
        port,
        host: '127.0.0.1',
        singlePort: {
          protocolFusion: true,
          protocols: ['http', 'tcp'],
        },
        websocket: { path: '/ws' },
        jsonrpc: { path: '/rpc' },
        tcp: { port, host: '127.0.0.1' },
      })

      server.procedure('ping').handler(async () => 'pong')

      await server.start()
      expect(server.isRunning).toBe(true)

      // Exercise all protocols
      await testHttp(port)
      await testWebSocket(port)
      await testJsonRpc(port)
      await testTcp(port)

      // Clean stop
      await server.stop()
      expect(server.isRunning).toBe(false)
      server = null
    })
  })
})
