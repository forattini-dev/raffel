/**
 * CORS Middleware
 *
 * Cross-Origin Resource Sharing middleware compatible with hono/cors.
 * Handles preflight requests and sets appropriate CORS headers.
 *
 * @example
 * import { cors } from 'raffel/http'
 *
 * // Allow all origins
 * app.use('*', cors())
 *
 * // Specific origin
 * app.use('*', cors({ origin: 'https://example.com' }))
 *
 * // Multiple origins
 * app.use('*', cors({ origin: ['https://a.com', 'https://b.com'] }))
 *
 * // Dynamic origin
 * app.use('*', cors({
 *   origin: (origin) => origin.endsWith('.example.com')
 * }))
 *
 * // Full configuration
 * app.use('*', cors({
 *   origin: '*',
 *   allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
 *   allowHeaders: ['Content-Type', 'Authorization'],
 *   exposeHeaders: ['X-Request-Id'],
 *   credentials: true,
 *   maxAge: 86400,
 * }))
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Origin validator function
 * Returns true if the origin is allowed, false otherwise
 */
export type OriginFunction = (origin: string, c: HttpContextInterface) => boolean | string

/**
 * CORS configuration options
 */
export interface CorsOptions {
  /**
   * Configures the Access-Control-Allow-Origin header.
   *
   * - `'*'` - Allow all origins (default)
   * - `string` - Allow specific origin
   * - `string[]` - Allow multiple specific origins
   * - `function` - Custom validation function
   *
   * @default '*'
   */
  origin?: string | string[] | OriginFunction

  /**
   * Configures the Access-Control-Allow-Methods header.
   * @default ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
   */
  allowMethods?: string[]

  /**
   * Configures the Access-Control-Allow-Headers header.
   * If not set, reflects the request's Access-Control-Request-Headers.
   */
  allowHeaders?: string[]

  /**
   * Configures the Access-Control-Expose-Headers header.
   * Specifies which headers can be exposed to the browser.
   */
  exposeHeaders?: string[]

  /**
   * Configures the Access-Control-Max-Age header.
   * Indicates how long preflight results can be cached (in seconds).
   */
  maxAge?: number

  /**
   * Configures the Access-Control-Allow-Credentials header.
   * Set to true to allow credentials (cookies, authorization headers).
   *
   * Note: When credentials is true, origin cannot be '*'.
   * The middleware will automatically use the request origin instead.
   *
   * @default false
   */
  credentials?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Values
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ALLOW_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']

// ─────────────────────────────────────────────────────────────────────────────
// CORS Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create CORS middleware
 *
 * @param options - CORS configuration options
 * @returns Middleware function
 */
export function cors<E extends Record<string, unknown> = Record<string, unknown>>(
  options: CorsOptions = {}
): HttpMiddleware<E> {
  const {
    origin = '*',
    allowMethods = DEFAULT_ALLOW_METHODS,
    allowHeaders,
    exposeHeaders,
    maxAge,
    credentials = false,
  } = options

  return async (c, next) => {
    const requestOrigin = c.req.header('origin') as string | undefined

    // Determine the allowed origin
    const allowedOrigin = resolveOrigin(origin, requestOrigin, c, credentials)

    // Helper to set CORS headers on response
    const setCorsHeaders = (response: Response): Response => {
      const headers = new Headers(response.headers)

      // Always set Access-Control-Allow-Origin if we have an allowed origin
      if (allowedOrigin) {
        headers.set('Access-Control-Allow-Origin', allowedOrigin)
      }

      // Set Vary header if origin is dynamic (not *)
      if (origin !== '*') {
        const vary = headers.get('Vary')
        if (vary) {
          if (!vary.includes('Origin')) {
            headers.set('Vary', `${vary}, Origin`)
          }
        } else {
          headers.set('Vary', 'Origin')
        }
      }

      // Set credentials header
      if (credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true')
      }

      // Set expose headers
      if (exposeHeaders && exposeHeaders.length > 0) {
        headers.set('Access-Control-Expose-Headers', exposeHeaders.join(', '))
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    // Handle preflight request (OPTIONS)
    if (c.req.method === 'OPTIONS') {
      const preflightHeaders = new Headers()

      // Set origin
      if (allowedOrigin) {
        preflightHeaders.set('Access-Control-Allow-Origin', allowedOrigin)
      }

      // Set Vary header if origin is dynamic
      if (origin !== '*') {
        preflightHeaders.set('Vary', 'Origin')
      }

      // Set allowed methods
      preflightHeaders.set('Access-Control-Allow-Methods', allowMethods.join(', '))

      // Set allowed headers
      if (allowHeaders && allowHeaders.length > 0) {
        preflightHeaders.set('Access-Control-Allow-Headers', allowHeaders.join(', '))
      } else {
        // Reflect the request headers if no specific headers configured
        const requestHeaders = c.req.header('access-control-request-headers') as string | undefined
        if (requestHeaders) {
          preflightHeaders.set('Access-Control-Allow-Headers', requestHeaders)
        }
      }

      // Set max age
      if (maxAge !== undefined) {
        preflightHeaders.set('Access-Control-Max-Age', maxAge.toString())
      }

      // Set credentials
      if (credentials) {
        preflightHeaders.set('Access-Control-Allow-Credentials', 'true')
      }

      // Return 204 No Content for preflight
      return new Response(null, {
        status: 204,
        headers: preflightHeaders,
      })
    }

    // For actual requests, proceed and add CORS headers to response
    await next()

    // If we have a response, add CORS headers
    if (c.res) {
      c.res = setCorsHeaders(c.res)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the allowed origin based on configuration
 */
function resolveOrigin<E extends Record<string, unknown>>(
  origin: string | string[] | OriginFunction,
  requestOrigin: string | undefined,
  c: HttpContextInterface<E>,
  credentials: boolean
): string | null {
  // No origin header means same-origin or non-browser request
  if (!requestOrigin) {
    return null
  }

  // Wildcard origin
  if (origin === '*') {
    // When credentials are enabled, we can't use '*'
    // We must echo back the actual origin
    if (credentials) {
      return requestOrigin
    }
    return '*'
  }

  // Single string origin
  if (typeof origin === 'string') {
    return origin === requestOrigin ? requestOrigin : null
  }

  // Array of origins
  if (Array.isArray(origin)) {
    return origin.includes(requestOrigin) ? requestOrigin : null
  }

  // Function origin validator
  if (typeof origin === 'function') {
    const result = origin(requestOrigin, c)
    if (result === true) {
      return requestOrigin
    }
    if (typeof result === 'string') {
      return result
    }
    return null
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default cors
