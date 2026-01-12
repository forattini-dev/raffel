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
import { extractMetadataFromHeaders } from '../utils/header-metadata.js'
import {
  jsonCodec,
  resolveCodecs,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../utils/content-codecs.js'

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

  /** Additional codecs for content negotiation */
  codecs?: Codec[]
}

export type JsonRpcMiddlewareOptions = Omit<JsonRpcAdapterOptions, 'port' | 'host'>

export interface JsonRpcAdapter {
  /** Start the server */
  start(): Promise<void>
  /** Stop the server */
  stop(): Promise<void>
  /** Get the underlying HTTP server */
  getServer(): Server | null
}

function createJsonRpcHandler(
  router: Router,
  options: JsonRpcAdapterOptions | JsonRpcMiddlewareOptions
): {
  handleRequest: (req: IncomingMessage, res: ServerResponse, opts?: { skipPathCheck?: boolean }) => Promise<void>
  createError: (code: number, message: string, id: string | number | null, data?: unknown) => JsonRpcResponse
} {
  const {
    path = '/',
    cors = true,
    maxBodySize = 1024 * 1024, // 1MB
    timeout = 30000,
  } = options
  const codecs = resolveCodecs(options.codecs)

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
      case 'UNPROCESSABLE_ENTITY':
        return JsonRpcErrorCode.INVALID_PARAMS
      case 'INVALID_TYPE':
      case 'INVALID_ENVELOPE':
        return JsonRpcErrorCode.INVALID_REQUEST
      case 'PARSE_ERROR':
        return JsonRpcErrorCode.PARSE_ERROR
      case 'UNAUTHENTICATED':
      case 'PERMISSION_DENIED':
        return JsonRpcErrorCode.SERVER_ERROR - 1 // -32001
      case 'RATE_LIMITED':
      case 'RESOURCE_EXHAUSTED':
        return JsonRpcErrorCode.SERVER_ERROR - 2 // -32002
      case 'NOT_ACCEPTABLE':
      case 'UNSUPPORTED_MEDIA_TYPE':
      case 'PAYLOAD_TOO_LARGE':
      case 'MESSAGE_TOO_LARGE':
      case 'FAILED_PRECONDITION':
      case 'ALREADY_EXISTS':
      case 'DEADLINE_EXCEEDED':
      case 'UNAVAILABLE':
      case 'BAD_GATEWAY':
      case 'GATEWAY_TIMEOUT':
        return JsonRpcErrorCode.SERVER_ERROR
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
  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    opts?: { skipPathCheck?: boolean }
  ): Promise<void> {
    const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined
    const responseCodec = selectCodecForAccept(accept, codecs, jsonCodec)
    if (!responseCodec) {
      res.writeHead(406, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(createError(JsonRpcErrorCode.INVALID_REQUEST, 'Not acceptable', null)))
      return
    }

    const contentType = typeof req.headers['content-type'] === 'string'
      ? req.headers['content-type']
      : undefined
    if (contentType) {
      const requestCodec = selectCodecForContentType(contentType, codecs)
      if (!requestCodec || requestCodec.name === 'csv') {
        const errorResponse = createError(JsonRpcErrorCode.INVALID_REQUEST, 'Unsupported media type', null)
        res.writeHead(415, {
          'Content-Type': responseCodec.contentTypes[0] ?? 'application/json',
        })
        res.end(responseCodec.encode(errorResponse))
        return
      }
    }

    const sendResponse = (status: number, payload: JsonRpcResponse | JsonRpcResponse[]) => {
      const headers: Record<string, string> = {
        'Content-Type': responseCodec.contentTypes[0] ?? 'application/json',
      }
      if (cors) {
        headers['Access-Control-Allow-Origin'] = '*'
      }
      res.writeHead(status, headers)
      res.end(responseCodec.encode(payload))
    }

    // CORS preflight
    if (cors && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, X-Request-Id, Traceparent, Tracestate',
        'Access-Control-Max-Age': '86400',
      })
      res.end()
      return
    }

    // Only accept POST
    if (req.method !== 'POST') {
      sendResponse(405, createError(JsonRpcErrorCode.INVALID_REQUEST, 'Method not allowed', null))
      return
    }

    // Check path
    if (!opts?.skipPathCheck) {
      const urlPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname
      if (urlPath !== path) {
        sendResponse(404, createError(JsonRpcErrorCode.INVALID_REQUEST, 'Not found', null))
        return
      }
    }

    // Read body
    let body = ''
    let bodySize = 0

    try {
      for await (const chunk of req) {
        bodySize += chunk.length
        if (bodySize > maxBodySize) {
          sendResponse(413, createError(JsonRpcErrorCode.INVALID_REQUEST, 'Request body too large', null))
          return
        }
        body += chunk
      }
    } catch {
      sendResponse(400, createError(JsonRpcErrorCode.PARSE_ERROR, 'Failed to read request body', null))
      return
    }

    if (!contentType && bodySize > 0) {
      sendResponse(415, createError(JsonRpcErrorCode.INVALID_REQUEST, 'Unsupported media type', null))
      return
    }

    // Parse JSON
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      sendResponse(200, createError(JsonRpcErrorCode.PARSE_ERROR, 'Parse error', null))
      return
    }

    // Extract metadata from headers
    const metadata = extractMetadataFromHeaders(req.headers)

    // Handle batch requests
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        sendResponse(200, createError(JsonRpcErrorCode.INVALID_REQUEST, 'Empty batch', null))
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
        res.writeHead(204, cors ? { 'Access-Control-Allow-Origin': '*' } : undefined)
        res.end()
        return
      }

      sendResponse(200, filteredResponses)
      return
    }

    // Single request
    logger.debug({ method: (parsed as JsonRpcRequest).method }, 'Processing request')

    const response = await processRequest(parsed as JsonRpcRequest, metadata)

    // Notification - no response
    if (response === null) {
      res.writeHead(204, cors ? { 'Access-Control-Allow-Origin': '*' } : undefined)
      res.end()
      return
    }

    sendResponse(200, response)
  }

  return { handleRequest, createError }
}

/**
 * Create a JSON-RPC 2.0 HTTP adapter
 */
export function createJsonRpcAdapter(router: Router, options: JsonRpcAdapterOptions): JsonRpcAdapter {
  const { port, host = '0.0.0.0', path = '/' } = options
  const { handleRequest, createError } = createJsonRpcHandler(router, options)
  let server: Server | null = null

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

export function createJsonRpcMiddleware(
  router: Router,
  options: JsonRpcMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const path = options.path || '/'
  const { handleRequest } = createJsonRpcHandler(router, options)

  return async (req, res) => {
    const urlPath = new URL(req.url || '/', `http://${req.headers.host}`).pathname
    if (urlPath !== path) {
      return false
    }
    await handleRequest(req, res, { skipPathCheck: true })
    return true
  }
}
