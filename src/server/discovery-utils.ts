/**
 * Discovery Utilities for Server
 *
 * Helper functions for file-system route discovery and hook resolution.
 */

import { createHash } from 'node:crypto'
import type { Registry } from '../core/registry.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import type { GlobalHooksConfig, BeforeHook, AfterHook, ErrorHook } from './types.js'
import type { DiscoveryResult, LoadedRoute } from './fs-routes/index.js'
import { createRouteInterceptors } from './fs-routes/index.js'
import { createHttpAwareProcedureHandler } from './http-lifecycle/index.js'
import { createLogger } from '../utils/logger.js'
import type { PolicyBootstrap } from '../middleware/policy/bootstrap.js'
import type { Policy, ProcedurePolicyConfig } from '../middleware/policy/types.js'

const logger = createLogger('server')

export interface DiscoveryRegistrationPolicyHook {
  bootstrap: PolicyBootstrap
}

export interface CoLocatedPolicyAutoScope {
  route?: string
  channel?: string
  protocol?: string
}

function policySourceKey(policy: Policy, automaticScopeKey: string): string {
  const source = policy._source ?? 'inline'
  const index = policy._index ?? 0
  return createHash('sha1').update(`${source}:${index}:${automaticScopeKey}`).digest('hex').slice(0, 12)
}

function applyAutomaticScope(
  policy: Policy,
  autoScope: CoLocatedPolicyAutoScope | undefined,
): { scope: Policy['scope']; key: string } {
  let scope = policy.scope ? { ...policy.scope } : undefined
  const keyParts: string[] = []

  if (autoScope?.route && !policy.scope?.routes?.length) {
    scope ??= {}
    scope.routes = [autoScope.route]
    keyParts.push(`route:${autoScope.route}`)
  }
  if (autoScope?.channel && !policy.scope?.channels?.length) {
    scope ??= {}
    scope.channels = [autoScope.channel]
    keyParts.push(`channel:${autoScope.channel}`)
  }
  if (autoScope?.protocol && !policy.scope?.protocols?.length) {
    scope ??= {}
    scope.protocols = [autoScope.protocol]
    keyParts.push(`protocol:${autoScope.protocol}`)
  }

  return {
    scope,
    key: keyParts.join('|'),
  }
}

function materializeCoLocatedPolicies(
  policies: readonly Policy[],
  autoScope?: CoLocatedPolicyAutoScope,
): Policy[] {
  const byOriginalId = new Map<string, Policy>()
  for (const policy of policies) {
    // Policies are resolved broader -> closer -> sibling. Collapsing by the
    // author-facing id here preserves the local "nearer wins" rule before
    // namespacing prevents unrelated files from colliding globally.
    byOriginalId.set(policy.id, policy)
  }

  return [...byOriginalId.values()].map((policy) => {
    const {
      _compiled: _dropCompiled,
      _compiledMatch: _dropCompiledMatch,
      ...rest
    } = policy
    const { scope, key } = applyAutomaticScope(policy, autoScope)
    return {
      ...rest,
      ...(scope ? { scope } : {}),
      id: `co:${policySourceKey(policy, key)}:${policy.id}`,
    }
  })
}

/**
 * Register co-located policies in the global engine. Policy IDs are
 * namespaced by source file/index after local cascade overrides are resolved,
 * so `id: read` in two unrelated directories cannot replace each other.
 */
export function addCoLocatedPoliciesToEngine(
  name: string,
  policies: readonly Policy[] | undefined,
  policyHook: DiscoveryRegistrationPolicyHook | undefined,
  diagnosticsFilePath?: string,
  autoScope?: CoLocatedPolicyAutoScope,
): boolean {
  if (!policyHook) return false
  if (!policies || policies.length === 0) return false
  const engine = policyHook.bootstrap.engine
  if (typeof engine.addPolicies !== 'function') {
    logger.warn(
      { name, filePath: diagnosticsFilePath },
      'Co-located policies present but engine driver does not support addPolicies(); skipping bridge',
    )
    return false
  }
  engine.addPolicies(materializeCoLocatedPolicies(policies, autoScope))
  return true
}

/**
 * Synthesise authz interceptors for a named operation given a set of
 * co-located policies. Reused by both procedure-style discovery and
 * REST/resource registration paths.
 */
export function buildCoLocatedAuthzInterceptorsForName(
  name: string,
  policies: readonly Policy[] | undefined,
  policyHook: DiscoveryRegistrationPolicyHook | undefined,
  diagnosticsFilePath?: string,
  policyConfig?: ProcedurePolicyConfig,
): Interceptor[] {
  if (!addCoLocatedPoliciesToEngine(name, policies, policyHook, diagnosticsFilePath, { route: name })) return []
  return [policyHook!.bootstrap.interceptorFactory(name, { action: name, ...policyConfig })]
}

function buildCoLocatedAuthzInterceptors(
  route: LoadedRoute,
  policyHook: DiscoveryRegistrationPolicyHook | undefined,
): Interceptor[] {
  return buildCoLocatedAuthzInterceptorsForName(
    route.name,
    route.coLocatedPolicies,
    policyHook,
    route.filePath,
  )
}

/**
 * Register discovered handlers from file-system
 */
export function registerDiscoveredHandlers(
  result: DiscoveryResult,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  globalInterceptors: Interceptor[],
  onRegistered?: (entry: {
    name: string
    kind: 'procedure' | 'stream' | 'event'
    filePath: string
  }) => void,
  policyHook?: DiscoveryRegistrationPolicyHook,
): void {
  for (const route of result.routes) {
    // Skip handlers already registered programmatically — explicit builder
    // calls (`server.procedure('x').authz(...)`) take precedence over any
    // co-located policy from discovery (issue #92 AC: explicit-wins).
    if (registry.has(route.name)) {
      logger.debug(
        { name: route.name, filePath: route.filePath },
        'Skipping discovered handler — name already registered programmatically',
      )
      continue
    }

    // Create interceptors from route config
    const routeInterceptors = createRouteInterceptors(route)
    const authzInterceptors = buildCoLocatedAuthzInterceptors(route, policyHook)
    const interceptors = [...globalInterceptors, ...routeInterceptors, ...authzInterceptors]

    // Register schema if defined
    if (route.inputSchema || route.outputSchema) {
      const schema: HandlerSchema = {}
      if (route.inputSchema) schema.input = route.inputSchema
      if (route.outputSchema) schema.output = route.outputSchema
      schemaRegistry.register(route.name, schema)
    }

    // Register based on kind
    if (route.kind === 'procedure') {
      const handler = route.meta?.httpPath
        ? createHttpAwareProcedureHandler(route.handler as ProcedureHandler)
        : route.handler as ProcedureHandler
      registry.procedure(route.name, handler, {
        description: route.meta?.description,
        graphql: route.meta?.graphql,
        httpPath: route.meta?.httpPath,
        httpMethod: route.meta?.httpMethod,
        httpSuccessStatus: route.meta?.httpSuccessStatus,
        jsonrpc: route.meta?.jsonrpc,
        grpc: route.meta?.grpc,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      onRegistered?.({ name: route.name, kind: 'procedure', filePath: route.filePath })
    } else if (route.kind === 'stream') {
      registry.stream(route.name, route.handler as StreamHandler, {
        description: route.meta?.description,
        direction: route.meta?.direction,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      onRegistered?.({ name: route.name, kind: 'stream', filePath: route.filePath })
    } else if (route.kind === 'event') {
      registry.event(route.name, route.handler as EventHandler, {
        description: route.meta?.description,
        delivery: route.meta?.delivery,
        retryPolicy: route.meta?.retryPolicy,
        deduplicationWindow: route.meta?.deduplicationWindow,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      onRegistered?.({ name: route.name, kind: 'event', filePath: route.filePath })
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
 * Collect every hook (or hook list) registered against a pattern that
 * matches the given procedure name.
 */
function collectMatchingHooks<H>(
  procedureName: string,
  patternMap: Record<string, H | H[]> | undefined,
): H[] {
  if (!patternMap) return []
  const matched: H[] = []
  for (const [pattern, hooks] of Object.entries(patternMap)) {
    if (!matchesPattern(procedureName, pattern)) continue
    if (Array.isArray(hooks)) {
      matched.push(...hooks)
    } else {
      matched.push(hooks)
    }
  }
  return matched
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
  return {
    before: collectMatchingHooks<BeforeHook<any>>(procedureName, globalHooks.before),
    after: collectMatchingHooks<AfterHook<any, any>>(procedureName, globalHooks.after),
    error: collectMatchingHooks<ErrorHook<any>>(procedureName, globalHooks.error),
  }
}
