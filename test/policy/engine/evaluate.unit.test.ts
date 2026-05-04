import { describe, it, expect, vi } from 'vitest'
import { createDefaultEngine } from '../../../src/middleware/policy/engine/index.js'
import type { AuthzInput, Policy, Principal, Resource } from '../../../src/middleware/policy/types.js'

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  id: 's1',
  tenantId: 't1',
  scopes: ['lead.read'],
  groups: ['channel:c1'],
  ...overrides,
})

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  type: 'lead',
  id: 'l1',
  tenantId: 't1',
  ...overrides,
})

const input = (overrides: Partial<AuthzInput> = {}): AuthzInput => ({
  principal: principal(),
  action: 'lead.read',
  resource: resource(),
  ...overrides,
})

describe('evaluate — precedence', () => {
  it('1) tenant_mismatch beats everything (even matching allow)', () => {
    const policies: Policy[] = [
      {
        id: 'allow-all',
        effect: 'allow',
        principals: ['**'],
        actions: ['**'],
        resources: ['**'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(
      input({
        principal: principal({ tenantId: 'tA' }),
        resource: resource({ tenantId: 'tB' }),
      }),
    )

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('tenant_mismatch')
    expect(decision.matchedPolicyIds).toEqual([])
  })

  it('2) explicit_deny beats matching allow', () => {
    const policies: Policy[] = [
      {
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
      {
        id: 'deny-archived',
        effect: 'deny',
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        condition: ({ resource: r }) => r.attrs?.status === 'archived',
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(
      input({ resource: resource({ attrs: { status: 'archived' } }) }),
    )

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('explicit_deny')
    expect(decision.matchedPolicyIds).toEqual(['deny-archived'])
  })

  it('3) allow when only allow matches', () => {
    const policies: Policy[] = [
      {
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(input())

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('allow')
    expect(decision.matchedPolicyIds).toEqual(['allow-read'])
  })

  it('4) implicit_deny when nothing matches — populates candidates', () => {
    const policies: Policy[] = [
      {
        id: 'allow-write',
        description: 'requires write scope',
        effect: 'allow',
        principals: ['scope:lead.write'],
        actions: ['lead.update'],
        resources: ['lead:*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(input())

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('implicit_deny')
    expect(decision.candidatePolicies).toHaveLength(1)
    expect(decision.candidatePolicies[0]?.id).toBe('allow-write')
  })
})

describe('evaluate — audit', () => {
  it('audit policies match but never change `allowed`', () => {
    const policies: Policy[] = [
      {
        id: 'audit-reads',
        effect: 'audit',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
      {
        id: 'allow-reads',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(input())

    expect(decision.allowed).toBe(true)
    expect(decision.reason).toBe('allow')
    expect(decision.auditedPolicyIds).toEqual(['audit-reads'])
  })

  it('audit-only-match keeps implicit_deny', () => {
    const policies: Policy[] = [
      {
        id: 'audit-reads',
        effect: 'audit',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(input())

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('implicit_deny')
    expect(decision.auditedPolicyIds).toEqual(['audit-reads'])
  })
})

describe('evaluate — failure safety', () => {
  it('throwing condition → policy treated as non-match + onConditionError invoked', () => {
    const onConditionError = vi.fn()
    const policies: Policy[] = [
      {
        id: 'broken',
        effect: 'allow',
        principals: ['**'],
        actions: ['**'],
        resources: ['**'],
        condition: () => {
          throw new Error('boom')
        },
      },
    ]
    const engine = createDefaultEngine({ policies, onConditionError })

    const decision = engine.evaluate(input())

    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe('implicit_deny')
    expect(onConditionError).toHaveBeenCalledOnce()
    expect(onConditionError.mock.calls[0]?.[0].id).toBe('broken')
    expect((onConditionError.mock.calls[0]?.[1] as Error).message).toBe('boom')
  })
})

describe('evaluate — bidirectional principal scope', () => {
  it('principal with broad scope satisfies narrow policy pattern', () => {
    const policies: Policy[] = [
      {
        id: 'allow-narrow',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
      },
    ]
    const engine = createDefaultEngine({ policies })

    const decision = engine.evaluate(
      input({ principal: principal({ scopes: ['lead.**'] }) }),
    )

    expect(decision.allowed).toBe(true)
    expect(decision.matchedPolicyIds).toEqual(['allow-narrow'])
  })
})

describe('evaluate — match DSL parity (T2.3)', () => {
  it('match: { "resource.status": "active" } evaluates same as condition equivalent', () => {
    const dslPolicies: Policy[] = [
      {
        id: 'allow-active',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        match: { 'resource.status': 'active' },
      },
    ]
    const condPolicies: Policy[] = [
      {
        id: 'allow-active',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        condition: ({ resource: r }) => r.attrs?.status === 'active',
      },
    ]

    const dslEngine = createDefaultEngine({ policies: dslPolicies })
    const condEngine = createDefaultEngine({ policies: condPolicies })

    const allowedInput = input({ resource: resource({ attrs: { status: 'active' } }) })
    const deniedInput = input({ resource: resource({ attrs: { status: 'archived' } }) })

    expect(dslEngine.evaluate(allowedInput).allowed).toBe(condEngine.evaluate(allowedInput).allowed)
    expect(dslEngine.evaluate(deniedInput).allowed).toBe(condEngine.evaluate(deniedInput).allowed)
    expect(dslEngine.evaluate(allowedInput).reason).toBe('allow')
    expect(dslEngine.evaluate(deniedInput).reason).toBe('implicit_deny')
  })

  it('both condition and match must pass (implicit AND)', () => {
    const policies: Policy[] = [
      {
        id: 'belt-and-suspenders',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        condition: ({ principal: p }) => p.attrs?.role === 'manager',
        match: { 'resource.status': 'active' },
      },
    ]
    const engine = createDefaultEngine({ policies })

    // Both true → allow
    expect(
      engine.evaluate(
        input({
          principal: principal({ attrs: { role: 'manager' } }),
          resource: resource({ attrs: { status: 'active' } }),
        }),
      ).allowed,
    ).toBe(true)

    // condition fails → no match
    expect(
      engine.evaluate(
        input({
          principal: principal({ attrs: { role: 'agent' } }),
          resource: resource({ attrs: { status: 'active' } }),
        }),
      ).allowed,
    ).toBe(false)

    // match fails → no match
    expect(
      engine.evaluate(
        input({
          principal: principal({ attrs: { role: 'manager' } }),
          resource: resource({ attrs: { status: 'archived' } }),
        }),
      ).allowed,
    ).toBe(false)
  })
})

describe('evaluate — duration', () => {
  it('records durationMs', () => {
    const engine = createDefaultEngine({ policies: [] })
    const decision = engine.evaluate(input())
    expect(decision.durationMs).toBeTypeOf('number')
    expect(decision.durationMs).toBeGreaterThanOrEqual(0)
  })
})
