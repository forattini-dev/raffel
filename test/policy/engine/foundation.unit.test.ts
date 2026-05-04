import { describe, it, expect } from 'vitest'
import { createDefaultEngine } from '../../../src/middleware/policy/index.js'
import type { AuthzInput } from '../../../src/middleware/policy/types.js'

describe('Phase 0 — engine foundation', () => {
  const sampleInput: AuthzInput = {
    principal: { id: 's1', tenantId: 't1', scopes: [], groups: [] },
    action: 'lead.read',
    resource: { type: 'lead', id: 'l1', tenantId: 't1' },
  }

  it('default engine returns implicit_deny for any input (Phase 0 stub)', () => {
    const engine = createDefaultEngine()
    const decision = engine.evaluate(sampleInput)

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'implicit_deny',
      matchedPolicyIds: [],
      auditedPolicyIds: [],
      candidatePolicies: [],
    })
  })

  it('list() returns the configured policies (frozen snapshot)', () => {
    const policies = [
      {
        id: 'sample',
        effect: 'allow' as const,
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const list = engine.list()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('sample')
    expect(Object.isFrozen(list)).toBe(true)
  })

  it('list() defaults to empty when no policies provided', () => {
    const engine = createDefaultEngine()
    expect(engine.list()).toEqual([])
  })
})
