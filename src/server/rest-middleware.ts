/**
 * REST Middleware for Server
 *
 * HTTP middleware for routing REST resources with proper verb matching.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LoadedRestResource } from './fs-routes/index.js'
import type { Router } from '../core/router.js'
import type { Registry } from '../core/registry.js'
import type { Context, Envelope } from '../types/index.js'
import { createContext } from '../types/context.js'
import { getStatusForCode } from '../errors/codes.js'
import { sid } from '../utils/id/index.js'
import { createLogger } from '../utils/logger.js'
import { extractMetadataFromHeaders } from '../utils/header-metadata.js'
import {
  jsonCodec,
  resolveCodecs,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../utils/content-codecs.js'
import { joinBasePath } from './channel-utils.js'

const logger = createLogger('server')

type RateLimitHeaderInfo = {
  limit?: number
  remaining?: number
  resetAt?: number
  retryAfter?: number
}

class BodyParseError extends Error {
  code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR'

  constructor(code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR', message: string) {
    super(message)
    this.code = code
  }
}

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

function getRateLimitInfo(ctx: Context, details?: unknown): RateLimitHeaderInfo | null {
  const ctxInfo = (ctx as { rateLimitInfo?: RateLimitHeaderInfo }).rateLimitInfo
  const detailInfo = (details as RateLimitHeaderInfo | undefined) ?? undefined

  const limit = detailInfo?.limit ?? ctxInfo?.limit
  const remaining = detailInfo?.remaining ?? ctxInfo?.remaining
  const resetAt = detailInfo?.resetAt ?? ctxInfo?.resetAt
  const retryAfter = detailInfo?.retryAfter ?? ctxInfo?.retryAfter

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

async function parseRequestBody(
  req: IncomingMessage,
  maxSize: number,
  codec: Codec
): Promise<{ payload: unknown; size: number }> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > maxSize) {
      throw new BodyParseError('PAYLOAD_TOO_LARGE', 'Request body too large')
    }
    chunks.push(chunk)
  }

  if (size === 0) {
    return { payload: {}, size }
  }

  try {
    const body = Buffer.concat(chunks).toString('utf-8')
    return { payload: codec.decode(body), size }
  } catch {
    throw new BodyParseError('PARSE_ERROR', 'Invalid request body')
  }
}

function sendEncodedResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
  codec: Codec,
  includeBody = true
): void {
  const body = codec.encode(data)
  res.writeHead(status, {
    'Content-Type': codec.contentTypes[0] ?? 'application/json',
    'Content-Length': includeBody ? Buffer.byteLength(body) : 0,
  })
  if (includeBody) {
    res.end(body)
  } else {
    res.end()
  }
}

function sendErrorResponse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  sendEncodedResponse(
    res,
    status,
    { error: { code, message, ...(details !== undefined && { details }) } },
    jsonCodec
  )
}

function parseQueryParams(params: URLSearchParams): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of params) {
    try {
      payload[key] = JSON.parse(value)
    } catch {
      payload[key] = value
    }
  }
  return payload
}

/**
 * Create a middleware function that handles REST resource routing
 */
export interface RestMiddlewareOptions {
  restResources: LoadedRestResource[]
  router: Router
  basePath: string
  maxBodySize: number
  contextFactory?: (req: IncomingMessage) => Partial<Context>
  codecs?: Codec[]
}

export interface HttpOverrideMiddlewareOptions {
  router: Router
  registry: Registry
  basePath: string
  maxBodySize: number
  contextFactory?: (req: IncomingMessage) => Partial<Context>
  codecs?: Codec[]
}

export function createRestMiddleware(
  options: RestMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const {
    restResources,
    router,
    basePath,
    maxBodySize,
    contextFactory,
    codecs: configuredCodecs,
  } = options
  const codecs = resolveCodecs(configuredCodecs)

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const method = (req.method || 'GET').toUpperCase()

    for (const resource of restResources) {
      for (const route of resource.routes) {
        if (route.method !== method) continue

        // Match path with params (e.g., /users/:id)
        const fullPath = joinBasePath(basePath, route.path)
        const pathPattern = fullPath.replace(/:(\w+)/g, '([^/]+)')
        const regex = new RegExp(`^${pathPattern}$`)
        const match = url.pathname.match(regex)

        if (match) {
          // Extract params
          const paramNames = (fullPath.match(/:(\w+)/g) || []).map((p: string) => p.slice(1))
          const params: Record<string, string> = {}
          paramNames.forEach((name: string, i: number) => {
            params[name] = match[i + 1]
          })

          // Parse query string
          const query: Record<string, any> = {}
          for (const [key, value] of url.searchParams) {
            if (key === 'page' || key === 'limit') {
              query[key] = parseInt(value, 10)
            } else {
              query[key] = value
            }
          }

          const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined
          const responseCodec = selectCodecForAccept(accept, codecs, jsonCodec)
          if (!responseCodec) {
            sendErrorResponse(res, 406, 'NOT_ACCEPTABLE', 'Not acceptable')
            return true
          }

          const contentType = typeof req.headers['content-type'] === 'string'
            ? req.headers['content-type']
            : undefined
          let requestCodec = jsonCodec
          if (contentType) {
            const selected = selectCodecForContentType(contentType, codecs)
            if (!selected) {
              sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
              return true
            }
            requestCodec = selected
          }

          let body: unknown = {}
          let bodySize = 0
          if (['POST', 'PUT', 'PATCH'].includes(method)) {
            try {
              const parsed = await parseRequestBody(req, maxBodySize, requestCodec)
              body = parsed.payload
              bodySize = parsed.size
            } catch (err) {
              if (err instanceof BodyParseError) {
                sendErrorResponse(res, getStatusForCode(err.code), err.code, err.message)
                return true
              }
              sendErrorResponse(res, 400, 'INVALID_ARGUMENT', (err as Error).message)
              return true
            }
          }

          if (!contentType && bodySize > 0) {
            sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
            return true
          }

          const abortController = new AbortController()
          const requestId = (req.headers['x-request-id'] as string) || sid()
          const ctx = createAbortableContext(requestId, contextFactory?.(req), abortController) as any
          ctx.params = params
          ctx.query = query
          ctx.operation = route.operation
          ctx.resource = resource.name

          req.on('aborted', () => abortController.abort('Client aborted request'))
          res.on('close', () => {
            if (!res.writableEnded) {
              abortController.abort('Response closed early')
            }
          })

          try {
            const envelope: Envelope = {
              id: requestId,
              procedure: `${resource.name}.${route.operation}`,
              type: 'request',
              payload: body,
              metadata: extractMetadataFromHeaders(req.headers),
              context: ctx,
            }
            const result = await router.handle(envelope)

            if (result && typeof result === 'object' && 'type' in result) {
              const resultEnvelope = result as Envelope
              if (resultEnvelope.type === 'error') {
                const errorPayload = resultEnvelope.payload as {
                  code: string
                  message: string
                  details?: unknown
                  status?: number
                }
                const status = errorPayload.status ?? getStatusForCode(errorPayload.code)
                applyRateLimitHeaders(res, ctx, errorPayload.details, errorPayload.code === 'RATE_LIMITED')
                sendErrorResponse(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
                return true
              }
              applyRateLimitHeaders(res, ctx)
              sendEncodedResponse(res, 200, resultEnvelope.payload, responseCodec, method !== 'HEAD')
              return true
            }

            applyRateLimitHeaders(res, ctx)
            sendEncodedResponse(res, 200, result, responseCodec, method !== 'HEAD')
            return true
          } catch (err: any) {
            const status = err.status ?? err.httpStatus ?? 500
            sendErrorResponse(
              res,
              status,
              err.code || 'INTERNAL_ERROR',
              err.message || 'Internal server error'
            )
            return true
          }
        }
      }
    }
    return false
  }
}

export function createHttpOverrideMiddleware(
  options: HttpOverrideMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const {
    router,
    registry,
    basePath,
    maxBodySize,
    contextFactory,
    codecs: configuredCodecs,
  } = options
  const codecs = resolveCodecs(configuredCodecs)

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const method = (req.method || 'GET').toUpperCase()

    for (const meta of registry.listProcedures()) {
      if (!meta.httpPath) continue
      if (meta.httpMethod && meta.httpMethod.toUpperCase() !== method) continue

      const normalized = meta.httpPath.startsWith('/') ? meta.httpPath : `/${meta.httpPath}`
      const fullPath = basePath !== '/' && !normalized.startsWith(basePath)
        ? joinBasePath(basePath, normalized)
        : normalized

      if (url.pathname !== fullPath && url.pathname !== `${fullPath}/`) continue

      const accept = typeof req.headers.accept === 'string' ? req.headers.accept : undefined
      const responseCodec = selectCodecForAccept(accept, codecs, jsonCodec)
      if (!responseCodec) {
        sendErrorResponse(res, 406, 'NOT_ACCEPTABLE', 'Not acceptable')
        return true
      }

      const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type']
        : undefined
      let requestCodec = jsonCodec
      if (contentType) {
        const selected = selectCodecForContentType(contentType, codecs)
        if (!selected) {
          sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
          return true
        }
        requestCodec = selected
      }

      let payload: unknown = {}
      let bodySize = 0
      if (method === 'GET' || method === 'HEAD') {
        payload = parseQueryParams(url.searchParams)
      } else {
        try {
          const parsed = await parseRequestBody(req, maxBodySize, requestCodec)
          payload = parsed.payload
          bodySize = parsed.size
        } catch (err) {
          if (err instanceof BodyParseError) {
            sendErrorResponse(res, getStatusForCode(err.code), err.code, err.message)
            return true
          }
          sendErrorResponse(res, 400, 'INVALID_ARGUMENT', (err as Error).message)
          return true
        }
      }

      if (!contentType && bodySize > 0) {
        sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
        return true
      }

      const abortController = new AbortController()
      const requestId = (req.headers['x-request-id'] as string) || sid()
      const ctx = createAbortableContext(requestId, contextFactory?.(req), abortController)

      req.on('aborted', () => abortController.abort('Client aborted request'))
      res.on('close', () => {
        if (!res.writableEnded) {
          abortController.abort('Response closed early')
        }
      })

      try {
        const envelope: Envelope = {
          id: requestId,
          procedure: meta.name,
          type: 'request',
          payload,
          metadata: extractMetadataFromHeaders(req.headers),
          context: ctx,
        }
        const result = await router.handle(envelope)

        if (result && typeof result === 'object' && 'type' in result) {
          const resultEnvelope = result as Envelope
          if (resultEnvelope.type === 'error') {
            const errorPayload = resultEnvelope.payload as {
              code: string
              message: string
              details?: unknown
              status?: number
            }
            const status = errorPayload.status ?? getStatusForCode(errorPayload.code)
            applyRateLimitHeaders(res, ctx, errorPayload.details, errorPayload.code === 'RATE_LIMITED')
            sendErrorResponse(res, status, errorPayload.code, errorPayload.message, errorPayload.details)
            return true
          }
          applyRateLimitHeaders(res, ctx)
          sendEncodedResponse(res, 200, resultEnvelope.payload, responseCodec, method !== 'HEAD')
          return true
        }

        applyRateLimitHeaders(res, ctx)
        sendEncodedResponse(res, 200, result, responseCodec, method !== 'HEAD')
        return true
      } catch (err: any) {
        const status = err.status ?? err.httpStatus ?? 500
        sendErrorResponse(res, status, err.code || 'INTERNAL_ERROR', err.message || 'Internal server error')
        return true
      }
    }

    return false
  }
}

/**
 * Log REST middleware registration
 */
export function logRestMiddlewareRegistered(count: number): void {
  logger.info({ count }, 'REST middleware registered')
}

/**
 * Create a middleware for serving documentation routes
 */
export function createDocsRouteMiddleware(
  routes: Array<{ method: string; path: string; handler: () => Response | null }>
): (req: any, res: any) => Promise<boolean> {
  return async (req: any, res: any) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    for (const route of routes) {
      if (req.method === route.method && (url.pathname === route.path || url.pathname === route.path + '/')) {
        const response = route.handler()
        if (response) {
          const contentType = response.headers.get('Content-Type') || 'application/octet-stream'
          res.writeHead(response.status, { 'Content-Type': contentType })
          res.end(await response.text())
          return true
        }
      }
    }
    return false
  }
}
