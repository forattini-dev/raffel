/**
 * Policy Test Harness
 *
 * Lightweight helper for unit-testing policies without booting a full server.
 *
 * @example
 * ```ts
 * import { createPolicyHarness } from 'raffel/testing'
 *
 * const harness = createPolicyHarness({
 *   policies: [
 *     {
 *       id: 'allow-active',
 *       effect: 'allow',
 *       principals: ['scope:lead.read'],
 *       actions: ['lead.read'],
 *       resources: ['lead:*'],
 *       match: { 'resource.status': 'active' },
 *     },
 *   ],
 * })
 *
 * const decision = harness.evaluate({
 *   principal: harness.principal({ scopes: ['lead.read'] }),
 *   action: 'lead.read',
 *   resource: { type: 'lead', id: 'l1', tenantId: 't1', attrs: { status: 'active' } },
 * })
 *
 * expect(decision.allowed).toBe(true)
 * expect(decision.matchedPolicyIds).toEqual(['allow-active'])
 * ```
 */

import { createDefaultEngine } from '../middleware/policy/engine/index.js'
import type {
  AuthzInput,
  Decision,
  Policy,
  PolicyCondition,
  Principal,
  Resource,
} from '../middleware/policy/types.js'

export interface CreatePolicyHarnessOptions {
  policies?: readonly Policy[]
  customConditions?: Record<string, PolicyCondition>
}

export interface PolicyHarness {
  /** Run an evaluation. Returns the engine `Decision`. */
  evaluate(input: AuthzInput): Decision | Promise<Decision>

  /** Convenience: build a Principal with sensible test defaults. */
  principal(overrides?: Partial<Principal>): Principal

  /** Convenience: build a Resource with sensible test defaults. */
  resource(overrides?: Partial<Resource>): Resource

  /** Read-only snapshot of loaded policies. */
  list(): readonly Policy[]
}

export function createPolicyHarness(
  options: CreatePolicyHarnessOptions = {},
): PolicyHarness {
  const engine = createDefaultEngine({ policies: options.policies })

  return {
    evaluate(input) {
      return engine.evaluate(input)
    },
    principal(overrides = {}) {
      return {
        id: 'test-user',
        tenantId: 'test-tenant',
        scopes: [],
        groups: [],
        ...overrides,
      }
    },
    resource(overrides = {}) {
      return {
        type: 'test-resource',
        id: 'test-id',
        tenantId: 'test-tenant',
        ...overrides,
      }
    },
    list() {
      return engine.list()
    },
  }
}
