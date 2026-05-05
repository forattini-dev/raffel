import { isIP } from 'node:net'

export const REP_SUCCESS = 0x00
export const REP_GENERAL_FAILURE = 0x01
export const REP_RULESET_DENIED = 0x02
export const REP_NET_UNREACHABLE = 0x03
export const REP_HOST_UNREACHABLE = 0x04
export const REP_CONN_REFUSED = 0x05
export const REP_TTL_EXPIRED = 0x06
export const REP_CMD_NOT_SUPPORTED = 0x07
export const REP_ATYP_NOT_SUPPORTED = 0x08

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '::0', ''])

export type Socks5AddressType = 'ipv4' | 'ipv6' | 'hostname'

interface ParsedSocksAddress {
  host: string
  atype: Socks5AddressType
  bytes: number
}

export interface ParsedRequestTarget extends ParsedSocksAddress {
  port: number
  consumed: number
}

export interface ParsedUdpPacket extends ParsedSocksAddress {
  port: number
  data: Buffer
  frag: number
}

export function mapUpstreamError(err: NodeJS.ErrnoException): number {
  switch (err.code) {
    case 'ECONNREFUSED':
      return REP_CONN_REFUSED
    case 'ETIMEDOUT':
      return REP_HOST_UNREACHABLE
    case 'EHOSTUNREACH':
      return REP_HOST_UNREACHABLE
    case 'ENETUNREACH':
      return REP_NET_UNREACHABLE
    case 'EMSGSIZE':
      return REP_TTL_EXPIRED
    default:
      return REP_GENERAL_FAILURE
  }
}

export function isWildcardHost(host: string | undefined): boolean {
  return host == null || WILDCARD_HOSTS.has(host)
}

export function normalizeReplyHost(boundHost: string | undefined, clientAddress: string | undefined): string {
  if (boundHost && !isWildcardHost(boundHost)) {
    return boundHost
  }
  if (clientAddress && isIP(clientAddress)) {
    return clientAddress
  }
  return '127.0.0.1'
}

function expandIpv6Address(address: string): number[] {
  if (address.includes('.')) {
    const lastColon = address.lastIndexOf(':')
    const ipv4Part = address.slice(lastColon + 1)
    const prefix = address.slice(0, lastColon)
    const octets = ipv4Part.split('.').map((part) => Number.parseInt(part, 10))
    if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(`Invalid IPv6 address: ${address}`)
    }
    const tailA = ((octets[0] << 8) | octets[1]).toString(16)
    const tailB = ((octets[2] << 8) | octets[3]).toString(16)
    return expandIpv6Address(`${prefix}:${tailA}:${tailB}`)
  }

  const [left, right] = address.split('::')
  const leftParts = left ? left.split(':').filter(Boolean) : []
  const rightParts = right ? right.split(':').filter(Boolean) : []
  const missing = 8 - (leftParts.length + rightParts.length)
  const parts = [
    ...leftParts,
    ...Array(Math.max(0, missing)).fill('0'),
    ...rightParts,
  ]

  if (parts.length !== 8) {
    throw new Error(`Invalid IPv6 address: ${address}`)
  }

  return parts.map((part) => Number.parseInt(part || '0', 16))
}

function encodeSocks5Address(host: string): Buffer {
  const version = isIP(host)
  if (version === 4) {
    const bytes = host.split('.').map((part) => Number.parseInt(part, 10))
    return Buffer.from([0x01, ...bytes])
  }

  if (version === 6) {
    const parts = expandIpv6Address(host)
    const out = Buffer.alloc(17)
    out[0] = 0x04
    for (let index = 0; index < 8; index++) {
      out.writeUInt16BE(parts[index], 1 + index * 2)
    }
    return out
  }

  const hostBytes = Buffer.from(host, 'utf8')
  return Buffer.concat([Buffer.from([0x03, hostBytes.length]), hostBytes])
}

export function socks5Reply(rep: number, host = '0.0.0.0', port = 0): Buffer {
  const portBuf = Buffer.alloc(2)
  portBuf.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x05, rep, 0x00]),
    encodeSocks5Address(host),
    portBuf,
  ])
}

function parseSocks5Address(buf: Buffer, offset: number): ParsedSocksAddress | null {
  if (buf.length < offset + 1) return null
  const atyp = buf[offset]

  if (atyp === 0x01) {
    if (buf.length < offset + 5) return null
    return {
      host: `${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}.${buf[offset + 4]}`,
      atype: 'ipv4',
      bytes: 5,
    }
  }

  if (atyp === 0x03) {
    if (buf.length < offset + 2) return null
    const hostLength = buf[offset + 1]
    if (buf.length < offset + 2 + hostLength) return null
    return {
      host: buf.subarray(offset + 2, offset + 2 + hostLength).toString('utf8'),
      atype: 'hostname',
      bytes: 2 + hostLength,
    }
  }

  if (atyp === 0x04) {
    if (buf.length < offset + 17) return null
    const parts: string[] = []
    for (let index = 0; index < 8; index++) {
      parts.push(buf.readUInt16BE(offset + 1 + index * 2).toString(16))
    }
    return {
      host: parts.join(':'),
      atype: 'ipv6',
      bytes: 17,
    }
  }

  return null
}

export function parseSocks5Request(buf: Buffer): ParsedRequestTarget | null {
  const address = parseSocks5Address(buf, 3)
  if (!address) return null
  const portOffset = 3 + address.bytes
  if (buf.length < portOffset + 2) return null
  const port = buf.readUInt16BE(portOffset)

  return {
    ...address,
    port,
    consumed: portOffset + 2,
  }
}

export function parseSocks5UdpPacket(msg: Buffer): ParsedUdpPacket | null {
  if (msg.length < 4) return null
  if (msg[0] !== 0x00 || msg[1] !== 0x00) return null

  const frag = msg[2]
  const address = parseSocks5Address(msg, 3)
  if (!address) return null
  const portOffset = 3 + address.bytes
  if (msg.length < portOffset + 2) return null

  return {
    ...address,
    frag,
    port: msg.readUInt16BE(portOffset),
    data: msg.subarray(portOffset + 2),
  }
}

export function buildSocks5UdpPacket(host: string, port: number, payload: Buffer): Buffer {
  const portBuf = Buffer.alloc(2)
  portBuf.writeUInt16BE(port, 0)
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00]),
    encodeSocks5Address(host),
    portBuf,
    payload,
  ])
}

export function formatRemoteKey(host: string, port: number): string {
  return `${host}:${port}`
}
