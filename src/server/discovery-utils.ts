/**
 * Discovery Utilities for Server
 *
 * Helper functions for file-system route discovery and hook resolution.
 */

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
import type { RouteCacheConfig } from '../cache/server-runtime.js'
import { policyMetadataFromRouteMeta } from './builder/metadata.js'

const logger = createLogger('server')

export interface DiscoveryRegistrationPolicyHook {
  bootstrap: PolicyBootstrap
}

export interface CoLocatedPolicyAutoScope {
  route?: string
  channel?: string
  protocol?: string
}

/**
 * Register co-located policies in the global engine. Policy IDs are
 * namespaced by source file/index after local cascade overrides are resolved,
 * so `id: read` in two unrelated directories cannot replace each other.
 *
 * (1.1.60+ fix) The previous implementation materialised one policy
 * per `(source, index, route)` triple and called
 * `engine.addPolicies()` per route. With N routes under the same
 * cascade `_policy.yaml` this produced N copies in the engine, each
 * with `scope.routes = [singleRoute]`. The engine's `addPolicies`
 * dedupes by id and replaces in place, so only the LAST route's scope
 * survived. The fix is to record `(source, index) → routes` in the
 * per-bootstrap accumulator and flush ONE policy per (source, index)
 * with `scope.routes` set to the union — see
 * `co-located-accumulator.ts`.
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
  // A custom engine without `addPolicies` cannot accept co-located
  // policies. Match the old behaviour: warn once and return false so
  // the caller skips synthesising an interceptor that would gate the
  // route against a policy the engine never received.
  if (typeof policyHook.bootstrap.engine.addPolicies !== 'function') {
    logger.warn(
      { name, filePath: diagnosticsFilePath },
      'Co-located policies present but engine driver does not support addPolicies(); skipping bridge',
    )
    return false
  }
  // `policies` is this route's full cascade chain in broader→closer
  // order. Resolve "nearest-wins" per route HERE: collapse by the
  // author-facing id keeping the closest (last) declaration. This is
  // the per-route resolution the old `materializeCoLocatedPolicies`
  // used to do; doing it before the accumulator means two unrelated
  // sibling files that happen to share an `id` (e.g. `users.policy.yaml`
  // and `projects.policy.yaml` both declaring `id: read`) stay
  // separate — they never appear in the same route's chain, so they
  // never collapse into each other.
  const byOriginalId = new Map<string, Policy>()
  for (const policy of policies) {
    byOriginalId.set(policy.id, policy)
  }

  // Feed the per-bootstrap accumulator instead of pushing to the
  // engine directly. The actual `engine.addPolicies()` call happens
  // once per load in `applyDiscoveryResult`'s flush step. Procedure
  // routes (HTTP) get `applyRouteScope: true` — the accumulator
  // fills `scope.routes` with the route name so the engine scopes
  // the policy per route. Protocol-bound surfaces (GraphQL, channels)
  // pass `false` so the accumulator doesn't add a route filter (the
  // engine action there is independent of the route name).
  const isRouteScoped = autoScope?.protocol === undefined
  for (const policy of byOriginalId.values()) {
    policyHook.bootstrap.coLocatedAccumulator.add(
      policy,
      name,
      policy.condition,
      isRouteScoped,
    )
  }
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
  // Routes declared as public (`meta.auth: 'none'`) must not have their
  // co-located policy enforced: an anonymous K8s probe (or any unauthenticated
  // request) would otherwise flow into the policy interceptor with no
  // principal context. Forwarding `public: true` here matches the author's
  // explicit intent — they opted the route out of authentication, so the
  // policy engine treats it as public too. Authors that still want policy
  // enforcement on an auth-free route can call `.authz({ public: false })`
  // explicitly via the builder API to override.
  const policyConfig: ProcedurePolicyConfig | undefined =
    route.meta?.auth === 'none' ? { public: true } : undefined

  return buildCoLocatedAuthzInterceptorsForName(
    route.name,
    route.coLocatedPolicies,
    policyHook,
    route.filePath,
    policyConfig,
  )
}

/**
 * Register discovered handlers from file-system
 *
 * On a hot reload (`previouslyDiscovered` is provided) the function first
 * drops every name that was registered by the previous load and is no
 * longer present in the new result, then re-registers everything that
 * remains. Programmatic registrations (builder API) are tracked by the
 * caller via `previouslyDiscovered` and are therefore never removed.
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
  previouslyDiscovered?: ReadonlySet<string>,
  cacheInterceptorFor?: (
    routeName: string,
    config: RouteCacheConfig | false | undefined,
  ) => Interceptor | undefined,
): { discoveredNames: Set<string> } {
  const newNames = new Set<string>()

  // Hot-reload cleanup: drop routes that were registered by the previous
  // discovery load but no longer appear in this result. Names that exist
  // in the registry but were NOT tracked as discovery-registered
  // (programmatic registrations) are preserved by definition — they
  // were not in `previouslyDiscovered`.
  if (previouslyDiscovered) {
    const incomingNames = new Set(result.routes.map((r) => r.name))
    for (const name of previouslyDiscovered) {
      if (incomingNames.has(name)) continue
      if (registry.remove(name)) {
        logger.debug({ name }, 'Removed stale discovered route on hot reload')
      }
    }
  }

  for (const route of result.routes) {
    // On hot reload, drop a route that was previously discovery-registered
    // before the explicit-wins check below. Otherwise the route stays in
    // the registry across reloads and the new handler is silently ignored.
    if (previouslyDiscovered?.has(route.name)) {
      registry.remove(route.name)
    }

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

    newNames.add(route.name)

    // Create interceptors from route config
    const routeInterceptors = createRouteInterceptors(route)
    const authzInterceptors = buildCoLocatedAuthzInterceptors(route, policyHook)
    const cacheInterceptor = route.kind === 'procedure'
      ? cacheInterceptorFor?.(route.name, route.meta?.cache)
      : undefined
    const interceptors = [
      ...globalInterceptors,
      ...routeInterceptors,
      ...authzInterceptors,
      ...(cacheInterceptor ? [cacheInterceptor] : []),
    ]

    // Register schema if defined
    if (route.inputSchema || route.outputSchema || route.inferredOutputSchema) {
      const schema: HandlerSchema = {}
      if (route.inputSchema) schema.input = route.inputSchema
      if (route.outputSchema) schema.output = route.outputSchema
      if (!route.outputSchema && route.inferredOutputSchema) {
        schema.documentationOutput = route.inferredOutputSchema
      }
      schemaRegistry.register(route.name, schema)
    }

    // Register based on kind
    if (route.kind === 'procedure') {
      const handler = route.meta?.httpPath
        ? createHttpAwareProcedureHandler(route.handler as ProcedureHandler)
        : route.handler as ProcedureHandler
      registry.procedure(route.name, handler, {
        summary: route.meta?.summary,
        description: route.meta?.description,
        tags: route.meta?.tags,
        graphql: route.meta?.graphql,
        httpPath: route.meta?.httpPath,
        httpMethod: route.meta?.httpMethod,
        httpSuccessStatus: route.meta?.httpSuccessStatus,
        jsonrpc: route.meta?.jsonrpc,
        grpc: route.meta?.grpc,
        policies: policyMetadataFromRouteMeta(route.meta),
        auth: route.meta?.auth,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      onRegistered?.({ name: route.name, kind: 'procedure', filePath: route.filePath })
    } else if (route.kind === 'stream') {
      registry.stream(route.name, route.handler as StreamHandler, {
        description: route.meta?.description,
        direction: route.meta?.direction,
        tags: route.meta?.tags,
        contentType: route.meta?.contentType,
        contentTypes: route.meta?.contentTypes,
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

  return { discoveredNames: newNames }
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
