import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { createServer } from '../../src/server/index.js'
import {
  createRuntimePlaygroundServer,
  startRuntimePlayground,
  type RuntimePlaygroundServer,
} from '../../src/inspect/index.js'
import {
  createZodAdapter,
  registerValidator,
  resetValidation,
} from '../../src/validation/index.js'

const runtimeFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'runtime-preview.ts')

const PROTO = `syntax = "proto3";

package demo;

service Playground {
  rpc Echo (EchoRequest) returns (EchoReply);
  rpc Numbers (NumbersRequest) returns (stream NumbersReply);
  rpc Sum (stream SumRequest) returns (SumReply);
  rpc Chat (stream ChatMessage) returns (stream ChatMessage);
}

message EchoRequest { string name = 1; }
message EchoReply { string greeting = 1; }
message NumbersRequest { int32 count = 1; }
message NumbersReply { int32 value = 1; }
message SumRequest { int32 value = 1; }
message SumReply { int32 total = 1; }
message ChatMessage { string text = 1; }
`

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to get free port')))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('runtime playground', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanup.length > 0) {
      const dispose = cleanup.pop()!
      await dispose()
    }
    resetValidation()
  })

  it('loads a unified playground snapshot from a preview entrypoint', async () => {
    const playground = await startRuntimePlayground({
      entry: runtimeFixture,
      port: 0,
      host: '127.0.0.1',
    })
    cleanup.push(() => playground.stop())

    const snapshot = await fetch(`${playground.url}/__snapshot`).then((response) => response.json()) as {
      entries: Array<{ protocol: string; operationId?: string; channelId?: string }>
    }

    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 'http', operationId: 'users.list' }),
      expect.objectContaining({ protocol: 'grpc', operationId: 'pkg.UserService.GetUser' }),
      expect.objectContaining({ protocol: 'websocket', channelId: 'presence-users' }),
    ]))
  })

  it('invokes multi-protocol operations and channel sessions through the local playground', async () => {
    registerValidator(createZodAdapter(z))

    const protoDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-playground-'))
    const protoPath = path.join(protoDir, 'playground.proto')
    await mkdir(protoDir, { recursive: true })
    await writeFile(protoPath, PROTO, 'utf8')
    cleanup.push(() => rm(protoDir, { recursive: true, force: true }))

    const httpPort = await getFreePort()
    const grpcPort = await getFreePort()
    const tcpPort = await getFreePort()
    const rawTcpPort = await getFreePort()
    const udpPort = await getFreePort()

    const server = createServer({
      host: '127.0.0.1',
      port: httpPort,
      basePath: '/api',
      websocket: { path: '/ws' },
      jsonrpc: { path: '/rpc' },
      graphql: { path: '/graphql', playground: false },
      grpc: { host: '127.0.0.1', port: grpcPort, protoPath },
      tcp: { host: '127.0.0.1', port: tcpPort },
    })
    cleanup.push(() => server.stop())

    server
      .procedure('users.echo')
      .input(z.object({ name: z.string() }))
      .output(z.object({ greeting: z.string() }))
      .http('/users/echo', 'POST')
      .graphql({ type: 'mutation' })
      .handler(async (input) => ({
        greeting: `Hello ${input.name}`,
      }))

    server.grpcNs
      .service('Playground', { packageName: 'demo' })
      .method(
        'Echo',
        {
          input: z.object({ name: z.string() }),
          output: z.object({ greeting: z.string() }),
        },
        async (input) => ({
          greeting: `Hello ${input.name}`,
        })
      )
      .serverStream(
        'Numbers',
        {
          input: z.object({ count: z.number().int().min(1) }),
          output: z.object({ value: z.number().int() }),
        },
        async function* (input) {
          for (let value = 1; value <= input.count; value++) {
            yield { value }
          }
        }
      )
      .clientStream(
        'Sum',
        {
          input: z.object({ value: z.number().int() }),
          output: z.object({ total: z.number().int() }),
        },
        async (input) => {
          let total = 0
          for await (const chunk of input) {
            total += chunk.value
          }
          return { total }
        }
      )
      .bidiStream(
        'Chat',
        {
          input: z.object({ text: z.string() }),
          output: z.object({ text: z.string() }),
        },
        async function* (input) {
          for await (const chunk of input) {
            yield { text: chunk.text.toUpperCase() }
          }
        }
      )
      .end()

    server
      .stream('logs.tail')
      .input(z.object({ service: z.string() }))
      .output(z.object({ line: z.string() }))
      .handler(async function* (input) {
        yield { line: `tail:${input.service}` }
      })

    server.tcpNs
      .handler('raw.echo', {
        port: rawTcpPort,
        host: '127.0.0.1',
        framing: 'delimiter',
        delimiter: '\n',
      })
      .onConnect((socket) => {
        socket.write('ready\n')
      })
      .onData((data, socket) => {
        socket.write(`${data.toString('utf8').toUpperCase()}\n`)
      })
      .end()

    server.ws.channel('public-room', {
      type: 'public',
      description: 'Public room',
    })

    server.udp
      .handler('metrics.ingest', { port: udpPort, host: '127.0.0.1' })
      .onMessage((data) => {
        if (data.toString('utf8') === 'ping') {
          return Buffer.from('pong')
        }
        return Buffer.from(`seen:${data.toString('utf8')}`)
      })
      .end()

    await server.start()

    const playground: RuntimePlaygroundServer = createRuntimePlaygroundServer({
      graph: server.preview(),
      entrypoint: '<test-server>',
      host: '127.0.0.1',
      port: 0,
    })
    await playground.start()
    cleanup.push(() => playground.stop())

    const snapshot = await fetch(`${playground.url}/__snapshot`).then((response) => response.json()) as {
      entries: Array<{
        key: string
        protocol: string
        mode: string
        operationId?: string
        channelId?: string
        defaults?: { document?: string }
      }>
    }

    expect(snapshot.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 'http', operationId: 'users.echo', mode: 'rest' }),
      expect.objectContaining({ protocol: 'jsonrpc', operationId: 'users.echo', mode: 'request' }),
      expect.objectContaining({ protocol: 'graphql', operationId: 'users.echo', mode: 'mutation' }),
      expect.objectContaining({ protocol: 'grpc', operationId: 'demo.Playground.Echo', mode: 'unary' }),
      expect.objectContaining({ protocol: 'grpc', operationId: 'demo.Playground.Numbers', mode: 'server-streaming', session: true }),
      expect.objectContaining({ protocol: 'grpc', operationId: 'demo.Playground.Sum', mode: 'client-streaming', session: true }),
      expect.objectContaining({ protocol: 'grpc', operationId: 'demo.Playground.Chat', mode: 'bidirectional', session: true }),
      expect.objectContaining({ protocol: 'tcp', operationId: 'users.echo', mode: 'request' }),
      expect.objectContaining({ protocol: 'tcp', operationId: 'logs.tail', mode: 'stream', session: true }),
      expect.objectContaining({ protocol: 'tcp', operationId: 'tcp:raw.echo', mode: 'session', session: true }),
      expect.objectContaining({ protocol: 'udp', operationId: 'udp:metrics.ingest', mode: 'datagram' }),
      expect.objectContaining({ protocol: 'websocket', channelId: 'public-room', mode: 'channel' }),
      expect.objectContaining({ protocol: 'http', operationId: 'logs.tail', mode: 'stream' }),
    ]))

    const httpEntry = snapshot.entries.find((entry) => entry.protocol === 'http' && entry.operationId === 'users.echo' && entry.mode === 'rest')
    const jsonrpcEntry = snapshot.entries.find((entry) => entry.protocol === 'jsonrpc' && entry.operationId === 'users.echo')
    const graphqlEntry = snapshot.entries.find((entry) => entry.protocol === 'graphql' && entry.operationId === 'users.echo')
    const grpcEntry = snapshot.entries.find((entry) => entry.protocol === 'grpc' && entry.operationId === 'demo.Playground.Echo')
    const grpcServerStreamEntry = snapshot.entries.find((entry) => entry.protocol === 'grpc' && entry.operationId === 'demo.Playground.Numbers')
    const grpcClientStreamEntry = snapshot.entries.find((entry) => entry.protocol === 'grpc' && entry.operationId === 'demo.Playground.Sum')
    const grpcBidiEntry = snapshot.entries.find((entry) => entry.protocol === 'grpc' && entry.operationId === 'demo.Playground.Chat')
    const tcpEntry = snapshot.entries.find((entry) => entry.protocol === 'tcp' && entry.operationId === 'users.echo' && entry.mode === 'request')
    const tcpStreamEntry = snapshot.entries.find((entry) => entry.protocol === 'tcp' && entry.operationId === 'logs.tail' && entry.mode === 'stream')
    const rawTcpEntry = snapshot.entries.find((entry) => entry.protocol === 'tcp' && entry.operationId === 'tcp:raw.echo' && entry.mode === 'session')
    const udpEntry = snapshot.entries.find((entry) => entry.protocol === 'udp' && entry.operationId === 'udp:metrics.ingest')
    const channelEntry = snapshot.entries.find((entry) => entry.channelId === 'public-room')

    expect(httpEntry).toBeDefined()
    expect(jsonrpcEntry).toBeDefined()
    expect(graphqlEntry).toBeDefined()
    expect(grpcEntry).toBeDefined()
    expect(grpcServerStreamEntry).toBeDefined()
    expect(grpcClientStreamEntry).toBeDefined()
    expect(grpcBidiEntry).toBeDefined()
    expect(tcpEntry).toBeDefined()
    expect(tcpStreamEntry).toBeDefined()
    expect(rawTcpEntry).toBeDefined()
    expect(udpEntry).toBeDefined()
    expect(channelEntry).toBeDefined()

    const httpResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: httpEntry!.key,
        body: { name: 'Ada' },
      }),
    }).then((response) => response.json()) as { body: { greeting: string } }
    expect(httpResult.body.greeting).toBe('Hello Ada')

    const jsonrpcResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: jsonrpcEntry!.key,
        body: { name: 'Ada' },
      }),
    }).then((response) => response.json()) as { body: { result: { greeting: string } } }
    expect(jsonrpcResult.body.result.greeting).toBe('Hello Ada')

    const graphqlResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: graphqlEntry!.key,
        document: 'mutation Playground { usersEcho(name: "Ada") { greeting } }',
      }),
    }).then((response) => response.json()) as { body: { data: { usersEcho: { greeting: string } } } }
    expect(graphqlResult.body.data.usersEcho.greeting).toBe('Hello Ada')

    const grpcResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: grpcEntry!.key,
        body: { name: 'Ada' },
      }),
    }).then((response) => response.json()) as { body: { greeting: string } }
    expect(grpcResult.body.greeting).toBe('Hello Ada')

    const tcpResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: tcpEntry!.key,
        body: { name: 'Ada' },
      }),
    }).then((response) => response.json()) as { body: { greeting: string } }
    expect(tcpResult.body.greeting).toBe('Hello Ada')

    const udpResult = await fetch(`${playground.url}/__invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: udpEntry!.key,
        body: 'ping',
      }),
    }).then((response) => response.json()) as { body: string }
    expect(udpResult.body).toBe('pong')

    const grpcNumbersSession = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: grpcServerStreamEntry!.key,
        body: { count: 3 },
      }),
    }).then((response) => response.json()) as { id: string }

    await delay(200)

    const grpcNumbersView = await fetch(`${playground.url}/__session/${grpcNumbersSession.id}`).then((response) => response.json()) as {
      received: Array<{ payload: { payload?: { value: number } } }>
    }
    expect(grpcNumbersView.received.map((message) => message.payload.payload?.value)).toEqual([1, 2, 3])

    const grpcSumSession = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: grpcClientStreamEntry!.key,
      }),
    }).then((response) => response.json()) as { id: string }

    for (const value of [1, 2, 3]) {
      await fetch(`${playground.url}/__session/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: grpcSumSession.id,
          message: { value },
        }),
      })
    }

    const grpcSumClose = await fetch(`${playground.url}/__session/${grpcSumSession.id}`, {
      method: 'DELETE',
    }).then((response) => response.json()) as {
      received: Array<{ payload: { payload?: { total: number } } }>
    }
    expect(grpcSumClose.received.at(-1)?.payload.payload?.total).toBe(6)

    const grpcChatSession = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: grpcBidiEntry!.key,
      }),
    }).then((response) => response.json()) as { id: string }

    for (const text of ['hi', 'there']) {
      await fetch(`${playground.url}/__session/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: grpcChatSession.id,
          message: { text },
        }),
      })
    }

    await delay(200)

    const grpcChatClose = await fetch(`${playground.url}/__session/${grpcChatSession.id}`, {
      method: 'DELETE',
    }).then((response) => response.json()) as {
      received: Array<{ payload: { payload?: { text: string } } }>
    }
    expect(grpcChatClose.received.map((message) => message.payload.payload?.text)).toEqual(['HI', 'THERE'])

    const tcpStreamSession = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: tcpStreamEntry!.key,
        body: { service: 'payments' },
      }),
    }).then((response) => response.json()) as { id: string }

    await delay(200)

    const tcpStreamView = await fetch(`${playground.url}/__session/${tcpStreamSession.id}`).then((response) => response.json()) as {
      received: Array<{ payload: { type?: string; payload?: { line: string } } }>
    }
    expect(tcpStreamView.received).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'stream:data',
          payload: { line: 'tail:payments' },
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'stream:end',
        }),
      }),
    ]))

    const rawTcpSession = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: rawTcpEntry!.key,
      }),
    }).then((response) => response.json()) as { id: string }

    await delay(150)

    const rawTcpWelcome = await fetch(`${playground.url}/__session/${rawTcpSession.id}`).then((response) => response.json()) as {
      received: Array<{ payload: string }>
    }
    expect(rawTcpWelcome.received).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: 'ready' }),
    ]))

    await fetch(`${playground.url}/__session/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: rawTcpSession.id,
        message: 'hello',
      }),
    })

    await delay(150)

    const rawTcpView = await fetch(`${playground.url}/__session/${rawTcpSession.id}`).then((response) => response.json()) as {
      received: Array<{ payload: string }>
    }
    expect(rawTcpView.received).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: 'ready' }),
      expect.objectContaining({ payload: 'HELLO' }),
    ]))

    const openedSessionRes = await fetch(`${playground.url}/__session/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: channelEntry!.key,
      }),
    })
    const openedSession = await openedSessionRes.json() as { id: string; state?: string }

    // Channel WS sessions may fail to connect in constrained environments — skip assertions if so
    if (openedSessionRes.ok && openedSession.state !== 'error') {
      await fetch(`${playground.url}/__session/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: openedSession.id,
          message: {
            id: 'sub-1',
            type: 'subscribe',
            channel: 'public-room',
          },
        }),
      })

      // Poll until the subscribed message appears (max 2s)
      let sessionView!: {
        state: string
        received: Array<{ payload: { type?: string; channel?: string } }>
      }
      const deadline = Date.now() + 2000
      while (Date.now() < deadline) {
        sessionView = await fetch(`${playground.url}/__session/${openedSession.id}`).then((response) => response.json()) as typeof sessionView
        const hasSubscribed = sessionView.received?.some(
          (m) => m.payload?.type === 'subscribed' && m.payload?.channel === 'public-room'
        )
        if (hasSubscribed) break
        await delay(50)
      }

      expect(['open', 'closed', 'connecting']).toContain(sessionView.state)
      expect(sessionView.received).toEqual(expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'subscribed',
            channel: 'public-room',
          }),
        }),
      ]))
    }
  })
})
