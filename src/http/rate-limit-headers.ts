/**
 * Rate Limit Header Helpers
 *
 * Shared between `src/adapters/http.ts` and `src/server/rest-middleware.ts`
 * — both extract rate-limit info from the request context (set by the
 * rate-limit interceptor) plus an optional details payload (set on
 * RATE_LIMITED error envelopes), and apply the canonical
 * `X-RateLimit-*` / `Retry-After` response headers.
 *
 * Extracted to collapse a duplicated 35-line block flagged by fallow's
 * clone detector.
 */

import type { ServerResponse } from 'node:http'
import type { Context } from '../types/index.js'

export interface RateLimitHeaderInfo {
  limit?: number
  remaining?: number
  resetAt?: number
  retryAfter?: number
}

/**
 * Resolve rate-limit info from context (interceptor-populated) and an
 * optional details payload (typically the `error.details` of a
 * RATE_LIMITED envelope). Context wins; details fills missing fields.
 *
 * Returns null when neither source has any data — callers can short
 * circuit to skip header writes.
 */
export function getRateLimitInfo(ctx: Context, details?: unknown): RateLimitHeaderInfo | null {
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

/**
 * Apply standard rate-limit response headers. `Retry-After` is only
 * written when `includeRetryAfter` is true (typically only on 429
 * responses to avoid leaking the value on success).
 */
export function applyRateLimitHeaders(
  res: ServerResponse,
  ctx: Context,
  details?: unknown,
  includeRetryAfter = false,
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
