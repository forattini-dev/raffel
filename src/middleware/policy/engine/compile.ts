/**
 * Startup-time pre-compilation of policy patterns and principal sets.
 *
 * Runs once per server boot. Hot path then only does regex tests.
 */

import type { CompiledPolicyPatterns, Policy, Principal } from '../types.js'
import { compileMatch } from './dsl.js'
import { compileGlob } from './match.js'

/**
 * Pre-compile all glob patterns and the match DSL on a policy. Mutates
 * `_compiled` and `_compiledMatch` fields.
 *
 * Throws if `match` is malformed — surface at startup so traffic never sees
 * a broken policy.
 */
export function compilePolicyPatterns(policy: Policy): Policy {
  if (!policy._compiled) {
    const compiled: CompiledPolicyPatterns = {
      principals: policy.principals.map(compileGlob),
      actions: policy.actions.map(compileGlob),
      resources: policy.resources.map(compileGlob),
    }
    if (policy.scope?.routes && policy.scope.routes.length > 0) {
      compiled.scopeRoutes = policy.scope.routes.map(compileGlob)
    }
    if (policy.scope?.channels && policy.scope.channels.length > 0) {
      compiled.scopeChannels = policy.scope.channels.map(compileGlob)
    }
    if (policy.scope?.protocols && policy.scope.protocols.length > 0) {
      compiled.scopeProtocols = policy.scope.protocols.map(compileGlob)
    }
    policy._compiled = compiled
  }
  if (policy.match && !policy._compiledMatch) {
    policy._compiledMatch = compileMatch(policy.match)
  }
  return policy
}

export function compileAllPolicies(policies: readonly Policy[]): readonly Policy[] {
  for (const p of policies) compilePolicyPatterns(p)
  return policies
}

/**
 * Expand a `Principal` into the flat string set used for pattern matching.
 *
 * Includes:
 *   - bare id, prefixed id (`user:<id>`)
 *   - each scope prefixed `scope:<scope>`
 *   - each group prefixed `group:<group>`
 *   - the wildcard `*` (always)
 *
 * Result is cached on `principal._compiledSet` to avoid recomputation on
 * subsequent evaluates within the same request.
 */
export function compilePrincipalSet(principal: Principal): readonly string[] {
  if (principal._compiledSet) return principal._compiledSet

  const set: string[] = [principal.id, `user:${principal.id}`, '*']
  for (const scope of principal.scopes) set.push(`scope:${scope}`)
  for (const group of principal.groups) set.push(`group:${group}`)

  const frozen = Object.freeze(set)
  principal._compiledSet = frozen
  return frozen
}
