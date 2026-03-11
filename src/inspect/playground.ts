/**
 * Inspect — Playground
 *
 * Creates a browser-based playground for invoking operations, channels, and
 * streams across all transports exposed by the inspection graph.
 */

import { createServer, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { loadRuntimeInspectionPreview, type RuntimeInspectionLoadOptions } from './loader.js'
import {
  buildGraphQLDocument,
  createSchemaExample,
  extractPathParameters,
  getSchemaObjectExample,
} from './schema-samples.js'
import { formatBindingLabel } from './format-utils.js'
import type {
  RuntimeInspectionChannel,
  RuntimeInspectionGraph,
  RuntimeInspectionOperation,
  RuntimeInspectionTransportFraming,
  RuntimeInspectionTransportHandler,
  RuntimeInspectionTransport,
  RuntimeInspectionTransportBinding,
} from './types.js'
import { renderPlaygroundHtml } from './playground-html.js'
import {
  normalizeConnectHost,
  parseJsonBody,
  invokeHttp,
  invokeJsonRpc,
  invokeGraphQL,
  invokeGrpc,
  invokeTcp,
  invokeUdp,
  toSessionView,
  createWebSocketSession,
  createHttpStreamSession,
  createGrpcSession,
  createRawTcpSession,
  createTcpStreamSession,
  type SessionRecord,
} from './playground-invokers.js'

// =========================================================================
// Types
// =========================================================================

export interface RuntimePlaygroundEntry {
  key: string
  kind: 'operation' | 'channel' | 'transport-handler'
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimeInspectionTransportBinding['mode'] | RuntimeInspectionTransportHandler['mode']
  label: string
  description?: string
  operationId?: string
  channelId?: string
  transportId: string
  bindingId: string
  session: boolean
  target: {
    host?: string
    port?: number
    path?: string
    service?: string
    method?: string
    procedure?: string
    socketType?: 'udp4' | 'udp6'
    framing?: RuntimeInspectionTransportFraming
  }
  defaults: {
    headers?: Record<string, string>
    metadata?: Record<string, string>
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: unknown
    document?: string
    message?: unknown
  }
}

export interface RuntimePlaygroundSnapshot {
  generatedAt: string
  graph: RuntimeInspectionGraph
  entries: RuntimePlaygroundEntry[]
}

export interface RuntimePlaygroundInvokeRequest {
  entry: string
  headers?: Record<string, unknown>
  metadata?: Record<string, unknown>
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  document?: string
}

export interface RuntimePlaygroundSessionView {
  id: string
  entry: string
  state: 'connecting' | 'open' | 'closed' | 'error'
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimePlaygroundEntry['mode']
  target: string
  sent: Array<{ at: string; payload: unknown }>
  received: Array<{ at: string; payload: unknown }>
  errors: string[]
}

export interface RuntimePlaygroundServerOptions {
  graph?: RuntimeInspectionGraph
  entry?: string
  cwd?: string
  host?: string
  port?: number
}

export interface RuntimePlaygroundServer {
  readonly entrypoint: string
  readonly snapshot: RuntimePlaygroundSnapshot
  readonly url: string
  readonly address: { host: string; port: number }
  start(): Promise<void>
  stop(): Promise<void>
}

// =========================================================================
// Snapshot builder
// =========================================================================

function findTransport(
  graph: RuntimeInspectionGraph,
  binding: RuntimeInspectionTransportBinding
): RuntimeInspectionTransport | undefined {
  return graph.transports.find((transport) => transport.protocol === binding.protocol)
}

function buildOperationDefaults(
  operation: RuntimeInspectionOperation,
  binding: RuntimeInspectionTransportBinding
): RuntimePlaygroundEntry['defaults'] {
  const inputExample = createSchemaExample(operation.schema.input)
  const inputObject = getSchemaObjectExample(operation.schema.input)

  if (binding.protocol === 'http') {
    const params = Object.fromEntries(
      extractPathParameters(binding.path).map((name) => [name, `example-${name}`])
    )
    const query = binding.method === 'GET'
      ? Object.fromEntries(Object.entries(inputObject).filter(([key]) => !(key in params)))
      : {}

    return {
      headers: binding.method === 'GET' ? {} : { 'content-type': 'application/json' },
      params,
      query,
      body: binding.method === 'GET' ? undefined : inputExample,
    }
  }

  if (binding.protocol === 'jsonrpc') {
    return {
      headers: { 'content-type': 'application/json' },
      metadata: {},
      body: inputExample,
    }
  }

  if (binding.protocol === 'graphql') {
    return {
      headers: { 'content-type': 'application/json' },
      document: buildGraphQLDocument(
        operation,
        binding.field ?? operation.name,
        binding.mode === 'query' ? 'query' : 'mutation'
      ),
    }
  }

  if (binding.protocol === 'grpc') {
    const defaults: RuntimePlaygroundEntry['defaults'] = {
      metadata: {},
    }

    if (binding.mode === 'unary' || binding.mode === 'server-streaming') {
      defaults.body = inputExample
    }

    if (binding.mode === 'client-streaming' || binding.mode === 'bidirectional') {
      defaults.message = inputExample
    }

    return defaults
  }

  if (binding.protocol === 'tcp') {
    return {
      metadata: {},
      body: inputExample,
    }
  }

  if (binding.protocol === 'websocket') {
    return {
      metadata: {},
      message: {
        id: randomUUID(),
        procedure: operation.name,
        type: binding.mode === 'event' ? 'event' : 'request',
        payload: inputExample,
        metadata: {},
      },
    }
  }

  return {
    body: inputExample,
  }
}

function buildChannelDefaults(channel: RuntimeInspectionChannel): RuntimePlaygroundEntry['defaults'] {
  const firstEvent = channel.events[0]
  return {
    metadata: {},
    message: {
      id: 'channel-subscribe',
      type: 'subscribe',
      channel: channel.name,
      metadata: {},
      publishTemplate: {
        id: 'channel-publish',
        type: 'publish',
        channel: channel.name,
        event: firstEvent?.name ?? 'message',
        data: firstEvent ? createSchemaExample(firstEvent.input) : { ok: true },
        metadata: {},
      },
    },
  }
}

function buildTransportHandlerDefaults(handler: RuntimeInspectionTransportHandler): RuntimePlaygroundEntry['defaults'] {
  if (handler.protocol === 'tcp') {
    return {
      message: '',
    }
  }

  if (handler.protocol === 'udp') {
    return {
      body: '',
    }
  }

  return {
    body: {},
  }
}

function requiresSession(binding: RuntimeInspectionTransportBinding): boolean {
  return binding.mode === 'channel'
    || binding.mode === 'stream'
    || binding.protocol === 'websocket'
    || (binding.protocol === 'grpc' && binding.mode !== 'unary')
}

export function createRuntimePlaygroundSnapshot(
  graph: RuntimeInspectionGraph
): RuntimePlaygroundSnapshot {
  const entries: RuntimePlaygroundEntry[] = []

  for (const operation of graph.operations) {
    for (const binding of operation.transports) {
      const transport = findTransport(graph, binding)
      entries.push({
        key: `${operation.id}:${binding.id}`,
        kind: 'operation',
        protocol: binding.protocol,
        mode: binding.mode,
        label: formatBindingLabel(binding),
        description: operation.summary ?? operation.description,
        operationId: operation.id,
        transportId: transport?.id ?? binding.protocol,
        bindingId: binding.id,
        session: requiresSession(binding),
        target: {
          host: transport?.host,
          port: transport?.port,
          path: binding.path,
          service: binding.service,
          method: binding.operation,
          procedure: binding.procedure,
        },
        defaults: buildOperationDefaults(operation, binding),
      })
    }
  }

  for (const channel of graph.channels) {
    const transport = findTransport(graph, channel.transport)
    entries.push({
      key: `channel:${channel.id}`,
      kind: 'channel',
      protocol: channel.transport.protocol,
      mode: channel.transport.mode,
      label: channel.name,
      description: channel.description,
      channelId: channel.id,
      transportId: transport?.id ?? channel.transport.protocol,
      bindingId: channel.transport.id,
      session: true,
      target: {
        host: transport?.host,
        port: transport?.port,
        path: channel.transport.path,
      },
      defaults: buildChannelDefaults(channel),
    })
  }

  for (const handler of graph.transportHandlers) {
    entries.push({
      key: `transport-handler:${handler.id}`,
      kind: 'transport-handler',
      protocol: handler.protocol,
      mode: handler.mode,
      label: handler.name,
      description: `${handler.protocol.toUpperCase()} transport handler`,
      operationId: handler.id,
      transportId: handler.transportId,
      bindingId: handler.id,
      session: handler.protocol === 'tcp',
      target: {
        host: handler.target.host,
        port: handler.target.port,
        procedure: handler.name,
        socketType: handler.target.socketType,
        framing: handler.details?.framing,
      },
      defaults: buildTransportHandlerDefaults(handler),
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    graph,
    entries,
  }
}

// =========================================================================
// Server
// =========================================================================

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function createRuntimePlaygroundServer(options: {
  graph: RuntimeInspectionGraph
  entrypoint?: string
  host?: string
  port?: number
}): RuntimePlaygroundServer {
  const entrypoint = options.entrypoint ?? '<programmatic>'
  const snapshot = createRuntimePlaygroundSnapshot(options.graph)
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 0
  let server: Server | null = null
  let address = { host, port: requestedPort }
  const sessions = new Map<string, SessionRecord>()

  async function closeSessions(): Promise<void> {
    await Promise.all(Array.from(sessions.values()).map((session) => session.close().catch(() => undefined)))
    sessions.clear()
  }

  async function handleInvoke(payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
    const entry = snapshot.entries.find((candidate) => candidate.key === payload.entry)
    if (!entry) {
      throw new Error(`Unknown playground entry "${payload.entry}"`)
    }

    if (entry.kind === 'transport-handler' && entry.protocol === 'tcp') {
      throw new Error('Use a session for raw TCP transport handlers')
    }

    if (entry.protocol === 'http') {
      return invokeHttp(entry, payload)
    }
    if (entry.protocol === 'jsonrpc') {
      return invokeJsonRpc(entry, payload)
    }
    if (entry.protocol === 'graphql') {
      return invokeGraphQL(entry, payload)
    }
    if (entry.protocol === 'grpc') {
      return invokeGrpc(entry, payload, options.graph)
    }
    if (entry.protocol === 'tcp') {
      return invokeTcp(entry, payload)
    }
    if (entry.protocol === 'udp') {
      return invokeUdp(entry, payload)
    }

    throw new Error(`Protocol ${entry.protocol} requires a session-oriented workflow`)
  }

  async function handleOpenSession(payload: RuntimePlaygroundInvokeRequest): Promise<RuntimePlaygroundSessionView> {
    const entry = snapshot.entries.find((candidate) => candidate.key === payload.entry)
    if (!entry) {
      throw new Error(`Unknown playground entry "${payload.entry}"`)
    }

    let session: SessionRecord
    if (entry.protocol === 'websocket') {
      session = await createWebSocketSession(entry, payload)
    } else if (entry.protocol === 'http' && entry.mode === 'stream') {
      session = await createHttpStreamSession(entry, payload)
    } else if (entry.protocol === 'grpc') {
      session = await createGrpcSession(entry, payload, options.graph)
    } else if (entry.kind === 'transport-handler' && entry.protocol === 'tcp') {
      session = await createRawTcpSession(entry)
    } else if (entry.protocol === 'tcp' && entry.mode === 'stream') {
      session = await createTcpStreamSession(entry, payload)
    } else {
      throw new Error(`Sessions are not supported for ${entry.protocol}:${entry.mode}`)
    }

    sessions.set(session.id, session)
    return toSessionView(session)
  }

  async function requestListener(req: import('node:http').IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host ?? '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/') {
      const html = renderPlaygroundHtml(snapshot, entrypoint)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
      })
      res.end(html)
      return
    }

    if (req.method === 'GET' && url.pathname === '/__snapshot') {
      sendJson(res, 200, snapshot)
      return
    }

    if (req.method === 'POST' && url.pathname === '/__invoke') {
      try {
        sendJson(res, 200, await handleInvoke(await parseJsonBody<RuntimePlaygroundInvokeRequest>(req)))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/__session/open') {
      try {
        sendJson(res, 200, await handleOpenSession(await parseJsonBody<RuntimePlaygroundInvokeRequest>(req)))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/__session/send') {
      try {
        const payload = await parseJsonBody<{ sessionId: string; message: unknown }>(req)
        const session = sessions.get(payload.sessionId)
        if (!session || !session.send) {
          throw new Error(`Session ${payload.sessionId} does not accept outbound messages`)
        }
        session.send(payload.message)
        sendJson(res, 200, toSessionView(session))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/__session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/__session/'.length))
      const session = sessions.get(sessionId)
      if (!session) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` })
        return
      }
      sendJson(res, 200, toSessionView(session))
      return
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/__session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/__session/'.length))
      const session = sessions.get(sessionId)
      if (!session) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` })
        return
      }
      await session.close()
      sendJson(res, 200, toSessionView(session))
      return
    }

    sendJson(res, 404, { error: `Unknown playground route ${req.method} ${url.pathname}` })
  }

  return {
    entrypoint,
    snapshot,
    get url() {
      return `http://${address.host}:${address.port}`
    },
    get address() {
      return address
    },
    async start() {
      if (server) {
        return
      }

      server = createServer((req, res) => {
        void requestListener(req, res)
      })

      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(requestedPort, host, () => {
          const info = server!.address()
          if (!info || typeof info === 'string') {
            reject(new Error('Failed to resolve playground address'))
            return
          }
          address = {
            host: normalizeConnectHost(info.address),
            port: info.port,
          }
          resolve()
        })
      })
    },
    async stop() {
      await closeSessions()
      if (!server) {
        return
      }
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      server = null
    },
  }
}

export async function startRuntimePlayground(
  options: RuntimePlaygroundServerOptions = {}
): Promise<RuntimePlaygroundServer> {
  const preview = options.graph
    ? { entrypoint: options.entry ?? '<programmatic>', graph: options.graph }
    : await loadRuntimeInspectionPreview(options as RuntimeInspectionLoadOptions)

  const server = createRuntimePlaygroundServer({
    graph: preview.graph,
    entrypoint: preview.entrypoint,
    host: options.host,
    port: options.port,
  })

  await server.start()
  return server
}
