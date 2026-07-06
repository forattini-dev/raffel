/**
 * HTTP tracing helpers.
 *
 * Keeps the HTTP server span close to the transport boundary while allowing
 * route-aware middleware to attach low-cardinality route metadata later.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '../types/index.js'
import type { HttpMiddleware } from '../http/app.js'
import type { Span, SpanAttributes, SpanContext, Tracer } from './types.js'

export interface HttpTelemetryRoute {
  route?: string
  procedure?: string
}

export interface HttpServerSpanOptions {
  method: string
  url: URL
  protocolVersion?: string
  route?: string
  procedure?: string
  remoteAddress?: string
  remotePort?: number
}

const httpTelemetryRoutes = new WeakMap<object, HttpTelemetryRoute>()

export function setHttpTelemetryRoute(carrier: object, route: HttpTelemetryRoute): void {
  const current = httpTelemetryRoutes.get(carrier) ?? {}
  httpTelemetryRoutes.set(carrier, { ...current, ...route })
}

export function getHttpTelemetryRoute(carrier: object): HttpTelemetryRoute | undefined {
  return httpTelemetryRoutes.get(carrier)
}

function normalizeMethod(method: string | undefined): string {
  return (method || 'GET').toUpperCase()
}

function spanName(method: string, route?: string, procedure?: string): string {
  if (route) return `${method} ${route}`
  if (procedure) return `${method} ${procedure}`
  return method
}

function serverPortFromUrl(url: URL): number | undefined {
  if (url.port) return Number.parseInt(url.port, 10)
  if (url.protocol === 'https:') return 443
  if (url.protocol === 'http:') return 80
  return undefined
}

function baseHttpAttributes(options: HttpServerSpanOptions): SpanAttributes {
  const method = normalizeMethod(options.method)
  const attributes: SpanAttributes = {
    'http.request.method': method,
    'url.path': options.url.pathname,
    'url.scheme': options.url.protocol.replace(/:$/, ''),
    'server.address': options.url.hostname,
    'network.protocol.version': options.protocolVersion ?? '1.1',
  }

  const serverPort = serverPortFromUrl(options.url)
  if (serverPort !== undefined) {
    attributes['server.port'] = serverPort
  }

  if (options.route) {
    attributes['http.route'] = options.route
  }
  if (options.procedure) {
    attributes['rpc.method'] = options.procedure
    attributes['raffel.procedure'] = options.procedure
  }
  if (options.remoteAddress) {
    attributes['network.peer.address'] = options.remoteAddress
  }
  if (options.remotePort !== undefined) {
    attributes['network.peer.port'] = options.remotePort
  }

  return attributes
}

export function extractHttpParentContext(
  tracer: Tracer,
  headers: Headers | Record<string, string | string[] | undefined>
): SpanContext | undefined {
  if (headers instanceof Headers) {
    return tracer.extractContext({
      traceparent: headers.get('traceparent') ?? undefined,
      tracestate: headers.get('tracestate') ?? undefined,
    })
  }

  const traceparent = headers.traceparent
  const tracestate = headers.tracestate
  return tracer.extractContext({
    traceparent: Array.isArray(traceparent) ? traceparent[0] : traceparent,
    tracestate: Array.isArray(tracestate) ? tracestate[0] : tracestate,
  })
}

export function startHttpServerSpan(
  tracer: Tracer,
  options: HttpServerSpanOptions,
  parent?: SpanContext
): Span {
  const method = normalizeMethod(options.method)
  return tracer.startSpan(spanName(method, options.route, options.procedure), {
    kind: 'server',
    parent,
    attributes: baseHttpAttributes({ ...options, method }),
  })
}

export function applyHttpRouteToSpan(span: Span, method: string, route?: HttpTelemetryRoute): void {
  if (!route) return

  const normalizedMethod = normalizeMethod(method)
  if (route.route) {
    span.setAttribute('http.route', route.route)
  }
  if (route.procedure) {
    span.setAttribute('rpc.method', route.procedure)
    span.setAttribute('raffel.procedure', route.procedure)
  }
  span.updateName(spanName(normalizedMethod, route.route, route.procedure))
}

export function finishHttpServerSpan(span: Span, statusCode: number): void {
  span.setAttribute('http.response.status_code', statusCode)
  if (statusCode >= 500) {
    if (span.toSpanData().status.code !== 'error') {
      span.setStatus('error')
    }
    span.setAttribute('error.type', String(statusCode))
  } else {
    span.setStatus('ok')
  }
  span.finish()
}

export function bindContextToSpan(
  ctx: Context,
  span: Span,
  parentContext?: SpanContext
): void {
  ctx.tracing = {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    parentSpanId: parentContext?.spanId,
  }
  ctx.logger = ctx.logger.child({
    trace_id: span.context.traceId,
    span_id: span.context.spanId,
  })
}

export function setTraceResponseHeaders(
  target: ServerResponse | { header(name: string, value: string): void },
  span: Span
): void {
  if ('setHeader' in target) {
    if (!target.headersSent) {
      target.setHeader('x-trace-id', span.context.traceId)
      target.setHeader('x-span-id', span.context.spanId)
    }
    return
  }

  target.header('x-trace-id', span.context.traceId)
  target.header('x-span-id', span.context.spanId)
}

export function createHttpTracingMiddleware(tracer: Tracer): HttpMiddleware {
  return async (ctx, next) => {
    const url = new URL(ctx.req.url)
    const method = normalizeMethod(ctx.req.method)
    const parentContext = extractHttpParentContext(tracer, ctx.req.raw.headers)
    const route = getHttpTelemetryRoute(ctx.req.raw)
    const span = startHttpServerSpan(tracer, {
      method,
      url,
      route: route?.route,
      procedure: route?.procedure,
    }, parentContext)
    const previousSpan = tracer.getActiveSpan()

    tracer.setActiveSpan(span)
    setTraceResponseHeaders(ctx, span)

    try {
      await next()
      applyHttpRouteToSpan(span, method, getHttpTelemetryRoute(ctx.req.raw))
      finishHttpServerSpan(span, ctx.res?.status ?? 404)
    } catch (error) {
      if (error instanceof Error) {
        span.recordError(error)
      } else {
        span.setStatus('error', String(error))
      }
      span.finish()
      throw error
    } finally {
      tracer.setActiveSpan(previousSpan)
    }
  }
}
