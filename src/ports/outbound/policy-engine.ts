/**
 * Policy Engine Port
 *
 * Canonical authorization-engine interface. The default driver lives in
 * `src/middleware/policy/engine/`; users can supply any implementation
 * (OPA, Cedar, Casbin, Oso, custom) by passing `policy.engine` on
 * `createServer`.
 *
 * Re-exports the type form from `middleware/policy/types.ts` to keep the
 * single source of truth there.
 */

import type {
  AuthzInput,
  Decision,
  Policy,
  PolicyEnginePortLike,
} from '../../middleware/policy/types.js'

/**
 * Authorization engine. Pure: no I/O beyond what the implementation chooses.
 *
 * Implementations MUST be safe to call concurrently from multiple requests.
 * Implementations SHOULD pre-compile patterns at construction time.
 */
export interface PolicyEnginePort extends PolicyEnginePortLike {
  evaluate(input: AuthzInput): Decision | Promise<Decision>
  /** Read-only snapshot of all currently loaded policies. */
  list(): readonly Policy[]
}

export type {
  AuthzInput,
  Decision,
  DecisionReason,
  Policy,
  JsonPolicy,
  PolicyEffect,
  PolicyCondition,
  Principal,
  Resource,
  EvalContext,
  CandidatePolicy,
  MatchNode,
  MatchValue,
  MatchOperator,
  MatchLiteral,
  PolicyConfig,
  PrincipalConfig,
  PrincipalSource,
  ProcedurePolicyConfig,
  ResourceResolver,
  PolicyForbiddenBody,
} from '../../middleware/policy/types.js'
