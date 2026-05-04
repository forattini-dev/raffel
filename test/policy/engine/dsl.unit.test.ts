import { describe, it, expect } from 'vitest'
import { compileMatch, resolvePath } from '../../../src/middleware/policy/engine/dsl.js'
import type { AuthzInput, Principal, Resource } from '../../../src/middleware/policy/types.js'

const principal = (overrides: Partial<Principal> = {}): Principal => ({
  id: 's1',
  tenantId: 't1',
  scopes: ['lead.read', 'lead.claim'],
  groups: ['channel:c1', 'admins'],
  attrs: { role: 'manager', deptId: 'd9' },
  ...overrides,
})

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  type: 'lead',
  id: 'l1',
  tenantId: 't1',
  attrs: {
    status: 'active',
    assignedTo: 's1',
    channelId: 'channel:c1',
    amount: 1500,
    tags: ['vip', 'priority'],
    allowedScopes: ['lead.read'],
  },
  ...overrides,
})

const input = (overrides: Partial<AuthzInput> = {}): AuthzInput => ({
  principal: principal(),
  action: 'lead.read',
  resource: resource(),
  context: { hour: 10 },
  ...overrides,
})

describe('DSL — path resolution', () => {
  it('action / principal.* / resource.* / resource.attrs.* / context.*', () => {
    const i = input()
    expect(resolvePath(i, 'action')).toBe('lead.read')
    expect(resolvePath(i, 'principal.id')).toBe('s1')
    expect(resolvePath(i, 'principal.tenantId')).toBe('t1')
    expect(resolvePath(i, 'principal.scopes')).toEqual(['lead.read', 'lead.claim'])
    expect(resolvePath(i, 'principal.groups')).toEqual(['channel:c1', 'admins'])
    expect(resolvePath(i, 'principal.attrs.role')).toBe('manager')
    expect(resolvePath(i, 'resource.id')).toBe('l1')
    expect(resolvePath(i, 'resource.type')).toBe('lead')
    expect(resolvePath(i, 'resource.tenantId')).toBe('t1')
    expect(resolvePath(i, 'resource.attrs.status')).toBe('active')
    expect(resolvePath(i, 'resource.status')).toBe('active') // shorthand
    expect(resolvePath(i, 'context.hour')).toBe(10)
  })
})

describe('DSL — literal equality', () => {
  it('matches scalar', () => {
    const p = compileMatch({ 'resource.status': 'active' })
    expect(p(input())).toBe(true)
    expect(p(input({ resource: resource({ attrs: { status: 'archived' } }) }))).toBe(false)
  })

  it('matches null strictly', () => {
    const p = compileMatch({ 'resource.assignedTo': null })
    expect(p(input({ resource: resource({ attrs: { assignedTo: null } }) }))).toBe(true)
    expect(p(input())).toBe(false)
  })

  it('"*" wildcard always passes', () => {
    const p = compileMatch({ 'resource.type': '*' })
    expect(p(input())).toBe(true)
  })

  it('multi-key node = implicit allOf', () => {
    const p = compileMatch({
      'resource.status': 'active',
      'principal.attrs.role': 'manager',
    })
    expect(p(input())).toBe(true)
    expect(p(input({ principal: principal({ attrs: { role: 'agent' } }) }))).toBe(false)
  })
})

describe('DSL — @ref (path comparison)', () => {
  it('scalar vs scalar', () => {
    const p = compileMatch({ 'resource.assignedTo': '@principal.id' })
    expect(p(input())).toBe(true)
    expect(p(input({ principal: principal({ id: 's2' }) }))).toBe(false)
  })

  it('scalar vs array → includes check', () => {
    const p = compileMatch({ 'resource.channelId': '@principal.groups' })
    expect(p(input())).toBe(true) // 'channel:c1' is in groups
  })

  it('array vs array → intersection check', () => {
    const p = compileMatch({ 'principal.scopes': '@resource.allowedScopes' })
    expect(p(input())).toBe(true) // 'lead.read' is in both
  })
})

describe('DSL — `!` prefix negation', () => {
  it('!literal', () => {
    const p = compileMatch({ 'resource.status': '!archived' })
    expect(p(input())).toBe(true)
    expect(p(input({ resource: resource({ attrs: { status: 'archived' } }) }))).toBe(false)
  })

  it('!@ref', () => {
    const p = compileMatch({ 'resource.assignedTo': '!@principal.id' })
    expect(p(input())).toBe(false) // assignedTo === id
    expect(p(input({ principal: principal({ id: 's2' }) }))).toBe(true)
  })
})

describe('DSL — operators', () => {
  it('==', () => {
    const p = compileMatch({ 'resource.status': { '==': 'active' } })
    expect(p(input())).toBe(true)
  })

  it('!=', () => {
    const p = compileMatch({ 'resource.status': { '!=': 'archived' } })
    expect(p(input())).toBe(true)
  })

  it('!= with @ref', () => {
    const p = compileMatch({ 'resource.assignedTo': { '!=': '@principal.id' } })
    expect(p(input())).toBe(false)
    expect(p(input({ principal: principal({ id: 's9' }) }))).toBe(true)
  })

  it('< / <= / > / >=', () => {
    expect(compileMatch({ 'resource.amount': { '<': 2000 } })(input())).toBe(true)
    expect(compileMatch({ 'resource.amount': { '<=': 1500 } })(input())).toBe(true)
    expect(compileMatch({ 'resource.amount': { '>': 1000 } })(input())).toBe(true)
    expect(compileMatch({ 'resource.amount': { '>=': 1500 } })(input())).toBe(true)
    expect(compileMatch({ 'resource.amount': { '>': 5000 } })(input())).toBe(false)
  })

  it('in (literal array)', () => {
    expect(
      compileMatch({ 'resource.status': { in: ['active', 'pending'] } })(input()),
    ).toBe(true)
    expect(compileMatch({ 'resource.status': { in: ['archived'] } })(input())).toBe(false)
  })

  it('in with @ref', () => {
    expect(
      compileMatch({ 'resource.channelId': { in: '@principal.groups' } })(input()),
    ).toBe(true)
  })

  it('notIn', () => {
    expect(
      compileMatch({ 'resource.status': { notIn: ['archived', 'deleted'] } })(input()),
    ).toBe(true)
  })

  it('regex', () => {
    expect(
      compileMatch({ 'resource.id': { regex: '^l\\d+$' } })(input()),
    ).toBe(true)
    expect(
      compileMatch({ 'resource.id': { regex: '^x' } })(input()),
    ).toBe(false)
  })

  it('startsWith / endsWith / contains (string)', () => {
    expect(compileMatch({ 'resource.id': { startsWith: 'l' } })(input())).toBe(true)
    expect(compileMatch({ 'resource.id': { endsWith: '1' } })(input())).toBe(true)
  })

  it('contains on array', () => {
    expect(compileMatch({ 'resource.tags': { contains: 'vip' } })(input())).toBe(true)
    expect(compileMatch({ 'resource.tags': { contains: 'wat' } })(input())).toBe(false)
  })

  it('exists true / false', () => {
    expect(compileMatch({ 'resource.assignedTo': { exists: true } })(input())).toBe(true)
    expect(compileMatch({ 'resource.deletedAt': { exists: false } })(input())).toBe(true)
  })
})

describe('DSL — composition', () => {
  it('anyOf', () => {
    const p = compileMatch({
      anyOf: [
        { 'resource.status': 'archived' },
        { 'principal.attrs.role': 'manager' },
      ],
    })
    expect(p(input())).toBe(true)
  })

  it('allOf', () => {
    const p = compileMatch({
      allOf: [
        { 'resource.status': 'active' },
        { 'principal.attrs.role': 'manager' },
      ],
    })
    expect(p(input())).toBe(true)
  })

  it('not', () => {
    const p = compileMatch({ not: { 'resource.assignedTo': '@principal.id' } })
    expect(p(input())).toBe(false)
    expect(p(input({ principal: principal({ id: 's9' }) }))).toBe(true)
  })

  it('deep nesting (any/allOf/not mix)', () => {
    const p = compileMatch({
      anyOf: [
        {
          allOf: [
            { 'resource.channelId': '@principal.groups' },
            { 'principal.attrs.role': 'manager' },
          ],
        },
        { not: { 'resource.assignedTo': '@principal.id' } },
      ],
    })
    expect(p(input())).toBe(true) // first branch matches
  })
})

describe('DSL — invalid shapes throw at compile time', () => {
  it('mixing composition + path keys', () => {
    expect(() =>
      compileMatch({ anyOf: [{ 'resource.id': 'x' }], 'resource.foo': 'bar' } as never),
    ).toThrow(/cannot share a node/)
  })

  it('anyOf with non-array', () => {
    expect(() => compileMatch({ anyOf: 'nope' } as never)).toThrow(/expected array/)
  })

  it('not with non-object', () => {
    expect(() => compileMatch({ not: 42 } as never)).toThrow(/expected node/)
  })
})
