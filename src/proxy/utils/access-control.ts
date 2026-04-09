/**
 * Proxy Access Control
 *
 * ProxyFilter — optional blocklist/allowlist by host, TLD, port, IP/CIDR, and custom check.
 * Works across all 4 proxy types.
 */

import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

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
  /** Deny specific IPs/CIDRs, e.g. ['127.0.0.1', '10.0.0.0/8'] */
  denyCidrs?: string[]
  /** Only allow these IPs/CIDRs */
  allowCidrs?: string[]
  /**
   * Block loopback, RFC1918, link-local, multicast and other non-public ranges.
   * Hostnames require `resolveDns: true` for this rule to be enforced.
   */
  blockPrivateRanges?: boolean
  /**
   * Resolve hostnames before applying IP/CIDR or private-range checks.
   * Recommended whenever `allowCidrs`, `denyCidrs`, or `blockPrivateRanges` are used.
   */
  resolveDns?: boolean
  /** Async custom check — return false to deny */
  check?: (target: { host: string; port: number }) => boolean | Promise<boolean>
  /** Called when a connection is denied */
  onDenied?: (info: { host: string; port: number; reason: string }) => void
}

export interface ProxyResolvedAddress {
  address: string
  family: 4 | 6
}

export interface CheckProxyFilterOptions {
  lookup?: (hostname: string) => Promise<ProxyResolvedAddress[]>
}

const cidrBlockListCache = new Map<string, BlockList>()
let privateRangeBlockList: BlockList | null = null

/** Returns true if host matches the pattern. Wildcard prefix supported: '*.example.com' */
function matchesHostPattern(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHost(host)
  const normalizedPattern = normalizeHost(pattern)

  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1) // e.g. '.example.com'
    return normalizedHost === normalizedPattern.slice(2) || normalizedHost.endsWith(suffix)
  }
  return normalizedHost === normalizedPattern
}

function normalizeHost(host: string): string {
  let normalized = host.trim().toLowerCase()

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }

  const percentIndex = normalized.indexOf('%')
  if (percentIndex !== -1) {
    normalized = normalized.slice(0, percentIndex)
  }

  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice(7)
    if (isIP(mappedIpv4) === 4) {
      normalized = mappedIpv4
    }
  }

  return normalized
}

function getIpType(host: string): 'ipv4' | 'ipv6' | undefined {
  const version = isIP(normalizeHost(host))
  if (version === 4) return 'ipv4'
  if (version === 6) return 'ipv6'
  return undefined
}

/** Extract TLD from hostname. Returns null for IP addresses. */
function getTLD(host: string): string | null {
  const normalizedHost = normalizeHost(host)
  if (getIpType(normalizedHost)) return null
  const dot = normalizedHost.lastIndexOf('.')
  if (dot === -1) return null
  return normalizedHost.slice(dot + 1)
}

/** Normalise a TLD entry: strip leading dot, lowercase. */
function normalizeTLD(tld: string): string {
  return tld.startsWith('.') ? tld.slice(1).toLowerCase() : tld.toLowerCase()
}

function compileCidrBlockList(entries: string[]): BlockList {
  const cacheKey = entries.map((entry) => entry.trim()).filter(Boolean).sort().join('|')
  const cached = cidrBlockListCache.get(cacheKey)
  if (cached) return cached

  const blockList = new BlockList()
  for (const rawEntry of entries) {
    const entry = rawEntry.trim()
    if (entry.length === 0) continue

    const slashIndex = entry.indexOf('/')
    if (slashIndex !== -1) {
      const base = normalizeHost(entry.slice(0, slashIndex))
      const prefix = Number.parseInt(entry.slice(slashIndex + 1), 10)
      const type = getIpType(base)
      if (!type || !Number.isInteger(prefix)) continue
      blockList.addSubnet(base, prefix, type)
      continue
    }

    const address = normalizeHost(entry)
    const type = getIpType(address)
    if (!type) continue
    blockList.addAddress(address, type)
  }

  cidrBlockListCache.set(cacheKey, blockList)
  return blockList
}

function getPrivateRangeBlockList(): BlockList {
  if (privateRangeBlockList) {
    return privateRangeBlockList
  }

  const blockList = new BlockList()
  const ipv4Subnets: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  const ipv6Subnets: Array<[string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
  ]

  for (const [base, prefix] of ipv4Subnets) {
    blockList.addSubnet(base, prefix, 'ipv4')
  }
  for (const [base, prefix] of ipv6Subnets) {
    blockList.addSubnet(base, prefix, 'ipv6')
  }

  privateRangeBlockList = blockList
  return blockList
}

function matchesBlockList(blockList: BlockList, address: string): boolean {
  const normalizedAddress = normalizeHost(address)
  const type = getIpType(normalizedAddress)
  if (!type) return false
  return blockList.check(normalizedAddress, type)
}

function hasIpBasedRules(filter: ProxyFilter): boolean {
  return Boolean(
    filter.allowCidrs?.length
    || filter.denyCidrs?.length
    || filter.blockPrivateRanges
  )
}

async function resolveAddressesForFilter(
  filter: ProxyFilter,
  host: string,
  options: CheckProxyFilterOptions,
): Promise<{ addresses: string[]; reason?: string }> {
  const normalizedHost = normalizeHost(host)
  if (!hasIpBasedRules(filter)) {
    return { addresses: [] }
  }

  if (getIpType(normalizedHost)) {
    return { addresses: [normalizedHost] }
  }

  if (!filter.resolveDns) {
    return {
      addresses: [],
      reason: `host "${normalizedHost}" requires resolveDns for IP-based filtering`,
    }
  }

  const lookupFn = options.lookup ?? (async (hostname: string) => {
    const records = await dnsLookup(hostname, { all: true, verbatim: true })
    return records
      .filter((record): record is { address: string; family: 4 | 6 } => record.family === 4 || record.family === 6)
      .map((record) => ({ address: record.address, family: record.family }))
  })

  try {
    const records = await lookupFn(normalizedHost)
    const addresses = records
      .map((record) => normalizeHost(record.address))
      .filter((address) => getIpType(address) !== undefined)

    if (addresses.length === 0) {
      return {
        addresses: [],
        reason: `dns lookup for "${normalizedHost}" returned no IP addresses`,
      }
    }

    return {
      addresses: [...new Set(addresses)],
    }
  } catch {
    return {
      addresses: [],
      reason: `dns lookup failed for "${normalizedHost}"`,
    }
  }
}

/**
 * Check whether a target host:port is allowed by the filter.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export async function checkProxyFilter(
  filter: ProxyFilter,
  host: string,
  port: number,
  options: CheckProxyFilterOptions = {},
): Promise<{ allowed: boolean; reason?: string }> {
  const normalizedHost = normalizeHost(host)

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
    const matches = filter.allowHosts.some((p) => matchesHostPattern(normalizedHost, p))
    if (!matches) {
      return { allowed: false, reason: `host "${normalizedHost}" not in allowHosts` }
    }
  }
  if (filter.denyHosts && filter.denyHosts.length > 0) {
    const blocked = filter.denyHosts.some((p) => matchesHostPattern(normalizedHost, p))
    if (blocked) {
      return { allowed: false, reason: `host "${normalizedHost}" is in denyHosts` }
    }
  }

  // 3. TLD checks (skipped for IP addresses)
  const tld = getTLD(normalizedHost)
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

  // 4. IP / CIDR checks
  const resolved = await resolveAddressesForFilter(filter, normalizedHost, options)
  if (resolved.reason) {
    return { allowed: false, reason: resolved.reason }
  }

  if (filter.allowCidrs && filter.allowCidrs.length > 0) {
    const allowList = compileCidrBlockList(filter.allowCidrs)
    const deniedAddress = resolved.addresses.find((address) => !matchesBlockList(allowList, address))
    if (deniedAddress) {
      return { allowed: false, reason: `address "${deniedAddress}" not in allowCidrs` }
    }
  }

  if (filter.denyCidrs && filter.denyCidrs.length > 0) {
    const denyList = compileCidrBlockList(filter.denyCidrs)
    const deniedAddress = resolved.addresses.find((address) => matchesBlockList(denyList, address))
    if (deniedAddress) {
      return { allowed: false, reason: `address "${deniedAddress}" is in denyCidrs` }
    }
  }

  if (filter.blockPrivateRanges) {
    const deniedAddress = resolved.addresses.find((address) => matchesBlockList(getPrivateRangeBlockList(), address))
    if (deniedAddress) {
      return { allowed: false, reason: `address "${deniedAddress}" is in blocked private ranges` }
    }
  }

  // 5. Custom async check
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
