/**
 * Guards System for S3DB Adapter
 *
 * Provides flexible authorization guards supporting:
 * - Boolean (allow/deny)
 * - Scope strings with wildcards
 * - Role-based access
 * - Custom functions
 */

import type { Context } from '../../../types/index.js'

/**
 * User information expected in auth context.
 */
export interface GuardUser {
  id?: string
  role?: string
  roles?: string[]
  scopes?: string[]
  [key: string]: unknown
}

/**
 * Guard function signature.
 * Can optionally receive the record being accessed for record-level guards.
 */
export type GuardFunction = (
  ctx: Context,
  record?: Record<string, unknown> | null
) => boolean | Promise<boolean>

/**
 * Guard object with role, scopes, and/or custom check.
 */
export interface GuardObject {
  /** Required role(s). User must have at least one. */
  role?: string | string[]
  /** Required scopes. User must have ALL specified scopes. */
  scopes?: string | string[]
  /** Custom check function. */
  check?: GuardFunction
}

/**
 * Guard can be:
 * - boolean: true = allow, false = deny
 * - string: scope check (e.g., "users:read")
 * - string[]: any scope matches (OR)
 * - GuardFunction: custom function
 * - GuardObject: role + scopes + check
 * - null/undefined: no guard (allow)
 */
export type Guard = boolean | string | string[] | GuardFunction | GuardObject | null | undefined

/**
 * Guards configuration per operation.
 */
export interface GuardsConfig {
  /** Guard for list operation */
  list?: Guard
  /** Guard for get operation */
  get?: Guard
  /** Guard for count operation */
  count?: Guard
  /** Guard for create operation */
  create?: Guard
  /** Guard for update operation (PUT) */
  update?: Guard
  /** Guard for patch operation (PATCH) - falls back to update */
  patch?: Guard
  /** Guard for delete operation */
  delete?: Guard
  /** Guard for head operation */
  head?: Guard
  /** Guard for options operation */
  options?: Guard
  /** Alias for read operations (list, get, count, head) */
  read?: Guard
  /** Alias for write operations (create, update, patch, delete) */
  write?: Guard
  /** Fallback guard for all operations */
  all?: Guard
}

/**
 * S3DB operation names.
 */
export type S3DBOperation =
  | 'list'
  | 'get'
  | 'count'
  | 'create'
  | 'update'
  | 'patch'
  | 'delete'
  | 'head'
  | 'options'

/**
 * Check if a user has a specific scope, supporting wildcards.
 *
 * Wildcards:
 * - `users:*` matches `users:read`, `users:write`, etc.
 * - `*` matches everything
 *
 * @example
 * ```ts
 * hasScope({ scopes: ['users:*'] }, 'users:read')  // true
 * hasScope({ scopes: ['admin'] }, 'users:read')   // false
 * hasScope({ scopes: ['*'] }, 'anything')         // true
 * ```
 */
export function hasScope(user: GuardUser | null | undefined, scope: string): boolean {
  if (!user?.scopes || !Array.isArray(user.scopes)) {
    return false
  }

  // Direct match
  if (user.scopes.includes(scope)) {
    return true
  }

  // Check wildcards
  for (const userScope of user.scopes) {
    // Global wildcard
    if (userScope === '*') {
      return true
    }

    // Prefix wildcard (e.g., "users:*" matches "users:read")
    if (userScope.endsWith(':*')) {
      const prefix = userScope.slice(0, -2)
      if (scope.startsWith(prefix + ':') || scope === prefix) {
        return true
      }
    }
  }

  return false
}

/**
 * Check if a user has a specific role.
 *
 * Checks both `role` (string) and `roles` (array) properties.
 */
export function hasRole(user: GuardUser | null | undefined, role: string): boolean {
  if (!user) return false

  // Check single role property
  if (user.role === role) return true

  // Check roles array
  if (Array.isArray(user.roles) && user.roles.includes(role)) return true

  return false
}

/**
 * Check if a user has any of the specified roles.
 */
export function hasAnyRole(user: GuardUser | null | undefined, roles: string[]): boolean {
  return roles.some((role) => hasRole(user, role))
}

/**
 * Check a guard against the context and optional record.
 *
 * @returns true if allowed, false if denied
 */
export async function checkGuard(
  guard: Guard,
  ctx: Context,
  record?: Record<string, unknown> | null
): Promise<boolean> {
  // No guard = allow
  if (guard === null || guard === undefined) {
    return true
  }

  // Boolean guard
  if (typeof guard === 'boolean') {
    return guard
  }

  // Get user from auth context (auth can be any shape, we just need scopes/roles)
  const user = ctx.auth as unknown as GuardUser | null

  // String = scope check
  if (typeof guard === 'string') {
    return hasScope(user, guard)
  }

  // Array = any scope matches (OR)
  if (Array.isArray(guard)) {
    return guard.some((scope) => hasScope(user, scope))
  }

  // Function = custom check
  if (typeof guard === 'function') {
    const result = guard(ctx, record)
    return result instanceof Promise ? await result : result
  }

  // Object = role + scopes + check
  if (typeof guard === 'object') {
    const guardObj = guard as GuardObject

    // Check role requirement
    if (guardObj.role) {
      const requiredRoles = Array.isArray(guardObj.role) ? guardObj.role : [guardObj.role]
      if (!hasAnyRole(user, requiredRoles)) {
        return false
      }
    }

    // Check scopes requirement (ALL must match)
    if (guardObj.scopes) {
      const requiredScopes = Array.isArray(guardObj.scopes) ? guardObj.scopes : [guardObj.scopes]
      if (!requiredScopes.every((scope) => hasScope(user, scope))) {
        return false
      }
    }

    // Check custom function
    if (guardObj.check && typeof guardObj.check === 'function') {
      const result = guardObj.check(ctx, record)
      return result instanceof Promise ? await result : result
    }

    // All checks passed
    return true
  }

  // Unknown type = deny
  return false
}

/**
 * Operation aliases for guard resolution.
 */
const OPERATION_ALIASES: Record<string, string> = {
  list: 'read',
  get: 'read',
  count: 'read',
  head: 'read',
  create: 'write',
  update: 'write',
  patch: 'write',
  delete: 'write',
}

/**
 * Get the guard for a specific operation, with fallback resolution.
 *
 * Resolution order:
 * 1. Exact operation match (e.g., `guards.list`)
 * 2. Alias match (e.g., `guards.read` for list/get)
 * 3. All fallback (e.g., `guards.all`)
 * 4. No guard (allow)
 */
export function getOperationGuard(guards: GuardsConfig | null | undefined, operation: S3DBOperation): Guard {
  if (!guards) {
    return null
  }

  // 1. Exact match
  if (guards[operation] !== undefined) {
    return guards[operation]
  }

  // 2. Alias match
  const alias = OPERATION_ALIASES[operation]
  if (alias && guards[alias as keyof GuardsConfig] !== undefined) {
    return guards[alias as keyof GuardsConfig]
  }

  // 3. All fallback
  if (guards.all !== undefined) {
    return guards.all
  }

  // 4. No guard
  return null
}
