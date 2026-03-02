/**
 * HTTP hop-by-hop header utilities.
 *
 * Hop-by-hop headers must not be forwarded by proxies (RFC 7230 §6.1).
 */

export const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
])

/**
 * Return a copy of `headers` with hop-by-hop headers removed.
 *
 * Also strips headers listed in the `Connection` header value, per RFC 7230.
 */
export function stripHopByHopHeaders(
  headers: Record<string, string>,
  extra?: string[],
): Record<string, string> {
  const toRemove = new Set<string>(HOP_BY_HOP_HEADERS)

  // Connection header may list additional headers to remove
  const connectionVal = headers['connection']
  if (connectionVal) {
    for (const h of connectionVal.split(',')) {
      toRemove.add(h.trim().toLowerCase())
    }
  }

  if (extra) {
    for (const h of extra) {
      toRemove.add(h.toLowerCase())
    }
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !toRemove.has(k.toLowerCase())),
  )
}
