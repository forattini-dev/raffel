/**
 * Security Headers Middleware
 *
 * HTTP-specific middleware for setting security headers.
 * Implements best practices for protecting against common web vulnerabilities.
 */

import type { ServerResponse } from 'node:http'
import type {
  SecurityConfig,
  HstsConfig,
  CspConfig,
  PermissionsPolicyConfig,
} from '../types.js'

/**
 * Default security configuration (recommended)
 */
export const defaultSecurityConfig: SecurityConfig = {
  noSniff: true,
  frameOptions: 'DENY',
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: false,
  },
  referrerPolicy: 'strict-origin-when-cross-origin',
  dnsPrefetchControl: false,
  xssProtection: true,
  crossDomainPolicy: 'none',
}

/**
 * Strict security configuration (for high-security applications)
 */
export const strictSecurityConfig: SecurityConfig = {
  ...defaultSecurityConfig,
  hsts: {
    maxAge: 63072000, // 2 years
    includeSubDomains: true,
    preload: true,
  },
  csp: {
    enabled: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'"],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'base-uri': ["'self'"],
      'upgrade-insecure-requests': [],
    },
  },
  permissionsPolicy: {
    features: {
      'geolocation': [],
      'microphone': [],
      'camera': [],
      'payment': [],
      'usb': [],
    },
  },
}

/**
 * Relaxed security configuration (for development or internal tools)
 */
export const relaxedSecurityConfig: SecurityConfig = {
  noSniff: true,
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'no-referrer-when-downgrade',
}

/**
 * Build HSTS header value
 */
function buildHstsHeader(hsts: HstsConfig): string {
  const parts = [`max-age=${hsts.maxAge ?? 31536000}`]

  if (hsts.includeSubDomains !== false) {
    parts.push('includeSubDomains')
  }

  if (hsts.preload) {
    parts.push('preload')
  }

  return parts.join('; ')
}

/**
 * Build CSP header value
 */
function buildCspHeader(csp: CspConfig): string | null {
  if (!csp.enabled || !csp.directives) {
    return null
  }

  const parts: string[] = []

  for (const [directive, values] of Object.entries(csp.directives)) {
    if (Array.isArray(values)) {
      if (values.length === 0) {
        // Directives like 'upgrade-insecure-requests' have no values
        parts.push(directive)
      } else {
        parts.push(`${directive} ${values.join(' ')}`)
      }
    } else if (typeof values === 'string') {
      parts.push(`${directive} ${values}`)
    }
  }

  if (csp.reportUri) {
    parts.push(`report-uri ${csp.reportUri}`)
  }

  return parts.length > 0 ? parts.join('; ') : null
}

/**
 * Build Permissions-Policy header value
 */
function buildPermissionsPolicyHeader(config: PermissionsPolicyConfig): string | null {
  if (!config.features) {
    return null
  }

  const parts: string[] = []

  for (const [feature, allowList] of Object.entries(config.features)) {
    if (Array.isArray(allowList)) {
      if (allowList.length === 0) {
        parts.push(`${feature}=()`)
      } else {
        parts.push(`${feature}=(${allowList.join(' ')})`)
      }
    }
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Apply security headers to a response
 *
 * @example
 * ```typescript
 * import { applySecurityHeaders, defaultSecurityConfig } from 'raffel/middleware/http'
 *
 * // In your HTTP handler
 * applySecurityHeaders(res, defaultSecurityConfig)
 *
 * // Or with custom config
 * applySecurityHeaders(res, {
 *   noSniff: true,
 *   frameOptions: 'SAMEORIGIN',
 *   csp: {
 *     enabled: true,
 *     directives: {
 *       'default-src': ["'self'"],
 *       'script-src': ["'self'", "'unsafe-inline'"],
 *     }
 *   }
 * })
 * ```
 */
export function applySecurityHeaders(
  res: ServerResponse,
  config: SecurityConfig = defaultSecurityConfig
): void {
  // X-Content-Type-Options
  if (config.noSniff !== false) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
  }

  // X-Frame-Options
  if (config.frameOptions !== false) {
    res.setHeader('X-Frame-Options', config.frameOptions ?? 'DENY')
  }

  // Strict-Transport-Security (HSTS)
  if (config.hsts !== false) {
    const hstsValue = buildHstsHeader(config.hsts ?? { maxAge: 31536000 })
    res.setHeader('Strict-Transport-Security', hstsValue)
  }

  // Referrer-Policy
  if (config.referrerPolicy !== false) {
    res.setHeader('Referrer-Policy', config.referrerPolicy ?? 'strict-origin-when-cross-origin')
  }

  // X-DNS-Prefetch-Control
  if (config.dnsPrefetchControl !== undefined) {
    res.setHeader('X-DNS-Prefetch-Control', config.dnsPrefetchControl ? 'on' : 'off')
  }

  // X-XSS-Protection
  if (config.xssProtection !== false) {
    res.setHeader('X-XSS-Protection', '1; mode=block')
  }

  // X-Permitted-Cross-Domain-Policies
  if (config.crossDomainPolicy !== false) {
    res.setHeader('X-Permitted-Cross-Domain-Policies', config.crossDomainPolicy ?? 'none')
  }

  // Content-Security-Policy
  if (config.csp) {
    const cspValue = buildCspHeader(config.csp)
    if (cspValue) {
      const headerName = config.csp.reportOnly
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy'
      res.setHeader(headerName, cspValue)
    }
  }

  // Permissions-Policy
  if (config.permissionsPolicy) {
    const ppValue = buildPermissionsPolicyHeader(config.permissionsPolicy)
    if (ppValue) {
      res.setHeader('Permissions-Policy', ppValue)
    }
  }
}

/**
 * Create a security headers middleware function
 *
 * Returns a function that can be used as middleware in HTTP handlers.
 *
 * @example
 * ```typescript
 * const securityMiddleware = createSecurityMiddleware(strictSecurityConfig)
 *
 * // Apply to each response
 * function handleRequest(req, res) {
 *   securityMiddleware(res)
 *   // ... rest of handler
 * }
 * ```
 */
export function createSecurityMiddleware(
  config: SecurityConfig = defaultSecurityConfig
): (res: ServerResponse) => void {
  return (res: ServerResponse) => {
    applySecurityHeaders(res, config)
  }
}

/**
 * Get security config for a preset level
 */
export function getSecurityPreset(
  level: 'strict' | 'recommended' | 'relaxed'
): SecurityConfig {
  switch (level) {
    case 'strict':
      return strictSecurityConfig
    case 'recommended':
      return defaultSecurityConfig
    case 'relaxed':
      return relaxedSecurityConfig
    default:
      return defaultSecurityConfig
  }
}

/**
 * Merge custom config with a base config
 */
export function mergeSecurityConfig(
  base: SecurityConfig,
  custom: Partial<SecurityConfig>
): SecurityConfig {
  return {
    ...base,
    ...custom,
    hsts: custom.hsts === false ? false : {
      ...(typeof base.hsts === 'object' ? base.hsts : {}),
      ...(typeof custom.hsts === 'object' ? custom.hsts : {}),
    },
    csp: custom.csp === false ? false : {
      ...(typeof base.csp === 'object' ? base.csp : {}),
      ...(typeof custom.csp === 'object' ? custom.csp : {}),
      directives: {
        ...(typeof base.csp === 'object' ? base.csp.directives : {}),
        ...(typeof custom.csp === 'object' ? custom.csp.directives : {}),
      },
    },
    permissionsPolicy: custom.permissionsPolicy === false ? false : {
      ...(typeof base.permissionsPolicy === 'object' ? base.permissionsPolicy : {}),
      ...(typeof custom.permissionsPolicy === 'object' ? custom.permissionsPolicy : {}),
      features: {
        ...(typeof base.permissionsPolicy === 'object' ? base.permissionsPolicy.features : {}),
        ...(typeof custom.permissionsPolicy === 'object' ? custom.permissionsPolicy.features : {}),
      },
    },
  }
}
