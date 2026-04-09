import { BlockList, isIP } from 'node:net'

export type TrustedProxyConfig = false | string[]

export interface RequestSocketInfo {
  remoteAddress?: string
  remotePort?: number
}

export type ClientIpSource = 'socket' | 'x-forwarded-for' | 'x-real-ip' | 'unknown'

export interface ClientIpResolution {
  ip?: string
  source: ClientIpSource
  remoteAddress?: string
  remotePort?: number
  forwardedChain: string[]
}

const requestSocketInfo = new WeakMap<Request, RequestSocketInfo>()
const trustedProxyCache = new Map<string, BlockList>()

type HeaderValue = string | string[] | undefined
type HeaderRecord = Headers | Record<string, HeaderValue> | undefined

function getHeaderValue(headers: HeaderRecord, name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }

  const lowerName = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? value.join(', ') : value
    }
  }

  return undefined
}

function normalizeIpCandidate(value: string | undefined): string | undefined {
  if (!value) return undefined

  let candidate = value.trim()
  if (candidate.length === 0) return undefined

  const forwardedPrefixMatch = candidate.match(/^for=(.+)$/i)
  if (forwardedPrefixMatch) {
    candidate = forwardedPrefixMatch[1].trim()
  }

  if (candidate.startsWith('"') && candidate.endsWith('"') && candidate.length > 1) {
    candidate = candidate.slice(1, -1)
  }

  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1)
  }

  const percentIndex = candidate.indexOf('%')
  if (percentIndex !== -1) {
    candidate = candidate.slice(0, percentIndex)
  }

  if (candidate.startsWith('::ffff:')) {
    const mappedIpv4 = candidate.slice(7)
    if (isIP(mappedIpv4) === 4) {
      candidate = mappedIpv4
    }
  }

  if (candidate.includes('.') && candidate.includes(':') && candidate.indexOf(':') === candidate.lastIndexOf(':')) {
    const withoutPort = candidate.slice(0, candidate.lastIndexOf(':'))
    if (isIP(withoutPort) === 4) {
      candidate = withoutPort
    }
  }

  if (candidate.toLowerCase() === 'unknown') {
    return undefined
  }

  return isIP(candidate) === 0 ? undefined : candidate
}

function parseForwardedFor(value: string | undefined): string[] {
  if (!value) return []

  return value
    .split(',')
    .map((entry) => normalizeIpCandidate(entry))
    .filter((entry): entry is string => entry !== undefined)
}

function getIpType(ip: string): 'ipv4' | 'ipv6' | undefined {
  const version = isIP(ip)
  if (version === 4) return 'ipv4'
  if (version === 6) return 'ipv6'
  return undefined
}

function compileTrustedProxyList(config: string[]): BlockList {
  const cacheKey = config.join('|')
  const cached = trustedProxyCache.get(cacheKey)
  if (cached) return cached

  const blockList = new BlockList()
  for (const entry of config) {
    const normalizedEntry = entry.trim()
    if (normalizedEntry.length === 0) continue

    const slashIndex = normalizedEntry.indexOf('/')
    if (slashIndex !== -1) {
      const base = normalizeIpCandidate(normalizedEntry.slice(0, slashIndex))
      const prefix = Number.parseInt(normalizedEntry.slice(slashIndex + 1), 10)
      const type = base ? getIpType(base) : undefined
      if (!base || !type || !Number.isInteger(prefix)) continue
      blockList.addSubnet(base, prefix, type)
      continue
    }

    const address = normalizeIpCandidate(normalizedEntry)
    const type = address ? getIpType(address) : undefined
    if (!address || !type) continue
    blockList.addAddress(address, type)
  }

  trustedProxyCache.set(cacheKey, blockList)
  return blockList
}

function isTrustedProxy(ip: string | undefined, trustedProxies: TrustedProxyConfig): boolean {
  if (!ip || trustedProxies === false || trustedProxies.length === 0) {
    return false
  }

  const type = getIpType(ip)
  if (!type) return false

  return compileTrustedProxyList(trustedProxies).check(ip, type)
}

export function attachRequestSocketInfo(request: Request, info: RequestSocketInfo): Request {
  requestSocketInfo.set(request, info)
  return request
}

export function getRequestSocketInfo(request: Request): RequestSocketInfo | undefined {
  return requestSocketInfo.get(request)
}

export function resolveClientIp(options: {
  headers?: HeaderRecord
  remoteAddress?: string
  remotePort?: number
  trustedProxies?: TrustedProxyConfig
}): ClientIpResolution {
  const trustedProxies = options.trustedProxies ?? false
  const remoteAddress = normalizeIpCandidate(options.remoteAddress)
  const remotePort = options.remotePort
  const forwardedChain = parseForwardedFor(getHeaderValue(options.headers, 'x-forwarded-for'))
  const realIp = normalizeIpCandidate(getHeaderValue(options.headers, 'x-real-ip'))

  if (trustedProxies === false || trustedProxies.length === 0) {
    return {
      ip: remoteAddress,
      source: remoteAddress ? 'socket' : 'unknown',
      remoteAddress,
      remotePort,
      forwardedChain,
    }
  }

  if (!remoteAddress) {
    return {
      ip: forwardedChain[0] ?? realIp,
      source: forwardedChain.length > 0 ? 'x-forwarded-for' : realIp ? 'x-real-ip' : 'unknown',
      remotePort,
      forwardedChain,
    }
  }

  if (!isTrustedProxy(remoteAddress, trustedProxies)) {
    return {
      ip: remoteAddress,
      source: 'socket',
      remoteAddress,
      remotePort,
      forwardedChain,
    }
  }

  const chain = forwardedChain.length > 0
    ? [...forwardedChain, remoteAddress]
    : realIp
      ? [realIp, remoteAddress]
      : [remoteAddress]

  let clientIp = chain[0] ?? remoteAddress
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]
    if (!isTrustedProxy(candidate, trustedProxies)) {
      clientIp = candidate
      break
    }
  }

  return {
    ip: clientIp,
    source: clientIp === remoteAddress
      ? 'socket'
      : forwardedChain.length > 0
        ? 'x-forwarded-for'
        : realIp
          ? 'x-real-ip'
          : 'socket',
    remoteAddress,
    remotePort,
    forwardedChain,
  }
}

export function resolveRequestClientIp(
  request: Request,
  trustedProxies: TrustedProxyConfig = false
): ClientIpResolution {
  const socketInfo = getRequestSocketInfo(request)
  return resolveClientIp({
    headers: request.headers,
    remoteAddress: socketInfo?.remoteAddress,
    remotePort: socketInfo?.remotePort,
    trustedProxies,
  })
}
