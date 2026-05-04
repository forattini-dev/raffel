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
import type { Interceptor } from '../../types/index.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import { createDefaultEngine } from './engine/index.js'
import { createPolicyInterceptor, createNoPolicyDeclaredInterceptor } from './interceptor.js'
import { loadPoliciesFromDir, mergePolicies } from './loader.js'
import { createPrincipalResolver } from './principal/index.js'
import { setPolicyProvider } from '../../mcp/resources/index.js'
import type { PolicyConfig, ProcedurePolicyConfig } from './types.js'

export interface PolicyBootstrap {
  /** The resolved engine (user-supplied or createDefaultEngine). */
  engine: PolicyEnginePort
  /** Default decision when a procedure has no policy declared. */
  defaultMode: 'allow' | 'deny'
  /** Build a policy interceptor for a specific procedure declaration. */
  interceptorFactory: (procedureName: string, config: ProcedurePolicyConfig) => Interceptor
  /** Build the "no policy declared" interceptor for a procedure. */
  noPolicyDeclaredFactory: (procedureName: string) => Interceptor
}

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

  const interceptorFactory = (procedureName: string, procConfig: ProcedurePolicyConfig): Interceptor =>
    createPolicyInterceptor({
      engine,
      defaultAction: procedureName,
      config: procConfig,
      principalResolver,
      productionErrorBody,
      logger: policyLogger,
    })

  const noPolicyDeclaredFactory = (procedureName: string): Interceptor =>
    createNoPolicyDeclaredInterceptor(procedureName, productionErrorBody)

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

  return { engine, defaultMode, interceptorFactory, noPolicyDeclaredFactory }
}
