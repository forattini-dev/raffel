/**
 * Shared Adapter Dispatch Helpers
 *
 * Slice 7 (narrowed) of architecture-deepening initiative (PRD #6 / issue #16).
 *
 * `core/router.ts` already provides `router.handle(envelope)` — the actual
 * shared dispatch path used by every transport adapter. This module exposes
 * one tiny but real cross-cutting helper that adapters can opt into:
 *
 * `dispatchEnvelope(router, envelope, transportInterceptor?)`
 *
 * Today only the WebSocket adapter wraps `router.handle()` with a composed
 * transport-level interceptor chain. By extracting the wrap pattern, any
 * adapter (HTTP, JSON-RPC, TCP, etc.) can opt into transport-level
 * interceptors without re-implementing the conditional + compose dance.
 *
 * The "extract a full dispatch() that owns parse-input → encode-output" idea
 * from the original RFC was rejected after re-survey: per-protocol wire
 * format work (HTTP body parsing, WS frames, gRPC proto, SMTP envelopes) is
 * irreducibly per-protocol.
 */

import type { Envelope } from '../../types/index.js'
import type { Context, Interceptor } from '../../types/index.js'
import type { Router, RouterResult } from '../../core/router.js'
import { compose } from '../../middleware/compose.js'

/**
 * Compose a list of transport-level interceptors into a single wrapping
 * function. Returns `null` when the list is empty (skip the wrap entirely).
 */
export function composeTransportInterceptors(
  interceptors: readonly Interceptor[] | undefined,
): Interceptor | null {
  if (!interceptors || interceptors.length === 0) return null
  return compose(...interceptors)
}

/**
 * Dispatch an envelope through the router, optionally wrapping with a
 * pre-composed transport interceptor.
 *
 * Equivalent to:
 * ```ts
 * transportInterceptor
 *   ? await transportInterceptor(envelope, ctx, () => router.handle(envelope))
 *   : await router.handle(envelope)
 * ```
 *
 * Use this in transport adapters that need transport-level interceptors
 * (auth, logging, rate-limit) running outside the per-procedure chain.
 */
export async function dispatchEnvelope(
  router: Router,
  envelope: Envelope,
  ctx: Context,
  transportInterceptor: Interceptor | null,
): Promise<RouterResult> {
  if (transportInterceptor) {
    return (await transportInterceptor(envelope, ctx, () => router.handle(envelope))) as RouterResult
  }
  return router.handle(envelope)
}
