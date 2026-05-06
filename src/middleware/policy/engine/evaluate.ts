/**
 * Core authorization evaluation.
 *
 * Precedence (top wins):
 *   1. tenant_mismatch — principal and resource have different non-null tenantIds
 *   2. explicit_deny   — at least one `deny` policy fully matched
 *   3. allow           — at least one `allow` policy fully matched
 *   4. implicit_deny   — nothing matched (default closed)
 *
 * `audit` policies match like others but never change `allowed` — their ids
 * accumulate in `auditedPolicyIds`.
 */

import type {
  AuthzInput,
  CandidatePolicy,
  Decision,
  Policy,
} from '../types.js'
import { compilePolicyPatterns, compilePrincipalSet } from './compile.js'
import { matchAnyCompiled, matchSetBidirectional } from './match.js'

interface PolicyMatchResult {
  /** All three pattern arrays matched. */
  fullMatch: boolean
  /** Which pattern arrays failed to match (for diagnostics). */
  missing: string[]
}

function checkPolicyPatterns(policy: Policy, input: AuthzInput): PolicyMatchResult {
  compilePolicyPatterns(policy)
  const compiled = policy._compiled!

  // Scope filter (protocol/route/channel). When any scope facet is set the
  // policy is short-circuited if the input does not match — this keeps the
  // policy out of `candidatePolicies` diagnostics so reports stay quiet for
  // non-applicable transports.
  if (compiled.scopeProtocols && compiled.scopeProtocols.length > 0) {
    const protocol = input.protocol ?? ''
    if (!matchAnyCompiled(protocol, compiled.scopeProtocols)) {
      return { fullMatch: false, missing: ['scope.protocols'] }
    }
  }
  if (compiled.scopeRoutes && compiled.scopeRoutes.length > 0) {
    if (!matchAnyCompiled(input.action, compiled.scopeRoutes)) {
      return { fullMatch: false, missing: ['scope.routes'] }
    }
  }
  if (compiled.scopeChannels && compiled.scopeChannels.length > 0) {
    if (!matchAnyCompiled(input.action, compiled.scopeChannels)) {
      return { fullMatch: false, missing: ['scope.channels'] }
    }
  }

  const principalSet = compilePrincipalSet(input.principal)
  const resourceTag = `${input.resource.type}:${input.resource.id}`

  const principalsMatch = matchSetBidirectional(
    principalSet,
    policy.principals,
    compiled.principals,
  )
  const actionsMatch = matchAnyCompiled(input.action, compiled.actions)
  const resourcesMatch = matchAnyCompiled(resourceTag, compiled.resources)

  const missing: string[] = []
  if (!principalsMatch) missing.push('principals')
  if (!actionsMatch) missing.push('actions')
  if (!resourcesMatch) missing.push('resources')

  return { fullMatch: missing.length === 0, missing }
}

function safeCondition(
  policy: Policy,
  input: AuthzInput,
  onError: (err: unknown) => void,
): boolean {
  // Both `condition` and `match` (compiled) must pass when present.
  if (policy.condition) {
    try {
      if (!policy.condition(input)) return false
    } catch (err) {
      onError(err)
      return false
    }
  }
  if (policy._compiledMatch) {
    try {
      if (!policy._compiledMatch(input)) return false
    } catch (err) {
      onError(err)
      return false
    }
  }
  return true
}

export interface EvaluateOptions {
  /**
   * Called when a policy `condition` throws. The engine treats the policy as
   * a non-match and continues. The handler should typically log via LoggerPort.
   */
  onConditionError?: (policy: Policy, error: unknown) => void
}

export function evaluate(
  input: AuthzInput,
  policies: readonly Policy[],
  options: EvaluateOptions = {},
): Decision {
  const startedAt = performance.now()

  // Precedence #1 — tenant mismatch is checked before any policy runs.
  const principalTenant = input.principal.tenantId
  const resourceTenant = input.resource.tenantId
  if (
    principalTenant != null &&
    resourceTenant != null &&
    principalTenant !== resourceTenant
  ) {
    return {
      allowed: false,
      reason: 'tenant_mismatch',
      matchedPolicyIds: [],
      auditedPolicyIds: [],
      candidatePolicies: [],
      durationMs: performance.now() - startedAt,
    }
  }

  const matchedAllow: string[] = []
  const matchedDeny: string[] = []
  const audited: string[] = []
  const candidates: CandidatePolicy[] = []

  for (const policy of policies) {
    const patternResult = checkPolicyPatterns(policy, input)

    if (!patternResult.fullMatch) {
      // Partial match → candidate (only if at least one pattern array matched).
      if (patternResult.missing.length < 3) {
        candidates.push({
          id: policy.id,
          description: policy.description,
          effect: policy.effect,
          requiredPrincipals: [...policy.principals],
          missing: patternResult.missing,
        })
      }
      continue
    }

    if (!safeCondition(policy, input, (err) => options.onConditionError?.(policy, err))) {
      continue
    }

    switch (policy.effect) {
      case 'allow':
        matchedAllow.push(policy.id)
        break
      case 'deny':
        matchedDeny.push(policy.id)
        break
      case 'audit':
        audited.push(policy.id)
        break
    }
  }

  const durationMs = performance.now() - startedAt

  if (matchedDeny.length > 0) {
    return {
      allowed: false,
      reason: 'explicit_deny',
      matchedPolicyIds: matchedDeny,
      auditedPolicyIds: audited,
      candidatePolicies: candidates,
      durationMs,
    }
  }

  if (matchedAllow.length > 0) {
    return {
      allowed: true,
      reason: 'allow',
      matchedPolicyIds: matchedAllow,
      auditedPolicyIds: audited,
      candidatePolicies: candidates,
      durationMs,
    }
  }

  return {
    allowed: false,
    reason: 'implicit_deny',
    matchedPolicyIds: [],
    auditedPolicyIds: audited,
    candidatePolicies: candidates,
    durationMs,
  }
}
