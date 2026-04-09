/**
 * Field Filter Interceptor
 *
 * Strips protected fields (passwords, secrets, internal data) from handler output
 * before sending to the client. Works across all protocols (HTTP, WebSocket, TCP, JSON-RPC).
 *
 * @example
 * ```typescript
 * // Static field stripping
 * server.use(createFieldFilterInterceptor({
 *   strip: ['password', 'secret', '_internal'],
 * }))
 *
 * // Deep recursive stripping
 * server.use(createFieldFilterInterceptor({
 *   strip: ['password', 'hash'],
 *   deep: true,
 * }))
 *
 * // Dynamic transform based on context (e.g., user role)
 * server.use(createFieldFilterInterceptor({
 *   transform: (data, ctx) => {
 *     if (ctx.auth?.hasRole('admin')) return data
 *     return stripFields(data, ['ssn', 'salary'])
 *   },
 * }))
 * ```
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import { isAsyncIterable } from '../../utils/type-guards.js'

/**
 * Field filter configuration
 */
export interface FieldFilterConfig {
  /** List of field names to strip from output */
  strip?: string[]

  /** Custom transform function applied after stripping */
  transform?: (data: unknown, ctx: Context) => unknown

  /** Recursively strip fields in nested objects (default: false) */
  deep?: boolean
}

/**
 * Strip specified fields from a value (shallow or deep)
 */
function stripFields(value: unknown, fields: Set<string>, deep: boolean): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    if (!deep) return value
    return value.map((item) => stripFields(item, fields, true))
  }

  const obj = value as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(obj)) {
    if (fields.has(key)) continue
    result[key] = deep ? stripFields(obj[key], fields, true) : obj[key]
  }

  return result
}

/**
 * Create a field filter interceptor
 *
 * Removes sensitive fields from handler output. Useful for stripping passwords,
 * secrets, internal metadata before responses reach the client.
 *
 * @param config - Field filter configuration
 * @returns Interceptor that filters output fields
 */
export function createFieldFilterInterceptor(config: FieldFilterConfig = {}): Interceptor {
  const { strip = [], transform, deep = false } = config
  const fieldSet = new Set(strip)

  return async (_envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const result = await next()

    // Skip async iterables (stream results) — they are consumed by the router's
    // wrapStreamInEnvelopes. Each chunk will go through its own interceptor chain.
    if (isAsyncIterable(result)) {
      return result
    }

    let filtered = result

    // Apply static field stripping
    if (fieldSet.size > 0 && filtered !== null && filtered !== undefined && typeof filtered === 'object') {
      filtered = stripFields(filtered, fieldSet, deep)
    }

    // Apply dynamic transform
    if (transform) {
      filtered = transform(filtered, ctx)
    }

    return filtered
  }
}
