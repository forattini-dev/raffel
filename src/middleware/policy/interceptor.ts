/**
 * Policy Interceptor
 *
 * Wraps procedure execution with an authorization gate. Sequence:
 *   1. Resolve principal (cached on ctx after first call within same request).
 *   2. Resolve resource via the procedure's resolver.
 *   3. Call engine.evaluate.
 *   4. On allow: attach Decision to `ctx.policyDecision`, call next().
 *   5. On deny: throw RaffelError(PERMISSION_DENIED) with a body shaped per
 *      NODE_ENV (verbose in dev/test, minimal in production).
 *
 * Phase 1: HTTP only (multi-protocol verified in Phase 4 via integration tests
 * — engine + interceptor are transport-agnostic).
 */

import { RaffelError } from '../../core/error.js'
import type { LoggerPort } from '../../ports/outbound/logger.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import type { Context } from '../../types/context.js'
import type { Envelope, Interceptor } from '../../types/index.js'
import { attachPolicyHelpers } from './ctx-helpers.js'
import type { PrincipalResolver } from './principal/index.js'
import type {
  AuthzInput,
  Decision,
  PolicyForbiddenBody,
  Principal,
  ProcedurePolicyConfig,
  Resource,
} from './types.js'

const POLICY_PRINCIPAL_KEY = '__policyPrincipal' as const
const POLICY_DECISION_KEY = 'policyDecision' as const

export interface CreatePolicyInterceptorOptions {
  engine: PolicyEnginePort
  /** Default action when the procedure didn't override it. */
  defaultAction: string
  /** Per-procedure config from `.authz({...})`. */
  config: ProcedurePolicyConfig
  /** Resolves the principal from ctx (cached per request). */
  principalResolver: PrincipalResolver
  /** When true, omit policy ids / candidates from the deny response body. */
  productionErrorBody?: boolean
  /** Logger for structured decision logging. */
  logger?: LoggerPort
}

function logDecision(
  logger: LoggerPort | undefined,
  decision: import('./types.js').Decision,
  action: string,
  principal: Principal,
  resource: Resource,
): void {
  if (!logger) return
  const data = {
    action,
    principal: { id: principal.id, tenantId: principal.tenantId },
    resource: { type: resource.type, id: resource.id, tenantId: resource.tenantId },
    allowed: decision.allowed,
    reason: decision.reason,
    matchedPolicyIds: decision.matchedPolicyIds,
    auditedPolicyIds: decision.auditedPolicyIds,
    candidatePolicies: decision.candidatePolicies.map((c) => ({ id: c.id, missing: c.missing })),
    durationMs: decision.durationMs,
  }
  if (decision.allowed) {
    if (decision.auditedPolicyIds.length > 0) {
      logger.info(data, 'policy: allow + audited policies fired')
    } else {
      logger.info(data, 'policy: allow')
    }
  } else if (decision.reason === 'tenant_mismatch') {
    logger.warn(data, 'policy: tenant_mismatch')
  } else if (decision.reason === 'explicit_deny') {
    logger.warn(data, 'policy: explicit_deny')
  } else if (decision.auditedPolicyIds.length > 0) {
    logger.debug(data, 'policy: audit-only-match (gate unaffected)')
  } else {
    logger.warn(data, 'policy: implicit_deny')
  }
}

function readCachedPrincipal(ctx: Context): Principal | undefined {
  const bag = ctx as unknown as Record<string, unknown>
  return bag[POLICY_PRINCIPAL_KEY] as Principal | undefined
}

function writeCachedPrincipal(ctx: Context, principal: Principal): void {
  const bag = ctx as unknown as Record<string, unknown>
  bag[POLICY_PRINCIPAL_KEY] = principal
  bag.principal = principal
}

function attachDecision(ctx: Context, decision: Decision): void {
  const bag = ctx as unknown as Record<string, unknown>
  bag[POLICY_DECISION_KEY] = decision
}

function buildForbiddenBody(
  decision: Decision,
  action: string,
  principal: Principal,
  productionMode: boolean,
): PolicyForbiddenBody {
  if (productionMode) {
    return { error: 'forbidden', code: 'POLICY_DENIED' }
  }
  return {
    error: 'forbidden',
    code: 'POLICY_DENIED',
    reason: decision.reason,
    action,
    principal: { id: principal.id, tenantId: principal.tenantId },
    matchedPolicyIds: decision.matchedPolicyIds,
    candidatePolicies: decision.candidatePolicies.map((c) => ({
      id: c.id,
      missing: c.missing,
    })),
  }
}

async function resolveResources(
  config: ProcedurePolicyConfig,
  envelope: Envelope,
  ctx: Context,
): Promise<readonly Resource[] | null> {
  if (!config.resource) return null
  const raw = await config.resource(envelope.payload, ctx)
  if (raw == null) return null
  return (Array.isArray(raw) ? raw : [raw]) as readonly Resource[]
}

/**
 * Synthesize the "no-policy-declared" deny interceptor used when
 * `policy.defaultMode === 'deny'` and a procedure was registered without
 * `.authz()`. Returns a 403 with `code: 'NO_POLICY_DECLARED'`.
 */
export function createNoPolicyDeclaredInterceptor(
  procedureName: string,
  productionErrorBody = false,
): Interceptor {
  return async (_envelope, _ctx, _next) => {
    const body: PolicyForbiddenBody = productionErrorBody
      ? { error: 'forbidden', code: 'NO_POLICY_DECLARED' }
      : {
          error: 'forbidden',
          code: 'NO_POLICY_DECLARED',
          reason: 'no_policy_declared' as const,
          action: procedureName,
        }
    throw new RaffelError('PERMISSION_DENIED', 'No policy declared for procedure', body)
  }
}

export function createPolicyInterceptor(
  options: CreatePolicyInterceptorOptions,
): Interceptor {
  const {
    engine,
    defaultAction,
    config,
    principalResolver,
    productionErrorBody = false,
    logger,
  } = options
  const action = config.action ?? defaultAction
  const mode = config.mode ?? 'enforce'

  return async (envelope, ctx, next) => {
    if (config.public) {
      return next()
    }

    let principal = readCachedPrincipal(ctx)
    if (!principal) {
      principal = await principalResolver(ctx)
      writeCachedPrincipal(ctx, principal)
    }

    // Attach ctx.policy.{evaluate,filterResources} helpers (idempotent).
    attachPolicyHelpers(ctx, engine, principal)

    const protocol = (ctx as { protocol?: unknown }).protocol
    const protocolValue = typeof protocol === 'string' ? protocol : undefined

    const resources = await resolveResources(config, envelope, ctx)

    if (!resources) {
      // No resource → run a single eval with a synthetic placeholder so
      // patterns relying on `actions` and `principals` still work.
      const placeholderResource: Resource = {
        type: '*',
        id: '*',
        tenantId: principal.tenantId,
      }
      const decision = await engine.evaluate({
        principal,
        action,
        resource: placeholderResource,
        ...(protocolValue ? { protocol: protocolValue } : {}),
      } satisfies AuthzInput)
      attachDecision(ctx, decision)
      logDecision(logger, decision, action, principal, placeholderResource)
      if (!decision.allowed) {
        throw new RaffelError(
          'PERMISSION_DENIED',
          'Policy denied',
          buildForbiddenBody(decision, action, principal, productionErrorBody),
        )
      }
      return next()
    }

    if (mode === 'any') {
      let lastDecision: Decision | undefined
      let lastResource: Resource | undefined
      let allowed = false
      for (const resource of resources) {
        const decision = await engine.evaluate({
          principal, action, resource,
          ...(protocolValue ? { protocol: protocolValue } : {}),
        })
        lastDecision = decision
        lastResource = resource
        logDecision(logger, decision, action, principal, resource)
        if (decision.allowed) {
          allowed = true
          attachDecision(ctx, decision)
          break
        }
      }
      if (!allowed && lastDecision && lastResource) {
        attachDecision(ctx, lastDecision)
        throw new RaffelError(
          'PERMISSION_DENIED',
          'Policy denied (no resource passed)',
          buildForbiddenBody(lastDecision, action, principal, productionErrorBody),
        )
      }
      return next()
    }

    // enforce — every resource must pass
    for (const resource of resources) {
      const decision = await engine.evaluate({
        principal, action, resource,
        ...(protocolValue ? { protocol: protocolValue } : {}),
      })
      attachDecision(ctx, decision)
      logDecision(logger, decision, action, principal, resource)
      if (!decision.allowed) {
        throw new RaffelError(
          'PERMISSION_DENIED',
          'Policy denied',
          buildForbiddenBody(decision, action, principal, productionErrorBody),
        )
      }
    }

    return next()
  }
}
