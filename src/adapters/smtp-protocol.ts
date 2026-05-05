import type { ParsedAddress } from './smtp-types.js'

export const CRLF = '\r\n'
export const MAX_LINE_LENGTH = 998
export const DEFAULT_MAX_MESSAGE_SIZE = 50 * 1024 * 1024
export const DEFAULT_MAX_RECIPIENTS = 100
export const DEFAULT_MAX_AUTH_ATTEMPTS = 5

/** SMTP timeouts per RFC 5321 §4.5.3.2 */
export const DEFAULT_TIMEOUTS = {
  greeting: 30_000,
  command: 30_000,
  data: 600_000,
  quit: 5_000,
  tls: 30_000,
} as const

export function parseAddress(raw: string): ParsedAddress | null {
  const match = raw.match(/^<([^>]*)>\s*(.*)$/)
  if (!match) {
    const lenientMatch = raw.match(/^(\S+@\S+)\s*(.*)$/)
    if (!lenientMatch) return null
    return {
      raw,
      address: lenientMatch[1]!,
      params: parseEsmtpParams(lenientMatch[2] ?? ''),
    }
  }

  return {
    raw,
    address: match[1]!,
    params: parseEsmtpParams(match[2] ?? ''),
  }
}

function parseEsmtpParams(str: string): Record<string, string> {
  const params: Record<string, string> = {}
  if (!str.trim()) return params

  for (const part of str.trim().split(/\s+/)) {
    const eq = part.indexOf('=')
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
    } else {
      params[part.toUpperCase()] = ''
    }
  }
  return params
}

export function undotStuff(lines: string[]): string {
  return lines
    .map((line) => (line.startsWith('..') ? line.slice(1) : line))
    .join(CRLF)
}

export function parseMessageHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const headerEnd = raw.indexOf(CRLF + CRLF)
  const headerSection = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw

  const unfolded = headerSection.replace(/\r\n([ \t])/g, ' ')

  for (const line of unfolded.split(CRLF)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const name = line.slice(0, colon).trim().toLowerCase()
      const value = line.slice(colon + 1).trim()
      headers[name] = value
    }
  }
  return headers
}
