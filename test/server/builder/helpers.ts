import { createSocket } from 'node:dgram'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { WebSocket } from 'ws'

export { afterEach, beforeEach, describe, expect, it } from 'vitest'
export { rm } from 'node:fs/promises'
export { z } from 'zod'
export { default as path } from 'node:path'
export { WebSocket }
export { createServer } from '../../../src/server/builder.js'
export { createRouterModule } from '../../../src/server/router-module.js'
export { registerValidator, resetValidation, createZodAdapter } from '../../../src/validation/index.js'
export { loadDiscovery } from '../../../src/server/fs-routes/loader.js'
export {
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
} from '../../../src/middleware/interceptors/envelope.js'
export * as grpc from '@grpc/grpc-js'
export type { Context, Envelope, Interceptor } from '../../../src/types/index.js'

import { createContext, type Envelope } from '../../../src/types/index.js'
export { createContext }

// Helper to create test envelope with context
export function createTestEnvelope(
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

export async function getFreePort(): Promise<number> {
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

export async function sendRawPayload(port: number, payload: string | Buffer): Promise<string> {
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

export function sendRawUdpPayload(port: number, payload: string | Buffer): Promise<Buffer> {
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

export function encodeSinglePortTcpPayload(payload: object): Buffer {
  const data = Buffer.from(JSON.stringify(payload), 'utf-8')
  const frame = Buffer.allocUnsafe(4 + data.length)
  frame.writeUInt32BE(data.length, 0)
  data.copy(frame, 4)
  return frame
}

export function receiveSinglePortTcpResponse(port: number, payload: object): Promise<Record<string, unknown>> {
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

export async function createGrpcSinglePortProto(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-shared-grpc-'))
  const filePath = path.join(dir, 'shared.proto')
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, GRPC_SINGLE_PORT_PROTO, 'utf-8')
  return filePath
}

export function createDynamicGrpcClient(protoPath: string, address: string): grpc.Client & Record<string, Function> {
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

export async function bindTestPort(
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

export function closeTestServer(server: ReturnType<typeof createHttpServer>): Promise<void> {
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

export function createWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

export function sendWebSocketEnvelope(
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

export function frontDoorStartupAddressFixture(host: string, port: number, tcpPort: number, udpPort: number) {
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

export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'raffel-channels-'))
}

export async function writeFixture(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf-8')
}

export const TEST_PORT = 24000
