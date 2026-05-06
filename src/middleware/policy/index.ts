/**
 * Policy Engine Module — opt-in authorization for Raffel.
 *
 * Vendored and adapted from github.com/filipeforattini/policy-engine.
 *
 * @example
 * ```ts
 * import { createServer } from 'raffel'
 *
 * const server = createServer({
 *   policy: {
 *     principal: { from: 'session' },
 *     policies: [
 *       {
 *         id: 'leads-read-own',
 *         effect: 'allow',
 *         principals: ['scope:lead.read'],
 *         actions: ['lead.read'],
 *         resources: ['lead:*'],
 *         condition: ({ principal, resource }) =>
 *           resource.attrs?.assignedTo === principal.id,
 *       },
 *     ],
 *   },
 * })
 *
 * server.procedure('lead.read').authz({
 *   resource: (input) => ({ type: 'lead', id: input.id, tenantId: input.tenantId }),
 * }).handler(async ({ id }) => loadLead(id))
 * ```
 */

// Default driver
export { createDefaultEngine } from './engine/index.js'
export type { CreateDefaultEngineOptions } from './engine/index.js'

// Bootstrap — one-call wiring (slice 10 of architecture-deepening
// initiative, PRD #6 / issue #13). Replaces the four-step ritual of
// loadPoliciesFromDir → mergePolicies → createDefaultEngine →
// createPolicyInterceptor.
export { createPolicyBootstrap } from './bootstrap.js'
export type { PolicyBootstrap, CreatePolicyBootstrapOptions } from './bootstrap.js'

// Ctx helpers
export type { PolicyCtxHelpers } from './ctx-helpers.js'

// JSON loader
export { loadPoliciesFromDir, mergePolicies } from './loader.js'
export type { LoadOptions, LoadResult } from './loader.js'

// Co-located policy discovery (sibling `<file>.policy.{yaml,yml,json}`)
export {
  resolveCoLocatedPolicies,
  siblingPolicyCandidates,
  handlerBaseKey,
  policyFileBaseKey,
} from './co-located/resolver.js'
export type {
  RouteDescriptor as CoLocatedRouteDescriptor,
  PolicyFileDescriptor as CoLocatedPolicyFileDescriptor,
  PolicyFileKind as CoLocatedPolicyFileKind,
  PolicySource as CoLocatedPolicySource,
  RoutePolicyDescriptor as CoLocatedRoutePolicyDescriptor,
} from './co-located/resolver.js'
export { loadCoLocatedPolicies } from './co-located/loader.js'
export type {
  CoLocatedLoadOptions,
  CoLocatedLoadResult,
} from './co-located/loader.js'

// Types
export type {
  AuthzInput,
  CandidatePolicy,
  CompiledPolicyPatterns,
  Decision,
  DecisionReason,
  EvalContext,
  JsonPolicy,
  MatchLiteral,
  MatchNode,
  MatchOperator,
  MatchValue,
  Policy,
  PolicyCondition,
  PolicyConfig,
  PolicyEffect,
  PolicyEnginePortLike,
  PolicyForbiddenBody,
  Principal,
  PrincipalConfig,
  PrincipalSource,
  ProcedurePolicyConfig,
  Resource,
  ResourceResolver,
} from './types.js'
