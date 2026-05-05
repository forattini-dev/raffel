/**
 * Inspect — Playground protocol invokers and session management
 *
 * Handles HTTP, JSON-RPC, GraphQL, gRPC invocations and
 * WebSocket/SSE session lifecycle for the playground server.
 */

import { randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { WebSocket } from 'ws'
import type {
  RuntimeInspectionGraph,
  RuntimeInspectionTransportBinding,
} from './types.js'
import type { RuntimePlaygroundEntry, RuntimePlaygroundInvokeRequest, RuntimePlaygroundSessionView } from './playground.js'
import { buildHttpUrl, buildWebSocketCandidates, normalizeConnectHost, toStringRecord } from './playground-targets.js'
import {
  attachRawTcpMessageStream,
  attachTcpEnvelopeStream,
  connectTcpSocket,
  encodeTcpRawPayload,
  frameRawTcpMessage,
  frameTcpMessage,
  waitForTcpEnvelope,
} from './playground-tcp.js'

export { normalizeConnectHost, toStringRecord } from './playground-targets.js'

export interface SessionRecord {
  id: string
  entry: RuntimePlaygroundEntry
  state: RuntimePlaygroundSessionView['state']
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimePlaygroundEntry['mode']
  target: string
  sent: RuntimePlaygroundSessionView['sent']
  received: RuntimePlaygroundSessionView['received']
  errors: string[]
  send?: (payload: unknown) => void
  close: () => Promise<void>
}

export function parseJsonBody<T = Record<string, unknown>>(req: import('node:http').IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve((text ? JSON.parse(text) : {}) as T)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function parseFetchResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}

function encodeDatagramPayload(payload: unknown): Buffer {
  if (payload === undefined || payload === null) {
    return Buffer.alloc(0)
  }

  if (typeof payload === 'string') {
    return Buffer.from(payload, 'utf8')
  }

  return Buffer.from(JSON.stringify(payload), 'utf8')
}

function decodeDatagramPayload(payload: Buffer): unknown {
  const raw = payload.toString('utf8')
  if (!raw) {
    return ''
  }

  return parseMaybeJson(raw)
}

export async function invokeHttp(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  if (entry.mode === 'stream') {
    throw new Error('Use a session for HTTP stream bindings')
  }

  const url = buildHttpUrl(entry, payload)
  const headers = {
    ...toStringRecord(payload.headers),
    ...toStringRecord(payload.metadata),
  }
  const method = entry.label.split(' ')[0] || 'POST'
  const requestInit: RequestInit = {
    method,
    headers,
  }

  if (method !== 'GET' && payload.body !== undefined) {
    requestInit.body = JSON.stringify(payload.body)
    if (!headers['content-type']) {
      headers['content-type'] = 'application/json'
    }
  }

  const response = await fetch(url, requestInit)
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

export async function invokeJsonRpc(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  const url = buildHttpUrl(entry, payload)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...toStringRecord(payload.headers),
      ...toStringRecord(payload.metadata),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: entry.label,
      params: payload.body ?? {},
      id: 'playground-call',
    }),
  })

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

export async function invokeGraphQL(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  const url = buildHttpUrl(entry, payload)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...toStringRecord(payload.headers),
      ...toStringRecord(payload.metadata),
    },
    body: JSON.stringify({
      query: payload.document,
    }),
  })

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

function resolveGrpcClient(root: Record<string, unknown>, fullName: string): grpc.ServiceClientConstructor {
  const parts = fullName.split('.').filter(Boolean)
  let current: unknown = root

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      throw new Error(`gRPC service "${fullName}" not found in loaded proto definition`)
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current as grpc.ServiceClientConstructor
}

function createGrpcClient(
  entry: RuntimePlaygroundEntry,
  graph: RuntimeInspectionGraph
): grpc.Client & Record<string, Function> {
  const transport = graph.transports.find((candidate) => candidate.id === entry.transportId)
  if (!transport?.grpc) {
    throw new Error('Missing gRPC transport metadata for playground invocation')
  }

  const definition = protoLoader.loadSync(transport.grpc.protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const proto = grpc.loadPackageDefinition(definition) as Record<string, unknown>
  const Client = resolveGrpcClient(proto, entry.target.service ?? '')
  return new Client(
    `${normalizeConnectHost(entry.target.host)}:${entry.target.port}`,
    grpc.credentials.createInsecure()
  ) as grpc.Client & Record<string, Function>
}

function buildGrpcMetadata(payload: RuntimePlaygroundInvokeRequest): grpc.Metadata {
  const metadata = new grpc.Metadata()
  for (const [key, value] of Object.entries(toStringRecord(payload.metadata))) {
    metadata.set(key, value)
  }
  return metadata
}

export async function invokeGrpc(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest, graph: RuntimeInspectionGraph): Promise<unknown> {
  if (entry.mode !== 'unary') {
    throw new Error(`Use a session for gRPC ${entry.mode} methods`)
  }

  const client = createGrpcClient(entry, graph)
  const metadata = buildGrpcMetadata(payload)

  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      client[entry.target.method ?? ''](payload.body ?? {}, metadata, (error: Error | null, result: unknown) => {
        if (error) {
          reject(error)
          return
        }
        resolve(result)
      })
    })

    return {
      ok: true,
      body: response,
    }
  } finally {
    client.close()
  }
}

export async function invokeTcp(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  if (entry.mode === 'stream') {
    throw new Error('Use a session for TCP stream bindings')
  }

  const socket = await connectTcpSocket(entry)
  const requestId = randomUUID()
  const metadata = {
    ...toStringRecord(payload.headers),
    ...toStringRecord(payload.metadata),
  }
  const message = {
    id: requestId,
    procedure: entry.target.procedure ?? entry.label,
    type: entry.mode === 'event' ? 'event' : 'request',
    payload: payload.body ?? {},
    metadata,
  }

  try {
    const responsePromise = waitForTcpEnvelope(socket)
    socket.write(frameTcpMessage(message))
    const response = await responsePromise
    return {
      ok: response.type !== 'error',
      body: response.payload,
      envelope: response,
    }
  } finally {
    socket.destroy()
  }
}

export async function invokeUdp(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  const port = entry.target.port
  if (port === undefined) {
    throw new Error(`Missing UDP target port for playground entry "${entry.key}"`)
  }

  const socketType = entry.target.socketType ?? 'udp4'
  const socket = createSocket(socketType)
  const body = encodeDatagramPayload(payload.body)

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(() => resolve())
    })

    const response = await new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve({
          ok: true,
          body: null,
          note: 'No UDP response received before timeout; the handler may be fire-and-forget.',
        })
      }, 1500)

      const cleanup = () => {
        clearTimeout(timeout)
        socket.off('message', onMessage)
        socket.off('error', onError)
      }

      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }

      const onMessage = (message: Buffer) => {
        cleanup()
        resolve({
          ok: true,
          body: decodeDatagramPayload(message),
        })
      }

      socket.once('error', onError)
      socket.once('message', onMessage)
      socket.send(body, port, normalizeConnectHost(entry.target.host), (error) => {
        if (error) {
          cleanup()
          reject(error)
        }
      })
    })

    return response
  } finally {
    socket.close()
  }
}

export function toSessionView(session: SessionRecord): RuntimePlaygroundSessionView {
  return {
    id: session.id,
    entry: session.entry.key,
    state: session.state,
    protocol: session.protocol,
    mode: session.mode,
    target: session.target,
    sent: [...session.sent],
    received: [...session.received],
    errors: [...session.errors],
  }
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export async function createGrpcSession(
  entry: RuntimePlaygroundEntry,
  payload: RuntimePlaygroundInvokeRequest,
  graph: RuntimeInspectionGraph
): Promise<SessionRecord> {
  const client = createGrpcClient(entry, graph)
  const metadata = buildGrpcMetadata(payload)
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const target = `${normalizeConnectHost(entry.target.host)}:${entry.target.port}/${entry.target.service}.${entry.target.method}`
  const methodName = entry.target.method ?? ''
  let closing = false
  let resolveSettled: (() => void) | null = null
  let rejectSettled: ((error: Error) => void) | null = null
  const settled = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve
    rejectSettled = reject
  })

  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    async close() {
      closing = true
      if (entry.mode === 'server-streaming') {
        readableCall?.cancel()
        client.close()
        session.state = 'closed'
        resolveSettled?.()
        return
      }

      if (entry.mode === 'client-streaming') {
        writableCall?.end()
      } else if (entry.mode === 'bidirectional') {
        duplexCall?.end()
      }

      try {
        await settled
      } finally {
        client.close()
      }
    },
  }

  let readableCall: grpc.ClientReadableStream<unknown> | null = null
  let writableCall: grpc.ClientWritableStream<unknown> | null = null
  let duplexCall: grpc.ClientDuplexStream<unknown, unknown> | null = null

  const pushReceived = (message: unknown) => {
    received.push({ at: new Date().toISOString(), payload: message })
  }

  const handleError = (error: Error) => {
    const isCancellation = (error as grpc.ServiceError).code === grpc.status.CANCELLED
    if (closing && isCancellation) {
      session.state = 'closed'
      resolveSettled?.()
      return
    }
    session.state = 'error'
    errors.push(error.message)
    rejectSettled?.(error)
  }

  if (entry.mode === 'server-streaming') {
    readableCall = client[methodName](payload.body ?? {}, metadata) as grpc.ClientReadableStream<unknown>
    readableCall.on('data', (chunk: unknown) => {
      pushReceived({ type: 'data', payload: chunk })
    })
    readableCall.on('end', () => {
      session.state = 'closed'
      resolveSettled?.()
      client.close()
    })
    readableCall.on('error', handleError)
    session.state = 'open'
    return session
  }

  if (entry.mode === 'client-streaming') {
    writableCall = client[methodName](
      metadata,
      (error: Error | null, result: unknown) => {
        if (error) {
          handleError(error)
          return
        }
        pushReceived({ type: 'response', payload: result })
        session.state = 'closed'
        resolveSettled?.()
      }
    ) as grpc.ClientWritableStream<unknown>
    session.send = (message: unknown) => {
      writableCall?.write(message)
      sent.push({ at: new Date().toISOString(), payload: message })
    }
    writableCall.on('error', handleError)
    session.state = 'open'
    return session
  }

  if (entry.mode !== 'bidirectional') {
    client.close()
    throw new Error(`Sessions are not supported for gRPC ${entry.mode}`)
  }

  duplexCall = client[methodName](metadata) as grpc.ClientDuplexStream<unknown, unknown>
  duplexCall.on('data', (chunk: unknown) => {
    pushReceived({ type: 'data', payload: chunk })
  })
  duplexCall.on('end', () => {
    session.state = 'closed'
    resolveSettled?.()
    client.close()
  })
  duplexCall.on('error', handleError)
  session.send = (message: unknown) => {
    duplexCall?.write(message)
    sent.push({ at: new Date().toISOString(), payload: message })
  }
  session.state = 'open'
  return session
}

export async function createTcpStreamSession(
  entry: RuntimePlaygroundEntry,
  payload: RuntimePlaygroundInvokeRequest
): Promise<SessionRecord> {
  if (entry.mode !== 'stream') {
    throw new Error(`TCP sessions are only supported for stream bindings; received ${entry.mode}`)
  }

  const socket = await connectTcpSocket(entry)
  const requestId = randomUUID()
  const target = `${normalizeConnectHost(entry.target.host)}:${entry.target.port}/${entry.target.procedure ?? entry.label}`
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  let closing = false

  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    async close() {
      closing = true
      if (!socket.destroyed) {
        socket.write(frameTcpMessage({
          id: requestId,
          type: 'cancel',
        }))
        socket.end()
      }
      session.state = 'closed'
    },
  }

  attachTcpEnvelopeStream(socket, {
    onEnvelope(envelope) {
      received.push({ at: new Date().toISOString(), payload: envelope })
      if (envelope.type === 'stream:end') {
        session.state = 'closed'
      } else if (envelope.type === 'stream:error' || envelope.type === 'error') {
        session.state = closing ? 'closed' : 'error'
      } else if (session.state === 'connecting') {
        session.state = 'open'
      }
    },
    onError(error) {
      if (closing) {
        session.state = 'closed'
        return
      }
      session.state = 'error'
      errors.push(error.message)
    },
    onClose() {
      if (session.state !== 'error') {
        session.state = 'closed'
      }
    },
  })

  socket.write(frameTcpMessage({
    id: requestId,
    procedure: entry.target.procedure ?? entry.label,
    type: 'stream:start',
    payload: payload.body ?? {},
    metadata: {
      ...toStringRecord(payload.headers),
      ...toStringRecord(payload.metadata),
    },
  }))
  session.state = 'open'
  return session
}

export async function createRawTcpSession(
  entry: RuntimePlaygroundEntry
): Promise<SessionRecord> {
  const socket = await connectTcpSocket(entry)
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const target = `${normalizeConnectHost(entry.target.host)}:${entry.target.port}/${entry.target.procedure ?? entry.label}`
  const framing = entry.target.framing

  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    send(message) {
      const payload = encodeTcpRawPayload(message)
      socket.write(frameRawTcpMessage(payload, framing))
      sent.push({ at: new Date().toISOString(), payload: parseMaybeJson(payload.toString('utf8')) })
    },
    async close() {
      socket.end()
      session.state = 'closed'
    },
  }

  attachRawTcpMessageStream(socket, framing, {
    onMessage(message) {
      received.push({
        at: new Date().toISOString(),
        payload: parseMaybeJson(message.toString('utf8')),
      })
      if (session.state === 'connecting') {
        session.state = 'open'
      }
    },
    onError(error) {
      session.state = 'error'
      errors.push(error.message)
    },
    onClose() {
      if (session.state !== 'error') {
        session.state = 'closed'
      }
    },
  })

  session.state = 'open'
  return session
}

export async function createWebSocketSession(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<SessionRecord> {
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const headers = {
    ...toStringRecord(payload.headers),
    ...toStringRecord(payload.metadata),
  }
  const candidates = buildWebSocketCandidates(entry, payload)
  let socket: WebSocket | null = null
  let target = candidates[0]

  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    send(message) {
      const normalized = typeof message === 'string' ? message : JSON.stringify(message)
      socket?.send(normalized)
      sent.push({ at: new Date().toISOString(), payload: parseMaybeJson(normalized) })
    },
    async close() {
      socket?.close()
    },
  }

  async function connect(candidate: string): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
      const current = new WebSocket(candidate, { headers })
      const timeout = setTimeout(() => {
        current.close()
        reject(new Error(`Timed out opening WebSocket session to ${candidate}`))
      }, 2000)

      current.once('open', () => {
        clearTimeout(timeout)
        resolve(current)
      })
      current.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      socket = await connect(candidate)
      target = candidate
      session.target = candidate
      break
    } catch (error) {
      lastError = error as Error
      errors.push(lastError.message)
    }
  }

  if (!socket) {
    session.state = 'error'
    throw lastError ?? new Error('Failed to open WebSocket session')
  }

  socket.on('message', (message) => {
    const raw = typeof message === 'string' ? message : message.toString('utf8')
    received.push({ at: new Date().toISOString(), payload: parseMaybeJson(raw) })
  })
  socket.on('close', () => {
    session.state = 'closed'
  })
  socket.on('error', (error) => {
    session.state = 'error'
    errors.push(error.message)
  })
  session.state = 'open'

  return session
}

function parseSseBlock(block: string): unknown {
  const event: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key === 'event') {
      event.event = value
    } else if (key === 'data') {
      event.data = value
    }
  }
  if (event.data) {
    return {
      ...event,
      parsed: parseMaybeJson(event.data),
    }
  }
  return event
}

export async function createHttpStreamSession(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<SessionRecord> {
  const target = buildHttpUrl(entry, payload)
  const controller = new AbortController()
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    async close() {
      controller.abort('playground-session-closed')
      session.state = 'closed'
    },
  }

  void (async () => {
    try {
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...toStringRecord(payload.headers),
          ...toStringRecord(payload.metadata),
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        session.state = 'error'
        errors.push(`HTTP ${response.status}`)
        received.push({
          at: new Date().toISOString(),
          payload: await parseFetchResponse(response),
        })
        return
      }

      session.state = 'open'
      const reader = response.body?.getReader()
      if (!reader) {
        session.state = 'closed'
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          if (!block.trim()) continue
          received.push({
            at: new Date().toISOString(),
            payload: parseSseBlock(block),
          })
        }
      }
      session.state = 'closed'
    } catch (error) {
      if (!controller.signal.aborted) {
        session.state = 'error'
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  })()

  return session
}
