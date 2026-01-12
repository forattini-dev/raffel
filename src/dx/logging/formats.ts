/**
 * HTTP Log Formats
 *
 * Predefined log format strings and token definitions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LogContext } from './types.js'

/**
 * Predefined log format strings.
 */
export const LOG_FORMATS = {
  /**
   * Apache combined format.
   * Example: 127.0.0.1 - alice [10/Oct/2023:13:55:36 -0700] "GET /users HTTP/1.1" 200 532 "https://example.com" "Mozilla/5.0..."
   */
  combined: ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"',

  /**
   * Apache common format.
   * Example: 127.0.0.1 - alice [10/Oct/2023:13:55:36 -0700] "GET /users HTTP/1.1" 200 532
   */
  common: ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length]',

  /**
   * Development format with colors.
   * Example: GET /users 200 15.234 ms - 532
   */
  dev: ':method :url :status :response-time ms - :res[content-length]',

  /**
   * Minimal format.
   * Example: GET /users 200 15.234ms
   */
  tiny: ':method :url :status :response-time ms',

  /**
   * Short format.
   * Example: 127.0.0.1 - GET /users HTTP/1.1 200 532 - 15.234 ms
   */
  short: ':remote-addr - :method :url HTTP/:http-version :status :res[content-length] - :response-time ms',
} as const

/**
 * ANSI color codes for terminal output.
 */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
} as const

/**
 * Colorize status code based on value.
 */
function colorizeStatus(status: number, colorize: boolean): string {
  const statusStr = String(status)
  if (!colorize) return statusStr

  if (status >= 500) return `${colors.red}${statusStr}${colors.reset}`
  if (status >= 400) return `${colors.yellow}${statusStr}${colors.reset}`
  if (status >= 300) return `${colors.cyan}${statusStr}${colors.reset}`
  if (status >= 200) return `${colors.green}${statusStr}${colors.reset}`
  return statusStr
}

/**
 * Colorize HTTP method.
 */
function colorizeMethod(method: string, colorize: boolean): string {
  if (!colorize) return method

  const methodColors: Record<string, string> = {
    GET: colors.green,
    POST: colors.cyan,
    PUT: colors.yellow,
    PATCH: colors.yellow,
    DELETE: colors.red,
    HEAD: colors.magenta,
    OPTIONS: colors.blue,
  }

  const color = methodColors[method] || colors.white
  return `${color}${method}${colors.reset}`
}

/**
 * Colorize response time based on value.
 */
function colorizeResponseTime(ms: number, colorize: boolean): string {
  const msStr = ms.toFixed(3)
  if (!colorize) return msStr

  if (ms < 100) return `${colors.green}${msStr}${colors.reset}`
  if (ms < 500) return `${colors.yellow}${msStr}${colors.reset}`
  return `${colors.red}${msStr}${colors.reset}`
}

/**
 * Format date in different styles.
 */
function formatDate(date: Date, format: string = 'clf'): string {
  switch (format) {
    case 'clf': {
      // Common Log Format: 10/Oct/2023:13:55:36 -0700
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const day = String(date.getDate()).padStart(2, '0')
      const month = months[date.getMonth()]
      const year = date.getFullYear()
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      const offset = -date.getTimezoneOffset()
      const offsetSign = offset >= 0 ? '+' : '-'
      const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')
      const offsetMins = String(Math.abs(offset) % 60).padStart(2, '0')
      return `${day}/${month}/${year}:${hours}:${minutes}:${seconds} ${offsetSign}${offsetHours}${offsetMins}`
    }
    case 'iso':
      return date.toISOString()
    case 'web':
      return date.toUTCString()
    default:
      return date.toISOString()
  }
}

/**
 * Get remote IP address from request.
 */
function getRemoteAddress(req: IncomingMessage): string {
  // Check common proxy headers
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded
    return ips.split(',')[0].trim()
  }

  const realIp = req.headers['x-real-ip']
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp
  }

  return req.socket?.remoteAddress || '-'
}

/**
 * Token value getters.
 */
type TokenGetter = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: LogContext,
  arg?: string,
  colorize?: boolean
) => string

const tokens: Record<string, TokenGetter> = {
  'remote-addr': (req) => getRemoteAddress(req),

  'remote-user': (req) => {
    // Try to extract user from Basic auth header
    const auth = req.headers.authorization
    if (auth?.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(auth.slice(6), 'base64').toString()
        const [user] = decoded.split(':')
        return user || '-'
      } catch {
        return '-'
      }
    }
    return '-'
  },

  method: (req, _, __, ___, colorize) => colorizeMethod(req.method || 'GET', colorize ?? false),

  url: (req) => req.url || '/',

  'http-version': (req) => `${req.httpVersionMajor}.${req.httpVersionMinor}`,

  status: (_, res, __, ___, colorize) => colorizeStatus(res.statusCode, colorize ?? false),

  res: (_, res, __, header) => {
    if (!header) return '-'
    const value = res.getHeader(header)
    if (value === undefined) return '-'
    return Array.isArray(value) ? value.join(', ') : String(value)
  },

  'response-time': (_, __, ctx, digits, colorize) => {
    const precision = digits ? parseInt(digits, 10) : 3
    const ms = Number(process.hrtime.bigint() - ctx.startTime) / 1_000_000
    if (colorize) {
      return colorizeResponseTime(ms, true)
    }
    return ms.toFixed(precision)
  },

  date: (_, __, ctx, format) => formatDate(ctx.startDate, format),

  referrer: (req) => {
    const referrer = req.headers.referer || req.headers.referrer
    if (!referrer) return '-'
    return Array.isArray(referrer) ? referrer[0] : referrer
  },

  'user-agent': (req) => req.headers['user-agent'] || '-',

  'content-length': (req) => {
    const length = req.headers['content-length']
    return length || '-'
  },

  req: (req, _, __, header) => {
    if (!header) return '-'
    const value = req.headers[header.toLowerCase()]
    if (value === undefined) return '-'
    return Array.isArray(value) ? value.join(', ') : String(value)
  },
}

/**
 * Compile a format string into a function.
 */
export function compileFormat(
  format: string,
  colorize: boolean = false
): (req: IncomingMessage, res: ServerResponse, ctx: LogContext) => string {
  // Parse tokens in format string
  // Matches :token, :token[arg], :token[arg1,arg2]
  const tokenRegex = /:([a-z-]+)(?:\[([^\]]+)\])?/gi

  return (req, res, ctx) => {
    return format.replace(tokenRegex, (_, tokenName: string, arg?: string) => {
      const getter = tokens[tokenName.toLowerCase()]
      if (!getter) return '-'
      return getter(req, res, ctx, arg, colorize)
    })
  }
}

/**
 * Get predefined format string.
 */
export function getFormatString(format: string): string {
  if (format in LOG_FORMATS) {
    return LOG_FORMATS[format as keyof typeof LOG_FORMATS]
  }
  return format // Assume it's a custom format string
}
