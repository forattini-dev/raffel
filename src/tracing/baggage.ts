/**
 * W3C Baggage (https://www.w3.org/TR/baggage/)
 *
 * Baggage propagates arbitrary cross-cutting key/value context (tenant id,
 * user id, feature flags, ...) alongside the trace, through the `baggage`
 * HTTP header. Unlike `traceparent`/`tracestate`, baggage carries
 * *application* data, not trace identity — it survives across every hop of
 * an A → B → C call chain without every intermediate handler having to know
 * about or forward it explicitly.
 *
 * Deliberately minimal: this implementation supports the `key=value` pairs
 * that cover the common case (propagating a handful of identifiers) and
 * skips the optional per-member `;property=value` metadata from the spec,
 * which nothing in Raffel reads today. Unknown/malformed members are
 * dropped rather than throwing — a broken baggage header from a
 * non-Raffel caller should never break the request.
 */

export type Baggage = Record<string, string>

const MAX_BAGGAGE_HEADER_LENGTH = 8192 // W3C spec recommendation

/**
 * Parse a `baggage` header value into a plain key/value map.
 *
 * Per-member properties (`key=value;prop1;prop2=x`) are recognized but
 * discarded — only the leading `key=value` is kept.
 */
export function parseBaggageHeader(header: string | undefined | null): Baggage {
  const baggage: Baggage = {}
  if (!header) return baggage

  const members = header.split(',')
  for (const member of members) {
    const [pair] = member.split(';', 1)
    const eq = pair.indexOf('=')
    if (eq <= 0) continue

    const key = pair.slice(0, eq).trim()
    const rawValue = pair.slice(eq + 1).trim()
    if (!key || !rawValue) continue

    try {
      baggage[decodeBaggageKey(key)] = decodeURIComponent(rawValue)
    } catch {
      // Malformed percent-encoding — skip this member, keep the rest.
    }
  }

  return baggage
}

/**
 * Serialize a baggage map back into a `baggage` header value.
 *
 * Returns `undefined` when there is nothing to send, so callers can omit
 * the header entirely instead of sending `baggage: `.
 */
export function serializeBaggageHeader(baggage: Baggage | undefined): string | undefined {
  if (!baggage) return undefined

  const entries = Object.entries(baggage).filter(([key, value]) => key && value !== undefined)
  if (entries.length === 0) return undefined

  const header = entries
    .map(([key, value]) => `${encodeBaggageKey(key)}=${encodeURIComponent(value)}`)
    .join(',')

  // The spec caps total header size — truncate by dropping the tail rather
  // than sending an oversized header some proxies will reject outright.
  if (header.length <= MAX_BAGGAGE_HEADER_LENGTH) return header
  return truncateToLimit(entries, MAX_BAGGAGE_HEADER_LENGTH)
}

/**
 * Merge two baggage maps — `override` wins on key collisions. Useful when
 * a handler wants to add/replace a member without dropping what a caller
 * already propagated from upstream.
 */
export function mergeBaggage(base: Baggage | undefined, override: Baggage | undefined): Baggage {
  return { ...(base ?? {}), ...(override ?? {}) }
}

function encodeBaggageKey(key: string): string {
  // Keys are restricted to token characters per RFC 7230; encodeURIComponent
  // is a safe superset (it never produces the delimiters `=`, `,`, `;`).
  return encodeURIComponent(key)
}

function decodeBaggageKey(key: string): string {
  try {
    return decodeURIComponent(key)
  } catch {
    return key
  }
}

function truncateToLimit(entries: Array<[string, string]>, limit: number): string {
  const parts: string[] = []
  let length = 0
  for (const [key, value] of entries) {
    const part = `${encodeBaggageKey(key)}=${encodeURIComponent(value)}`
    const addedLength = length === 0 ? part.length : part.length + 1
    if (length + addedLength > limit) break
    parts.push(part)
    length += addedLength
  }
  return parts.join(',')
}
