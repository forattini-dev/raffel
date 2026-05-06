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
  const policies: Policy[] = [...compileAllPolicies(options.policies ?? [])]
  const seenIds = new Set(policies.map((p) => p.id))
  const onConditionError = options.onConditionError

  return {
    evaluate(input: AuthzInput): Decision {
      return evaluate(input, policies, { onConditionError })
    },
    list(): readonly Policy[] {
      return Object.freeze([...policies])
    },
    addPolicies(extras: readonly Policy[]): void {
      if (extras.length === 0) return
      const compiled = compileAllPolicies(extras)
      for (const p of compiled) {
        if (seenIds.has(p.id)) {
          // Replace in-place to preserve list order semantics for duplicates.
          const idx = policies.findIndex((existing) => existing.id === p.id)
          if (idx >= 0) policies[idx] = p
          continue
        }
        seenIds.add(p.id)
        policies.push(p)
      }
    },
  }
}

