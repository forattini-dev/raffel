/**
 * gRPC Adapter Tests
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { createRegistry } from '../core/registry.js'
import { createRouter } from '../core/router.js'
import { createGrpcAdapter } from './grpc.js'
import type { ClientStreamHandler } from '../types/handlers.js'

const PROTO = `syntax = "proto3";

package demo;

service Raffel {
  rpc Greet (GreetRequest) returns (GreetReply);
  rpc Numbers (NumbersRequest) returns (stream NumbersReply);
  rpc Sum (stream SumRequest) returns (SumReply);
  rpc Chat (stream ChatMessage) returns (stream ChatMessage);
}

message GreetRequest { string name = 1; }
message GreetReply { string message = 1; }
message NumbersRequest { int32 count = 1; }
message NumbersReply { int32 value = 1; }
message SumRequest { int32 value = 1; }
message SumReply { int32 total = 1; }
message ChatMessage { string text = 1; }
`

async function createTempProto(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-grpc-'))
  const filePath = path.join(dir, 'demo.proto')
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, PROTO, 'utf-8')
  return filePath
}

function createClient(protoPath: string, address: string): any {
  const definition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })

  const proto = grpc.loadPackageDefinition(definition) as any
  const Client = proto.demo.Raffel
  return new Client(address, grpc.credentials.createInsecure())
}

/**
 * Dynamic gRPC client type - methods are generated from proto
 */
interface DynamicGrpcClient extends grpc.Client {
  Greet: (request: { name: string }, callback: (err: Error | null, response: unknown) => void) => void
  Numbers: (request: { count: number }) => grpc.ClientReadableStream<{ value: number }>
  Sum: (callback: (err: Error | null, response: unknown) => void) => grpc.ClientWritableStream<{ value: number }>
  Chat: () => grpc.ClientDuplexStream<{ text: string }, { text: string }>
}

describe('gRPC adapter', () => {
  let protoPath: string | null = null
  let adapter: ReturnType<typeof createGrpcAdapter> | null = null
  let client: DynamicGrpcClient | null = null

  afterEach(async () => {
    if (client) {
      client.close()
      client = null
    }
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
    if (protoPath) {
      await rm(path.dirname(protoPath), { recursive: true, force: true })
      protoPath = null
    }
  })

  it('handles unary calls', async () => {
    protoPath = await createTempProto()

    const registry = createRegistry()
    registry.procedure('demo.Raffel.Greet', async (input: { name: string }) => {
      return { message: `Hello, ${input.name}!` }
    })

    const router = createRouter(registry)
    adapter = createGrpcAdapter(router, { port: 0, protoPath })
    await adapter.start()

    const address = adapter.address!
    client = createClient(protoPath, `${address.host}:${address.port}`)

    const response = await new Promise<any>((resolve, reject) => {
      client!.Greet({ name: 'Ana' }, (err: Error | null, res: any) => {
        if (err) reject(err)
        else resolve(res)
      })
    })

    expect(response).toEqual({ message: 'Hello, Ana!' })
  })

  it('handles server streaming', async () => {
    protoPath = await createTempProto()

    const registry = createRegistry()
    registry.stream('demo.Raffel.Numbers', async function* (input: { count: number }) {
      for (let i = 1; i <= input.count; i++) {
        yield { value: i }
      }
    }, { direction: 'server' })

    const router = createRouter(registry)
    adapter = createGrpcAdapter(router, { port: 0, protoPath })
    await adapter.start()

    const address = adapter.address!
    client = createClient(protoPath, `${address.host}:${address.port}`)

    const values = await new Promise<number[]>((resolve, reject) => {
      const call = client!.Numbers({ count: 3 })
      const results: number[] = []

      call.on('data', (chunk: { value: number }) => results.push(chunk.value))
      call.on('end', () => resolve(results))
      call.on('error', reject)
    })

    expect(values).toEqual([1, 2, 3])
  })

  it('handles client streaming', async () => {
    protoPath = await createTempProto()

    const registry = createRegistry()
    const sumHandler: ClientStreamHandler<{ value: number }, { total: number }> = async (input) => {
      let total = 0
      for await (const chunk of input) {
        total += chunk.value
      }
      return { total }
    }
    registry.stream('demo.Raffel.Sum', sumHandler, { direction: 'client' })

    const router = createRouter(registry)
    adapter = createGrpcAdapter(router, { port: 0, protoPath })
    await adapter.start()

    const address = adapter.address!
    client = createClient(protoPath, `${address.host}:${address.port}`)

    const response = await new Promise<any>((resolve, reject) => {
      const call = client!.Sum((err: Error | null, res: any) => {
        if (err) reject(err)
        else resolve(res)
      })

      call.write({ value: 1 })
      call.write({ value: 2 })
      call.write({ value: 3 })
      call.end()
    })

    expect(response).toEqual({ total: 6 })
  })

  it('handles bidi streaming', async () => {
    protoPath = await createTempProto()

    const registry = createRegistry()
    registry.stream('demo.Raffel.Chat', async function* (input: AsyncIterable<{ text: string }>) {
      for await (const chunk of input) {
        yield { text: chunk.text.toUpperCase() }
      }
    }, { direction: 'bidi' })

    const router = createRouter(registry)
    adapter = createGrpcAdapter(router, { port: 0, protoPath })
    await adapter.start()

    const address = adapter.address!
    client = createClient(protoPath, `${address.host}:${address.port}`)

    const responses = await new Promise<string[]>((resolve, reject) => {
      const call = client!.Chat()
      const results: string[] = []

      call.on('data', (chunk: { text: string }) => results.push(chunk.text))
      call.on('end', () => resolve(results))
      call.on('error', reject)

      call.write({ text: 'hi' })
      call.write({ text: 'there' })
      call.end()
    })

    expect(responses).toEqual(['HI', 'THERE'])
  })
})
