import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createDefaultEngine,
  loadPoliciesFromDir,
  mergePolicies,
} from '../../src/policy.js'
import type { PolicyEnginePort } from '../../src/policy.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('policy public subpaths', () => {
  it('exposes the documented policy API from the source barrel', () => {
    const engine: PolicyEnginePort = createDefaultEngine()

    expect(engine.evaluate({ principal: { id: 'u1' }, action: 'lead.read', resource: { type: 'lead' } }))
      .toMatchObject({ allowed: false, reason: 'implicit_deny' })
    expect(engine.list()).toEqual([])
    expect(loadPoliciesFromDir).toBeTypeOf('function')
    expect(mergePolicies).toBeTypeOf('function')
  })

  it('exports the documented policy package subpaths', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(repoRoot, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, { types: string; import: string }>
    }

    expect(packageJson.exports['./policy']).toEqual({
      types: './dist/policy.d.ts',
      import: './dist/policy.js',
    })
    expect(packageJson.exports['./ports/outbound/policy-engine']).toEqual({
      types: './dist/ports/outbound/policy-engine.d.ts',
      import: './dist/ports/outbound/policy-engine.js',
    })
  })
})
