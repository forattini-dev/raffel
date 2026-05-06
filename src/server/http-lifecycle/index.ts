import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Router } from '../../core/router.js'
import { getStatusForCode } from '../../errors/codes.js'
import { applyRateLimitHeaders } from '../../http/rate-limit-headers.js'
import type { Context, ContextSeed, Envelope } from '../../types/index.js'
import { mergeContextSeeds } from '../../types/index.js'
import { createAbortableContextAsync } from '../../utils/context-utils.js'
import { resolveClientIp, type TrustedProxyConfig } from '../../utils/client-ip.js'
import {
  jsonCodec,
  selectCodecForAccept,
  selectCodecForContentType,
  type Codec,
} from '../../utils/content-codecs.js'
import { extractMetadataFromHeaders, mergeMetadata } from '../../utils/header-metadata.js'
import { sid } from '../../utils/id/index.js'

export class HttpBodyParseError extends Error {
  code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR'

  constructor(code: 'PAYLOAD_TOO_LARGE' | 'PARSE_ERROR', message: string) {
    super(message)
    this.name = 'HttpBodyParseError'
    this.code = code
  }
}

export function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined
  return Array.isArray(value) ? value.join(',') : value
}

export function requestHasBody(req: IncomingMessage): boolean {
  const lengthHeader = getHeaderValue(req.headers['content-length'])
  if (lengthHeader) {
    const length = Number.parseInt(lengthHeader, 10)
    if (Number.isFinite(length)) {
      return length > 0
    }
  }

  const transferEncoding = getHeaderValue(req.headers['transfer-encoding'])
  return Boolean(transferEncoding && transferEncoding.toLowerCase() !== 'identity')
}

export function searchParamsToQuery(params: URLSearchParams): Record<string, unknown> {
  const query: Record<string, unknown> = {}
  for (const [key, value] of params.entries()) {
    const existing = query[key]
    if (existing === undefined) {
      query[key] = value
      continue
    }
    if (Array.isArray(existing)) {
      existing.push(value)
      continue
    }
    query[key] = [existing, value]
  }
  return query
}

export function parseJsonQueryParams(params: URLSearchParams): Record<string, unknown> {
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

export async function parseHttpRequestBody(
  req: IncomingMessage,
  maxSize: number,
  codec: Codec
): Promise<{ payload: unknown; size: number; raw?: Buffer }> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxSize) {
      req.destroy()
      throw new HttpBodyParseError('PAYLOAD_TOO_LARGE', 'Request body too large')
    }
    chunks.push(buffer)
  }

  if (size === 0) {
    return { payload: {}, size }
  }

  // We always concat the chunks for parsing, so retaining the resulting
  // Buffer adds one reference (no extra copy). The buffer is bounded by
  // `maxSize` (default 1MB) and is released when the request ctx goes out
  // of scope. This keeps `ctx.http.rawBody` available for HMAC signature
  // verification (Stripe, Svix, GitHub webhooks, etc.) at predictable cost.
  const raw = Buffer.concat(chunks)
  try {
    const body = raw.toString('utf-8')
    return { payload: codec.decode(body), size, raw }
  } catch {
    throw new HttpBodyParseError('PARSE_ERROR', 'Invalid request body')
  }
}

export function sendEncodedResponse(
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

export function sendErrorResponse(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
  includeBody = true
): void {
  sendEncodedResponse(
    res,
    status,
    { error: { code, message, ...(details !== undefined && { details }) } },
    jsonCodec,
    includeBody
  )
}

export function resolveHttpResponseCodec(
  req: IncomingMessage,
  res: ServerResponse,
  codecs: Codec[]
): Codec | null {
  const accept = getHeaderValue(req.headers.accept)
  const responseCodec = selectCodecForAccept(accept, codecs, jsonCodec)
  if (!responseCodec) {
    sendErrorResponse(res, 406, 'NOT_ACCEPTABLE', 'Not acceptable')
    return null
  }
  return responseCodec
}

export async function resolveHttpRequestBody(args: {
  req: IncomingMessage
  res: ServerResponse
  codecs: Codec[]
  maxBodySize: number
}): Promise<{ payload: unknown; size: number; raw?: Buffer } | null> {
  const { req, res, codecs, maxBodySize } = args
  const contentType = getHeaderValue(req.headers['content-type'])
  let requestCodec = jsonCodec

  if (contentType) {
    const selected = selectCodecForContentType(contentType, codecs)
    if (!selected) {
      sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return null
    }
    requestCodec = selected
  } else if (requestHasBody(req)) {
    sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
    return null
  }

  try {
    const parsed = await parseHttpRequestBody(req, maxBodySize, requestCodec)
    if (!contentType && parsed.size > 0) {
      sendErrorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type')
      return null
    }
    return parsed
  } catch (err) {
    if (err instanceof HttpBodyParseError) {
      sendErrorResponse(res, getStatusForCode(err.code), err.code, err.message)
      return null
    }
    sendErrorResponse(res, 400, 'INVALID_ARGUMENT', (err as Error).message)
    return null
  }
}

export function buildHttpContextSeed(options: {
  req: IncomingMessage
  res?: ServerResponse
  method: string
  url: URL
  input: {
    body?: unknown
    params?: Record<string, string>
    query?: Record<string, unknown>
  }
  rawBody?: Buffer
  trustedProxies?: TrustedProxyConfig
}): { metadata: Record<string, string>; seed: ContextSeed } {
  const { req, res, method, url, input, rawBody, trustedProxies } = options
  const client = resolveClientIp({
    headers: req.headers,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort,
    trustedProxies,
  })
  const metadata = mergeMetadata(
    extractMetadataFromHeaders(req.headers),
    client.ip ? { 'x-client-ip': client.ip } : undefined
  )

  return {
    metadata,
    seed: {
      protocol: 'http',
      input: {
        body: input.body,
        params: input.params,
        query: input.query,
        metadata,
      },
      http: {
        kind: 'http',
        method,
        path: url.pathname,
        url: url.toString(),
        headers: metadata,
        clientIp: client.ip,
        remoteAddress: client.remoteAddress,
        remotePort: client.remotePort,
        rawBody,
        req,
        res,
      },
    },
  }
}

export function attachHttpAbortHandlers(
  req: IncomingMessage,
  res: ServerResponse,
  abortController: AbortController
): void {
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
}

export async function createHttpRequestContext(args: {
  req: IncomingMessage
  res: ServerResponse
  method: string
  url: URL
  input: {
    body?: unknown
    params?: Record<string, string>
    query?: Record<string, unknown>
  }
  rawBody?: Buffer
  trustedProxies?: TrustedProxyConfig
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>
  abortController?: AbortController
}): Promise<{
  ctx: Context
  metadata: Record<string, string>
  requestId: string
  abortController: AbortController
}> {
  const abortController = args.abortController ?? new AbortController()
  attachHttpAbortHandlers(args.req, args.res, abortController)

  const requestId = getHeaderValue(args.req.headers['x-request-id']) ?? sid()
  const httpContext = buildHttpContextSeed({
    req: args.req,
    res: args.res,
    method: args.method,
    url: args.url,
    input: args.input,
    rawBody: args.rawBody,
    trustedProxies: args.trustedProxies,
  })
  const ctx = await createAbortableContextAsync(
    requestId,
    mergeContextSeeds(httpContext.seed, await args.contextFactory?.(args.req)),
    abortController
  )

  const deadlineHeader = getHeaderValue(args.req.headers['x-deadline'])
  const deadline = deadlineHeader ? Number.parseInt(deadlineHeader, 10) : NaN
  if (Number.isFinite(deadline)) {
    ctx.deadline = ctx.deadline ? Math.min(ctx.deadline, deadline) : deadline
  }

  return {
    ctx,
    metadata: httpContext.metadata,
    requestId,
    abortController,
  }
}

export async function dispatchHttpEnvelope(args: {
  res: ServerResponse
  router: Router
  procedure: string
  type?: Envelope['type']
  payload: unknown
  metadata: Record<string, string>
  ctx: Context
  responseCodec: Codec
  method: string
  successStatus?: number
}): Promise<void> {
  const {
    res,
    router,
    procedure,
    type = 'request',
    payload,
    metadata,
    ctx,
    responseCodec,
    method,
    successStatus = 200,
  } = args

  const result = await router.handle({
    id: ctx.requestId,
    procedure,
    type,
    payload,
    metadata: { ...metadata },
    context: ctx,
  })

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
      sendErrorResponse(res, status, errorPayload.code, errorPayload.message, errorPayload.details, method !== 'HEAD')
      return
    }

    applyRateLimitHeaders(res, ctx)
    sendEncodedResponse(
      res,
      successStatus,
      resultEnvelope.payload,
      responseCodec,
      method !== 'HEAD' && successStatus !== 204 && successStatus !== 304
    )
    return
  }

  applyRateLimitHeaders(res, ctx)
  sendEncodedResponse(
    res,
    successStatus,
    result,
    responseCodec,
    method !== 'HEAD' && successStatus !== 204 && successStatus !== 304
  )
}
