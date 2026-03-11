/**
 * Policy control plane integration tests
 *
 * Verifies contract-bound policy semantics across transports.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createNodeServer } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocket, type RawData } from 'ws'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createHttpAdapter } from '../../src/adapters/http.js'
import { createJsonRpcAdapter } from '../../src/adapters/jsonrpc.js'
import { createWebSocketAdapter } from '../../src/adapters/websocket.js'
import { createGrpcAdapter } from '../../src/adapters/grpc.js'

const PROTO = `syntax = "proto3";

package demo;

service Policy {
  rpc Slow (SlowRequest) returns (SlowReply);
}

message SlowRequest {}
message SlowReply { bool ok = 1; }
`

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve port')))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(address.port)
        }
      })
    })
  })
}

async function createTempProto(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-policy-'))
  await mkdir(dir, { recursive: true })
  const protoPath = path.join(dir, 'policy.proto')
  await writeFile(protoPath, PROTO, 'utf-8')
  return protoPath
}

function createGrpcClient(protoPath: string, address: string): grpc.Client & {
  Slow: (request: {}, callback: (error: grpc.ServiceError | null, response: unknown) => void) => void
} {
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const proto = grpc.loadPackageDefinition(definition) as any
  return new proto.demo.Policy(address, grpc.credentials.createInsecure())
}

function openWebSocket(url: string): Promise<WebSocket> {
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
    const timeout = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('WebSocket response timeout'))
    }, 5000)

    const onMessage = (raw: RawData) => {
      clearTimeout(timeout)
      ws.off('message', onMessage)

      try {
        const payload = typeof raw === 'string'
          ? raw
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString('utf-8')
            : Array.isArray(raw)
              ? Buffer.concat(raw).toString('utf-8')
              : Buffer.from(raw).toString('utf-8')
        resolve(JSON.parse(payload) as Record<string, unknown>)
      } catch (error) {
        reject(error as Error)
      }
    }

    ws.on('message', onMessage)
    ws.send(JSON.stringify(envelope))
  })
}

describe('policy control plane', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanup.length > 0) {
      const stop = cleanup.pop()!
      await stop()
    }
  })

  it('preserves auth policy outcomes over HTTP and JSON-RPC', async () => {
    const registry = createRegistry()
    registry.procedure('secure.echo', async () => ({ ok: true }), {
      policies: {
        auth: { mode: 'required' },
      },
    })

    const router = createRouter(registry)
    const httpPort = await getFreePort()
    const jsonrpcPort = await getFreePort()
    const http = createHttpAdapter(router, { port: httpPort, host: '127.0.0.1' })
    const jsonrpc = createJsonRpcAdapter(router, { port: jsonrpcPort, host: '127.0.0.1' })

    await http.start()
    cleanup.push(() => http.stop())
    await jsonrpc.start()
    cleanup.push(() => jsonrpc.stop())

    const httpResponse = await fetch(`http://127.0.0.1:${httpPort}/secure.echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const httpBody = await httpResponse.json() as { error: { code: string } }

    const jsonrpcResponse = await fetch(`http://127.0.0.1:${jsonrpcPort}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'secure.echo',
        params: {},
        id: 1,
      }),
    })
    const jsonrpcBody = await jsonrpcResponse.json() as {
      error?: { data?: { raffel?: { code?: string } } }
    }

    expect(httpResponse.status).toBe(401)
    expect(httpBody.error.code).toBe('UNAUTHENTICATED')
    expect(jsonrpcResponse.status).toBe(200)
    expect(jsonrpcBody.error?.data?.raffel?.code).toBe('UNAUTHENTICATED')
  })

  it('preserves timeout semantics over gRPC and WebSocket', async () => {
    const protoPath = await createTempProto()
    cleanup.push(() => rm(path.dirname(protoPath), { recursive: true, force: true }))

    const registry = createRegistry()
    registry.procedure('demo.Policy.Slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return { ok: true }
    }, {
      policies: {
        timeout: { timeoutMs: 25 },
      },
    })

    const router = createRouter(registry)
    const wsPort = await getFreePort()
    const ws = createWebSocketAdapter(router, { port: wsPort, host: '127.0.0.1' })
    const grpcAdapter = createGrpcAdapter(router, { port: 0, protoPath })

    await ws.start()
    cleanup.push(() => ws.stop())
    await grpcAdapter.start()
    cleanup.push(() => grpcAdapter.stop())

    const socket = await openWebSocket(`ws://127.0.0.1:${wsPort}`)
    cleanup.push(async () => {
      socket.close()
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    const wsResponse = await sendWebSocketEnvelope(socket, {
      id: 'slow-1',
      procedure: 'demo.Policy.Slow',
      type: 'request',
      payload: {},
    })

    const client = createGrpcClient(
      protoPath,
      `${grpcAdapter.address!.host}:${grpcAdapter.address!.port}`
    )
    cleanup.push(async () => {
      client.close()
    })

    const grpcError = await new Promise<grpc.ServiceError>((resolve, reject) => {
      client.Slow({}, (error) => {
        if (error) {
          resolve(error)
          return
        }
        reject(new Error('Expected gRPC timeout error'))
      })
    })

    expect(wsResponse.type).toBe('error')
    expect((wsResponse.payload as { code: string }).code).toBe('DEADLINE_EXCEEDED')
    expect(grpcError.code).toBe(grpc.status.DEADLINE_EXCEEDED)
  })

  it('preserves rate-limit semantics over HTTP and WebSocket', async () => {
    const registry = createRegistry()
    registry.procedure('limited.echo', async () => ({ ok: true }), {
      policies: {
        rateLimit: { windowMs: 60000, maxRequests: 1, key: 'client' },
      },
    })

    const router = createRouter(registry)
    const httpPort = await getFreePort()
    const wsPort = await getFreePort()
    const http = createHttpAdapter(router, { port: httpPort, host: '127.0.0.1' })
    const ws = createWebSocketAdapter(router, { port: wsPort, host: '127.0.0.1' })

    await http.start()
    cleanup.push(() => http.stop())
    await ws.start()
    cleanup.push(() => ws.stop())

    const httpHeaders = {
      'Content-Type': 'application/json',
      'X-Client-Id': 'http-client',
    }

    await fetch(`http://127.0.0.1:${httpPort}/limited.echo`, {
      method: 'POST',
      headers: httpHeaders,
      body: JSON.stringify({}),
    })

    const httpResponse = await fetch(`http://127.0.0.1:${httpPort}/limited.echo`, {
      method: 'POST',
      headers: httpHeaders,
      body: JSON.stringify({}),
    })
    const httpBody = await httpResponse.json() as { error: { code: string } }

    const socket = await openWebSocket(`ws://127.0.0.1:${wsPort}`)
    cleanup.push(async () => {
      socket.close()
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    await sendWebSocketEnvelope(socket, {
      id: 'rate-1',
      procedure: 'limited.echo',
      type: 'request',
      payload: {},
      metadata: { 'x-client-id': 'ws-client' },
    })
    const wsResponse = await sendWebSocketEnvelope(socket, {
      id: 'rate-2',
      procedure: 'limited.echo',
      type: 'request',
      payload: {},
      metadata: { 'x-client-id': 'ws-client' },
    })

    expect(httpResponse.status).toBe(429)
    expect(httpBody.error.code).toBe('RATE_LIMITED')
    expect(wsResponse.type).toBe('error')
    expect((wsResponse.payload as { code: string }).code).toBe('RATE_LIMITED')
  })
})
