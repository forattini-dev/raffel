/**
 * Stream Authentication
 *
 * Provides authentication helpers for SSE/EventSource streams.
 *
 * EventSource API limitations:
 * - Cannot set custom headers (only browser-native credentials via cookies)
 * - Auth must be passed via cookies or query parameters
 *
 * Supported auth methods for streams:
 * - Cookie session: Automatic with same-origin requests
 * - Bearer token via query param: ?token=xxx or ?authorization=Bearer xxx
 * - API key via query param: ?apiKey=xxx or ?api_key=xxx
 * - Bearer token via header: For fetch + ReadableStream clients
 *
 * @example
 * import { createStreamAuthFactory, streamBearerAuth, streamCookieSession } from 'raffel/http/stream-auth'
 *
 * // Create auth factory for HTTP adapter
 * const authFactory = createStreamAuthFactory({
 *   // Bearer token via query param (for EventSource)
 *   bearer: {
 *     queryParam: 'token',
 *     verify: async (token) => {
 *       const user = await verifyJWT(token)
 *       return user ? { principal: user.id, claims: user } : null
 *     }
 *   },
 *   // Or cookie session
 *   cookie: {
 *     secret: process.env.SESSION_SECRET!,
 *     cookieName: 'session'
 *   }
 * })
 *
 * // Use with HTTP adapter
 * const adapter = createHttpAdapter(router, {
 *   port: 3000,
 *   contextFactory: authFactory
 * })
 */

import type { IncomingMessage } from 'node:http'
import type { AuthContext } from '../types/context.js'
import { getSignedCookie, type CookieContext } from './cookie.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auth result from verification
 */
export interface StreamAuthResult {
  /** User/service identifier */
  principal?: string

  /** Authentication claims */
  claims?: Record<string, unknown>
}

/**
 * Bearer token auth options for streams
 */
export interface StreamBearerOptions {
  /**
   * Query parameter name(s) to check for token
   * @default ['token', 'authorization', 'access_token']
   */
  queryParams?: string[]

  /**
   * Header name to check (for fetch + ReadableStream clients)
   * @default 'authorization'
   */
  headerName?: string

  /**
   * Token prefix to strip from header value
   * @default 'Bearer'
   */
  headerPrefix?: string

  /**
   * Token verification function
   * Returns auth result if valid, null if invalid
   */
  verify: (token: string) => StreamAuthResult | null | Promise<StreamAuthResult | null>
}

/**
 * API key auth options for streams
 */
export interface StreamApiKeyOptions {
  /**
   * Query parameter name(s) to check for API key
   * @default ['apiKey', 'api_key', 'key']
   */
  queryParams?: string[]

  /**
   * Header name to check for API key
   * @default 'x-api-key'
   */
  headerName?: string

  /**
   * API key verification function
   * Returns auth result if valid, null if invalid
   */
  verify: (apiKey: string) => StreamAuthResult | null | Promise<StreamAuthResult | null>
}

/**
 * Cookie session auth options for streams
 */
export interface StreamCookieSessionOptions {
  /**
   * Secret key for signed cookies
   */
  secret: string

  /**
   * Cookie name
   * @default 'session'
   */
  cookieName?: string

  /**
   * Session validation function
   * Returns auth result if valid, null if invalid
   */
  validate?: (sessionData: Record<string, unknown>) => StreamAuthResult | null | Promise<StreamAuthResult | null>
}

/**
 * Stream auth factory options
 */
export interface StreamAuthFactoryOptions {
  /**
   * Bearer token authentication
   */
  bearer?: StreamBearerOptions

  /**
   * API key authentication
   */
  apiKey?: StreamApiKeyOptions

  /**
   * Cookie session authentication
   */
  cookie?: StreamCookieSessionOptions

  /**
   * Custom auth extractor function
   */
  custom?: (req: IncomingMessage, url: URL) => AuthContext | null | Promise<AuthContext | null>

  /**
   * Order of auth methods to try
   * @default ['bearer', 'apiKey', 'cookie', 'custom']
   */
  order?: ('bearer' | 'apiKey' | 'cookie' | 'custom')[]

  /**
   * Whether to require authentication (return 401 if none found)
   * @default false
   */
  required?: boolean
}

/**
 * Stream context with auth and params
 */
export interface StreamContext {
  auth?: AuthContext
  params?: Record<string, string>
  query?: Record<string, string | string[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie Context Adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adapt IncomingMessage to CookieContext for reading cookies
 */
function toReqCookieContext(req: IncomingMessage): CookieContext {
  return {
    req: {
      header: (name: string) => {
        const value = req.headers[name.toLowerCase()]
        return Array.isArray(value) ? value[0] : value
      },
      raw: {
        headers: {
          cookie: req.headers.cookie,
        },
      },
    },
    header: () => {}, // No-op for reading
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract bearer token from request
 */
export async function extractBearerToken(
  req: IncomingMessage,
  url: URL,
  options: StreamBearerOptions
): Promise<StreamAuthResult | null> {
  const {
    queryParams = ['token', 'authorization', 'access_token'],
    headerName = 'authorization',
    headerPrefix = 'Bearer',
    verify,
  } = options

  let token: string | null = null

  // Try query params first (for EventSource compatibility)
  for (const param of queryParams) {
    const value = url.searchParams.get(param)
    if (value) {
      // Handle "Bearer xxx" format in query param
      if (value.toLowerCase().startsWith('bearer ')) {
        token = value.slice(7).trim()
      } else {
        token = value
      }
      break
    }
  }

  // Try header if no query param token
  if (!token) {
    const headerValue = req.headers[headerName.toLowerCase()]
    const headerStr = Array.isArray(headerValue) ? headerValue[0] : headerValue

    if (headerStr) {
      const prefixLower = headerPrefix.toLowerCase()
      if (headerStr.toLowerCase().startsWith(prefixLower + ' ')) {
        token = headerStr.slice(headerPrefix.length + 1).trim()
      } else if (!headerPrefix) {
        token = headerStr.trim()
      }
    }
  }

  if (!token) {
    return null
  }

  return verify(token)
}

/**
 * Extract API key from request
 */
export async function extractApiKey(
  req: IncomingMessage,
  url: URL,
  options: StreamApiKeyOptions
): Promise<StreamAuthResult | null> {
  const {
    queryParams = ['apiKey', 'api_key', 'key'],
    headerName = 'x-api-key',
    verify,
  } = options

  let apiKey: string | null = null

  // Try query params first (for EventSource compatibility)
  for (const param of queryParams) {
    const value = url.searchParams.get(param)
    if (value) {
      apiKey = value
      break
    }
  }

  // Try header if no query param
  if (!apiKey) {
    const headerValue = req.headers[headerName.toLowerCase()]
    apiKey = Array.isArray(headerValue) ? headerValue[0] : (headerValue || null)
  }

  if (!apiKey) {
    return null
  }

  return verify(apiKey)
}

/**
 * Extract session from signed cookie
 */
export async function extractCookieSession(
  req: IncomingMessage,
  options: StreamCookieSessionOptions
): Promise<StreamAuthResult | null> {
  const {
    secret,
    cookieName = 'session',
    validate,
  } = options

  const cookieCtx = toReqCookieContext(req)

  // Get signed cookie
  const cookieValue = await getSignedCookie(cookieCtx, secret, cookieName)
  if (!cookieValue) {
    return null
  }

  // Parse session data
  let sessionData: Record<string, unknown>
  try {
    sessionData = JSON.parse(cookieValue)
  } catch {
    return null
  }

  // Check expiration if present
  if (typeof sessionData.expiresAt === 'number' && sessionData.expiresAt < Date.now()) {
    return null
  }

  // Custom validation
  if (validate) {
    const data = sessionData.data as Record<string, unknown> | undefined
    return validate(data || sessionData)
  }

  // Default: extract principal from userId or id
  const data = sessionData.data as Record<string, unknown> | undefined
  const userId = data?.userId || data?.user_id || data?.id || sessionData.id

  return {
    principal: typeof userId === 'string' ? userId : undefined,
    claims: data || sessionData,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Params Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse path parameters from URL path using pattern
 *
 * @param path - URL path (e.g., '/logs/service-123')
 * @param pattern - Route pattern (e.g., '/logs/:serviceId')
 * @returns Params object or null if no match
 *
 * @example
 * parsePathParams('/logs/service-123', '/logs/:serviceId')
 * // => { serviceId: 'service-123' }
 */
export function parsePathParams(
  path: string,
  pattern: string
): Record<string, string> | null {
  // Normalize paths
  const pathParts = path.split('/').filter(Boolean)
  const patternParts = pattern.split('/').filter(Boolean)

  // Length must match (unless pattern ends with wildcard)
  const hasWildcard = patternParts[patternParts.length - 1] === '*'
  if (!hasWildcard && pathParts.length !== patternParts.length) {
    return null
  }
  if (hasWildcard && pathParts.length < patternParts.length - 1) {
    return null
  }

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i]
    const pathPart = pathParts[i]

    if (patternPart === '*') {
      // Wildcard matches rest of path
      params['*'] = pathParts.slice(i).join('/')
      break
    }

    if (patternPart.startsWith(':')) {
      // Parameter
      const paramName = patternPart.slice(1)
      params[paramName] = pathPart
    } else if (patternPart !== pathPart) {
      // Literal mismatch
      return null
    }
  }

  return params
}

/**
 * Parse query parameters from URL
 *
 * @param url - URL object
 * @returns Query params object
 */
export function parseQueryParams(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {}

  for (const [key, value] of url.searchParams) {
    if (key in query) {
      const existing = query[key]
      if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        query[key] = [existing, value]
      }
    } else {
      query[key] = value
    }
  }

  return query
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Auth Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a context factory for stream authentication
 *
 * Returns a function that can be used as `contextFactory` in HttpAdapterOptions.
 *
 * @param options - Auth configuration options
 * @returns Context factory function
 *
 * @example
 * const authFactory = createStreamAuthFactory({
 *   bearer: {
 *     queryParam: 'token',
 *     verify: async (token) => {
 *       const user = await verifyJWT(token)
 *       return user ? { principal: user.id, claims: user } : null
 *     }
 *   }
 * })
 *
 * const adapter = createHttpAdapter(router, {
 *   port: 3000,
 *   contextFactory: authFactory
 * })
 */
export function createStreamAuthFactory(
  options: StreamAuthFactoryOptions
): (req: IncomingMessage) => Promise<{ auth?: AuthContext }> {
  const {
    bearer,
    apiKey,
    cookie,
    custom,
    order = ['bearer', 'apiKey', 'cookie', 'custom'],
  } = options

  return async (req: IncomingMessage) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    let authResult: StreamAuthResult | null = null

    // Try auth methods in order
    for (const method of order) {
      if (authResult) break

      switch (method) {
        case 'bearer':
          if (bearer) {
            authResult = await extractBearerToken(req, url, bearer)
          }
          break

        case 'apiKey':
          if (apiKey) {
            authResult = await extractApiKey(req, url, apiKey)
          }
          break

        case 'cookie':
          if (cookie) {
            authResult = await extractCookieSession(req, cookie)
          }
          break

        case 'custom':
          if (custom) {
            const customResult = await custom(req, url)
            if (customResult) {
              return { auth: customResult }
            }
          }
          break
      }
    }

    if (authResult) {
      return {
        auth: {
          authenticated: true,
          principal: authResult.principal,
          claims: authResult.claims,
        },
      }
    }

    return {
      auth: {
        authenticated: false,
      },
    }
  }
}

/**
 * Create bearer-only stream auth factory
 *
 * Convenience wrapper for bearer token auth.
 *
 * @param options - Bearer auth options
 * @returns Context factory function
 *
 * @example
 * const authFactory = streamBearerAuth({
 *   verify: async (token) => {
 *     const user = await verifyJWT(token)
 *     return user ? { principal: user.id } : null
 *   }
 * })
 */
export function streamBearerAuth(
  options: StreamBearerOptions
): (req: IncomingMessage) => Promise<{ auth?: AuthContext }> {
  return createStreamAuthFactory({ bearer: options })
}

/**
 * Create API key-only stream auth factory
 *
 * Convenience wrapper for API key auth.
 *
 * @param options - API key auth options
 * @returns Context factory function
 *
 * @example
 * const authFactory = streamApiKeyAuth({
 *   verify: async (key) => {
 *     const apiKey = await db.findApiKey(key)
 *     return apiKey ? { principal: apiKey.userId } : null
 *   }
 * })
 */
export function streamApiKeyAuth(
  options: StreamApiKeyOptions
): (req: IncomingMessage) => Promise<{ auth?: AuthContext }> {
  return createStreamAuthFactory({ apiKey: options })
}

/**
 * Create cookie session-only stream auth factory
 *
 * Convenience wrapper for cookie session auth.
 *
 * @param options - Cookie session auth options
 * @returns Context factory function
 *
 * @example
 * const authFactory = streamCookieSession({
 *   secret: process.env.SESSION_SECRET!,
 *   validate: (session) => {
 *     return session.userId ? { principal: session.userId } : null
 *   }
 * })
 */
export function streamCookieSession(
  options: StreamCookieSessionOptions
): (req: IncomingMessage) => Promise<{ auth?: AuthContext }> {
  return createStreamAuthFactory({ cookie: options })
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream Route Matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream route definition
 */
export interface StreamRoute {
  /**
   * Route pattern with optional params (e.g., '/logs/:serviceId')
   */
  pattern: string

  /**
   * Auth required for this route
   */
  authRequired?: boolean

  /**
   * Custom auth for this route (overrides global)
   */
  auth?: StreamAuthFactoryOptions
}

/**
 * Match request against stream routes
 *
 * @param path - Request path
 * @param routes - Stream route definitions
 * @returns Matched route and params, or null
 */
export function matchStreamRoute(
  path: string,
  routes: StreamRoute[]
): { route: StreamRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    const params = parsePathParams(path, route.pattern)
    if (params) {
      return { route, params }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createStreamAuthFactory,
  streamBearerAuth,
  streamApiKeyAuth,
  streamCookieSession,
  extractBearerToken,
  extractApiKey,
  extractCookieSession,
  parsePathParams,
  parseQueryParams,
  matchStreamRoute,
}
