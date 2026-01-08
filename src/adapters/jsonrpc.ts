/**
 * JSON-RPC 2.0 Adapter
 *
 * Implements JSON-RPC 2.0 specification over HTTP.
 * Supports batch requests, notifications, and standard error codes.
 *
 * @see https://www.jsonrpc.org/specification
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Router } from '../core/router.js'
import { RaffelError } from '../core/router.js'
import { createContext, createExtensionKey, withExtension } from '../types/context.js'
import { getLogger } from '../utils/logger.js'

/**
 * Extension key for HTTP request metadata (headers, etc.)
 */
export const HttpMetadataKey = createExtensionKey<Record<string, string>>('http-metadata')

const logger = getLogger().child({ component: 'jsonrpc-adapter' })

// === JSON-RPC 2.0 Types ===

/**
 * JSON-RPC 2.0 Request object
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown[] | Record<string, unknown>
  id?: string | number | null
}

/**
 * JSON-RPC 2.0 Response object
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  result?: unknown
  error?: JsonRpcError
  id: string | number | null
}

/**
 * JSON-RPC 2.0 Error object
 */
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

// === Standard Error Codes ===

export const JsonRpcErrorCode = {
  /** Invalid JSON was received */
  PARSE_ERROR: -32700,
  /** The JSON sent is not a valid Request object */
  INVALID_REQUEST: -32600,
  /** The method does not exist / is not available */
  METHOD_NOT_FOUND: -32601,
  /** Invalid method parameter(s) */
  INVALID_PARAMS: -32602,
  /** Internal JSON-RPC error */
  INTERNAL_ERROR: -32603,
  // Server errors: -32000 to -32099
  /** Server error */
  SERVER_ERROR: -32000,
} as const

// === Adapter Types ===

export interface JsonRpcAdapterOptions {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Endpoint path (default: '/') */
  path?: string
  /** Enable CORS (default: true) */
  cors?: boolean
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number
  /** Request timeout in ms (default: 30000) */
  timeout?: number
}

export interface JsonRpcAdapter {
  /** Start the server */
  start(): Promise<void>
  /** Stop the server */
  stop(): Promise<void>
  /** Get the underlying HTTP server */
  getServer(): Server | null
}

/**
 * Create a JSON-RPC 2.0 HTTP adapter
 */
export function createJsonRpcAdapter(router: Router, options: JsonRpcAdapterOptions): JsonRpcAdapter {
  const {
    port,
    host = '0.0.0.0',
    path = '/',
    cors = true,
    maxBodySize = 1024 * 1024, // 1MB
    timeout = 30000,
  } = options

  let server: Server | null = null

  /**
   * Create error response
   */
  function createError(code: number, message: string, id: string | number | null, data?: unknown): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      error: { code, message, ...(data !== undefined && { data }) },
      id,
    }
  }

  /**
   * Map Raffel error codes to JSON-RPC error codes
   */
  function mapErrorCode(raffelCode: string): number {
    switch (raffelCode) {
      case 'NOT_FOUND':
        return JsonRpcErrorCode.METHOD_NOT_FOUND
      case 'VALIDATION_ERROR':
      case 'INVALID_ARGUMENT':
        return JsonRpcErrorCode.INVALID_PARAMS
      case 'UNAUTHENTICATED':
      case 'PERMISSION_DENIED':
        return JsonRpcErrorCode.SERVER_ERROR - 1 // -32001
      case 'RATE_LIMITED':
        return JsonRpcErrorCode.SERVER_ERROR - 2 // -32002
      default:
        return JsonRpcErrorCode.INTERNAL_ERROR
    }
  }

  /**
   * Process a single JSON-RPC request
   */
  async function processRequest(request: JsonRpcRequest, metadata: Record<string, string>): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null

    // Validate request structure
    if (request.jsonrpc !== '2.0') {
      return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC version', id)
    }

    if (typeof request.method !== 'string' || request.method === '') {
      return createError(JsonRpcErrorCode.INVALID_REQUEST, 'Method must be a non-empty string', id)
    }

    // Notifications (no id) don't get responses
    const isNotification = request.id === undefined

    try {
      // Convert params to payload
      let payload: unknown = {}
      if (Array.isArray(request.params)) {
        // Positional params - wrap in object with numeric keys or pass as-is
        payload = request.params.length === 1 ? request.params[0] : request.params
      } else if (request.params && typeof request.params === 'object') {
        payload = request.params
      }

      // Create context with metadata as extension
      let ctx = createContext(`jsonrpc-${Date.now()}`)
      if (timeout > 0) {
        ctx.deadline = Date.now() + timeout
      }
      // Add HTTP metadata to context
      ctx = withExtension(ctx, HttpMetadataKey, metadata)

      // Route the request - always use 'request' type for procedures
      // Notifications are just requests that don't return responses
      const result = await router.handle({
        id: String(id ?? `notif-${Date.now()}`),
        procedure: request.method,
        type: 'request',
        payload,
        metadata,
        context: ctx,
      })

      // Don't send response for notifications
      if (isNotification) {
        return null
      }

      // Handle result (could be envelope or stream)
      // For JSON-RPC, we only handle single responses, not streams
      const envelope = result as { type: string; payload: unknown }

      // Check if it's an error envelope
      if (envelope.type === 'error') {
        const errorPayload = envelope.payload as { code: string; message: string; details?: unknown }
        return createError(
          mapErrorCode(errorPayload.code),
          errorPayload.message,
          id,
          errorPayload.details
        )
      }

      return {
        jsonrpc: '2.0',
        result: envelope.payload,
        id,
      }
    } catch (error) {
      // Don't send error for notifications
      if (isNotification) {
        logger.warn({ method: request.method, error }, 'Notification handler error')
        return null
      }

      if (error instanceof RaffelError) {
        return createError(mapErrorCode(error.code), error.message, id, error.details)
      }

      logger.error({ method: request.method, error }, 'Unexpected error processing request')
      return createError(
        JsonRpcErrorCode.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error',
        id
      )
    }
  }

  /**
   * Handle HTTP request
   */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS preflight
    if (cors && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }

    // Only accept POST
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Method not allowed', null)))
      return
    }

    // Check path
    const urlPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname
    if (urlPath !== path) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Not found', null)))
      return
    }

    // Check content type
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('application/json')) {
      res.writeHead(415, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Content-Type must be application/json', null)))
      return
    }

    // Read body
    let body = ''
    let bodySize = 0

    try {
      for await (const chunk of req) {
        bodySize += chunk.length
        if (bodySize > maxBodySize) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Request body too large', null)))
          return
        }
        body += chunk
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.PARSE_ERROR, 'Failed to read request body', null)))
      return
    }

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.PARSE_ERROR, 'Parse error', null)))
      return
    }

    // Extract metadata from headers
    const metadata: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        metadata[key.toLowerCase()] = value
      }
    }

    // Set response headers
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (cors) {
      responseHeaders['Access-Control-Allow-Origin'] = '*'
    }

    // Handle batch requests
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        res.writeHead(200, responseHeaders)
        res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Empty batch', null)))
        return
      }

      logger.debug({ batchSize: parsed.length }, 'Processing batch request')

      const responses = await Promise.all(
        parsed.map((req) => processRequest(req as JsonRpcRequest, metadata))
      )

      // Filter out null responses (notifications)
      const filteredResponses = responses.filter((r): r is JsonRpcResponse => r !== null)

      // If all were notifications, don't send response
      if (filteredResponses.length === 0) {
        res.writeHead(204, responseHeaders)
        res.end()
        return
      }

      res.writeHead(200, responseHeaders)
      res.end(JSON.stringify(filteredResponses))
      return
    }

    // Single request
    logger.debug({ method: (parsed as JsonRpcRequest).method }, 'Processing request')

    const response = await processRequest(parsed as JsonRpcRequest, metadata)

    // Notification - no response
    if (response === null) {
      res.writeHead(204, responseHeaders)
      res.end()
      return
    }

    res.writeHead(200, responseHeaders)
    res.end(JSON.stringify(response))
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = createServer((req, res) => {
          handleRequest(req, res).catch((error) => {
            logger.error({ error }, 'Unhandled error in request handler')
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(createError(JsonRpcErrorCode.INTERNAL_ERROR, 'Internal error', null)))
            }
          })
        })

        server.on('error', reject)

        server.listen(port, host, () => {
          logger.info({ port, host, path }, 'JSON-RPC server listening')
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (!server) {
          resolve()
          return
        }

        server.close(() => {
          logger.info('JSON-RPC server stopped')
          server = null
          resolve()
        })
      })
    },

    getServer(): Server | null {
      return server
    },
  }
}
