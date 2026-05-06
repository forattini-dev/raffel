import { describe, it, expect } from 'vitest'
import {
  ancestorDirs,
  folderPolicyCandidates,
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

  it('ignores folder descriptors without a `dir` field', () => {
    const routes: RouteDescriptor[] = [
      { name: 'users.get', filePath: '/abs/users/get.ts' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/_policy.yaml',
        policies: [dummyPolicy('skip')],
        kind: 'folder',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toEqual([])
  })

  it('cascades folder _policy from ancestor directories (broader → closer)', () => {
    const routes: RouteDescriptor[] = [
      { name: 'admin.reset', filePath: '/abs/admin/reset.ts' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/_policy.yaml',
        policies: [dummyPolicy('root')],
        kind: 'folder',
        dir: '/abs',
      },
      {
        filePath: '/abs/admin/_policy.yaml',
        policies: [dummyPolicy('admin')],
        kind: 'folder',
        dir: '/abs/admin',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toHaveLength(1)
    expect(result[0]?.policies.map((p) => p.id)).toEqual(['root', 'admin'])
    expect(result[0]?.sources.map((s) => s.kind)).toEqual(['folder', 'folder'])
  })

  it('appends sibling after folder cascades so it is highest precedence in apply order', () => {
    const routes: RouteDescriptor[] = [
      { name: 'orders.list', filePath: '/abs/orders/list.ts' },
    ]
    const files: PolicyFileDescriptor[] = [
      {
        filePath: '/abs/_policy.yaml',
        policies: [dummyPolicy('cascade')],
        kind: 'folder',
        dir: '/abs',
      },
      {
        filePath: '/abs/orders/list.policy.yaml',
        policies: [dummyPolicy('sibling')],
        kind: 'sibling',
      },
    ]
    const result = resolveCoLocatedPolicies(routes, files)
    expect(result).toHaveLength(1)
    expect(result[0]?.policies.map((p) => p.id)).toEqual(['cascade', 'sibling'])
    expect(result[0]?.sources.map((s) => s.kind)).toEqual(['folder', 'sibling'])
  })
})

describe('ancestorDirs', () => {
  it('walks from handler dir up to filesystem root by default', () => {
    const chain = ancestorDirs('/a/b/c/get.ts')
    // broader → closer
    expect(chain[0]).toBe('/')
    expect(chain[chain.length - 1]).toBe('/a/b/c')
  })

  it('stops at provided rootDir', () => {
    const chain = ancestorDirs('/abs/feature/sub/get.ts', '/abs')
    expect(chain).toEqual(['/abs', '/abs/feature', '/abs/feature/sub'])
  })

  it('returns just the handler dir when handler lives directly under rootDir', () => {
    const chain = ancestorDirs('/abs/get.ts', '/abs')
    expect(chain).toEqual(['/abs'])
  })
})

describe('folderPolicyCandidates', () => {
  it('lists every supported _policy filename for a directory', () => {
    expect(folderPolicyCandidates('/abs/feature')).toEqual([
      '/abs/feature/_policy.yaml',
      '/abs/feature/_policy.yml',
      '/abs/feature/_policy.json',
    ])
  })
})
