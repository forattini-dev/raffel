/**
 * Streamable HTTP Transport
 *
 * Modern MCP transport (2025-03-26 spec). Works as HTTP middleware
 * on Raffel's existing HTTP adapter — no separate server needed.
 *
 * - POST /mcp  → JSON-RPC request/response
 * - GET  /mcp  → SSE stream for server-initiated notifications
 * - DELETE /mcp → session teardown
 *
 * Session management via Mcp-Session-Id header.
 */

import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, McpAuthProvider, McpAuthInfo } from '../types.js'
import { JsonRpcErrorCode } from '../types.js'
import type { McpTransport, McpMessageHandler, JsonRpcMessage } from './types.js'

export interface StreamableHttpTransportOptions {
  /** MCP endpoint path (default: '/mcp') */
  path?: string

  /** Enable session management (default: true) */
  stateful?: boolean

  /** Session TTL in ms (default: 30 minutes) */
  sessionTtl?: number

  /** Auth provider — when set, rejects unauthenticated requests with 401 */
  auth?: McpAuthProvider
}

interface McpSession {
  id: string
  createdAt: number
  lastActivity: number
  /** SSE response streams for server-initiated notifications */
  sseStreams: Set<ServerResponse>
}

/**
 * Create a Streamable HTTP transport that works as Raffel HTTP middleware.
 *
 * Returns both the McpTransport and an HTTP middleware function.
 * The middleware should be added to HttpAdapterOptions.middleware.
 */
export function createStreamableHttpTransport(
  options: StreamableHttpTransportOptions = {}
): {
  transport: McpTransport
  middleware: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>
} {
  const path = options.path ?? '/mcp'
  const stateful = options.stateful ?? true
  const sessionTtl = options.sessionTtl ?? 30 * 60 * 1000 // 30 min

  const authProvider = options.auth ?? null

  const sessions = new Map<string, McpSession>()
  let messageHandler: McpMessageHandler | null = null
  let cleanupTimer: ReturnType<typeof setInterval> | null = null

  // ─── Auth Verification ─────────────────────────────────────

  async function verifyAuth(req: IncomingMessage): Promise<McpAuthInfo | null | 'reject'> {
    if (!authProvider) return null // no auth configured — allow all

    const headers: Record<string, string | string[] | undefined> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      headers[key] = value
    }

    const authInfo = await authProvider.verify({
      headers,
      method: req.method ?? 'POST',
      url: req.url ?? '/',
    })

    if (!authInfo) return 'reject' // auth configured but verification failed
    return authInfo
  }

  function send401(res: ServerResponse): void {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer',
    })
    res.end(JSON.stringify({ error: 'Unauthorized' }))
  }

  // ─── Session Management ────────────────────────────────────

  function getOrCreateSession(req: IncomingMessage): McpSession {
    const existingId = req.headers['mcp-session-id'] as string | undefined

    if (existingId && sessions.has(existingId)) {
      const session = sessions.get(existingId)!
      session.lastActivity = Date.now()
      return session
    }

    const session: McpSession = {
      id: randomUUID(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      sseStreams: new Set(),
    }
    sessions.set(session.id, session)
    return session
  }

  function cleanupSessions(): void {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > sessionTtl) {
        for (const stream of session.sseStreams) {
          stream.end()
        }
        sessions.delete(id)
      }
    }
  }

  // ─── Request Body Parsing ──────────────────────────────────

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const maxSize = 10 * 1024 * 1024 // 10MB

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxSize) {
          reject(new Error('Request body too large'))
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  // ─── Response Helpers ──────────────────────────────────────

  function sendJsonResponse(res: ServerResponse, data: unknown, session?: McpSession): void {
    const body = JSON.stringify(data)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...(session && stateful ? { 'Mcp-Session-Id': session.id } : {}),
    })
    res.end(body)
  }

  function sendJsonRpcError(res: ServerResponse, id: string | number | null, code: number, message: string, session?: McpSession): void {
    sendJsonResponse(res, {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    } satisfies JsonRpcResponse, session)
  }

  // ─── HTTP Middleware ───────────────────────────────────────

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    // Only handle requests to our path
    const url = req.url?.split('?')[0]
    if (url !== path) return false

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization, X-Api-Key')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return true
    }

    // Auth check (all methods except OPTIONS)
    const authResult = await verifyAuth(req)
    if (authResult === 'reject') {
      send401(res)
      return true
    }
    const authInfo = authResult ?? undefined

    // POST — JSON-RPC request
    if (req.method === 'POST') {
      return handlePost(req, res, authInfo)
    }

    // GET — SSE stream for server-initiated notifications
    if (req.method === 'GET') {
      return handleGet(req, res)
    }

    // DELETE — session teardown
    if (req.method === 'DELETE') {
      return handleDelete(req, res)
    }

    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return true
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse, authInfo?: McpAuthInfo): Promise<boolean> {
    if (!messageHandler) {
      sendJsonRpcError(res, null, JsonRpcErrorCode.InternalError, 'Server not started')
      return true
    }

    const session = stateful ? getOrCreateSession(req) : undefined

    let body: string
    try {
      body = await readBody(req)
    } catch {
      sendJsonRpcError(res, null, JsonRpcErrorCode.ParseError, 'Failed to read request body', session)
      return true
    }

    let request: JsonRpcRequest
    try {
      request = JSON.parse(body) as JsonRpcRequest
    } catch {
      sendJsonRpcError(res, null, JsonRpcErrorCode.ParseError, 'Invalid JSON', session)
      return true
    }

    const response = await messageHandler(request, authInfo ? { authInfo } : undefined)

    if (response) {
      sendJsonResponse(res, response, session)
    } else {
      // Notification — no response body
      res.writeHead(202, {
        ...(session && stateful ? { 'Mcp-Session-Id': session.id } : {}),
      })
      res.end()
    }

    return true
  }

  function handleGet(req: IncomingMessage, res: ServerResponse): boolean {
    if (!stateful) {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'SSE not available in stateless mode' }))
      return true
    }

    const session = getOrCreateSession(req)

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Mcp-Session-Id': session.id,
    })

    // Keep-alive
    res.write(': connected\n\n')

    session.sseStreams.add(res)

    req.on('close', () => {
      session.sseStreams.delete(res)
    })

    return true
  }

  function handleDelete(req: IncomingMessage, res: ServerResponse): boolean {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!
      for (const stream of session.sseStreams) {
        stream.end()
      }
      sessions.delete(sessionId)
      res.writeHead(204)
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return true
    }

    res.end()
    return true
  }

  // ─── Send to SSE clients ──────────────────────────────────

  function sendToSseClients(message: JsonRpcMessage): void {
    const data = JSON.stringify(message)
    for (const [, session] of sessions) {
      for (const stream of session.sseStreams) {
        stream.write(`data: ${data}\n\n`)
      }
    }
  }

  // ─── Transport Interface ──────────────────────────────────

  const transport: McpTransport = {
    async start(handler: McpMessageHandler): Promise<void> {
      messageHandler = handler

      if (stateful) {
        cleanupTimer = setInterval(cleanupSessions, 60_000)
        if (cleanupTimer.unref) cleanupTimer.unref()
      }
    },

    async stop(): Promise<void> {
      messageHandler = null

      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }

      // Close all SSE streams
      for (const [, session] of sessions) {
        for (const stream of session.sseStreams) {
          stream.end()
        }
      }
      sessions.clear()
    },

    async send(message: JsonRpcMessage): Promise<void> {
      sendToSseClients(message)
    },
  }

  return {
    transport,
    middleware: handleRequest,
  }
}
