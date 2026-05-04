/**
 * createPolicyHarness (T11.1)
 */

import { describe, it, expect } from 'vitest'
import { createPolicyHarness } from '../../src/testing/policy-harness.js'

describe('createPolicyHarness', () => {
  it('evaluates a simple policy without booting a server', () => {
    const harness = createPolicyHarness({
      policies: [
        {
          id: 'allow-active',
          effect: 'allow',
          principals: ['scope:lead.read'],
          actions: ['lead.read'],
          resources: ['lead:*'],
          match: { 'resource.status': 'active' },
        },
      ],
    })

    const decision = harness.evaluate({
      principal: harness.principal({ scopes: ['lead.read'] }),
      action: 'lead.read',
      resource: harness.resource({
        type: 'lead',
        id: 'l1',
        attrs: { status: 'active' },
      }),
    })

    expect((decision as any).allowed).toBe(true)
    expect((decision as any).matchedPolicyIds).toEqual(['allow-active'])
  })

  it('list() returns the loaded policies', () => {
    const harness = createPolicyHarness({
      policies: [
        { id: 'a', effect: 'allow', principals: ['*'], actions: ['*'], resources: ['*'] },
        { id: 'b', effect: 'deny', principals: ['*'], actions: ['*'], resources: ['*'] },
      ],
    })
    expect(harness.list().map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('verifies precedence (deny > allow)', () => {
    const harness = createPolicyHarness({
      policies: [
        { id: 'allow', effect: 'allow', principals: ['**'], actions: ['**'], resources: ['**'] },
        { id: 'deny', effect: 'deny', principals: ['**'], actions: ['**'], resources: ['**'] },
      ],
    })
    const d = harness.evaluate({
      principal: harness.principal(),
      action: 'anything',
      resource: harness.resource(),
    }) as any
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('explicit_deny')
  })

  it('candidatePolicies populated on implicit_deny', () => {
    const harness = createPolicyHarness({
      policies: [
        {
          id: 'requires-write',
          effect: 'allow',
          principals: ['scope:lead.write'],
          actions: ['lead.update'],
          resources: ['lead:*'],
        },
      ],
    })
    const d = harness.evaluate({
      principal: harness.principal({ scopes: ['lead.read'] }),
      action: 'lead.read',
      resource: harness.resource({ type: 'lead', id: 'l1' }),
    }) as any

    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('implicit_deny')
    expect(d.candidatePolicies).toHaveLength(1)
    expect(d.candidatePolicies[0]?.id).toBe('requires-write')
  })
})
