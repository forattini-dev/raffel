/**
 * ConnectionFilter
 *
 * Inbound connection access control for TCP, UDP, and WebSocket adapters.
 * Filters by source IP/hostname — who is connecting to us.
 *
 * Distinct from ProxyFilter (src/proxy/utils/access-control.ts) which
 * filters the destination (where we proxy to). Connection filters never
 * check ports-of-origin (ephemeral, no practical value) or TLDs (IPs have none).
 */

/** Normalises an IPv4-mapped IPv6 address (::ffff:127.0.0.1 → 127.0.0.1) */
function normalizeAddress(addr: string): string {
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

/**
 * Wildcard host/origin pattern matching.
 *   '*.evil.com'  → suffix: matches 'app.evil.com' and 'evil.com'
 *   '192.168.*'   → prefix: matches '192.168.1.1'
 *   exact string  → exact match only
 */
function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // '.evil.com'
    return host === pattern.slice(2) || host.endsWith(suffix)
  }
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1) // '192.168.'
    return host.startsWith(prefix)
  }
  return host === pattern
}

export interface ConnectionFilter {
  /** Block connections from these source IPs/hostnames (exact or wildcard) */
  denyHosts?: string[]
  /** Exclusive allowlist — deny any source not matching at least one entry */
  allowHosts?: string[]
  /** Custom async check — return false to deny */
  check?: (info: { host: string; port: number }) => boolean | Promise<boolean>
  /**
   * Called when a connection is denied.
   * NOTE: NOT called by checkConnectionFilter — the caller is responsible
   * (same contract as checkProxyFilter).
   */
  onDenied?: (info: { host: string; port: number; reason: string }) => void
}

export interface WebSocketConnectionFilter extends ConnectionFilter {
  /** Exclusive allowlist for HTTP Origin header (wildcard supported) */
  allowOrigins?: string[]
  /** Block connections with these Origin values (wildcard supported); absent origin = skip */
  denyOrigins?: string[]
}

/**
 * Check whether an incoming connection is allowed by the filter.
 * Normalises the host (strips ::ffff: prefix) before checking.
 * onDenied is NOT called — the caller is responsible.
 */
export async function checkConnectionFilter(
  filter: ConnectionFilter,
  host: string,
  port: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const normalizedHost = normalizeAddress(host)

  // 1. allowHosts (exclusive) — deny if no pattern matches
  if (filter.allowHosts && filter.allowHosts.length > 0) {
    const matches = filter.allowHosts.some((p) => matchesHostPattern(normalizedHost, p))
    if (!matches) {
      return { allowed: false, reason: `host "${normalizedHost}" not in allowHosts` }
    }
  }

  // 2. denyHosts — deny if any pattern matches
  if (filter.denyHosts && filter.denyHosts.length > 0) {
    const blocked = filter.denyHosts.some((p) => matchesHostPattern(normalizedHost, p))
    if (blocked) {
      return { allowed: false, reason: `host "${normalizedHost}" is in denyHosts` }
    }
  }

  // 3. Custom async check
  if (filter.check) {
    let ok: boolean
    try {
      ok = await Promise.resolve(filter.check({ host: normalizedHost, port }))
    } catch {
      return { allowed: false, reason: 'denied by custom check' }
    }
    if (!ok) {
      return { allowed: false, reason: 'denied by custom check' }
    }
  }

  return { allowed: true }
}

/**
 * Check WebSocket connection with optional Origin header validation.
 * Calls checkConnectionFilter first, then checks Origin fields.
 */
export async function checkWebSocketConnectionFilter(
  filter: WebSocketConnectionFilter,
  host: string,
  port: number,
  origin: string | undefined,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Base IP/host check
  const baseResult = await checkConnectionFilter(filter, host, port)
  if (!baseResult.allowed) {
    return baseResult
  }

  // 2. allowOrigins (exclusive) — origin required; deny if absent or not matched
  if (filter.allowOrigins && filter.allowOrigins.length > 0) {
    if (!origin) {
      return { allowed: false, reason: 'origin required by allowOrigins but not present' }
    }
    const matches = filter.allowOrigins.some((p) => matchesHostPattern(origin, p))
    if (!matches) {
      return { allowed: false, reason: `origin "${origin}" not in allowOrigins` }
    }
  }

  // 3. denyOrigins — deny if origin present and matches; absent origin = skip
  if (filter.denyOrigins && filter.denyOrigins.length > 0 && origin) {
    const blocked = filter.denyOrigins.some((p) => matchesHostPattern(origin, p))
    if (blocked) {
      return { allowed: false, reason: `origin "${origin}" is in denyOrigins` }
    }
  }

  return { allowed: true }
}
