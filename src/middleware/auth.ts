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
