/**
 * Proxy Access Control
 *
 * ProxyFilter — optional blocklist/allowlist by host, TLD, port, and custom check.
 * Works across all 4 proxy types.
 */

export interface ProxyFilter {
  /** Deny by exact hostname, IP, or wildcard (e.g. '*.evil.com') */
  denyHosts?: string[]
  /** Only allow these hosts; deny everything else */
  allowHosts?: string[]
  /** Deny TLDs, e.g. ['ru', 'xyz'] or ['.ru', '.xyz'] */
  denyTLDs?: string[]
  /** Only allow these TLDs */
  allowTLDs?: string[]
  /** Deny specific ports, e.g. [22, 25] */
  denyPorts?: number[]
  /** Only allow these ports */
  allowPorts?: number[]
  /** Async custom check — return false to deny */
  check?: (target: { host: string; port: number }) => boolean | Promise<boolean>
  /** Called when a connection is denied */
  onDenied?: (info: { host: string; port: number; reason: string }) => void
}

/** Returns true if host matches the pattern. Wildcard prefix supported: '*.example.com' */
function matchesHostPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1) // e.g. '.example.com'
    return host === pattern.slice(2) || host.endsWith(suffix)
  }
  return host === pattern
}

const IP_PATTERN = /^\d+[\d.:%]+$/

/** Extract TLD from hostname. Returns null for IP addresses. */
function getTLD(host: string): string | null {
  if (IP_PATTERN.test(host)) return null
  const dot = host.lastIndexOf('.')
  if (dot === -1) return null
  return host.slice(dot + 1)
}

/** Normalise a TLD entry: strip leading dot, lowercase. */
function normalizeTLD(tld: string): string {
  return tld.startsWith('.') ? tld.slice(1).toLowerCase() : tld.toLowerCase()
}

/**
 * Check whether a target host:port is allowed by the filter.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkProxyFilter(
  filter: ProxyFilter,
  host: string,
  port: number,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Port checks
  if (filter.allowPorts && filter.allowPorts.length > 0) {
    if (!filter.allowPorts.includes(port)) {
      return { allowed: false, reason: `port ${port} not in allowPorts` }
    }
  }
  if (filter.denyPorts && filter.denyPorts.length > 0) {
    if (filter.denyPorts.includes(port)) {
      return { allowed: false, reason: `port ${port} is in denyPorts` }
    }
  }

  // 2. Host checks — allowHosts first (exclusive allowlist), then denyHosts
  if (filter.allowHosts && filter.allowHosts.length > 0) {
    const matches = filter.allowHosts.some((p) => matchesHostPattern(host, p))
    if (!matches) {
      return { allowed: false, reason: `host "${host}" not in allowHosts` }
    }
  }
  if (filter.denyHosts && filter.denyHosts.length > 0) {
    const blocked = filter.denyHosts.some((p) => matchesHostPattern(host, p))
    if (blocked) {
      return { allowed: false, reason: `host "${host}" is in denyHosts` }
    }
  }

  // 3. TLD checks (skipped for IP addresses)
  const tld = getTLD(host)
  if (tld !== null) {
    if (filter.allowTLDs && filter.allowTLDs.length > 0) {
      const allowed = filter.allowTLDs.map(normalizeTLD).includes(tld.toLowerCase())
      if (!allowed) {
        return { allowed: false, reason: `TLD "${tld}" not in allowTLDs` }
      }
    }
    if (filter.denyTLDs && filter.denyTLDs.length > 0) {
      const denied = filter.denyTLDs.map(normalizeTLD).includes(tld.toLowerCase())
      if (denied) {
        return { allowed: false, reason: `TLD "${tld}" is in denyTLDs` }
      }
    }
  }

  // 4. Custom async check
  if (filter.check) {
    let ok: boolean
    try {
      ok = await Promise.resolve(filter.check({ host, port }))
    } catch {
      return { allowed: false, reason: 'denied by custom check' }
    }
    if (!ok) {
      return { allowed: false, reason: 'denied by custom check' }
    }
  }

  return { allowed: true }
}
