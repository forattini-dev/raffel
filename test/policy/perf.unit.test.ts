/**
 * Performance sanity check (T11.2)
 *
 * Not a benchmark — just a tripwire to catch O(n²) regressions.
 */

import { describe, it, expect } from 'vitest'
import { createDefaultEngine } from '../../src/middleware/policy/engine/index.js'
import type { AuthzInput, Policy } from '../../src/middleware/policy/types.js'

describe('perf sanity (T11.2)', () => {
  it('1000 policies × 100 evaluates completes well under 500ms', () => {
    const policies: Policy[] = []
    for (let i = 0; i < 1000; i++) {
      policies.push({
        id: `p${i}`,
        effect: 'allow',
        principals: [`scope:resource.read.${i}`],
        actions: [`resource.read.${i}`],
        resources: [`r:${i}`],
        match: { 'resource.attrs.tier': 'gold' },
      })
    }
    // Catch-all match
    policies.push({
      id: 'catch-all',
      effect: 'allow',
      principals: ['scope:resource.read'],
      actions: ['resource.read'],
      resources: ['r:hot'],
    })

    const engine = createDefaultEngine({ policies })

    const inputs: AuthzInput[] = []
    for (let i = 0; i < 100; i++) {
      inputs.push({
        principal: {
          id: `s${i}`,
          tenantId: 't1',
          scopes: ['resource.read'],
          groups: [],
        },
        action: 'resource.read',
        resource: { type: 'r', id: 'hot', tenantId: 't1', attrs: { tier: 'gold' } },
      })
    }

    const start = performance.now()
    let allowed = 0
    for (const input of inputs) {
      const d = engine.evaluate(input)
      if (d.allowed) allowed++
    }
    const elapsed = performance.now() - start

    expect(allowed).toBe(100)
    expect(elapsed).toBeLessThan(500)
  })

  it('compile cost amortised across many evaluations', () => {
    const policies: Policy[] = Array.from({ length: 200 }, (_, i) => ({
      id: `p${i}`,
      effect: 'allow' as const,
      principals: [`scope:x.${i}`],
      actions: [`x.${i}`],
      resources: [`r:${i}`],
    }))

    // First eval includes compile cost; subsequent should be much cheaper.
    const engine = createDefaultEngine({ policies })
    const sample: AuthzInput = {
      principal: { id: 's1', tenantId: 't1', scopes: ['x.5'], groups: [] },
      action: 'x.5',
      resource: { type: 'r', id: '5', tenantId: 't1' },
    }

    const t1 = performance.now()
    engine.evaluate(sample)
    const firstMs = performance.now() - t1

    const t2 = performance.now()
    for (let i = 0; i < 1000; i++) engine.evaluate(sample)
    const subsequentMs = performance.now() - t2

    // Per-eval after warmup should be sub-millisecond on a modern dev machine.
    const perEval = subsequentMs / 1000
    expect(perEval).toBeLessThan(1)
    // First eval still well under 50ms.
    expect(firstMs).toBeLessThan(50)
  })
})
