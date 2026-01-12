/**
 * Discovery Utilities for Server
 *
 * Helper functions for file-system route discovery and hook resolution.
 */

import type { Registry } from '../core/registry.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import type { GlobalHooksConfig, BeforeHook, AfterHook, ErrorHook } from './types.js'
import type { DiscoveryResult } from './fs-routes/index.js'
import { createRouteInterceptors } from './fs-routes/index.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('server')

/**
 * Register discovered handlers from file-system
 */
export function registerDiscoveredHandlers(
  result: DiscoveryResult,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  globalInterceptors: Interceptor[]
): void {
  for (const route of result.routes) {
    // Create interceptors from route config
    const routeInterceptors = createRouteInterceptors(route)
    const interceptors = [...globalInterceptors, ...routeInterceptors]

    // Register schema if defined
    if (route.inputSchema || route.outputSchema) {
      const schema: HandlerSchema = {}
      if (route.inputSchema) schema.input = route.inputSchema
      if (route.outputSchema) schema.output = route.outputSchema
      schemaRegistry.register(route.name, schema)
    }

    // Register based on kind
    if (route.kind === 'procedure') {
      registry.procedure(route.name, route.handler as ProcedureHandler, {
        description: route.meta?.description,
        graphql: route.meta?.graphql,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    } else if (route.kind === 'stream') {
      registry.stream(route.name, route.handler as StreamHandler, {
        description: route.meta?.description,
        direction: route.meta?.direction,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    } else if (route.kind === 'event') {
      registry.event(route.name, route.handler as EventHandler, {
        description: route.meta?.description,
        delivery: route.meta?.delivery,
        retryPolicy: route.meta?.retryPolicy,
        deduplicationWindow: route.meta?.deduplicationWindow,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    }

    logger.debug({ name: route.name, kind: route.kind }, 'Registered handler')
  }
}

/**
 * Check if a procedure name matches a hook pattern.
 *
 * Patterns:
 * - '*' matches everything
 * - 'users.*' matches 'users.get', 'users.create', etc.
 * - 'users.get' matches exactly 'users.get'
 */
export function matchesPattern(procedureName: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1) // 'users.*' → 'users.'
    return procedureName.startsWith(prefix)
  }
  return procedureName === pattern
}

/**
 * Resolve matching hooks for a procedure name from global hooks config
 */
export function resolveHooksForProcedure(
  procedureName: string,
  globalHooks: GlobalHooksConfig
): {
  before: BeforeHook<any>[]
  after: AfterHook<any, any>[]
  error: ErrorHook<any>[]
} {
  const before: BeforeHook<any>[] = []
  const after: AfterHook<any, any>[] = []
  const error: ErrorHook<any>[] = []

  // Collect matching before hooks
  if (globalHooks.before) {
    for (const [pattern, hooks] of Object.entries(globalHooks.before)) {
      if (matchesPattern(procedureName, pattern)) {
        if (Array.isArray(hooks)) {
          before.push(...hooks)
        } else {
          before.push(hooks)
        }
      }
    }
  }

  // Collect matching after hooks
  if (globalHooks.after) {
    for (const [pattern, hooks] of Object.entries(globalHooks.after)) {
      if (matchesPattern(procedureName, pattern)) {
        if (Array.isArray(hooks)) {
          after.push(...hooks)
        } else {
          after.push(hooks)
        }
      }
    }
  }

  // Collect matching error hooks
  if (globalHooks.error) {
    for (const [pattern, hooks] of Object.entries(globalHooks.error)) {
      if (matchesPattern(procedureName, pattern)) {
        if (Array.isArray(hooks)) {
          error.push(...hooks)
        } else {
          error.push(hooks)
        }
      }
    }
  }

  return { before, after, error }
}
