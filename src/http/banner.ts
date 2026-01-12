/**
 * Startup Banner
 *
 * Display a formatted startup banner when the server starts.
 * Shows useful information like host, port, routes, and documentation URLs.
 *
 * @example
 * import { printBanner } from 'raffel/http'
 *
 * // Basic usage
 * printBanner({ port: 3000, host: 'localhost' })
 *
 * // With options
 * printBanner({
 *   name: 'My API',
 *   version: '1.0.0',
 *   port: 3000,
 *   host: '0.0.0.0',
 *   docsUrl: '/docs',
 *   routes: [
 *     { method: 'GET', path: '/health' },
 *     { method: 'GET', path: '/api/users' },
 *   ]
 * })
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Route info for banner display
 */
export interface BannerRoute {
  method: string
  path: string
}

/**
 * Banner configuration options
 */
export interface BannerOptions {
  /**
   * Application name
   * @default 'Raffel Server'
   */
  name?: string

  /**
   * Application version
   */
  version?: string

  /**
   * Server port
   */
  port: number

  /**
   * Server host
   * @default 'localhost'
   */
  host?: string

  /**
   * Documentation URL (relative path)
   */
  docsUrl?: string

  /**
   * Routes to display (limited to first 10)
   */
  routes?: BannerRoute[]

  /**
   * Environment name
   * @default process.env.NODE_ENV || 'development'
   */
  env?: string

  /**
   * Disable colored output
   * @default false
   */
  noColor?: boolean

  /**
   * Custom message to display
   */
  message?: string

  /**
   * Whether to show startup timestamp
   * @default true
   */
  showTimestamp?: boolean

  /**
   * Additional info lines to display
   */
  info?: Record<string, string | number | boolean>
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors (ANSI escape codes)
// ─────────────────────────────────────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
}

function c(color: keyof typeof colors, text: string, noColor: boolean): string {
  if (noColor) return text
  return `${colors[color]}${text}${colors.reset}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print startup banner to console
 *
 * @param options - Banner configuration
 *
 * @example
 * printBanner({
 *   name: 'API Server',
 *   version: '1.0.0',
 *   port: 3000,
 *   docsUrl: '/docs'
 * })
 */
export function printBanner(options: BannerOptions): void {
  const banner = generateBanner(options)
  console.log(banner)
}

/**
 * Generate banner string without printing
 *
 * @param options - Banner configuration
 * @returns Formatted banner string
 */
export function generateBanner(options: BannerOptions): string {
  const {
    name = 'Raffel Server',
    version,
    port,
    host = 'localhost',
    docsUrl,
    routes,
    env = process.env.NODE_ENV || 'development',
    noColor = false,
    message,
    showTimestamp = true,
    info,
  } = options

  const lines: string[] = []
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  const baseUrl = `http://${isLocal ? 'localhost' : host}:${port}`

  // Header
  lines.push('')
  lines.push(c('cyan', '┌' + '─'.repeat(58) + '┐', noColor))

  // App name and version
  const titleParts = [c('bold', name, noColor)]
  if (version) {
    titleParts.push(c('dim', `v${version}`, noColor))
  }
  const title = titleParts.join(' ')
  const titlePadding = Math.max(0, 56 - stripAnsi(title).length)
  lines.push(c('cyan', '│', noColor) + ' ' + title + ' '.repeat(titlePadding) + c('cyan', '│', noColor))

  lines.push(c('cyan', '├' + '─'.repeat(58) + '┤', noColor))

  // Server info
  const serverLine = `${c('green', '▸', noColor)} Server: ${c('bold', baseUrl, noColor)}`
  lines.push(formatLine(serverLine, noColor))

  // Environment
  const envColor = env === 'production' ? 'magenta' : env === 'development' ? 'green' : 'yellow'
  const envLine = `${c('green', '▸', noColor)} Environment: ${c(envColor, env, noColor)}`
  lines.push(formatLine(envLine, noColor))

  // Documentation URL
  if (docsUrl) {
    const docsLine = `${c('green', '▸', noColor)} Documentation: ${c('blue', `${baseUrl}${docsUrl}`, noColor)}`
    lines.push(formatLine(docsLine, noColor))
  }

  // Additional info
  if (info) {
    for (const [key, value] of Object.entries(info)) {
      const infoLine = `${c('green', '▸', noColor)} ${key}: ${c('dim', String(value), noColor)}`
      lines.push(formatLine(infoLine, noColor))
    }
  }

  // Routes
  if (routes && routes.length > 0) {
    lines.push(c('cyan', '├' + '─'.repeat(58) + '┤', noColor))
    const displayRoutes = routes.slice(0, 10)

    for (const route of displayRoutes) {
      const methodColor = getMethodColor(route.method)
      const method = c(methodColor, route.method.toUpperCase().padEnd(7), noColor)
      const routeLine = `  ${method} ${c('dim', route.path, noColor)}`
      lines.push(formatLine(routeLine, noColor))
    }

    if (routes.length > 10) {
      const moreLine = `  ${c('dim', `... and ${routes.length - 10} more routes`, noColor)}`
      lines.push(formatLine(moreLine, noColor))
    }
  }

  // Custom message
  if (message) {
    lines.push(c('cyan', '├' + '─'.repeat(58) + '┤', noColor))
    const msgLine = `  ${c('yellow', message, noColor)}`
    lines.push(formatLine(msgLine, noColor))
  }

  // Timestamp
  if (showTimestamp) {
    lines.push(c('cyan', '├' + '─'.repeat(58) + '┤', noColor))
    const timestamp = new Date().toISOString()
    const timeLine = `  ${c('dim', `Started at ${timestamp}`, noColor)}`
    lines.push(formatLine(timeLine, noColor))
  }

  // Footer
  lines.push(c('cyan', '└' + '─'.repeat(58) + '┘', noColor))
  lines.push('')

  return lines.join('\n')
}

/**
 * Create a banner middleware that prints on first request
 */
export function bannerMiddleware(options: BannerOptions): () => void {
  let printed = false
  return () => {
    if (!printed) {
      printBanner(options)
      printed = true
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function formatLine(content: string, noColor: boolean): string {
  const stripped = stripAnsi(content)
  const padding = Math.max(0, 56 - stripped.length)
  return c('cyan', '│', noColor) + ' ' + content + ' '.repeat(padding) + c('cyan', '│', noColor)
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function getMethodColor(method: string): keyof typeof colors {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'green'
    case 'POST':
      return 'yellow'
    case 'PUT':
      return 'blue'
    case 'PATCH':
      return 'cyan'
    case 'DELETE':
      return 'magenta'
    default:
      return 'gray'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  printBanner,
  generateBanner,
  bannerMiddleware,
}
