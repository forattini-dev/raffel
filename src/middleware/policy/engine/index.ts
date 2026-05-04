/**
 * Default Policy Engine Driver — `createDefaultEngine`.
 *
 * In-process evaluator. Pre-compiles all glob patterns at construction time;
 * hot path is regex tests + `condition` invocations only.
 */

import type { PolicyEnginePort } from '../../../ports/outbound/policy-engine.js'
import type { AuthzInput, Decision, Policy } from '../types.js'
import { compileAllPolicies } from './compile.js'
import { evaluate } from './evaluate.js'

export interface CreateDefaultEngineOptions {
  policies?: readonly Policy[]
  /**
   * Called when a policy `condition` throws. The engine still treats the
   * policy as a non-match. Wire this to your `LoggerPort` to capture the
   * error with stack.
   */
  onConditionError?: (policy: Policy, error: unknown) => void
}

export function createDefaultEngine(
  options: CreateDefaultEngineOptions = {},
): PolicyEnginePort {
  const policies = Object.freeze([...compileAllPolicies(options.policies ?? [])])
  const onConditionError = options.onConditionError

  return {
    evaluate(input: AuthzInput): Decision {
      return evaluate(input, policies, { onConditionError })
    },
    list(): readonly Policy[] {
      return policies
    },
  }
}

export { evaluate } from './evaluate.js'
export { compileGlob, matchAnyCompiled, matchSetBidirectional } from './match.js'
export { compilePolicyPatterns, compilePrincipalSet } from './compile.js'
