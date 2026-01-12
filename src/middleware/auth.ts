/**
 * Authentication Middleware
 *
 * Flexible authentication middleware supporting multiple strategies:
 * - Bearer token (JWT, OAuth tokens)
 * - API Key
 * - Custom strategies
 */

import { RaffelError } from '../core/index.js'
import type { Interceptor, Envelope, Context, AuthContext } from '../types/index.js'

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication was successful */
  authenticated: boolean
  /** User/service identifier (maps to AuthContext.principal) */
  principal?: string
  /** User roles/permissions (stored in claims.roles) */
  roles?: string[]
  /** Authentication claims (JWT payload, etc.) */
  claims?: Record<string, unknown>
}

/**
 * Authentication strategy interface
 */
export interface AuthStrategy {
  /** Strategy name for identification */
  name: string

  /**
   * Authenticate the request
   * @param envelope - The incoming envelope with metadata
   * @param ctx - Request context
   * @returns AuthResult or null if strategy doesn't apply
   */
  authenticate(envelope: Envelope, ctx: Context): Promise<AuthResult | null>
}

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  /** Authentication strategies to apply (in order) */
  strategies: AuthStrategy[]
  /** Procedures that don't require authentication */
  publicProcedures?: string[]
  /** Custom error handler */
  onError?: (error: Error, envelope: Envelope) => void
}

/**
 * Bearer token authentication strategy
 */
export interface BearerTokenOptions {
  /** Function to verify and decode the token */
  verify: (token: string) => Promise<AuthResult | null>
  /** Header name (default: 'authorization') */
  headerName?: string
  /** Token prefix (default: 'Bearer ') */
  tokenPrefix?: string
}

/**
 * Create a bearer token authentication strategy
 */
export function createBearerStrategy(options: BearerTokenOptions): AuthStrategy {
  const { verify, headerName = 'authorization', tokenPrefix = 'Bearer ' } = options

  return {
    name: 'bearer',
    async authenticate(envelope: Envelope): Promise<AuthResult | null> {
      const authHeader = envelope.metadata?.[headerName] || envelope.metadata?.['Authorization']

      if (!authHeader || typeof authHeader !== 'string') {
        return null // Strategy doesn't apply
      }

      if (!authHeader.startsWith(tokenPrefix)) {
        return null // Not a bearer token
      }

      const token = authHeader.slice(tokenPrefix.length)
      return verify(token)
    },
  }
}

/**
 * API Key authentication strategy options
 */
export interface ApiKeyOptions {
  /** Function to verify the API key */
  verify: (apiKey: string) => Promise<AuthResult | null>
  /** Header name for API key (default: 'x-api-key') */
  headerName?: string
}

/**
 * Create an API key authentication strategy
 */
export function createApiKeyStrategy(options: ApiKeyOptions): AuthStrategy {
  const { verify, headerName = 'x-api-key' } = options

  return {
    name: 'api-key',
    async authenticate(envelope: Envelope): Promise<AuthResult | null> {
      const apiKey = envelope.metadata?.[headerName]

      if (!apiKey || typeof apiKey !== 'string') {
        return null // Strategy doesn't apply
      }

      return verify(apiKey)
    },
  }
}

/**
 * Simple static API key strategy for development/internal use
 */
export function createStaticApiKeyStrategy(validKeys: Map<string, AuthResult>): AuthStrategy {
  return createApiKeyStrategy({
    async verify(apiKey: string): Promise<AuthResult | null> {
      const result = validKeys.get(apiKey)
      return result || { authenticated: false }
    },
  })
}

// ============================================================================
// COOKIE SESSION AUTHENTICATION
// ============================================================================

/**
 * Cookie session authentication strategy options
 */
export interface CookieSessionOptions {
  /** Cookie name (default: 'session') */
  cookieName?: string
  /** Secret for signed cookies (optional) */
  secret?: string
  /** Function to validate and decode the session */
  validate: (sessionId: string) => Promise<AuthResult | null>
  /** Whether to use chunked cookies for large sessions */
  chunked?: boolean
}

/**
 * Create a cookie session authentication strategy
 *
 * Works with:
 * - Simple session cookies
 * - Signed cookies (HMAC-SHA256)
 * - Chunked cookies (for large JWT sessions)
 *
 * @example
 * ```ts
 * const cookieAuth = createCookieSessionStrategy({
 *   cookieName: 'session',
 *   secret: process.env.COOKIE_SECRET,
 *   validate: async (sessionId) => {
 *     const session = await redis.get(`session:${sessionId}`)
 *     if (!session) return null
 *     return { authenticated: true, principal: session.userId, claims: session }
 *   }
 * })
 * ```
 */
export function createCookieSessionStrategy(options: CookieSessionOptions): AuthStrategy {
  const { cookieName = 'session', secret, validate, chunked = false } = options

  return {
    name: 'cookie-session',
    async authenticate(envelope: Envelope, ctx: Context): Promise<AuthResult | null> {
      // Get cookie header from metadata
      const cookieHeader = envelope.metadata?.['cookie'] || envelope.metadata?.['Cookie']

      if (!cookieHeader || typeof cookieHeader !== 'string') {
        return null // No cookies
      }

      // Parse cookies
      const cookies = parseCookies(cookieHeader)

      let sessionId: string | undefined

      if (chunked) {
        // Reassemble chunked cookies
        sessionId = getChunkedCookie(cookies, cookieName)
      } else {
        sessionId = cookies[cookieName]
      }

      if (!sessionId) {
        return null // No session cookie
      }

      // Verify signature if secret provided
      if (secret) {
        const verified = verifySignedCookie(sessionId, secret)
        if (!verified) {
          return { authenticated: false } // Invalid signature
        }
        sessionId = verified
      }

      // Validate session
      return validate(sessionId)
    },
  }
}

/**
 * Parse cookie header into key-value pairs
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}

  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=')
    if (name) {
      cookies[name.trim()] = decodeURIComponent(valueParts.join('='))
    }
  }

  return cookies
}

/**
 * Get chunked cookie value (reassembles cookie.0, cookie.1, etc.)
 */
function getChunkedCookie(cookies: Record<string, string>, name: string): string | undefined {
  const chunksCountKey = `${name}.__chunks`
  const chunksCount = parseInt(cookies[chunksCountKey] || '0', 10)

  if (chunksCount === 0) {
    // Not chunked, try regular cookie
    return cookies[name]
  }

  const chunks: string[] = []
  for (let i = 0; i < chunksCount; i++) {
    const chunk = cookies[`${name}.${i}`]
    if (!chunk) return undefined // Missing chunk
    chunks.push(chunk)
  }

  return chunks.join('')
}

/**
 * Verify signed cookie (format: value.signature)
 */
function verifySignedCookie(signedValue: string, secret: string): string | null {
  const lastDot = signedValue.lastIndexOf('.')
  if (lastDot === -1) return null

  const value = signedValue.slice(0, lastDot)
  const signature = signedValue.slice(lastDot + 1)

  // Compute expected signature
  const expectedSignature = computeHmacSignature(value, secret)

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) return null
  let valid = true
  for (let i = 0; i < signature.length; i++) {
    if (signature[i] !== expectedSignature[i]) valid = false
  }

  return valid ? value : null
}

/**
 * Compute HMAC-SHA256 signature (base64url encoded)
 */
function computeHmacSignature(value: string, secret: string): string {
  // Use Node.js crypto
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

// ============================================================================
// ENHANCED BEARER TOKEN WITH QUERY PARAM SUPPORT
// ============================================================================

/**
 * Enhanced bearer token options with query param support
 */
export interface EnhancedBearerTokenOptions {
  /** Function to verify and decode the token */
  verify: (token: string) => Promise<AuthResult | null>
  /** Header name (default: 'authorization') */
  headerName?: string
  /** Token prefix (default: 'Bearer ') */
  tokenPrefix?: string
  /** Query param name for token (e.g., 'token' for EventSource) */
  queryParam?: string
  /** Extract from sources (default: ['header']) */
  extractFrom?: Array<'header' | 'query'>
}

/**
 * Create an enhanced bearer token strategy with query param support
 *
 * This is useful for EventSource/SSE connections where you can't set
 * custom headers. The token can be passed via query param instead.
 *
 * @example
 * ```ts
 * const bearerAuth = createEnhancedBearerStrategy({
 *   extractFrom: ['header', 'query'],
 *   queryParam: 'token',
 *   verify: async (token) => {
 *     const decoded = jwt.verify(token, secret)
 *     return { authenticated: true, principal: decoded.sub, claims: decoded }
 *   }
 * })
 *
 * // Works with:
 * // Authorization: Bearer <token>
 * // GET /stream?token=<token>
 * ```
 */
export function createEnhancedBearerStrategy(options: EnhancedBearerTokenOptions): AuthStrategy {
  const {
    verify,
    headerName = 'authorization',
    tokenPrefix = 'Bearer ',
    queryParam = 'token',
    extractFrom = ['header'],
  } = options

  return {
    name: 'bearer-enhanced',
    async authenticate(envelope: Envelope, ctx: Context): Promise<AuthResult | null> {
      let token: string | undefined

      // Try header first
      if (extractFrom.includes('header')) {
        const authHeader = envelope.metadata?.[headerName] || envelope.metadata?.['Authorization']
        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith(tokenPrefix)) {
          token = authHeader.slice(tokenPrefix.length)
        }
      }

      // Try query param if not found in header
      if (!token && extractFrom.includes('query')) {
        // Query params might be in metadata or in a parsed query object
        const metadata = envelope.metadata as Record<string, unknown> | undefined
        const queryObj = metadata?.['query'] as Record<string, unknown> | undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctxQuery = (ctx as any).query as Record<string, unknown> | undefined

        const queryToken = metadata?.[queryParam] || queryObj?.[queryParam] || ctxQuery?.[queryParam]

        if (queryToken && typeof queryToken === 'string') {
          token = queryToken
        }
      }

      if (!token) {
        return null // No token found
      }

      return verify(token)
    },
  }
}

// ============================================================================
// ENHANCED API KEY WITH QUERY PARAM SUPPORT
// ============================================================================

/**
 * Enhanced API key options with query param support
 */
export interface EnhancedApiKeyOptions {
  /** Function to verify the API key */
  verify: (apiKey: string) => Promise<AuthResult | null>
  /** Header name for API key (default: 'x-api-key') */
  headerName?: string
  /** Query param name for API key (e.g., 'apiKey' for EventSource) */
  queryParam?: string
  /** Extract from sources (default: ['header']) */
  extractFrom?: Array<'header' | 'query'>
}

/**
 * Create an enhanced API key strategy with query param support
 *
 * @example
 * ```ts
 * const apiKeyAuth = createEnhancedApiKeyStrategy({
 *   extractFrom: ['header', 'query'],
 *   queryParam: 'apiKey',
 *   verify: async (key) => {
 *     const apiKey = await db.apiKeys.findByKey(key)
 *     if (!apiKey) return null
 *     return { authenticated: true, principal: apiKey.ownerId, claims: { scopes: apiKey.scopes } }
 *   }
 * })
 *
 * // Works with:
 * // X-API-Key: <key>
 * // GET /stream?apiKey=<key>
 * ```
 */
export function createEnhancedApiKeyStrategy(options: EnhancedApiKeyOptions): AuthStrategy {
  const { verify, headerName = 'x-api-key', queryParam = 'apiKey', extractFrom = ['header'] } = options

  return {
    name: 'api-key-enhanced',
    async authenticate(envelope: Envelope, ctx: Context): Promise<AuthResult | null> {
      let apiKey: string | undefined

      // Try header first
      if (extractFrom.includes('header')) {
        const headerKey = envelope.metadata?.[headerName] || envelope.metadata?.['X-API-Key']
        if (headerKey && typeof headerKey === 'string') {
          apiKey = headerKey
        }
      }

      // Try query param if not found in header
      if (!apiKey && extractFrom.includes('query')) {
        const metadata = envelope.metadata as Record<string, unknown> | undefined
        const queryObj = metadata?.['query'] as Record<string, unknown> | undefined
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctxQuery = (ctx as any).query as Record<string, unknown> | undefined

        const queryKey = metadata?.[queryParam] || queryObj?.[queryParam] || ctxQuery?.[queryParam]

        if (queryKey && typeof queryKey === 'string') {
          apiKey = queryKey
        }
      }

      if (!apiKey) {
        return null // No API key found
      }

      return verify(apiKey)
    },
  }
}

/**
 * Create the authentication interceptor
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): Interceptor {
  const { strategies, publicProcedures = [], onError } = options

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Check if procedure is public
    if (publicProcedures.includes(envelope.procedure)) {
      return next()
    }

    // Try each strategy in order
    let authResult: AuthResult | null = null

    for (const strategy of strategies) {
      try {
        authResult = await strategy.authenticate(envelope, ctx)
        if (authResult) break
      } catch (error) {
        if (onError) {
          onError(error as Error, envelope)
        }
        // Continue to next strategy on error
      }
    }

    // Check authentication result
    if (!authResult) {
      throw new RaffelError('UNAUTHENTICATED', 'Authentication required')
    }

    if (!authResult.authenticated) {
      throw new RaffelError('UNAUTHENTICATED', 'Invalid credentials')
    }

    // Attach auth context
    const authContext: AuthContext = {
      authenticated: true,
      principal: authResult.principal,
      claims: {
        ...authResult.claims,
        roles: authResult.roles,
      },
    }

    // Update context with auth info
    ;(ctx as any).auth = authContext

    return next()
  }
}

/**
 * Authorization middleware options
 */
export interface AuthzMiddlewareOptions {
  /** Role-based access control rules */
  rules: AuthzRule[]
  /** Default policy when no rule matches */
  defaultAllow?: boolean
}

/**
 * Authorization rule
 */
export interface AuthzRule {
  /** Procedure name pattern (supports * wildcard) */
  procedure: string
  /** Required roles (any of these) */
  roles?: string[]
  /** Custom check function */
  check?: (ctx: Context) => Promise<boolean> | boolean
}

/**
 * Get roles from auth context
 */
function getRoles(auth: AuthContext | undefined): string[] {
  if (!auth?.claims?.roles) return []
  if (Array.isArray(auth.claims.roles)) return auth.claims.roles
  return []
}

/**
 * Create authorization middleware (role-based access control)
 */
export function createAuthzMiddleware(options: AuthzMiddlewareOptions): Interceptor {
  const { rules, defaultAllow = false } = options

  function matchProcedure(pattern: string, procedure: string): boolean {
    if (pattern === '*') return true
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      return procedure.startsWith(prefix + '.')
    }
    return pattern === procedure
  }

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const auth = (ctx as any).auth as AuthContext | undefined

    // Find matching rules
    const matchingRules = rules.filter((rule) => matchProcedure(rule.procedure, envelope.procedure))

    // If no rules match, use default policy
    if (matchingRules.length === 0) {
      if (!defaultAllow) {
        throw new RaffelError('PERMISSION_DENIED', `Access denied to ${envelope.procedure}`)
      }
      return next()
    }

    // Check all matching rules
    for (const rule of matchingRules) {
      let allowed = false

      // Check roles
      if (rule.roles && rule.roles.length > 0) {
        const userRoles = getRoles(auth)
        allowed = rule.roles.some((role) => userRoles.includes(role))
      }

      // Check custom function
      if (rule.check) {
        allowed = await rule.check(ctx)
      }

      if (!allowed) {
        throw new RaffelError('PERMISSION_DENIED', `Access denied to ${envelope.procedure}`)
      }
    }

    return next()
  }
}

/**
 * Helper to require authentication on context
 */
export function requireAuth(ctx: Context): AuthContext {
  const auth = ctx.auth
  if (!auth || !auth.authenticated || !auth.principal) {
    throw new RaffelError('UNAUTHENTICATED', 'Authentication required')
  }
  return auth
}

/**
 * Helper to check if user has a specific role
 */
export function hasRole(ctx: Context, role: string): boolean {
  const auth = ctx.auth
  return getRoles(auth).includes(role)
}

/**
 * Helper to check if user has any of the specified roles
 */
export function hasAnyRole(ctx: Context, roles: string[]): boolean {
  const auth = ctx.auth
  const userRoles = getRoles(auth)
  return roles.some((role) => userRoles.includes(role))
}

/**
 * Helper to check if user has all of the specified roles
 */
export function hasAllRoles(ctx: Context, roles: string[]): boolean {
  const auth = ctx.auth
  const userRoles = getRoles(auth)
  return roles.every((role) => userRoles.includes(role))
}

// ============================================================================
// OAuth2/OIDC STRATEGIES
// ============================================================================

export {
  // OAuth2 Strategy
  createOAuth2Strategy,
  // OIDC Strategy
  createOIDCStrategy,
  // Provider presets
  OAuth2Providers,
  // Provider shortcut functions
  createGoogleOAuth2Strategy,
  createGitHubOAuth2Strategy,
  createMicrosoftOAuth2Strategy,
  createAppleOAuth2Strategy,
  createFacebookOAuth2Strategy,
  // Utilities
  generateState,
  generateNonce,
  // Discovery cache
  clearDiscoveryCache,
} from './auth/oauth2.js'

export type {
  // OAuth2 types
  OAuth2Config,
  OAuth2Tokens,
  OAuth2UserInfo,
  OAuth2StrategyWithFlow,
  // OIDC types
  OIDCConfig,
  OIDCDiscoveryDocument,
  OIDCStrategyWithFlow,
  // Provider types
  OAuth2Provider,
} from './auth/oauth2.js'
