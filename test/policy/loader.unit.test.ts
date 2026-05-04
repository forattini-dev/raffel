import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  loadPoliciesFromDir,
  mergePolicies,
} from '../../src/middleware/policy/loader.js'
import type { Policy } from '../../src/middleware/policy/types.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-policy-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loader — happy path', () => {
  it('loads valid JSON files (single policy + array)', async () => {
    await writeFile(
      path.join(dir, 'a.json'),
      JSON.stringify({
        id: 'allow-read',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        match: { 'resource.status': 'active' },
      }),
    )
    await writeFile(
      path.join(dir, 'b.json'),
      JSON.stringify([
        {
          id: 'deny-archived',
          effect: 'deny',
          principals: ['**'],
          actions: ['lead.read'],
          resources: ['lead:*'],
          match: { 'resource.status': 'archived' },
        },
        {
          id: 'audit-reads',
          effect: 'audit',
          principals: ['scope:lead.read'],
          actions: ['lead.read'],
          resources: ['lead:*'],
        },
      ]),
    )

    const { policies, loadedFiles } = loadPoliciesFromDir({ dir })
    expect(policies).toHaveLength(3)
    expect(loadedFiles.length).toBe(2)
    expect(policies.map((p) => p.id).sort()).toEqual(['allow-read', 'audit-reads', 'deny-archived'])
    expect(policies[0]?._source).toContain('a.json')
  })

  it('walks subdirectories recursively', async () => {
    await mkdir(path.join(dir, 'sub'))
    await writeFile(
      path.join(dir, 'sub', 'p.json'),
      JSON.stringify({
        id: 'p',
        effect: 'allow',
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
      }),
    )

    const { policies } = loadPoliciesFromDir({ dir })
    expect(policies).toHaveLength(1)
    expect(policies[0]?.id).toBe('p')
  })

  it('resolves customCondition references', async () => {
    await writeFile(
      path.join(dir, 'p.json'),
      JSON.stringify({
        id: 'biz-hours',
        effect: 'deny',
        principals: ['**'],
        actions: ['lead.update'],
        resources: ['lead:*'],
        customCondition: 'businessHoursOnly',
      }),
    )

    const businessHoursOnly = () => false
    const { policies } = loadPoliciesFromDir({
      dir,
      customConditions: { businessHoursOnly },
    })
    expect(policies[0]?.condition).toBe(businessHoursOnly)
  })
})

describe('loader — failures', () => {
  it('throws on invalid JSON syntax', async () => {
    await writeFile(path.join(dir, 'bad.json'), '{ invalid json }')
    expect(() => loadPoliciesFromDir({ dir })).toThrow(/invalid JSON/)
  })

  it('throws on schema violation (missing required field)', async () => {
    await writeFile(
      path.join(dir, 'no-id.json'),
      JSON.stringify({ effect: 'allow', principals: [], actions: [], resources: [] }),
    )
    expect(() => loadPoliciesFromDir({ dir })).toThrow(/schema validation failed/)
  })

  it('throws when customCondition referenced but not registered', async () => {
    await writeFile(
      path.join(dir, 'p.json'),
      JSON.stringify({
        id: 'x',
        effect: 'allow',
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
        customCondition: 'nonExistent',
      }),
    )
    expect(() => loadPoliciesFromDir({ dir })).toThrow(/nonExistent/)
  })

  it('throws on directory I/O error (nonexistent dir)', () => {
    expect(() => loadPoliciesFromDir({ dir: '/nonexistent/path' })).toThrow(
      /cannot read directory/,
    )
  })

  it('rejects policy with both match AND customCondition (mutually exclusive)', async () => {
    await writeFile(
      path.join(dir, 'p.json'),
      JSON.stringify({
        id: 'x',
        effect: 'allow',
        principals: ['*'],
        actions: ['*'],
        resources: ['*'],
        match: { 'resource.id': 'l1' },
        customCondition: 'foo',
      }),
    )
    expect(() => loadPoliciesFromDir({ dir, customConditions: { foo: () => true } })).toThrow(
      /schema validation failed/,
    )
  })
})

describe('mergePolicies', () => {
  const inline: Policy[] = [
    { id: 'p1', effect: 'allow', principals: ['*'], actions: ['*'], resources: ['*'] },
    { id: 'p2', effect: 'audit', principals: ['*'], actions: ['*'], resources: ['*'] },
  ]
  const fromJson: Policy[] = [
    {
      id: 'p2',
      effect: 'deny',
      principals: ['*'],
      actions: ['*'],
      resources: ['*'],
      _source: '/tmp/x.json',
    },
    { id: 'p3', effect: 'allow', principals: ['*'], actions: ['*'], resources: ['*'], _source: '/tmp/x.json' },
  ]

  it('JSON wins on duplicate id, warning emitted', () => {
    const { merged, warnings } = mergePolicies(inline, fromJson)
    expect(merged).toHaveLength(3)
    const p2 = merged.find((p) => p.id === 'p2')!
    expect(p2.effect).toBe('deny') // overridden by JSON
    expect(warnings.some((w) => w.includes('p2'))).toBe(true)
  })

  it('warns about empty pattern arrays (dead policies)', () => {
    const dead: Policy[] = [
      { id: 'dead', effect: 'allow', principals: [], actions: ['*'], resources: ['*'] },
    ]
    const { warnings } = mergePolicies([], dead)
    expect(warnings.some((w) => w.includes('empty principals'))).toBe(true)
  })
})
