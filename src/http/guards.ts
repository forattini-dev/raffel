/**
 * Guards System
 *
 * Route guards for authorization and access control.
 * Guards are functions that check if a request should be allowed to proceed.
 *
 * @example
 * import { createGuardsRegistry, requireUser, requireRole, requireScope } from 'raffel/http'
 *
 * // Create guards registry
 * const guards = createGuardsRegistry()
 *
 * // Register custom guards
 * guards.register('isAdmin', (c) => c.get('user')?.role === 'admin')
 * guards.register('isOwner', (c) => c.get('user')?.id === c.req.param('id'))
 *
 * // Use built-in guard helpers
 * app.get('/admin', requireRole('admin'), adminHandler)
 * app.get('/profile', requireUser(), profileHandler)
 * app.get('/api/data', requireScope('read:data'), dataHandler)
 *
 * // Combine guards (all must pass)
 * app.delete('/users/:id', requireRole('admin'), guards.get('isOwner'), deleteHandler)
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import { HttpUnauthorizedError, HttpForbiddenError } from './errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guard function type
 * Returns true if access is allowed, false or throws to deny
 */
export type GuardFn<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>
) => boolean | Promise<boolean>

/**
 * Guard result with optional error message
 */
export interface GuardResult {
  allowed: boolean
  message?: string
}

/**
 * Extended guard function that returns detailed result
 */
export type ExtendedGuardFn<E extends Record<string, unknown> = Record<string, unknown>> = (
  c: HttpContextInterface<E>
) => boolean | GuardResult | Promise<boolean | GuardResult>

/**
 * User object interface (minimal expected shape)
 */
export interface GuardUser {
  id?: string | number
  role?: string
  roles?: string[]
  scope?: string
  scopes?: string[]
  permissions?: string[]
  [key: string]: unknown
}

/**
 * Guard options for built-in guards
 */
export interface GuardOptions {
  /**
   * Custom error message when guard fails
   */
  message?: string

  /**
   * HTTP status code when guard fails (default: 403)
   */
  status?: 401 | 403

  /**
   * Key in context where user object is stored
   * @default 'user'
   */
  userKey?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guards registry for named guard functions
 */
export interface GuardsRegistry<E extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Register a named guard
   */
  register(name: string, guard: ExtendedGuardFn<E>): void

  /**
   * Get a guard as middleware by name
   */
  get(name: string): HttpMiddleware<E>

  /**
   * Check if a guard exists
   */
  has(name: string): boolean

  /**
   * Get all registered guard names
   */
  names(): string[]

  /**
   * Create a composite guard (all must pass)
   */
  all(...names: string[]): HttpMiddleware<E>

  /**
   * Create a composite guard (any must pass)
   */
  any(...names: string[]): HttpMiddleware<E>
}

/**
 * Create a guards registry
 *
 * @example
 * const guards = createGuardsRegistry()
 *
 * guards.register('isAdmin', (c) => c.get('user')?.role === 'admin')
 * guards.register('isVerified', (c) => c.get('user')?.verified === true)
 *
 * app.get('/admin', guards.get('isAdmin'), adminHandler)
 * app.get('/dashboard', guards.all('isAdmin', 'isVerified'), dashHandler)
 */
export function createGuardsRegistry<
  E extends Record<string, unknown> = Record<string, unknown>
>(): GuardsRegistry<E> {
  const guards = new Map<string, ExtendedGuardFn<E>>()

  return {
    register(name: string, guard: ExtendedGuardFn<E>) {
      guards.set(name, guard)
    },

    get(name: string): HttpMiddleware<E> {
      const guard = guards.get(name)
      if (!guard) {
        throw new Error(`Guard not found: ${name}`)
      }
      return createGuardMiddleware(guard, { message: `Guard '${name}' denied access` })
    },

    has(name: string): boolean {
      return guards.has(name)
    },

    names(): string[] {
      return Array.from(guards.keys())
    },

    all(...names: string[]): HttpMiddleware<E> {
      const guardFns = names.map((name) => {
        const guard = guards.get(name)
        if (!guard) throw new Error(`Guard not found: ${name}`)
        return guard
      })

      return async (c, next) => {
        for (const guard of guardFns) {
          const result = await guard(c)
          const allowed = typeof result === 'boolean' ? result : result.allowed
          if (!allowed) {
            const message = typeof result === 'object' ? result.message : undefined
            throw new HttpForbiddenError(message || 'Access denied')
          }
        }
        await next()
      }
    },

    any(...names: string[]): HttpMiddleware<E> {
      const guardFns = names.map((name) => {
        const guard = guards.get(name)
        if (!guard) throw new Error(`Guard not found: ${name}`)
        return guard
      })

      return async (c, next) => {
        for (const guard of guardFns) {
          try {
            const result = await guard(c)
            const allowed = typeof result === 'boolean' ? result : result.allowed
            if (allowed) {
              await next()
              return
            }
          } catch {
            // Guard threw, try next one
          }
        }
        throw new HttpForbiddenError('Access denied')
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guard Middleware Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a middleware from a guard function
 */
function createGuardMiddleware<E extends Record<string, unknown>>(
  guard: ExtendedGuardFn<E>,
  options: GuardOptions = {}
): HttpMiddleware<E> {
  const { message = 'Access denied', status = 403, userKey: _userKey = 'user' } = options

  return async (c, next) => {
    try {
      const result = await guard(c)
      const allowed = typeof result === 'boolean' ? result : result.allowed
      const errorMessage = typeof result === 'object' && result.message ? result.message : message

      if (!allowed) {
        if (status === 401) {
          throw new HttpUnauthorizedError(errorMessage)
        }
        throw new HttpForbiddenError(errorMessage)
      }

      await next()
    } catch (err) {
      if (err instanceof HttpUnauthorizedError || err instanceof HttpForbiddenError) {
        throw err
      }
      // Guard threw an unexpected error
      throw new HttpForbiddenError(message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Require an authenticated user
 *
 * Checks if a user object exists in context.
 *
 * @param options - Guard options
 * @returns Middleware function
 *
 * @example
 * app.get('/profile', requireUser(), getProfile)
 * app.get('/settings', requireUser({ userKey: 'currentUser' }), getSettings)
 */
export function requireUser<E extends Record<string, unknown> = Record<string, unknown>>(
  options: GuardOptions = {}
): HttpMiddleware<E> {
  const { message = 'Authentication required', status: _status = 401, userKey = 'user' } = options

  return async (c, next) => {
    const user = c.get(userKey as keyof E)
    if (!user) {
      throw new HttpUnauthorizedError(message)
    }
    await next()
  }
}

/**
 * Require a specific role
 *
 * Checks if the user has the specified role.
 *
 * @param role - Required role (or array of roles, any match)
 * @param options - Guard options
 * @returns Middleware function
 *
 * @example
 * app.get('/admin', requireRole('admin'), adminDashboard)
 * app.get('/moderate', requireRole(['admin', 'moderator']), moderateContent)
 */
export function requireRole<E extends Record<string, unknown> = Record<string, unknown>>(
  role: string | string[],
  options: GuardOptions = {}
): HttpMiddleware<E> {
  const roles = Array.isArray(role) ? role : [role]
  const { message, status: _status = 403, userKey = 'user' } = options
  const defaultMessage = `Required role: ${roles.join(' or ')}`

  return async (c, next) => {
    const user = c.get(userKey as keyof E) as GuardUser | undefined

    if (!user) {
      throw new HttpUnauthorizedError('Authentication required')
    }

    // Check user.role (single role)
    if (user.role && roles.includes(user.role)) {
      await next()
      return
    }

    // Check user.roles (array of roles)
    if (user.roles && user.roles.some((r) => roles.includes(r))) {
      await next()
      return
    }

    throw new HttpForbiddenError(message || defaultMessage)
  }
}

/**
 * Require a specific scope/permission
 *
 * Checks if the user has the specified scope.
 *
 * @param scope - Required scope (or array of scopes, any match)
 * @param options - Guard options
 * @returns Middleware function
 *
 * @example
 * app.get('/api/users', requireScope('read:users'), listUsers)
 * app.post('/api/users', requireScope('write:users'), createUser)
 * app.delete('/api/users/:id', requireScope(['admin', 'delete:users']), deleteUser)
 */
export function requireScope<E extends Record<string, unknown> = Record<string, unknown>>(
  scope: string | string[],
  options: GuardOptions = {}
): HttpMiddleware<E> {
  const scopes = Array.isArray(scope) ? scope : [scope]
  const { message, status: _status = 403, userKey = 'user' } = options
  const defaultMessage = `Required scope: ${scopes.join(' or ')}`

  return async (c, next) => {
    const user = c.get(userKey as keyof E) as GuardUser | undefined

    if (!user) {
      throw new HttpUnauthorizedError('Authentication required')
    }

    // Check user.scope (single scope string, space-separated)
    if (user.scope) {
      const userScopes = user.scope.split(' ')
      if (scopes.some((s) => userScopes.includes(s))) {
        await next()
        return
      }
    }

    // Check user.scopes (array of scopes)
    if (user.scopes && user.scopes.some((s) => scopes.includes(s))) {
      await next()
      return
    }

    // Check user.permissions (alternative name)
    if (user.permissions && user.permissions.some((p) => scopes.includes(p))) {
      await next()
      return
    }

    throw new HttpForbiddenError(message || defaultMessage)
  }
}

/**
 * Require a specific permission (alias for requireScope)
 */
export const requirePermission = requireScope

/**
 * Create a custom guard middleware
 *
 * @param guardFn - Guard function
 * @param options - Guard options
 * @returns Middleware function
 *
 * @example
 * const isOwner = guard(
 *   (c) => c.get('user')?.id === c.req.param('id'),
 *   { message: 'You can only access your own resources' }
 * )
 *
 * app.get('/users/:id/private', isOwner, getPrivateData)
 */
export function guard<E extends Record<string, unknown> = Record<string, unknown>>(
  guardFn: ExtendedGuardFn<E>,
  options: GuardOptions = {}
): HttpMiddleware<E> {
  return createGuardMiddleware(guardFn, options)
}

/**
 * Combine multiple guards (all must pass)
 *
 * @param guards - Guard middlewares to combine
 * @returns Combined middleware
 *
 * @example
 * const adminOwner = allGuards(requireRole('admin'), isOwnerGuard)
 * app.delete('/posts/:id', adminOwner, deletePost)
 */
export function allGuards<E extends Record<string, unknown> = Record<string, unknown>>(
  ...guards: HttpMiddleware<E>[]
): HttpMiddleware<E> {
  return async (c, next) => {
    for (const g of guards) {
      await new Promise<void>((resolve, reject) => {
        const result = g(c, async () => resolve())
        if (result instanceof Promise) {
          result.catch(reject)
        }
      })
    }
    await next()
  }
}

/**
 * Combine multiple guards (any must pass)
 *
 * @param guards - Guard middlewares to combine
 * @returns Combined middleware
 *
 * @example
 * const adminOrMod = anyGuard(requireRole('admin'), requireRole('moderator'))
 * app.post('/moderate', adminOrMod, moderateContent)
 */
export function anyGuard<E extends Record<string, unknown> = Record<string, unknown>>(
  ...guards: HttpMiddleware<E>[]
): HttpMiddleware<E> {
  return async (c, next) => {
    const errors: Error[] = []

    for (const g of guards) {
      try {
        await new Promise<void>((resolve, reject) => {
          const result = g(c, async () => resolve())
          if (result instanceof Promise) {
            result.catch(reject)
          }
        })
        // Guard passed, continue to handler
        await next()
        return
      } catch (err) {
        errors.push(err as Error)
      }
    }

    // All guards failed
    throw errors[0] || new HttpForbiddenError('Access denied')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createGuardsRegistry,
  requireUser,
  requireRole,
  requireScope,
  requirePermission,
  guard,
  allGuards,
  anyGuard,
}
