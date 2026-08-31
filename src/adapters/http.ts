/**
 * HTTP Adapter
 *
 * Exposes Raffel services over HTTP with REST-like mapping.
 * - Procedures: POST /procedure.name → request/response
 * - Streams: GET /procedure.name → Server-Sent Events
 * - Events: POST /events/event.name → fire-and-forget
 */

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { resolveTlsOptions, type TlsOptions } from '../utils/tls.js'
import type { Router } from '../core/router.js'
import type { Envelope, Context, ContextSeed } from '../types/index.js'
import type { StreamOperationalControls } from '../types/index.js'
import type { Tracer, Span, SpanContext } from '../tracing/index.js'
import { createLogger } from '../utils/logger.js'
import { extractMetadataFromHeaders } from '../utils/header-metadata.js'
import { applyRateLimitHeaders } from '../http/rate-limit-headers.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import {
  applyHttpRouteToSpan,
  bindContextToSpan,
  extractHttpBaggageHeader,
  extractHttpParentContext,
  finishHttpServerSpan,
  getHttpTelemetryRoute,
  setHttpTelemetryRoute,
  setTraceResponseHeaders,
  startHttpServerSpan,
} from '../tracing/index.js'
import { parseBaggageHeader } from '../tracing/baggage.js'
import type { Baggage } from '../tracing/index.js'
import {
  resolveCodecs,
  type Codec,
} from '../utils/content-codecs.js'
import type { TrustedProxyConfig } from '../utils/client-ip.js'
import type { ClosableHttpServer } from '../types/server.js'
import { getStatusForCode } from '../errors/codes.js'
import {
  createHttpRequestContext,
  dispatchHttpEnvelope,
  resolveHttpRequestBody,
  resolveHttpResponseCodec,
  searchParamsToQuery,
  sendErrorResponse,
} from '../server/http-lifecycle/index.js'
import { writeSseStream } from './sse-runtime.js'

const logger = createLogger('http-adapter')

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

  /** Host to bind to (default: '127.0.0.1') */
  host?: string

  /** Base path for all endpoints (default: '/') */
  basePath?: string

  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Context factory for creating request context */
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>

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

  /** Optional tracer used to create one server span per HTTP request. */
  tracer?: Tracer

  /**
   * Create Raffel's HTTP server span. Set to false when platform
   * auto-instrumentation already owns the active server span.
   * Default: true.
   */
  createServerSpan?: boolean

  /**
   * When false, start() creates the http.Server but does not call listen().
   * Useful when an external TCP server manages connection dispatch (single-port mode).
   * Default: true
   */
  listenOnStart?: boolean

  /**
   * TLS configuration for HTTPS.
   * - `true`: auto-generates a self-signed certificate for localhost
   * - `TlsOptions`: inline PEM, file paths (K8s volume mounts), or env vars (base64)
   */
  tls?: boolean | TlsOptions

  /**
   * Trusted proxy IPs/CIDRs used to resolve client IP from forwarding headers.
   * When false, forwarding headers are ignored for client IP resolution.
   * @default false
   */
  trustedProxies?: TrustedProxyConfig

  /** Resolve connection-scoped controls for a registered Live Stream. */
  resolveStreamControls?: (procedure: string) => StreamOperationalControls | undefined
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
 * Map Raffel error codes to HTTP status codes.
 * Delegates to the central error code registry.
 */
const mapErrorCodeToStatus = getStatusForCode

/**
 * Set CORS headers
 */
function setCorsHeaders(
  res: ServerResponse,
  req: IncomingMessage,
  cors: HttpAdapterOptions['cors']
): void {
  if (cors === false || cors === undefined) return

  const config = cors === true
    ? {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
      }
    : cors

  if (config.credentials && (config.origin === '*' || config.origin === true)) {
    throw new TypeError('CORS credentials require an explicit origin allowlist')
  }

  // Origin
  if (config.origin === true) {
    // `origin: true` is intentionally credentialless (guarded above), so a
    // wildcard is sufficient and avoids reflecting attacker-controlled input.
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (typeof config.origin === 'string') {
    res.setHeader('Access-Control-Allow-Origin', config.origin)
  } else if (Array.isArray(config.origin)) {
    const reqOrigin = req.headers.origin
    if (reqOrigin && config.origin.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin)
      res.setHeader('Vary', 'Origin')
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
 * Create an HTTP adapter
 */
export function createHttpAdapter(
  router: Router,
  options: HttpAdapterOptions
): HttpAdapter {
  const {
    port,
    host = '127.0.0.1',
    basePath = '/',
    maxBodySize = 1024 * 1024, // 1MB
    cors,
    trustedProxies = false,
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

  function routeForProcedure(procedure: string, isEvent: boolean, isStream: boolean): string {
    const normalizedBase = basePath === '/' ? '' : basePath.replace(/\/$/, '')
    if (isEvent) return `${normalizedBase}/events/${procedure}`
    if (isStream) return `${normalizedBase}/streams/${procedure}`
    return `${normalizedBase}/${procedure}`
  }

  /**
   * Handle incoming HTTP request
   */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startTime = Date.now()
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const { procedure, isEvent, isStream } = extractProcedure(url.pathname)
    setHttpTelemetryRoute(req, {
      route: routeForProcedure(procedure, isEvent, isStream),
      procedure,
    })

    let span: Span | undefined
    let parentContext: SpanContext | undefined
    let baggage: Baggage = {}
    let spanCompleted = false
    let ownsSpan = false
    if (options.tracer) {
      baggage = parseBaggageHeader(extractHttpBaggageHeader(req.headers))
      if (options.createServerSpan !== false) {
        parentContext = extractHttpParentContext(options.tracer, req.headers)
        span = startHttpServerSpan(options.tracer, {
          method,
          url,
          protocolVersion: req.httpVersion,
          route: getHttpTelemetryRoute(req)?.route,
          procedure,
          remoteAddress: req.socket?.remoteAddress,
          remotePort: req.socket?.remotePort,
        }, parentContext)
        ownsSpan = true
        setTraceResponseHeaders(res, span)
      } else {
        span = options.tracer.getActiveSpan()
      }
    }

    const completeSpan = () => {
      if (!span || spanCompleted) return
      // A borrowed span (createServerSpan: false) belongs to an outer
      // instrumentation layer: it still receives the route attributes, but is
      // neither renamed nor finished here — ending the caller's span
      // mid-flight or renaming it would clobber the outer layer's telemetry.
      applyHttpRouteToSpan(span, method, getHttpTelemetryRoute(req), { rename: ownsSpan })
      if (ownsSpan) {
        finishHttpServerSpan(span, res.statusCode)
      }
      spanCompleted = true
    }

    // The rest of this handler runs with `span`/`baggage` as the tracer's
    // active span/baggage — scoped via `runInSpanContext` (not a manual
    // enterWith+restore pair) so it correctly unwinds to whatever was
    // active before, no matter how many awaits happen below. When there's
    // no tracer, `span`/`baggage` are `undefined`/`{}` and this is a no-op
    // pass-through.
    return (options.tracer?.runInSpanContext(span, baggage, () => handleTracedRequest()) ??
      handleTracedRequest())

    async function handleTracedRequest(): Promise<void> {
      // Set CORS headers
      setCorsHeaders(res, req, cors)

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        completeSpan()
        return
      }

      // Run HTTP middleware (e.g., OpenAPI UI, static files)
      if (options.middleware) {
        for (const middleware of options.middleware) {
          const handled = await middleware(req, res)
          if (handled) {
            completeSpan()
            return
          }
        }
      }

      logger.debug({ method: req.method, path: url.pathname, procedure }, 'Request received')

      let ctx: Context | null = null
      let requestAbortController: AbortController | undefined

      try {
        // For methods that carry a request body, parse it first so the raw
        // bytes can be captured into the context for HMAC verification
        // (Stripe, Svix, GitHub webhooks, etc.). See issue #114.
        let parsedBody: { payload: unknown; size: number; raw?: Buffer } | null = null
        const carriesBody =
          req.method === 'POST' && (isEvent || (!isStream))
        if (carriesBody) {
          // Validate response codec before reading the body so we still emit
          // 406/415 cleanly when negotiation fails.
          const responseCodecCheck = resolveHttpResponseCodec(req, res, codecs)
          if (!responseCodecCheck) return
          parsedBody = await resolveHttpRequestBody({ req, res, codecs, maxBodySize })
          if (!parsedBody) return
        }

        const requestContext = await createHttpRequestContext({
          req,
          res,
          method,
          url,
          input: {
            query: searchParamsToQuery(url.searchParams),
            body: parsedBody?.payload,
          },
          rawBody: parsedBody?.raw,
          trustedProxies,
          contextFactory: options.contextFactory,
        })
        ctx = requestContext.ctx
        requestAbortController = requestContext.abortController
        if (span) {
          bindContextToSpan(ctx, span, parentContext, baggage)
        }

        // Handle based on type
        if (isStream && method === 'GET') {
          // Stream via SSE
          await handleStream(
            req,
            res,
            procedure,
            url.searchParams,
            ctx,
            requestAbortController
          )
        } else if (isEvent && method === 'POST') {
          // Fire-and-forget event
          await handleEvent(req, res, procedure, ctx, parsedBody!.payload)
        } else if (method === 'POST') {
          // Regular procedure call
          await handleProcedure(req, res, procedure, ctx, parsedBody!.payload)
        } else {
          sendErrorResponse(res, 405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed`)
        }
      } catch (err) {
        const error = err as Error
        span?.recordError(error)
        logger.error({ err: error, procedure }, 'Request handler error')
        if (ctx) {
          applyRateLimitHeaders(res, ctx)
        }
        sendErrorResponse(res, 500, 'INTERNAL_ERROR', error.message)
      } finally {
        completeSpan()
        logger.debug({ procedure, duration: Date.now() - startTime }, 'Request completed')
      }
    }
  }

  async function handleProcedure(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    ctx: Context,
    payload: unknown
  ): Promise<void> {
    const responseCodec = resolveHttpResponseCodec(req, res, codecs)
    if (!responseCodec) return

    await dispatchHttpEnvelope({
      res,
      router,
      procedure,
      payload,
      metadata: ctx.input.metadata as Record<string, string>,
      ctx,
      responseCodec,
      method: req.method ?? 'POST',
    })
  }

  /**
   * Handle stream request (GET /streams/procedure.name)
   */
  async function handleStream(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    params: URLSearchParams,
    ctx: Context,
    abortController: AbortController
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
    ctx.input = {
      ...ctx.input,
      body: payload,
    }
    ctx.stream = {
      kind: 'stream',
      mode: 'sse',
      id: ctx.requestId,
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
      sendErrorResponse(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
      return
    }

    // Check if stream
    if (!isAsyncIterable(result)) {
      sendErrorResponse(res, 500, 'INTERNAL_ERROR', 'Handler did not return a stream')
      return
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    await writeSseStream({
      stream: result as AsyncIterable<Envelope>,
      signal: ctx.signal,
      controls: options.resolveStreamControls?.(procedure),
      abort: (reason) => abortController.abort(reason),
      write: (chunk) => { res.write(chunk) },
      end: () => { res.end() },
      isClosed: () => res.destroyed || res.writableEnded,
      onError: (error) => logger.error({ err: error, procedure }, 'Stream error'),
    })
  }

  /**
   * Handle event (POST /events/event.name)
   */
  async function handleEvent(
    req: IncomingMessage,
    res: ServerResponse,
    procedure: string,
    ctx: Context,
    payload: unknown
  ): Promise<void> {
    if (!resolveHttpResponseCodec(req, res, codecs)) {
      return
    }

    // Build envelope
    const envelope: Envelope = {
      id: ctx.requestId,
      procedure,
      type: 'event',
      payload,
      metadata: ctx.input.metadata as Record<string, string>,
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
        sendErrorResponse(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
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
      if (options.tls) {
        const tlsConfig = options.tls === true ? {} : options.tls
        const resolved = await resolveTlsOptions(tlsConfig)
        if (resolved.autoGenerated) {
          logger.warn('Using auto-generated self-signed certificate (development only)')
        }
        server = createHttpsServer(
          { key: resolved.key, cert: resolved.cert, ca: resolved.ca },
          handleRequest
        ) as unknown as Server
      } else {
        server = createHttpServer(handleRequest)
      }

      return new Promise((resolve, reject) => {
        server!.on('error', (err) => {
          logger.error({ err }, 'HTTP server error')
          reject(err)
        })
        server!.on('clientError', (err, socket) => {
          const netSocket = socket as unknown as import('node:net').Socket
          logger.warn(
            {
              err: err.message,
              remoteAddress: netSocket.remoteAddress,
              remotePort: netSocket.remotePort,
              host,
              port,
            },
            'HTTP client error on front-door listener'
          )
          if (!socket.destroyed) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
          }
        })

        if (options.listenOnStart === false) {
          resolve()
          return
        }

        server!.listen(port, host, () => {
          const protocol = options.tls ? 'HTTPS' : 'HTTP'
          logger.info({ port, host, basePath, protocol }, `${protocol} server listening`)
          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        if (server) {
          const activeServer = server as ClosableHttpServer
          activeServer.closeIdleConnections?.()
          activeServer.close(() => {
            logger.info('HTTP server stopped')
            server = null
            resolve()
          })
          activeServer.closeAllConnections?.()
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
