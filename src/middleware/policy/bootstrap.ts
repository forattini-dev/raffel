/**
 * Policy Bootstrap
 *
 * One-call wiring for the authorization layer. Replaces the four-step
 * ritual (loadPoliciesFromDir → mergePolicies → createDefaultEngine →
 * createPolicyInterceptor) that was previously inlined in
 * `server/builder.ts`.
 *
 * Slice 10 of the architecture-deepening initiative (PRD #6 / issue #13).
 */

import type { LoggerPort } from '../../ports/outbound/logger.js'
import type { Context, Interceptor } from '../../types/index.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import { createDefaultEngine } from './engine/index.js'
import { createPolicyInterceptor, createNoPolicyDeclaredInterceptor } from './interceptor.js'
import { loadPoliciesFromDir, mergePolicies } from './loader.js'
import { createPrincipalResolver } from './principal/index.js'
import {
  createCoLocatedAccumulator,
  type CoLocatedAccumulator,
} from './co-located-accumulator.js'
import { setPolicyProvider } from '../../mcp/resources/index.js'
import type { PolicyConfig, Principal, ProcedurePolicyConfig, Policy } from './types.js'

export interface PolicyCoverageEntry {
  /** Operation/channel name as registered in the registry. */
  name: string
  /** Source kind for diagnostics (e.g. 'procedure', 'channel', 'rest-resource'). */
  kind: string
  /** Optional file path or other origin marker for the entry. */
  location?: string
}

export interface PolicyCoverageReport {
  defaultMode: 'allow' | 'deny'
  /** Total operations/channels considered. */
  total: number
  /** Names with at least one policy interceptor attached. */
  covered: number
  /** Names explicitly marked `public: true` via builder authz. */
  public: number
  /** Names with neither a policy nor a public marker. Empty when fully covered. */
  gaps: PolicyCoverageEntry[]
}

export interface PolicyBootstrap {
  /** The resolved engine (user-supplied or createDefaultEngine). */
  engine: PolicyEnginePort
  /** Default decision when a procedure has no policy declared. */
  defaultMode: 'allow' | 'deny'
  /** Build a policy interceptor for a specific procedure declaration. */
  interceptorFactory: (procedureName: string, config: ProcedurePolicyConfig) => Interceptor
  /** Build the "no policy declared" interceptor for a procedure. */
  noPolicyDeclaredFactory: (procedureName: string) => Interceptor
  /**
   * Resolve the current principal from a request context. Exposed for
   * non-procedure code paths (channels, custom integrations) that need to
   * evaluate the engine outside of the procedure interceptor pipeline.
   */
  resolvePrincipal: (ctx: Context) => Promise<Principal>
  /**
   * Compute a structured coverage report against a list of currently
   * registered operations/channels. Useful as a CI assertion or runtime
   * audit when `defaultMode: 'deny'` is configured.
   */
  getCoverage: (registered: readonly PolicyCoverageEntry[]) => PolicyCoverageReport
  /**
   * Accumulator for co-located policies (1.1.60+). Discovery calls
   * `accumulator.add()` for every (route, policy) pair it surfaces; the
   * application path (`applyDiscoveryResult`) calls `flush()` once at
   * the end of a load to materialise one policy per cascade file with
   * the union of route names in `scope.routes`, deduping the N-copy
   * leak that earlier releases produced when a single cascade
   * `_policy.yaml` was attached to N routes (Bug A from 1.1.58).
   *
   * `reset()` is called at the top of a hot reload so the next flush
   * only contains the policies for the routes that survived the
   * reload.
   */
  coLocatedAccumulator: CoLocatedAccumulator
}

/**
 * Per-server state for the co-located policy pipeline (1.1.60+).
 *
 * The accumulator exists so that a single cascade `_policy.yaml` shared
 * by N routes produces ONE entry in the engine instead of N copies
 * (one per route). Each `add()` records the route name against the
 * policy's `(source, index)` key. `flush()` materialises one policy
 * per key with `scope.routes` set to the union and commits to the
 * engine. `reset()` clears the accumulator without touching the
 * engine — used on hot reload so the next flush reflects only the
 * routes that survived the reload.
 *
 * Imported from `./co-located-accumulator.js`. Re-exported here so
 * existing call sites that imported the type from `bootstrap` keep
 * working.
 */
export type { CoLocatedAccumulator } from './co-located-accumulator.js'

export interface CreatePolicyBootstrapOptions {
  /** Fallback logger if `policy.logger` is not provided. */
  logger: LoggerPort
  /**
   * If false, skip side-effect registration of the MCP policy provider
   * (used by the MCP discovery resource). Default: true.
   */
  registerMcpProvider?: boolean
}

/**
 * Wire the entire policy stack from a single call. Returns null if
 * `config` is undefined (callers can short-circuit accordingly).
 */
export function createPolicyBootstrap(
  config: PolicyConfig | undefined,
  options: CreatePolicyBootstrapOptions,
): PolicyBootstrap | null {
  if (!config) return null

  const { logger: fallbackLogger } = options
  const registerMcpProvider = options.registerMcpProvider ?? true

  // Merge inline + JSON-loaded policies (eager validation, fail-fast).
  let mergedPolicies = [...(config.policies ?? [])]
  if (config.loadFromDir) {
    const { policies: jsonPolicies } = loadPoliciesFromDir({
      dir: config.loadFromDir,
      customConditions: config.customConditions,
    })
    const merged = mergePolicies(mergedPolicies, jsonPolicies)
    mergedPolicies = merged.merged
    const policyLog = config.logger ?? fallbackLogger
    for (const w of merged.warnings) {
      policyLog.warn({ component: 'policy' }, w)
    }
  }

  const engine = config.engine ?? createDefaultEngine({ policies: mergedPolicies })
  const principalResolver = createPrincipalResolver(config.principal)
  const productionErrorBody = process.env.NODE_ENV === 'production'
  const defaultMode: 'allow' | 'deny' = config.defaultMode ?? 'allow'
  const policyLogger = config.logger ?? fallbackLogger

  const coveredNames = new Set<string>()
  const publicNames = new Set<string>()

  const interceptorFactory = (procedureName: string, procConfig: ProcedurePolicyConfig): Interceptor => {
    coveredNames.add(procedureName)
    if (procConfig.public) publicNames.add(procedureName)
    return createPolicyInterceptor({
      engine,
      defaultAction: procedureName,
      config: procConfig,
      principalResolver,
      productionErrorBody,
      logger: policyLogger,
    })
  }

  const noPolicyDeclaredFactory = (procedureName: string): Interceptor =>
    createNoPolicyDeclaredInterceptor(procedureName, productionErrorBody)

  // Co-located policy accumulator (1.1.60+). Collects (source, index)
  // → Set<routeName> across the load, then flushes ONE policy per
  // (source, index) with `scope.routes` set to the union of routes.
  // Without this, an unscoped cascade _policy.yaml shared by N
  // routes produced N copies in the engine (Bug A from 1.1.58).
  const coLocatedAccumulator: CoLocatedAccumulator = createCoLocatedAccumulator({
    engine,
    flushLogger: policyLogger,
  })

  const getCoverage = (registered: readonly PolicyCoverageEntry[]) => {
    const gaps: PolicyCoverageEntry[] = []
    let covered = 0
    let pub = 0
    for (const entry of registered) {
      if (publicNames.has(entry.name)) {
        pub++
        continue
      }
      if (coveredNames.has(entry.name)) {
        covered++
        continue
      }
      gaps.push(entry)
    }
    return { defaultMode, total: registered.length, covered, public: pub, gaps }
  }

  if (registerMcpProvider) {
    // Sanitised snapshot for MCP discovery — strip `condition` (function,
    // non-serialisable) and emit `hasCondition: boolean` instead.
    setPolicyProvider(() =>
      engine.list().map((p) => ({
        id: p.id,
        description: p.description,
        effect: p.effect,
        principals: [...p.principals],
        actions: [...p.actions],
        resources: [...p.resources],
        hasCondition: typeof p.condition === 'function',
        ...(p.match ? { match: p.match } : {}),
      })),
    )
  }

  return {
    engine,
    defaultMode,
    interceptorFactory,
    noPolicyDeclaredFactory,
    resolvePrincipal: async (ctx) => principalResolver(ctx),
    getCoverage,
    coLocatedAccumulator,
  }
}
