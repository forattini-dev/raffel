/**
 * Security Headers Middleware
 *
 * Helmet-compatible security headers middleware that sets various HTTP headers
 * to help protect your app from well-known web vulnerabilities.
 *
 * @example
 * import { secureHeaders } from 'raffel/http'
 *
 * // Default configuration (recommended for most apps)
 * app.use('*', secureHeaders())
 *
 * // Custom configuration
 * app.use('*', secureHeaders({
 *   contentSecurityPolicy: {
 *     directives: {
 *       defaultSrc: ["'self'"],
 *       scriptSrc: ["'self'", "https://cdn.example.com"],
 *     },
 *   },
 *   hsts: { maxAge: 31536000, includeSubDomains: true },
 *   frameguard: { action: 'deny' },
 * }))
 *
 * // Disable specific headers
 * app.use('*', secureHeaders({
 *   hsts: false,
 *   frameguard: false,
 * }))
 */

import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSP directive values
 */
export type CspDirectiveValue = string | string[]

/**
 * Content Security Policy directives
 */
export interface CspDirectives {
  defaultSrc?: CspDirectiveValue
  scriptSrc?: CspDirectiveValue
  styleSrc?: CspDirectiveValue
  imgSrc?: CspDirectiveValue
  fontSrc?: CspDirectiveValue
  connectSrc?: CspDirectiveValue
  mediaSrc?: CspDirectiveValue
  objectSrc?: CspDirectiveValue
  frameSrc?: CspDirectiveValue
  childSrc?: CspDirectiveValue
  workerSrc?: CspDirectiveValue
  frameAncestors?: CspDirectiveValue
  formAction?: CspDirectiveValue
  baseUri?: CspDirectiveValue
  manifestSrc?: CspDirectiveValue
  upgradeInsecureRequests?: boolean
  blockAllMixedContent?: boolean
  reportUri?: string
  reportTo?: string
}

/**
 * Content Security Policy options
 */
export interface ContentSecurityPolicyOptions {
  /**
   * CSP directives
   */
  directives?: CspDirectives

  /**
   * Use report-only mode (Content-Security-Policy-Report-Only header)
   * @default false
   */
  reportOnly?: boolean

  /**
   * Use default directives merged with custom ones
   * @default true
   */
  useDefaults?: boolean
}

/**
 * HSTS options
 */
export interface HstsOptions {
  /**
   * Time in seconds the browser should remember to only use HTTPS
   * @default 15552000 (180 days)
   */
  maxAge?: number

  /**
   * Apply HSTS to subdomains
   * @default true
   */
  includeSubDomains?: boolean

  /**
   * Submit site to browser preload lists
   * @default false
   */
  preload?: boolean
}

/**
 * X-Frame-Options action
 */
export type FrameguardAction = 'deny' | 'sameorigin'

/**
 * Frameguard options
 */
export interface FrameguardOptions {
  /**
   * Action to take for framing
   * @default 'sameorigin'
   */
  action?: FrameguardAction
}

/**
 * Referrer-Policy values
 */
export type ReferrerPolicy =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url'

/**
 * Referrer policy options
 */
export interface ReferrerPolicyOptions {
  /**
   * Referrer policy value
   * @default 'strict-origin-when-cross-origin'
   */
  policy?: ReferrerPolicy | ReferrerPolicy[]
}

/**
 * X-Permitted-Cross-Domain-Policies values
 */
export type CrossDomainPolicy = 'none' | 'master-only' | 'by-content-type' | 'by-ftp-filename' | 'all'

/**
 * Permissions Policy features
 */
export interface PermissionsPolicyOptions {
  /**
   * Feature policies as key-value pairs
   * Key is the feature name, value is an array of allowed origins or 'self', 'none', '*'
   *
   * @example
   * { geolocation: ['self'], camera: ['none'], microphone: ['self', 'https://example.com'] }
   */
  features?: Record<string, string[]>
}

/**
 * Security headers configuration
 */
export interface SecureHeadersOptions {
  /**
   * Content Security Policy configuration
   * Set to false to disable
   */
  contentSecurityPolicy?: ContentSecurityPolicyOptions | false

  /**
   * HTTP Strict Transport Security configuration
   * Set to false to disable
   */
  hsts?: HstsOptions | false

  /**
   * X-Frame-Options configuration
   * Set to false to disable
   */
  frameguard?: FrameguardOptions | false

  /**
   * X-Content-Type-Options: nosniff
   * Set to false to disable
   * @default true
   */
  nosniff?: boolean

  /**
   * Referrer-Policy configuration
   * Set to false to disable
   */
  referrerPolicy?: ReferrerPolicyOptions | false

  /**
   * X-XSS-Protection configuration
   * Set to false to disable
   * @default true (sets to '0' to disable XSS auditor as it can introduce vulnerabilities)
   */
  xssFilter?: boolean

  /**
   * X-DNS-Prefetch-Control
   * Set to false to disable, true to set 'off', 'on' to enable
   * @default 'off'
   */
  dnsPrefetchControl?: boolean | 'on' | 'off'

  /**
   * Permissions-Policy configuration
   * Set to false to disable
   */
  permissionsPolicy?: PermissionsPolicyOptions | false

  /**
   * X-Permitted-Cross-Domain-Policies
   * Set to false to disable
   * @default 'none'
   */
  crossDomainPolicy?: CrossDomainPolicy | false

  /**
   * X-Download-Options: noopen
   * Set to false to disable
   * @default true
   */
  ieNoOpen?: boolean

  /**
   * Cross-Origin-Embedder-Policy
   * Set to false to disable
   */
  crossOriginEmbedderPolicy?: 'require-corp' | 'credentialless' | false

  /**
   * Cross-Origin-Opener-Policy
   * Set to false to disable
   */
  crossOriginOpenerPolicy?: 'same-origin' | 'same-origin-allow-popups' | 'unsafe-none' | false

  /**
   * Cross-Origin-Resource-Policy
   * Set to false to disable
   */
  crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin' | false

  /**
   * Origin-Agent-Cluster header
   * Set to false to disable
   * @default '?1'
   */
  originAgentCluster?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Values
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CSP_DIRECTIVES: CspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", 'https:', 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  upgradeInsecureRequests: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Security Headers Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create security headers middleware
 *
 * @param options - Security headers configuration
 * @returns Middleware function
 */
export function secureHeaders<E extends Record<string, unknown> = Record<string, unknown>>(
  options: SecureHeadersOptions = {}
): HttpMiddleware<E> {
  // Pre-compute static headers
  const staticHeaders = buildStaticHeaders(options)

  return async (c, next) => {
    // Execute the handler first
    await next()

    // No response to modify
    if (!c.res) {
      return
    }

    // Clone response with security headers
    const headers = new Headers(c.res.headers)

    // Apply pre-computed headers
    for (const [name, value] of staticHeaders) {
      if (!headers.has(name)) {
        headers.set(name, value)
      }
    }

    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build all static security headers at middleware creation time
 */
function buildStaticHeaders(options: SecureHeadersOptions): [string, string][] {
  const headers: [string, string][] = []

  // Content-Security-Policy
  if (options.contentSecurityPolicy !== false) {
    const cspHeader = buildCspHeader(options.contentSecurityPolicy || {})
    if (cspHeader) {
      const headerName = options.contentSecurityPolicy?.reportOnly
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy'
      headers.push([headerName, cspHeader])
    }
  }

  // Strict-Transport-Security
  if (options.hsts !== false) {
    headers.push(['Strict-Transport-Security', buildHstsHeader(options.hsts || {})])
  }

  // X-Frame-Options
  if (options.frameguard !== false) {
    const action = options.frameguard?.action || 'sameorigin'
    headers.push(['X-Frame-Options', action.toUpperCase()])
  }

  // X-Content-Type-Options
  if (options.nosniff !== false) {
    headers.push(['X-Content-Type-Options', 'nosniff'])
  }

  // Referrer-Policy
  if (options.referrerPolicy !== false) {
    const policy = options.referrerPolicy?.policy || 'strict-origin-when-cross-origin'
    const policyValue = Array.isArray(policy) ? policy.join(', ') : policy
    headers.push(['Referrer-Policy', policyValue])
  }

  // X-XSS-Protection (disabled by default as it can introduce vulnerabilities)
  if (options.xssFilter !== false) {
    headers.push(['X-XSS-Protection', '0'])
  }

  // X-DNS-Prefetch-Control
  if (options.dnsPrefetchControl !== false) {
    const value = options.dnsPrefetchControl === 'on' ? 'on' : 'off'
    headers.push(['X-DNS-Prefetch-Control', value])
  }

  // Permissions-Policy
  if (options.permissionsPolicy !== false && options.permissionsPolicy?.features) {
    const policy = buildPermissionsPolicyHeader(options.permissionsPolicy.features)
    if (policy) {
      headers.push(['Permissions-Policy', policy])
    }
  }

  // X-Permitted-Cross-Domain-Policies
  if (options.crossDomainPolicy !== false) {
    headers.push(['X-Permitted-Cross-Domain-Policies', options.crossDomainPolicy || 'none'])
  }

  // X-Download-Options (for IE)
  if (options.ieNoOpen !== false) {
    headers.push(['X-Download-Options', 'noopen'])
  }

  // Cross-Origin-Embedder-Policy
  if (options.crossOriginEmbedderPolicy) {
    headers.push(['Cross-Origin-Embedder-Policy', options.crossOriginEmbedderPolicy])
  }

  // Cross-Origin-Opener-Policy
  if (options.crossOriginOpenerPolicy) {
    headers.push(['Cross-Origin-Opener-Policy', options.crossOriginOpenerPolicy])
  }

  // Cross-Origin-Resource-Policy
  if (options.crossOriginResourcePolicy) {
    headers.push(['Cross-Origin-Resource-Policy', options.crossOriginResourcePolicy])
  }

  // Origin-Agent-Cluster
  if (options.originAgentCluster !== false) {
    headers.push(['Origin-Agent-Cluster', '?1'])
  }

  return headers
}

/**
 * Build Content-Security-Policy header value
 */
function buildCspHeader(options: ContentSecurityPolicyOptions): string {
  const useDefaults = options.useDefaults !== false
  const directives = useDefaults
    ? { ...DEFAULT_CSP_DIRECTIVES, ...options.directives }
    : options.directives || {}

  const parts: string[] = []

  for (const [key, value] of Object.entries(directives)) {
    if (value === undefined || value === null) continue

    const directiveName = camelToKebab(key)

    if (typeof value === 'boolean') {
      if (value) {
        parts.push(directiveName)
      }
    } else if (Array.isArray(value)) {
      parts.push(`${directiveName} ${value.join(' ')}`)
    } else {
      parts.push(`${directiveName} ${value}`)
    }
  }

  return parts.join('; ')
}

/**
 * Build Strict-Transport-Security header value
 */
function buildHstsHeader(options: HstsOptions): string {
  const maxAge = options.maxAge ?? 15552000 // 180 days
  const parts = [`max-age=${maxAge}`]

  if (options.includeSubDomains !== false) {
    parts.push('includeSubDomains')
  }

  if (options.preload) {
    parts.push('preload')
  }

  return parts.join('; ')
}

/**
 * Build Permissions-Policy header value
 */
function buildPermissionsPolicyHeader(features: Record<string, string[]>): string {
  const parts: string[] = []

  for (const [feature, values] of Object.entries(features)) {
    const featureName = camelToKebab(feature)

    if (values.length === 0 || values.includes('none')) {
      parts.push(`${featureName}=()`)
    } else if (values.includes('*')) {
      parts.push(`${featureName}=*`)
    } else {
      const formattedValues = values.map((v) => (v === 'self' ? 'self' : `"${v}"`))
      parts.push(`${featureName}=(${formattedValues.join(' ')})`)
    }
  }

  return parts.join(', ')
}

/**
 * Convert camelCase to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default secureHeaders
