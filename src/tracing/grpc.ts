/**
 * gRPC tracing helpers.
 *
 * gRPC carries trace context through call metadata rather than HTTP
 * headers, but the wire format is the same W3C Trace Context / Baggage
 * values — a `traceparent` metadata key propagates the same way a
 * `traceparent` HTTP header does. This lets a trace flow across a
 * mixed A → B → C chain even when one hop is HTTP and another is gRPC:
 * whichever leg B uses to call C, the same header/metadata key round-trips.
 *
 * Raffel only ships a gRPC *server* adapter (`../adapters/grpc.ts`) — there
 * is no bundled gRPC client, so `injectGrpcMetadata` below is exported for
 * callers using `@grpc/grpc-js` directly to make outbound calls (mirroring
 * what `tracedFetch` does automatically for HTTP).
 */

import { Metadata } from '@grpc/grpc-js'
import type * as grpc from '@grpc/grpc-js'
import type { Tracer, SpanContext, Span, SpanAttributes, Baggage } from './types.js'
import { parseBaggageHeader, serializeBaggageHeader } from './baggage.js'

export interface GrpcServerSpanOptions {
  /** Fully-qualified service name, e.g. `orders.v1.OrdersService` */
  service: string
  /** Method name, e.g. `CreateOrder` */
  method: string
  /** Whether the request side of this call is a stream */
  requestStream?: boolean
  /** Whether the response side of this call is a stream */
  responseStream?: boolean
}

/**
 * Extract a `grpc.Metadata`-like map into a plain lowercase-keyed record.
 * Accepts anything with a `.get(key)` method returning `string[]` (the real
 * `grpc.Metadata` shape) so callers don't need the actual class at the type
 * level.
 */
function metadataGet(
  metadata: Pick<grpc.Metadata, 'get'>,
  key: string
): string | undefined {
  const values = metadata.get(key)
  return values && values.length > 0 ? String(values[0]) : undefined
}

/**
 * Extract the W3C trace context (`traceparent`/`tracestate`) from incoming
 * gRPC call metadata.
 */
export function extractGrpcParentContext(
  tracer: Tracer,
  metadata: Pick<grpc.Metadata, 'get'>
): SpanContext | undefined {
  return tracer.extractContext({
    traceparent: metadataGet(metadata, 'traceparent'),
    tracestate: metadataGet(metadata, 'tracestate'),
  })
}

/**
 * Extract W3C Baggage from incoming gRPC call metadata. Always returns a
 * (possibly empty) object, matching the HTTP-side convention in
 * `interceptor.ts` so handlers can mutate `ctx.tracing.baggage` freely.
 */
export function extractGrpcBaggage(metadata: Pick<grpc.Metadata, 'get'>): Baggage {
  return parseBaggageHeader(metadataGet(metadata, 'baggage'))
}

function grpcSpanName(options: GrpcServerSpanOptions): string {
  return `${options.service}/${options.method}`
}

/**
 * Start a `kind: 'server'` span for an incoming gRPC call, following the
 * OTel RPC semantic conventions (`rpc.system`, `rpc.service`, `rpc.method`).
 */
export function startGrpcServerSpan(
  tracer: Tracer,
  options: GrpcServerSpanOptions,
  parent?: SpanContext
): Span {
  const attributes: SpanAttributes = {
    'rpc.system': 'grpc',
    'rpc.service': options.service,
    'rpc.method': options.method,
  }
  return tracer.startSpan(grpcSpanName(options), {
    kind: 'server',
    parent,
    attributes,
  })
}

/**
 * Record the final gRPC status code on a server span and finish it. Mirrors
 * `finishHttpServerSpan` in `./http.ts` — `grpc.status.OK` (0) maps to
 * `'ok'`, anything else to `'error'`.
 */
export function finishGrpcServerSpan(span: Span, statusCode: number): void {
  span.setAttribute('rpc.grpc.status_code', statusCode)
  span.setStatus(statusCode === 0 ? 'ok' : 'error')
  span.finish()
}

/**
 * Build outbound gRPC metadata carrying the current trace context and
 * baggage — the gRPC-side equivalent of what `tracedFetch` injects into
 * HTTP headers automatically.
 *
 * Raffel doesn't bundle a gRPC client, so wire this in manually around
 * `@grpc/grpc-js` calls:
 *
 * ```ts
 * import * as grpc from '@grpc/grpc-js'
 * import { injectGrpcMetadata } from 'raffel'
 *
 * const metadata = injectGrpcMetadata(tracer)
 * client.createOrder(request, metadata, callback)
 * ```
 *
 * No-op (returns `existing` unchanged, or a fresh empty `Metadata`) when no
 * tracer or no active span exists — safe to call unconditionally.
 */
export function injectGrpcMetadata(
  tracer: Tracer | undefined | null,
  existing?: grpc.Metadata
): grpc.Metadata {
  const metadata = existing ?? new Metadata()

  if (!tracer) return metadata

  const active = tracer.getActiveSpan()
  if (active) {
    const traceHeaders = tracer.injectContext(active.context)
    if (traceHeaders.traceparent) metadata.set('traceparent', traceHeaders.traceparent)
    if (traceHeaders.tracestate) metadata.set('tracestate', traceHeaders.tracestate)
  }

  const baggageHeader = serializeBaggageHeader(tracer.getBaggage())
  if (baggageHeader) metadata.set('baggage', baggageHeader)

  return metadata
}
