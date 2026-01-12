/**
 * Authentication Middleware
 *
 * Provides authentication drivers for various auth strategies:
 * - Cookie Session: Session-based auth with signed cookies
 * - Basic Auth: HTTP Basic authentication
 * - Bearer Token: JWT/API key token authentication
 *
 * @example
 * import { basicAuth, bearerAuth, cookieSession } from 'raffel/http'
 *
 * // Basic Auth
 * app.use('/admin/*', basicAuth({
 *   username: 'admin',
 *   password: 'secret',
 *   realm: 'Admin Area'
 * }))
 *
 * // Bearer Token
 * app.use('/api/*', bearerAuth({
 *   verifyToken: async (token) => {
 *     const user = await verifyJWT(token)
 *     return user ? { user } : null
 *   }
 * }))
 *
 * // Cookie Session
 * app.use('*', cookieSession({
 *   secret: 'my-secret-key',
 *   cookieName: 'session',
 *   maxAge: 86400
 * }))
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import { setSignedCookie, getSignedCookie, deleteCookie, type CookieContext } from './cookie.js'

/**
 * Adapt HttpContextInterface to CookieContext
 */
function toCookieContext<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>
): CookieContext {
  return {
    req: {
      header: (name: string) => c.req.header(name) as string | undefined,
      raw: {
        headers: {
          cookie: c.req.header('cookie') as string | undefined,
        },
      },
    },
    header: (name: string, value: string) => c.header(name, value),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Basic auth configuration
 */
export interface BasicAuthOptions {
  /**
   * Valid username or verification function
   */
  username: string | ((username: string, password: string) => boolean | Promise<boolean>)

  /**
   * Valid password (if username is string)
   */
  password?: string

  /**
   * Realm for WWW-Authenticate header
   * @default 'Secure Area'
   */
  realm?: string

  /**
   * Custom error message
   */
  errorMessage?: string

  /**
   * Hash function for password comparison (for timing-safe comparison)
   */
  hashFunction?: (password: string) => string | Promise<string>
}

/**
 * Bearer token configuration
 */
export interface BearerAuthOptions<T = unknown> {
  /**
   * Token verification function
   * Returns user/payload data if valid, null/undefined if invalid
   */
  verifyToken: (token: string) => T | null | undefined | Promise<T | null | undefined>

  /**
   * Header to extract token from
   * @default 'authorization'
   */
  headerName?: string

  /**
   * Token prefix to strip
   * @default 'Bearer'
   */
  prefix?: string

  /**
   * Also check query parameter for token
   */
  queryParam?: string

  /**
   * Key in context to store verified token data
   * @default 'auth'
   */
  contextKey?: string

  /**
   * Custom error message
   */
  errorMessage?: string

  /**
   * Realm for WWW-Authenticate header
   * @default 'api'
   */
  realm?: string
}

/**
 * Cookie session configuration
 */
export interface CookieSessionOptions {
  /**
   * Secret key for signing cookies
   */
  secret: string

  /**
   * Cookie name for session
   * @default 'session'
   */
  cookieName?: string

  /**
   * Session max age in seconds
   * @default 86400 (24 hours)
   */
  maxAge?: number

  /**
   * Cookie path
   * @default '/'
   */
  path?: string

  /**
   * Cookie domain
   */
  domain?: string

  /**
   * Secure cookie (HTTPS only)
   * @default true in production
   */
  secure?: boolean

  /**
   * HttpOnly flag
   * @default true
   */
  httpOnly?: boolean

  /**
   * SameSite attribute
   * @default 'Lax'
   */
  sameSite?: 'Strict' | 'Lax' | 'None'

  /**
   * Key in context to store session data
   * @default 'session'
   */
  contextKey?: string

  /**
   * Regenerate session ID on each request (rolling sessions)
   * @default false
   */
  rolling?: boolean
}

/**
 * Session data interface
 */
export interface SessionData {
  id: string
  data: Record<string, unknown>
  createdAt: number
  expiresAt: number
}

/**
 * Session manager interface for context
 */
export interface SessionManager {
  /**
   * Get session data
   */
  get<T = unknown>(key: string): T | undefined

  /**
   * Set session data
   */
  set<T = unknown>(key: string, value: T): void

  /**
   * Delete session key
   */
  delete(key: string): void

  /**
   * Clear all session data
   */
  clear(): void

  /**
   * Destroy session (removes cookie)
   */
  destroy(): void

  /**
   * Regenerate session ID
   */
  regenerate(): void

  /**
   * Get all session data
   */
  all(): Record<string, unknown>

  /**
   * Check if session has key
   */
  has(key: string): boolean

  /**
   * Session ID
   */
  readonly id: string

  /**
   * Whether session was modified
   */
  readonly modified: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Basic Auth Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create HTTP Basic Authentication middleware
 *
 * @param options - Basic auth configuration
 * @returns Middleware function
 *
 * @example
 * // Simple username/password
 * app.use('/admin/*', basicAuth({
 *   username: 'admin',
 *   password: 'secret'
 * }))
 *
 * // Custom verification
 * app.use('/admin/*', basicAuth({
 *   username: async (user, pass) => {
 *     const valid = await db.verifyCredentials(user, pass)
 *     return valid
 *   }
 * }))
 */
export function basicAuth<E extends Record<string, unknown> = Record<string, unknown>>(
  options: BasicAuthOptions
): HttpMiddleware<E> {
  const {
    username,
    password,
    realm = 'Secure Area',
    errorMessage = 'Unauthorized',
  } = options

  const isVerifyFn = typeof username === 'function'

  return async (c, next) => {
    const authHeader = c.req.header('authorization') as string | undefined

    if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
      return createUnauthorizedResponse(realm, errorMessage)
    }

    // Decode base64 credentials
    const base64Credentials = authHeader.slice(6)
    let decoded: string
    try {
      decoded = atob(base64Credentials)
    } catch {
      return createUnauthorizedResponse(realm, errorMessage)
    }

    const colonIndex = decoded.indexOf(':')
    if (colonIndex === -1) {
      return createUnauthorizedResponse(realm, errorMessage)
    }

    const providedUsername = decoded.slice(0, colonIndex)
    const providedPassword = decoded.slice(colonIndex + 1)

    // Verify credentials
    let valid = false
    if (isVerifyFn) {
      valid = await (username as Function)(providedUsername, providedPassword)
    } else {
      // Timing-safe comparison
      valid = timingSafeEqual(providedUsername, username as string) &&
              timingSafeEqual(providedPassword, password || '')
    }

    if (!valid) {
      return createUnauthorizedResponse(realm, errorMessage)
    }

    // Store authenticated username in context
    c.set('basicAuth' as keyof E, { username: providedUsername } as E[keyof E])

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bearer Token Auth Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Bearer Token Authentication middleware
 *
 * @param options - Bearer auth configuration
 * @returns Middleware function
 *
 * @example
 * // JWT verification
 * app.use('/api/*', bearerAuth({
 *   verifyToken: async (token) => {
 *     try {
 *       const payload = await jwt.verify(token, secret)
 *       return payload
 *     } catch {
 *       return null
 *     }
 *   }
 * }))
 *
 * // API key verification
 * app.use('/api/*', bearerAuth({
 *   prefix: 'ApiKey',
 *   verifyToken: async (key) => {
 *     const apiKey = await db.findApiKey(key)
 *     return apiKey ? { user: apiKey.user } : null
 *   }
 * }))
 */
export function bearerAuth<
  T = unknown,
  E extends Record<string, unknown> = Record<string, unknown>
>(options: BearerAuthOptions<T>): HttpMiddleware<E> {
  const {
    verifyToken,
    headerName = 'authorization',
    prefix = 'Bearer',
    queryParam,
    contextKey = 'auth',
    errorMessage = 'Invalid or missing token',
    realm = 'api',
  } = options

  const prefixLower = prefix.toLowerCase()

  return async (c, next) => {
    let token: string | undefined

    // Try header first
    const authHeader = c.req.header(headerName) as string | undefined
    if (authHeader) {
      const headerLower = authHeader.toLowerCase()
      if (headerLower.startsWith(prefixLower + ' ')) {
        token = authHeader.slice(prefix.length + 1).trim()
      } else if (!prefix) {
        // No prefix required
        token = authHeader.trim()
      }
    }

    // Try query param if configured and no token from header
    if (!token && queryParam) {
      const url = new URL(c.req.url)
      token = url.searchParams.get(queryParam) || undefined
    }

    if (!token) {
      return createBearerUnauthorizedResponse(realm, errorMessage)
    }

    // Verify token
    const result = await verifyToken(token)
    if (result === null || result === undefined) {
      return createBearerUnauthorizedResponse(realm, errorMessage)
    }

    // Store verified token data in context
    c.set(contextKey as keyof E, result as E[keyof E])

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie Session Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Cookie Session middleware
 *
 * Provides session management via signed cookies.
 *
 * @param options - Session configuration
 * @returns Middleware function
 *
 * @example
 * app.use('*', cookieSession({
 *   secret: process.env.SESSION_SECRET!,
 *   maxAge: 60 * 60 * 24 * 7 // 1 week
 * }))
 *
 * // In handler
 * app.post('/login', async (c) => {
 *   const session = c.get('session') as SessionManager
 *   session.set('userId', user.id)
 *   return c.json({ success: true })
 * })
 *
 * app.get('/profile', async (c) => {
 *   const session = c.get('session') as SessionManager
 *   const userId = session.get('userId')
 *   if (!userId) return c.json({ error: 'Not logged in' }, 401)
 *   // ...
 * })
 */
export function cookieSession<E extends Record<string, unknown> = Record<string, unknown>>(
  options: CookieSessionOptions
): HttpMiddleware<E> {
  const {
    secret,
    cookieName = 'session',
    maxAge = 86400,
    path = '/',
    domain,
    secure = process.env.NODE_ENV === 'production',
    httpOnly = true,
    sameSite = 'Lax',
    contextKey = 'session',
    rolling = false,
  } = options

  return async (c, next) => {
    // Load existing session from cookie
    let sessionData: SessionData | null = null
    const cookieCtx = toCookieContext(c)
    const existingCookie = await getSignedCookie(cookieCtx, secret, cookieName)

    if (existingCookie) {
      try {
        sessionData = JSON.parse(existingCookie)
        // Check expiration
        if (sessionData && sessionData.expiresAt < Date.now()) {
          sessionData = null
        }
      } catch {
        sessionData = null
      }
    }

    // Create new session if none exists
    if (!sessionData) {
      sessionData = {
        id: generateSessionId(),
        data: {},
        createdAt: Date.now(),
        expiresAt: Date.now() + maxAge * 1000,
      }
    }

    // Track modifications
    let modified = false
    let destroyed = false
    let regenerated = false
    let currentData = { ...sessionData.data }
    let currentId = sessionData.id

    // Create session manager
    const manager: SessionManager = {
      get<T>(key: string): T | undefined {
        return currentData[key] as T | undefined
      },

      set<T>(key: string, value: T): void {
        currentData[key] = value
        modified = true
      },

      delete(key: string): void {
        if (key in currentData) {
          delete currentData[key]
          modified = true
        }
      },

      clear(): void {
        currentData = {}
        modified = true
      },

      destroy(): void {
        destroyed = true
        modified = true
      },

      regenerate(): void {
        currentId = generateSessionId()
        regenerated = true
        modified = true
      },

      all(): Record<string, unknown> {
        return { ...currentData }
      },

      has(key: string): boolean {
        return key in currentData
      },

      get id(): string {
        return currentId
      },

      get modified(): boolean {
        return modified
      },
    }

    // Store session manager in context
    c.set(contextKey as keyof E, manager as E[keyof E])

    // Process request
    await next()

    // Save session after request
    if (destroyed) {
      // Delete cookie
      deleteCookie(cookieCtx, cookieName, { path, domain })
    } else if (modified || rolling) {
      // Update session cookie
      const newSession: SessionData = {
        id: currentId,
        data: currentData,
        createdAt: regenerated ? Date.now() : sessionData.createdAt,
        expiresAt: Date.now() + maxAge * 1000,
      }

      await setSignedCookie(cookieCtx, cookieName, JSON.stringify(newSession), secret, {
        path,
        domain,
        secure,
        httpOnly,
        sameSite,
        maxAge,
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Auth Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strategy for combining multiple auth methods
 */
export type CompositeAuthStrategy = 'any' | 'all' | 'priority'

/**
 * Composite auth configuration
 */
export interface CompositeAuthOptions<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Array of auth middlewares to combine
   */
  drivers: HttpMiddleware<E>[]

  /**
   * Strategy for combining auth methods
   * - 'any': First successful auth wins (OR logic) - default
   * - 'all': All auth methods must pass (AND logic)
   * - 'priority': Try in order, use first success, fail on first hard error
   * @default 'any'
   */
  strategy?: CompositeAuthStrategy

  /**
   * Custom error message when all auth methods fail
   */
  errorMessage?: string

  /**
   * Realm for WWW-Authenticate header
   * @default 'api'
   */
  realm?: string
}

/**
 * Create composite authentication middleware
 *
 * Combines multiple auth drivers with configurable strategies.
 *
 * @param options - Composite auth configuration
 * @returns Middleware function
 *
 * @example
 * // Accept either API key OR JWT token
 * app.use('/api/*', compositeAuth({
 *   drivers: [
 *     bearerAuth({ verifyToken: verifyJWT }),
 *     bearerAuth({ prefix: 'ApiKey', verifyToken: verifyApiKey })
 *   ],
 *   strategy: 'any' // First success wins
 * }))
 *
 * @example
 * // Require both session AND 2FA token
 * app.use('/sensitive/*', compositeAuth({
 *   drivers: [
 *     cookieSession({ secret }),
 *     bearerAuth({ headerName: 'x-2fa-token', verifyToken: verify2FA })
 *   ],
 *   strategy: 'all' // Both must pass
 * }))
 *
 * @example
 * // Priority: try JWT first, fall back to API key
 * app.use('/api/*', compositeAuth({
 *   drivers: [
 *     bearerAuth({ verifyToken: verifyJWT }),
 *     bearerAuth({ prefix: 'ApiKey', verifyToken: verifyApiKey })
 *   ],
 *   strategy: 'priority'
 * }))
 */
export function compositeAuth<E extends Record<string, unknown> = Record<string, unknown>>(
  options: CompositeAuthOptions<E>
): HttpMiddleware<E> {
  const {
    drivers,
    strategy = 'any',
    errorMessage = 'Authentication failed',
    realm = 'api',
  } = options

  if (drivers.length === 0) {
    throw new Error('compositeAuth requires at least one driver')
  }

  // Single driver - just return it
  if (drivers.length === 1) {
    return drivers[0]
  }

  return async (c, next) => {
    switch (strategy) {
      case 'any':
        return handleAnyStrategy(c, next, drivers, realm, errorMessage)
      case 'all':
        return handleAllStrategy(c, next, drivers, realm, errorMessage)
      case 'priority':
        return handlePriorityStrategy(c, next, drivers, realm, errorMessage)
      default:
        throw new Error(`Unknown composite auth strategy: ${strategy}`)
    }
  }
}

/**
 * ANY strategy: First successful auth wins
 * Tries each driver until one succeeds (calls next)
 */
async function handleAnyStrategy<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  next: () => Promise<void | Response>,
  drivers: HttpMiddleware<E>[],
  realm: string,
  errorMessage: string
): Promise<void | Response> {
  const errors: string[] = []

  for (const driver of drivers) {
    let succeeded = false
    let driverResponse: void | Response = undefined

    // Create a mock next that tracks if auth succeeded
    const mockNext = async (): Promise<void> => {
      succeeded = true
    }

    try {
      driverResponse = await driver(c, mockNext)

      if (succeeded) {
        // This driver succeeded, now call the real next
        await next()
        return
      }

      // Driver returned a response (likely 401)
      if (driverResponse instanceof Response) {
        // Try to extract error message
        try {
          const body = await driverResponse.clone().json() as { error?: { message?: string } }
          if (body?.error?.message) {
            errors.push(body.error.message)
          }
        } catch {
          errors.push(`Auth method ${drivers.indexOf(driver) + 1} failed`)
        }
      }
    } catch (err) {
      errors.push((err as Error).message || 'Unknown auth error')
    }
  }

  // All drivers failed
  return createCompositeUnauthorizedResponse(realm, errorMessage, errors)
}

/**
 * ALL strategy: All auth methods must pass
 * All drivers must call next (success)
 */
async function handleAllStrategy<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  next: () => Promise<void | Response>,
  drivers: HttpMiddleware<E>[],
  realm: string,
  errorMessage: string
): Promise<void | Response> {
  for (const driver of drivers) {
    let succeeded = false
    let driverResponse: void | Response = undefined

    const mockNext = async (): Promise<void> => {
      succeeded = true
    }

    try {
      driverResponse = await driver(c, mockNext)

      if (!succeeded) {
        // This driver failed - return its response or a generic error
        if (driverResponse instanceof Response) {
          return driverResponse
        }
        return createCompositeUnauthorizedResponse(realm, errorMessage, [])
      }
    } catch (err) {
      return createCompositeUnauthorizedResponse(realm, (err as Error).message || errorMessage, [])
    }
  }

  // All drivers succeeded
  await next()
}

/**
 * PRIORITY strategy: Try in order, first success or non-401 response wins
 * Similar to 'any' but preserves driver order importance
 */
async function handlePriorityStrategy<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  next: () => Promise<void | Response>,
  drivers: HttpMiddleware<E>[],
  realm: string,
  errorMessage: string
): Promise<void | Response> {
  let lastResponse: Response | undefined

  for (const driver of drivers) {
    let succeeded = false
    let driverResponse: void | Response = undefined

    const mockNext = async (): Promise<void> => {
      succeeded = true
    }

    try {
      driverResponse = await driver(c, mockNext)

      if (succeeded) {
        // This driver succeeded
        await next()
        return
      }

      // Check if it's a 401 (keep trying) or other error (stop)
      if (driverResponse instanceof Response) {
        if (driverResponse.status !== 401) {
          // Non-401 error - return immediately
          return driverResponse
        }
        lastResponse = driverResponse
      }
    } catch (err) {
      // Exception - return error
      return createCompositeUnauthorizedResponse(realm, (err as Error).message || errorMessage, [])
    }
  }

  // All drivers returned 401 - return the last one or generic error
  return lastResponse || createCompositeUnauthorizedResponse(realm, errorMessage, [])
}

/**
 * Create 401 Unauthorized response for composite auth
 */
function createCompositeUnauthorizedResponse(
  realm: string,
  message: string,
  details: string[]
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: 'UNAUTHORIZED',
        ...(details.length > 0 ? { details } : {}),
      },
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="${realm}"`,
      },
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create 401 Unauthorized response for Basic Auth
 */
function createUnauthorizedResponse(realm: string, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: 'UNAUTHORIZED',
      },
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Basic realm="${realm}", charset="UTF-8"`,
      },
    }
  )
}

/**
 * Create 401 Unauthorized response for Bearer Auth
 */
function createBearerUnauthorizedResponse(realm: string, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: 'UNAUTHORIZED',
      },
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="${realm}"`,
      },
    }
  )
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against same-length string to maintain constant time
    b = a
  }

  let result = a.length === b.length ? 0 : 1
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/**
 * Generate a random session ID
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Path-Based Auth Strategy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Path rule for path-based auth
 */
export interface PathAuthRule<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Path pattern to match (supports wildcards: /admin/*, /api/users/:id)
   */
  path: string

  /**
   * Auth middleware to apply for this path
   * Use null to skip auth (public route)
   */
  auth: HttpMiddleware<E> | null
}

/**
 * Path-based auth configuration
 */
export interface PathAuthOptions<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Array of path rules (evaluated in order, first match wins)
   */
  rules: PathAuthRule<E>[]

  /**
   * Default auth for paths that don't match any rule
   * If not provided, requests that don't match any rule pass through
   */
  defaultAuth?: HttpMiddleware<E> | null

  /**
   * Custom error message when no rule matches and defaultAuth is not set
   */
  errorMessage?: string
}

/**
 * Create path-based authentication middleware
 *
 * Routes requests to different auth middlewares based on URL path.
 *
 * @param options - Path auth configuration
 * @returns Middleware function
 *
 * @example
 * app.use(pathAuth({
 *   rules: [
 *     { path: '/public/*', auth: null }, // No auth
 *     { path: '/admin/*', auth: basicAuth({ username: 'admin', password: 'secret' }) },
 *     { path: '/api/*', auth: bearerAuth({ verifyToken }) },
 *   ],
 *   defaultAuth: bearerAuth({ verifyToken }) // Default for unmatched paths
 * }))
 */
export function pathAuth<E extends Record<string, unknown> = Record<string, unknown>>(
  options: PathAuthOptions<E>
): HttpMiddleware<E> {
  const { rules, defaultAuth, errorMessage } = options

  // Compile path patterns to regexes for efficient matching
  const compiledRules = rules.map(rule => ({
    pattern: compilePathPattern(rule.path),
    auth: rule.auth,
  }))

  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname

    // Find first matching rule
    for (const rule of compiledRules) {
      if (rule.pattern.test(pathname)) {
        if (rule.auth === null) {
          // Public route - no auth required
          await next()
          return
        }
        // Apply auth middleware
        return rule.auth(c, next)
      }
    }

    // No rule matched - use default or pass through
    if (defaultAuth !== undefined) {
      if (defaultAuth === null) {
        await next()
        return
      }
      return defaultAuth(c, next)
    }

    // No default - pass through
    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Rules Strategy (Path + Method)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HTTP methods for path rules
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | '*'

/**
 * Path rule with method matching
 */
export interface PathMethodRule<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Path pattern to match (supports wildcards)
   */
  path: string

  /**
   * HTTP method(s) to match. Use '*' for all methods.
   */
  method: HttpMethod | HttpMethod[]

  /**
   * Auth middleware to apply
   * Use null to skip auth (public route)
   */
  auth: HttpMiddleware<E> | null
}

/**
 * Path rules configuration
 */
export interface PathRulesOptions<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Array of path + method rules (evaluated in order, first match wins)
   */
  rules: PathMethodRule<E>[]

  /**
   * Default auth for requests that don't match any rule
   */
  defaultAuth?: HttpMiddleware<E> | null

  /**
   * Custom error for unauthorized requests
   */
  errorMessage?: string
}

/**
 * Create path + method based authentication middleware
 *
 * Routes requests to different auth middlewares based on URL path AND HTTP method.
 * More granular than pathAuth - allows different auth for GET vs POST on same path.
 *
 * @param options - Path rules configuration
 * @returns Middleware function
 *
 * @example
 * app.use(pathRules({
 *   rules: [
 *     // Public read, auth for write
 *     { path: '/api/posts', method: 'GET', auth: null },
 *     { path: '/api/posts', method: ['POST', 'PUT', 'DELETE'], auth: bearerAuth({ verifyToken }) },
 *
 *     // All methods on admin require auth
 *     { path: '/admin/*', method: '*', auth: basicAuth({ username, password }) },
 *   ]
 * }))
 */
export function pathRules<E extends Record<string, unknown> = Record<string, unknown>>(
  options: PathRulesOptions<E>
): HttpMiddleware<E> {
  const { rules, defaultAuth } = options

  // Compile rules
  const compiledRules = rules.map(rule => ({
    pattern: compilePathPattern(rule.path),
    methods: Array.isArray(rule.method) ? rule.method : [rule.method],
    auth: rule.auth,
  }))

  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname
    const method = c.req.method.toUpperCase() as HttpMethod

    // Find first matching rule
    for (const rule of compiledRules) {
      const pathMatches = rule.pattern.test(pathname)
      const methodMatches = rule.methods.includes('*') || rule.methods.includes(method)

      if (pathMatches && methodMatches) {
        if (rule.auth === null) {
          await next()
          return
        }
        return rule.auth(c, next)
      }
    }

    // No rule matched
    if (defaultAuth !== undefined) {
      if (defaultAuth === null) {
        await next()
        return
      }
      return defaultAuth(c, next)
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Throttling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Login attempt record
 */
interface LoginAttempt {
  /** Number of failed attempts */
  count: number
  /** Timestamp of first attempt in current window */
  firstAttemptAt: number
  /** Timestamp when block expires (if blocked) */
  blockedUntil?: number
}

/**
 * Login throttle configuration
 */
export interface LoginThrottleOptions {
  /**
   * Maximum failed attempts before blocking
   * @default 5
   */
  maxAttempts?: number

  /**
   * Time window for counting attempts (ms)
   * @default 900000 (15 minutes)
   */
  windowMs?: number

  /**
   * How long to block after max attempts (ms)
   * @default 3600000 (1 hour)
   */
  blockDurationMs?: number

  /**
   * Optional callback when an IP gets blocked
   */
  onBlock?: (key: string, attempts: number) => void

  /**
   * Optional callback when a blocked attempt occurs
   */
  onBlockedAttempt?: (key: string, remainingMs: number) => void
}

/**
 * Login throttle manager interface
 */
export interface LoginThrottleManager {
  /**
   * Check if a key (IP/user) is currently blocked
   */
  isBlocked(key: string): boolean

  /**
   * Get remaining block time in milliseconds (0 if not blocked)
   */
  getBlockTimeRemaining(key: string): number

  /**
   * Record a failed login attempt
   * Returns true if this attempt triggered a block
   */
  recordFailure(key: string): boolean

  /**
   * Reset attempts for a key (call on successful login)
   */
  reset(key: string): void

  /**
   * Get current attempt count for a key
   */
  getAttempts(key: string): number

  /**
   * Manually block a key
   */
  block(key: string, durationMs?: number): void

  /**
   * Manually unblock a key
   */
  unblock(key: string): void

  /**
   * Clean up expired entries
   */
  cleanup(): void

  /**
   * Get stats about current state
   */
  getStats(): { trackedKeys: number; blockedKeys: number }
}

/**
 * Create a login throttle manager
 *
 * Tracks failed login attempts and blocks keys (IPs/users) after too many failures.
 *
 * @param options - Throttle configuration
 * @returns LoginThrottleManager
 *
 * @example
 * const throttle = createLoginThrottle({
 *   maxAttempts: 5,
 *   windowMs: 15 * 60 * 1000, // 15 minutes
 *   blockDurationMs: 60 * 60 * 1000, // 1 hour
 *   onBlock: (ip) => console.log(`Blocked IP: ${ip}`)
 * })
 *
 * app.post('/login', async (c) => {
 *   const ip = c.req.header('x-forwarded-for') || 'unknown'
 *
 *   if (throttle.isBlocked(ip)) {
 *     const remaining = throttle.getBlockTimeRemaining(ip)
 *     return c.json({
 *       error: 'Too many failed attempts',
 *       retryAfterMs: remaining
 *     }, 429)
 *   }
 *
 *   const valid = await verifyCredentials(username, password)
 *   if (!valid) {
 *     const blocked = throttle.recordFailure(ip)
 *     if (blocked) {
 *       return c.json({ error: 'Account locked due to too many attempts' }, 429)
 *     }
 *     return c.json({ error: 'Invalid credentials' }, 401)
 *   }
 *
 *   throttle.reset(ip) // Clear on success
 *   // ... create session
 * })
 */
export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottleManager {
  const {
    maxAttempts = 5,
    windowMs = 15 * 60 * 1000,
    blockDurationMs = 60 * 60 * 1000,
    onBlock,
    onBlockedAttempt,
  } = options

  const attempts = new Map<string, LoginAttempt>()

  // Cleanup interval (run every 5 minutes)
  const cleanupInterval = setInterval(() => {
    cleanup()
  }, 5 * 60 * 1000)

  // Allow cleanup to be stopped
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }

  function cleanup(): void {
    const now = Date.now()
    for (const [key, record] of attempts) {
      // Remove if window expired and not blocked
      const windowExpired = now - record.firstAttemptAt > windowMs
      const blockExpired = !record.blockedUntil || record.blockedUntil < now

      if (windowExpired && blockExpired) {
        attempts.delete(key)
      }
    }
  }

  function isBlocked(key: string): boolean {
    const record = attempts.get(key)
    if (!record?.blockedUntil) return false

    if (record.blockedUntil < Date.now()) {
      // Block expired
      attempts.delete(key)
      return false
    }

    return true
  }

  function getBlockTimeRemaining(key: string): number {
    const record = attempts.get(key)
    if (!record?.blockedUntil) return 0

    const remaining = record.blockedUntil - Date.now()
    return remaining > 0 ? remaining : 0
  }

  function recordFailure(key: string): boolean {
    const now = Date.now()
    let record = attempts.get(key)

    if (!record) {
      record = { count: 0, firstAttemptAt: now }
      attempts.set(key, record)
    }

    // Check if window expired - reset if so
    if (now - record.firstAttemptAt > windowMs) {
      record.count = 0
      record.firstAttemptAt = now
      record.blockedUntil = undefined
    }

    record.count++

    // Check if should block
    if (record.count >= maxAttempts) {
      record.blockedUntil = now + blockDurationMs
      onBlock?.(key, record.count)
      return true
    }

    return false
  }

  function reset(key: string): void {
    attempts.delete(key)
  }

  function getAttempts(key: string): number {
    const record = attempts.get(key)
    if (!record) return 0

    // Check if window expired
    if (Date.now() - record.firstAttemptAt > windowMs) {
      attempts.delete(key)
      return 0
    }

    return record.count
  }

  function block(key: string, durationMs?: number): void {
    const duration = durationMs ?? blockDurationMs
    const record = attempts.get(key) || { count: maxAttempts, firstAttemptAt: Date.now() }
    record.blockedUntil = Date.now() + duration
    attempts.set(key, record)
  }

  function unblock(key: string): void {
    const record = attempts.get(key)
    if (record) {
      record.blockedUntil = undefined
      record.count = 0
    }
  }

  function getStats(): { trackedKeys: number; blockedKeys: number } {
    let blockedKeys = 0
    const now = Date.now()

    for (const record of attempts.values()) {
      if (record.blockedUntil && record.blockedUntil > now) {
        blockedKeys++
      }
    }

    return { trackedKeys: attempts.size, blockedKeys }
  }

  return {
    isBlocked,
    getBlockTimeRemaining,
    recordFailure,
    reset,
    getAttempts,
    block,
    unblock,
    cleanup,
    getStats,
  }
}

/**
 * Create login throttle middleware
 *
 * Automatically blocks requests from IPs with too many failures.
 * Use with a login endpoint that calls recordFailure on bad credentials.
 *
 * @param throttle - Login throttle manager
 * @param keyGenerator - Function to extract key from request (default: IP address)
 * @returns Middleware function
 *
 * @example
 * const throttle = createLoginThrottle({ maxAttempts: 5 })
 *
 * // Apply middleware to login route
 * app.post('/login',
 *   loginThrottleMiddleware(throttle),
 *   async (c) => {
 *     // ... verify credentials
 *     // On failure: throttle.recordFailure(key)
 *     // On success: throttle.reset(key)
 *   }
 * )
 */
export function loginThrottleMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  throttle: LoginThrottleManager,
  keyGenerator?: (c: HttpContextInterface<E>) => string
): HttpMiddleware<E> {
  const getKey = keyGenerator ?? ((c) => {
    // Try common headers for real IP behind proxy
    return (
      (c.req.header('x-forwarded-for') as string)?.split(',')[0]?.trim() ||
      (c.req.header('x-real-ip') as string) ||
      'unknown'
    )
  })

  return async (c, next) => {
    const key = getKey(c)

    if (throttle.isBlocked(key)) {
      const remaining = throttle.getBlockTimeRemaining(key)
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many failed login attempts. Please try again later.',
            retryAfterMs: remaining,
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil(remaining / 1000).toString(),
          },
        }
      )
    }

    // Store key in context for handler to use
    c.set('throttleKey' as keyof E, key as E[keyof E])

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile a path pattern to a regex
 * Supports:
 * - Wildcards: /api/* matches /api/anything
 * - Parameters: /users/:id matches /users/123
 * - Exact match: /login matches only /login
 */
function compilePathPattern(pattern: string): RegExp {
  // Escape special regex chars except * and :
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Convert :param to match any segment
    .replace(/:[^/]+/g, '[^/]+')
    // Convert * to match anything
    .replace(/\*/g, '.*')

  // Ensure exact match at start
  regex = '^' + regex

  // Handle trailing slash optionally
  if (!regex.endsWith('.*')) {
    regex += '/?$'
  }

  return new RegExp(regex)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  basicAuth,
  bearerAuth,
  cookieSession,
  compositeAuth,
  pathAuth,
  pathRules,
  createLoginThrottle,
  loginThrottleMiddleware,
}
