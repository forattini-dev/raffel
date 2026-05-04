/**
 * Payload Hashing
 *
 * Stable djb2 hash of a JSON-serialisable payload, used by the cache and
 * dedup interceptors to derive request keys. Returns a random string when
 * the payload can't be stringified — that way the caller's keying logic
 * naturally degrades to "no cache / no dedup" rather than throwing.
 *
 * Internal helper — leading underscore signals "private to interceptors/".
 */

import type { Envelope } from '../../types/index.js'

export function hashPayload(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return 'null'
  }
  try {
    const str = JSON.stringify(payload)
    // Simple djb2 hash
    let hash = 5381
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    }
    return (hash >>> 0).toString(36)
  } catch {
    return Math.random().toString(36).slice(2)
  }
}

/**
 * Build a procedure-keyed cache/dedup string. Pass an optional `prefix`
 * to namespace the key (e.g. `cache:` for the cache interceptor).
 */
export function envelopeKey(envelope: Envelope, prefix = ''): string {
  return `${prefix}${envelope.procedure}:${hashPayload(envelope.payload)}`
}
