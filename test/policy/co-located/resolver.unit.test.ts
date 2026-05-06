import { describe, it, expect } from 'vitest'
import {
  handlerBaseKey,
  policyFileBaseKey,
  resolveCoLocatedPolicies,
  siblingPolicyCandidates,
  type PolicyFileDescriptor,
  type RouteDescriptor,
} from '../../../src/middleware/policy/co-located/resolver.js'
import type { Policy } from '../../../src/middleware/policy/types.js'

const dummyPolicy = (id: string): Policy => ({
  id,
  effect: 'allow',
  principals: ['*'],
  actions: ['*'],
  resources: ['*'],
})

describe('handlerBaseKey', () => {
  it.each([
    ['/abs/users/get.ts', '/abs/users/get'],
    ['/abs/users/get.js', '/abs/users/get'],
    ['/abs/no-extension', '/abs/no-extension'],
    ['/abs/users/[id]/get.ts', '/abs/users/[id]/get'],
  ])('strips ext: %s → %s', (input, expected) => {
    expect(handlerBaseKey(input)).toBe(expected)
  })
})

describe('policyFileBaseKey', () => {
  it.each([
    ['/abs/users/get.policy.yaml', '/abs/users/get'],
    ['/abs/users/get.policy.yml', '/abs/users/get'],
    ['/abs/users/get.policy.json', '/abs/users/get'],
  ])('extracts handler key: %s → %s', (input, expected) => {
    expect(policyFileBaseKey(input)).toBe(expected)
  })

  it.each([
    '/abs/users/get.ts',
    '/abs/users/get.yaml',
    '/abs/_meta.yaml',
    '/abs/users/get.policy.toml',
  ])('returns null for non-policy file: %s', (input) => {
    expect(policyFileBaseKey(input)).toBeNull()
  })
})

describe('siblingPolicyCandidates', () => {
  it('lists yaml + yml + json for a handler path', () => {
    expect(siblingPolicyCandidates('/abs/users/get.ts')).toEqual([
      '/abs/users/get.policy.yaml',
      '/abs/users/get.policy.yml',
      '/abs/users/get.policy.json',
    ])
  })
})

describe('resolveCoLocatedPolicies', () => {
  it('pairs sibling policy with handler by base path', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
      { name: 'users.create', filePath: '/abs/users/create.ts' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/users/get.policy.yaml',
        policies: [dummyPolicy('users-get-allow')],
        kind: 'sibling',
      },
    ]

    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'users.get',
      filePath: '/abs/users/get.ts',
      policies: [dummyPolicy('users-get-allow')],
      sources: [{ filePath: '/abs/users/get.policy.yaml', kind: 'sibling' }],
    })
  })

  it('returns empty list when no policy files match', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
    ]
    const result = resolveCoLocatedPolicies(routes, [])
    expect(result).toEqual([])
  })

  it('handles routes whose handler file has no extension', () => {
    const routes: RouteDescriptor[] = [
      { name: 'orphan', filePath: '/abs/orphan' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/orphan.policy.json',
        policies: [dummyPolicy('orphan')],
        kind: 'sibling',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('orphan')
  })

  it('preserves multiple policies inside a single file', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
    ]
    const policies = [dummyPolicy('a'), dummyPolicy('b'), dummyPolicy('c')]
    const files: PolicyFileDescriptor[] = [
      { filePath: '/abs/users/get.policy.yaml', policies, kind: 'sibling' },
    ]

    const result = resolveCoLocatedPolicies(routes, files)
    expect(result[0]?.policies.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores policy files without a matching route', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/orphan.policy.yaml',
        policies: [dummyPolicy('orphan')],
        kind: 'sibling',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toEqual([])
  })

  it('ignores non-sibling policy file kinds (placeholder for future cascades)', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
    ]
    const files = [
      {
        filePath: '/abs/users/get.policy.yaml',
        policies: [dummyPolicy('skip')],
        // Cast to mimic a future kind without polluting the type
        kind: 'folder' as 'sibling',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toEqual([])
  })
})
