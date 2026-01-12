/**
 * Middleware Processor
 *
 * Converts file-system middleware and auth configs into Raffel interceptors.
 */

import type { Interceptor, Context, Envelope } from '../../types/index.js'
import { Errors } from '../../errors/index.js'
import { createLogger } from '../../utils/logger.js'
import type {
  LoadedRoute,
  MiddlewareFunction,
  AuthConfig,
  HandlerMeta,
} from './types.js'

const logger = createLogger('fs-middleware')

/**
 * Create interceptors for a loaded route
 */
export function createRouteInterceptors(route: LoadedRoute): Interceptor[] {
  const interceptors: Interceptor[] = []

  // 1. Add auth interceptor if needed
  if (route.meta?.auth && route.meta.auth !== 'none') {
    interceptors.push(createAuthInterceptor(route.meta, route.authConfig))
  }

  // 2. Add role check interceptor if needed
  if (route.meta?.roles && route.meta.roles.length > 0) {
    interceptors.push(createRoleInterceptor(route.meta.roles))
  }

  // 3. Add rate limit interceptor if configured
  if (route.meta?.rateLimit) {
    interceptors.push(createRateLimitInterceptor(route.meta.rateLimit))
  }

  // 4. Add middleware chain (converted to interceptors)
  for (const middleware of route.middlewares) {
    interceptors.push(middlewareToInterceptor(middleware))
  }

  // 5. Add custom interceptors from meta
  if (route.meta?.interceptors) {
    interceptors.push(...route.meta.interceptors)
  }

  return interceptors
}

/**
 * Convert a middleware function to an interceptor
 */
function middlewareToInterceptor(middleware: MiddlewareFunction): Interceptor {
  return async (envelope, ctx, next) => {
    // Create a next function that calls the interceptor chain
    const nextFn = async () => {
      const result = await next()
      return result
    }

    // Call middleware
    const result = await middleware(ctx, nextFn)

    // If middleware returned something, use it as the response
    if (result !== undefined) {
      return {
        ...envelope,
        type: 'response',
        payload: result,
      }
    }

    // Otherwise, the result was already handled by next()
    return next()
  }
}

/**
 * Create auth interceptor
 */
function createAuthInterceptor(meta: HandlerMeta, authConfig?: AuthConfig): Interceptor {
  return async (envelope, ctx, next) => {
    const isRequired = meta.auth === 'required'

    // Check if already authenticated
    if (ctx.auth?.authenticated) {
      return next()
    }

    // Try to authenticate
    if (authConfig?.verify || authConfig?.strategy) {
      const authenticated = await tryAuthenticate(envelope, ctx, authConfig)

      if (authenticated) {
        return next()
      }
    }

    // Not authenticated
    if (isRequired) {
      throw Errors.unauthorized('Authentication required')
    }

    // Optional auth: set anonymous if configured
    if (authConfig?.anonymous) {
      ctx.auth = {
        authenticated: false,
        principal: authConfig.anonymous.principal,
        claims: {
          ...(authConfig.anonymous.claims ?? {}),
          roles: authConfig.anonymous.roles ?? [],
        },
      }
    }

    return next()
  }
}

/**
 * Try to authenticate using auth config
 */
async function tryAuthenticate(envelope: Envelope, ctx: Context, authConfig: AuthConfig): Promise<boolean> {
  // Get credential from envelope metadata (set by adapter)
  const credential = extractCredential(envelope, authConfig)

  if (!credential) {
    return false
  }

  try {
    let result

    if (typeof authConfig.strategy === 'function') {
      result = await authConfig.strategy(credential, ctx)
    } else if (authConfig.verify) {
      result = await authConfig.verify(credential, ctx)
    } else {
      return false
    }

    if (result) {
      ctx.auth = {
        authenticated: true,
        principal: result.principal,
        claims: {
          ...(result.claims ?? {}),
          roles: result.roles ?? [],
        },
      }
      return true
    }
  } catch (err) {
    logger.debug({ err }, 'Authentication failed')
  }

  return false
}

/**
 * Extract credential from envelope metadata based on strategy
 */
function extractCredential(envelope: Envelope, authConfig: AuthConfig): string | undefined {
  const strategy = authConfig.strategy
  const metadata = envelope.metadata

  if (strategy === 'bearer' || strategy === undefined) {
    // Bearer token from Authorization header
    const authHeader = metadata.authorization ?? metadata.Authorization
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }
  }

  if (strategy === 'api-key') {
    // API key from header or query
    return metadata['x-api-key'] ?? metadata.apiKey
  }

  // Custom strategy handles its own extraction
  if (typeof strategy === 'function') {
    return metadata.authorization ?? metadata.Authorization
  }

  return undefined
}

/**
 * Create role check interceptor
 */
function createRoleInterceptor(requiredRoles: string[]): Interceptor {
  return async (_envelope, ctx, next) => {
    // Roles are stored in claims.roles
    const userRoles = (ctx.auth?.claims?.roles as string[] | undefined) ?? []

    // Check if user has any of the required roles
    const hasRole = requiredRoles.some((role) => userRoles.includes(role))

    if (!hasRole) {
      throw Errors.forbidden(
        `Required roles: ${requiredRoles.join(', ')}. User has: ${userRoles.join(', ') || 'none'}`
      )
    }

    return next()
  }
}

/**
 * Create rate limit interceptor
 */
function createRateLimitInterceptor(config: { limit: number; window: number }): Interceptor {
  const { limit, window } = config
  const requests = new Map<string, { count: number; resetAt: number }>()

  return async (_envelope, ctx, next) => {
    const key = ctx.auth?.principal ?? ctx.requestId

    const now = Date.now()
    let entry = requests.get(key)

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + window }
      requests.set(key, entry)
    }

    entry.count++

    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      throw Errors.rateLimit(retryAfter)
    }

    // Cleanup old entries periodically
    if (Math.random() < 0.01) {
      for (const [k, v] of requests) {
        if (now >= v.resetAt) {
          requests.delete(k)
        }
      }
    }

    return next()
  }
}

/**
 * Create channel authorization function from loaded config
 *
 * Note: For channels, authentication is done at WebSocket connection time.
 * This authorizer checks if the socket context is authenticated.
 */
export function createChannelAuthorizer(
  authConfig?: AuthConfig,
  requirement: 'required' | 'optional' | 'none' = 'none'
): ((socketId: string, channel: string, ctx: Context) => boolean | Promise<boolean>) | undefined {
  if (!authConfig || requirement === 'none') return undefined

  return async (_socketId, _channel, ctx) => {
    // Check if already authenticated (auth should be set by WebSocket adapter)
    if (ctx.auth?.authenticated) {
      return true
    }

    if (requirement === 'optional') {
      if (authConfig.anonymous) {
        ctx.auth = {
          authenticated: false,
          principal: authConfig.anonymous.principal,
          claims: {
            ...(authConfig.anonymous.claims ?? {}),
            roles: authConfig.anonymous.roles ?? [],
          },
        }
      }
      return true
    }

    // For channels, we require auth to be set up at connection time
    // The WebSocket adapter is responsible for authentication
    return false
  }
}
