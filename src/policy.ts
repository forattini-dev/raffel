/**
 * Public Policy API.
 *
 * This subpath keeps declarative authorization imports small and matches the
 * documented `raffel/policy` surface.
 */

export {
  createDefaultEngine,
  createPolicyBootstrap,
  loadPoliciesFromDir,
  mergePolicies,
} from './middleware/policy/index.js'

export type {
  AuthzInput,
  CandidatePolicy,
  CompiledPolicyPatterns,
  CreateDefaultEngineOptions,
  CreatePolicyBootstrapOptions,
  Decision,
  DecisionReason,
  EvalContext,
  JsonPolicy,
  LoadOptions,
  LoadResult,
  MatchLiteral,
  MatchNode,
  MatchOperator,
  MatchValue,
  Policy,
  PolicyBootstrap,
  PolicyCondition,
  PolicyConfig,
  PolicyCtxHelpers,
  PolicyEffect,
  PolicyEnginePortLike,
  PolicyForbiddenBody,
  Principal,
  PrincipalConfig,
  PrincipalSource,
  ProcedurePolicyConfig,
  Resource,
  ResourceResolver,
} from './middleware/policy/index.js'

export type { PolicyEnginePort } from './ports/outbound/policy-engine.js'
