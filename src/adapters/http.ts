/**
 * HTTP Adapter
 *
 * Exposes Raffel services over HTTP with REST-like mapping.
 * - Procedures: POST /procedure.name → request/response
 * - Streams: GET /procedure.name → Server-Sent Events
 * - Events: POST /events/event.name → fire-and-forget
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { sid } from '../utils/id/index.js'
import type { Router } from '../core/router.js'
import type { Envelope, Context } from '../types/index.js'
import { createContext } from '../types/context.js'
import { createLogger } from '../utils/logger.js'
import { extractMetadataFromHeaders } from '../utils/header-metadata.js'
import {
  jsonCodec,
  resolveCodecs,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../utils/content-codecs.js'

const logger = createLogger('http-adapter')

type RateLimitHeaderInfo = {
  limit?: number
  remaining?: number
  resetAt?: number
  retryAfter?: number
}

class BodyParseError extends Error {
  code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR' | 'INVALID_ARGUMENT'

  constructor(code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR' | 'INVALID_ARGUMENT', message: string) {
    super(message)
    this.code = code
  }
}

/**
 * HTTP middleware function.
 * Return true to indicate the request was handled, false to continue to next middleware/router.
 */
export type HttpMiddleware = (
  req: IncomingMessage,
  res: ServerResponse
) => boolean | Promise<boolean>

/**
 * HTTP adapter configuration
 */
export interface HttpAdapterOptions {
  /** Port to listen on */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Base path for all endpoints (default: '/') */
  basePath?: string

  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Context factory for creating request context */
  contextFactory?: (req: IncomingMessage) => Partial<Context>

  /** CORS configuration */
  cors?: {
    origin?: string | string[] | boolean
    methods?: string[]
    headers?: string[]
    credentials?: boolean
  } | boolean

  /** Additional codecs for content negotiation */
  codecs?: Codec[]

  /**
   * HTTP middleware to run before routing.
   * Middleware that returns true indicates it handled the request.
   */
  middleware?: HttpMiddleware[]
}

/**
 * HTTP Adapter interface
 */
export interface HttpAdapter {
  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Get the underlying HTTP server (for testing or custom routing) */
  readonly server: Server | null
}

/**
 * Parse request body using a codec
 */
function parseBody(
  req: IncomingMessage,
  maxSize: number,
  codec: Codec
): Promise<{ payload: unknown; size: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) {
        req.destroy()
        reject(new BodyParseError('PAYLOAD_TOO_LARGE', 'Request body too large'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (size === 0) {
        resolve({ payload: {}, size })
        return
      }

      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve({ payload: codec.decode(body), size })
      } catch {
        reject(new BodyParseError('PARSE_ERROR', 'Invalid request body'))
      }
    })

    req.on('error', reject)
  })
}

/**
 * Send response using a codec
 */
function sendEncoded(res: ServerResponse, status: number, data: unknown, codec: Codec): void {
  const body = codec.encode(data)
  res.writeHead(status, {
    'Content-Type': codec.contentTypes[0] ?? 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Send error response
 */
function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  sendEncoded(
    res,
    status,
    { error: { code, message, ...(details !== undefined && { details }) } },
    jsonCodec
  )
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value.join(',') : value
}

function requestHasBody(req: IncomingMessage): boolean {
  const lengthHeader = getHeaderValue(req.headers['content-length'])
  if (lengthHeader) {
    const length = Number.parseInt(lengthHeader, 10)
    if (Number.isFinite(length)) {
      return length > 0
    }
  }

  const transferEncoding = getHeaderValue(req.headers['transfer-encoding'])
  if (transferEncoding && transferEncoding.toLowerCase() !== 'identity') {
    return true
  }

  return false
}

function getRateLimitInfo(ctx: Context, details?: unknown): RateLimitHeaderInfo | null {
  const ctxInfo = (ctx as { rateLimitInfo?: RateLimitHeaderInfo }).rateLimitInfo
  const detailInfo = (details as RateLimitHeaderInfo | undefined) ?? undefined

  const limit = ctxInfo?.limit ?? detailInfo?.limit
  const remaining = ctxInfo?.remaining ?? detailInfo?.remaining
  const resetAt = ctxInfo?.resetAt ?? detailInfo?.resetAt
  const retryAfter = ctxInfo?.retryAfter ?? detailInfo?.retryAfter

  if (
    limit === undefined
    && remaining === undefined
    && resetAt === undefined
    && retryAfter === undefined
  ) {
    return null
  }

  return { limit, remaining, resetAt, retryAfter }
}

function applyRateLimitHeaders(
  res: ServerResponse,
  ctx: Context,
  details?: unknown,
  includeRetryAfter = false
): void {
  const info = getRateLimitInfo(ctx, details)
  if (!info) return

  if (info.limit !== undefined) {
    res.setHeader('X-RateLimit-Limit', info.limit.toString())
  }
  if (info.remaining !== undefined) {
    res.setHeader('X-RateLimit-Remaining', info.remaining.toString())
  }
  if (info.resetAt !== undefined) {
    res.setHeader('X-RateLimit-Reset', info.resetAt.toString())
  }
  if (includeRetryAfter && info.retryAfter !== undefined) {
    res.setHeader('Retry-After', info.retryAfter.toString())
  }
}

/**
 * Map Raffel error codes to HTTP status codes
 */
function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'NOT_ACCEPTABLE':
      return 406
    case 'INVALID_ARGUMENT':
    case 'INVALID_TYPE':
    case 'INVALID_ENVELOPE':
    case 'PARSE_ERROR':
    case 'VALIDATION_ERROR':
      return 400
    case 'UNPROCESSABLE_ENTITY':
      return 422
    case 'UNAUTHENTICATED':
      return 401
    case 'PERMISSION_DENIED':
      return 403
    case 'ALREADY_EXISTS':
      return 409
    case 'FAILED_PRECONDITION':
      return 412
    case 'PAYLOAD_TOO_LARGE':
    case 'MESSAGE_TOO_LARGE':
      return 413
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 415
    case 'RATE_LIMITED':
    case 'RESOURCE_EXHAUSTED':
      return 429
    case 'DEADLINE_EXCEEDED':
      return 504
    case 'BAD_GATEWAY':
      return 502
    case 'UNIMPLEMENTED':
      return 501
    case 'UNAVAILABLE':
      return 503
    case 'GATEWAY_TIMEOUT':
      return 504
    case 'CANCELLED':
      return 499
    case 'DATA_LOSS':
    case 'OUTPUT_VALIDATION_ERROR':
    case 'INTERNAL_ERROR':
    default:
      return 500
  }
}

/**
 * Set CORS headers
 */
function setCorsHeaders(
  res: ServerResponse,
  req: IncomingMessage,
  cors: HttpAdapterOptions['cors']
): void {
  if (cors === false) return

  const config = cors === true || cors === undefined
    ? {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
      }
    : cors

  // Origin
  if (config.origin === true) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  } else if (typeof config.origin === 'string') {
    res.setHeader('Access-Control-Allow-Origin', config.origin)
  } else if (Array.isArray(config.origin)) {
    const reqOrigin = req.headers.origin
    if (reqOrigin && config.origin.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin)
    }
  }

  // Methods
  if (config.methods) {
    res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '))
  }

  // Headers
  if (config.headers) {
    res.setHeader('Access-Control-Allow-Headers', config.headers.join(', '))
  }

  // Credentials
  if (config.credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
}

/**
 * Create a context with an abort signal tied to connection lifecycle
 */
function createAbortableContext(
  requestId: string,
  overrides: Partial<Context> | undefined,
  abortController: AbortController
): Context {
  const { signal: upstreamSignal, ...rest } = overrides ?? {}

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      abortController.abort(upstreamSignal.reason)
    } else {
      upstreamSignal.addEventListener(
        'abort',
        () => {
          abortController.abort(upstreamSignal.reason)
        },
        { once: true }
      )
    }
  }

  return createContext(
    requestId,
    { ...(rest as Partial<Omit<Context, 'requestId' | 'extensions'>>), signal: abortController.signal }
  )
}

/**
 * Create an HTTP adapter
 */
export function createHttpAdapter(
  router: Router,
  options: HttpAdapterOptions
): HttpAdapter {
  const {
    port,
    host = '0.0.0.0',
    basePath = '/',
    maxBodySize = 1024 * 1024, // 1MB
    cors,
  } = options
  const codecs = resolveCodecs(options.codecs)

  let server: Server | null = null

  /**
   * Extract procedure name from URL path
   * e.g., /users.create → users.create
   *       /api/users.create → users.create (with basePath=/api/)
   */
  function extractProcedure(pathname: string): { procedure: string; isEvent: boolean; isStream: boolean } {
    // Remove base path
    let path = pathname
    if (basePath !== '/') {
      const base = basePath.endsWith('/') ? basePath : basePath + '/'
      if (path.startsWith(base)) {
        path = '/' + path.slice(base.length)
      }
    }

    // Check for events prefix
    if (path.startsWith('/events/')) {
      return { procedure: path.slice(8), isEvent: true, isStream: false }
    }

    // Check for streams prefix
    if (path.startsWith('/streams/')) {
      return { procedure: path.slice(9), isEvent: false, isStream: true }
    }

    // Regular procedure
    return { procedure: path.slice(1), isEvent: false, isStream: false }
  }

  /**
   * Handle incoming HTTP request
   */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now()
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // Set CORS headers
    setCorsHeaders(res, req, cors)

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Run HTTP middleware (e.g., OpenAPI UI, static files)
    if (options.middleware) {
      for (const middleware of options.middleware) {
        const handled = await middleware(req, res)
        if (handled) {
          return
        }
      }
    }

    const abortController = new AbortController()
    const abort = (reason: string) => {
      if (!abortController.signal.aborted) {
        abortController.abort(reason)
      }
    }
    req.on('aborted', () => abort('Client aborted request'))
    res.on('close', () => {
      if (!res.writableEnded) {
        abort('Response closed early')
      }
    })

    const { procedure, isEvent, isStream } = extractProcedure(url.pathname)

    logger.debug({ method: req.method, path: url.pathname, procedure }, 'Request received')

    let ctx: Context | null = null

    try {
      // Build context
      const requestId = (req.headers['x-request-id'] as string) || sid()
      ctx = createAbortableContext(requestId, options.contextFactory?.(req), abortController)

      // Handle based on type
      if (isStream && req.method === 'GET') {
        // Stream via SSE
        await handleStream(req, res, procedure, url.searchParams, ctx)
      } else if (isEvent && req.method === 'POST') {
        // Fire-and-forget event
        await handleEvent(req, res, procedure, ctx)
      } else if (req.method === 'POST') {
        // Regular procedure call
        await handleProcedure(req, res, procedure, ctx)
      } else {
        if (ctx) {
          applyRateLimitHeaders(res, ctx)
        }
        sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method ${req.method} not allowed`)
      }
    } catch (err) {
      const error = err as Error
      logger.error({ err: error, procedure }, 'Request handler error')
      if (ctx) {
        applyRateLimitHeaders(res, ctx)
      }
      sendError(res, 500, 'INTERNAL_ERROR', error.message)
    } finally {
      logger.debug({ procedure, duration: Date.now() - startTime }, 'Request completed')
    }
  }

  /**
   * Handle procedure request (POST /procedure.name)
   */
  async function handleProcedure(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    ctx: Context
  ): Promise<void> {
    const accept = getHeaderValue(req.headers.accept)
    const responseCodec = selectCodecForAccept(accept, codecs, jsonCodec)
    if (!responseCodec) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 406, 'NOT_ACCEPTABLE', 'Not acceptable')
      return
    }

    const contentType = getHeaderValue(req.headers['content-type'])
    let requestCodec = jsonCodec
    if (contentType) {
      const selected = selectCodecForContentType(contentType, codecs)
      if (!selected) {
        applyRateLimitHeaders(res, ctx)
        sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
        return
      }
      requestCodec = selected
    } else if (requestHasBody(req)) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return
    }

    // Parse body
    let payload: unknown
    let bodySize = 0
    try {
      const parsed = await parseBody(req, maxBodySize, requestCodec)
      payload = parsed.payload
      bodySize = parsed.size
    } catch (err) {
      const error = err as Error
      if (error instanceof BodyParseError) {
        const status = mapErrorCodeToStatus(error.code)
        applyRateLimitHeaders(res, ctx)
        sendError(res, status, error.code, error.message)
        return
      }

      applyRateLimitHeaders(res, ctx)
      sendError(res, 400, 'INVALID_ARGUMENT', error.message)
      return
    }

    if (!contentType && bodySize > 0) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return
    }

    // Build envelope
    const envelope: Envelope = {
      id: ctx.requestId,
      procedure,
      type: 'request',
      payload,
      metadata: extractMetadataFromHeaders(req.headers),
      context: ctx,
    }

    // Route
    const result = await router.handle(envelope)

    // Check if error
    if (result && typeof result === 'object' && 'type' in result) {
      const resultEnvelope = result as Envelope
      if (resultEnvelope.type === 'error') {
        const errorPayload = resultEnvelope.payload as { code: string; message: string; details?: unknown }
        const status = mapErrorCodeToStatus(errorPayload.code)
        applyRateLimitHeaders(res, ctx, errorPayload.details, errorPayload.code === 'RATE_LIMITED')
        sendError(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
        return
      }

      // Success response
      applyRateLimitHeaders(res, ctx)
      sendEncoded(res, 200, resultEnvelope.payload, responseCodec)
    }
  }

  /**
   * Handle stream request (GET /streams/procedure.name)
   */
  async function handleStream(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    params: URLSearchParams,
    ctx: Context
  ): Promise<void> {
    // Convert query params to payload
    const payload: Record<string, unknown> = {}
    for (const [key, value] of params) {
      // Try to parse as JSON for complex types
      try {
        payload[key] = JSON.parse(value)
      } catch {
        payload[key] = value
      }
    }

    // Build envelope
    const envelope: Envelope = {
      id: ctx.requestId,
      procedure,
      type: 'stream:start',
      payload,
      metadata: extractMetadataFromHeaders(req.headers),
      context: ctx,
    }

    // Route
    const result = await router.handle(envelope)

    // Check if error
    if (result && typeof result === 'object' && 'type' in result && (result as Envelope).type === 'error') {
      const errorPayload = (result as Envelope).payload as { code: string; message: string; details?: unknown }
      const status = mapErrorCodeToStatus(errorPayload.code)
      sendError(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
      return
    }

    // Check if stream
    if (!result || typeof result !== 'object' || !(Symbol.asyncIterator in result)) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Handler did not return a stream')
      return
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    try {
      // Stream data as SSE events
      for await (const chunk of result as AsyncIterable<Envelope>) {
        if (ctx.signal.aborted) break
        if (res.destroyed) break

        const envelope = chunk as Envelope

        // Map envelope type to SSE event type
        let eventType = 'message'
        if (envelope.type === 'stream:data') {
          eventType = 'data'
        } else if (envelope.type === 'stream:end') {
          eventType = 'end'
        } else if (envelope.type === 'stream:error') {
          eventType = 'error'
        }

        // Send SSE event
        res.write(`event: ${eventType}\n`)
        res.write(`data: ${JSON.stringify(envelope.payload)}\n\n`)
      }
    } catch (err) {
      const error = err as Error
      logger.error({ err: error, procedure }, 'Stream error')
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ code: 'STREAM_ERROR', message: error.message })}\n\n`)
    } finally {
      res.end()
    }
  }

  /**
   * Handle event (POST /events/event.name)
   */
  async function handleEvent(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    ctx: Context
  ): Promise<void> {
    const accept = getHeaderValue(req.headers.accept)
    if (!selectCodecForAccept(accept, codecs, jsonCodec)) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 406, 'NOT_ACCEPTABLE', 'Not acceptable')
      return
    }

    const contentType = getHeaderValue(req.headers['content-type'])
    let requestCodec = jsonCodec
    if (contentType) {
      const selected = selectCodecForContentType(contentType, codecs)
      if (!selected) {
        applyRateLimitHeaders(res, ctx)
        sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
        return
      }
      requestCodec = selected
    } else if (requestHasBody(req)) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return
    }

    // Parse body
    let payload: unknown
    let bodySize = 0
    try {
      const parsed = await parseBody(req, maxBodySize, requestCodec)
      payload = parsed.payload
      bodySize = parsed.size
    } catch (err) {
      const error = err as Error
      if (error instanceof BodyParseError) {
        const status = mapErrorCodeToStatus(error.code)
        applyRateLimitHeaders(res, ctx)
        sendError(res, status, error.code, error.message)
        return
      }

      applyRateLimitHeaders(res, ctx)
      sendError(res, 400, 'INVALID_ARGUMENT', error.message)
      return
    }

    if (!contentType && bodySize > 0) {
      applyRateLimitHeaders(res, ctx)
      sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return
    }

    // Build envelope
    const envelope: Envelope = {
      id: ctx.requestId,
      procedure,
      type: 'event',
      payload,
      metadata: extractMetadataFromHeaders(req.headers),
      context: ctx,
    }

    // Route (fire-and-forget, but we still check for routing errors)
    const result = await router.handle(envelope)

    // Check if routing error
    if (result && typeof result === 'object' && 'type' in result) {
      const resultEnvelope = result as Envelope
      if (resultEnvelope.type === 'error') {
        const errorPayload = resultEnvelope.payload as { code: string; message: string; details?: unknown }
        const status = mapErrorCodeToStatus(errorPayload.code)
        applyRateLimitHeaders(res, ctx, errorPayload.details, errorPayload.code === 'RATE_LIMITED')
        sendError(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
        return
      }
    }

    // Accepted (fire-and-forget)
    applyRateLimitHeaders(res, ctx)
    res.writeHead(202)
    res.end()
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = createServer(handleRequest)

        server.on('error', (err) => {
          logger.error({ err }, 'HTTP server error')
          reject(err)
        })

        server.listen(port, host, () => {
          logger.info({ port, host, basePath }, 'HTTP server listening')
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (server) {
          server.close(() => {
            logger.info('HTTP server stopped')
            server = null
            resolve()
          })
        } else {
          resolve()
        }
      })
    },

    get server(): Server | null {
      return server
    },
  }
}
