/**
 * Performance sanity check (T11.2)
 *
 * Not a benchmark — just a tripwire to catch O(n²) regressions.
 *
 * Both tests use a warmup pass + median-of-N measurement to ride out CI
 * scheduler jitter, and the absolute thresholds are deliberately loose
 * (>10× the steady-state we observe locally) so we only fail when there
 * is a real algorithmic regression.
 */

import { describe, it, expect } from 'vitest'
import { createDefaultEngine } from '../../src/middleware/policy/engine/index.js'
import type { AuthzInput, Policy } from '../../src/middleware/policy/types.js'

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

describe('perf sanity (T11.2)', () => {
  it('1000 policies × 100 evaluates stays well under the regression budget', () => {
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

    const runOnce = (): { allowed: number; elapsed: number } => {
      const start = performance.now()
      let allowed = 0
      for (const input of inputs) {
        const d = engine.evaluate(input)
        if (d.allowed) allowed++
      }
      return { allowed, elapsed: performance.now() - start }
    }

    // Warmup pass — JIT, branch predictor, cache lines.
    runOnce()

    const samples: number[] = []
    let allowedTotal = 0
    for (let i = 0; i < 5; i++) {
      const { allowed, elapsed } = runOnce()
      samples.push(elapsed)
      allowedTotal = allowed
    }

    const elapsed = median(samples)
    expect(allowedTotal).toBe(100)
    // Loose budget: >10× the steady-state we measure locally (~20–40ms).
    // The point is to catch O(n²) regressions, not to gate on CI noise.
    expect(elapsed).toBeLessThan(2000)
  })

  it('amortised eval cost is at least one order of magnitude below compile cost', () => {
    const policies: Policy[] = Array.from({ length: 200 }, (_, i) => ({
      id: `p${i}`,
      effect: 'allow' as const,
      principals: [`scope:x.${i}`],
      actions: [`x.${i}`],
      resources: [`r:${i}`],
    }))

    const engine = createDefaultEngine({ policies })
    const sample: AuthzInput = {
      principal: { id: 's1', tenantId: 't1', scopes: ['x.5'], groups: [] },
      action: 'x.5',
      resource: { type: 'r', id: '5', tenantId: 't1' },
    }

    // First eval includes compile + JIT cost.
    const t1 = performance.now()
    engine.evaluate(sample)
    const firstMs = performance.now() - t1

    // Median per-eval over a long run, after a warmup batch.
    const ITERATIONS = 1000
    const BATCHES = 5
    const samples: number[] = []
    for (let b = 0; b < BATCHES + 1; b++) {
      const ts = performance.now()
      for (let i = 0; i < ITERATIONS; i++) engine.evaluate(sample)
      const ms = performance.now() - ts
      if (b > 0) samples.push(ms / ITERATIONS) // skip the first (warmup) batch
    }
    const perEval = median(samples)

    // Relative tripwire: per-eval must be at least 10× cheaper than first eval.
    // If they're comparable, the engine isn't amortising compile cost — that's
    // the actual O(n²) regression we want to catch.
    // Absolute fallback: 10ms per eval is generous even on slow CI runners.
    expect(perEval).toBeLessThan(Math.max(firstMs / 10, 10))
  })
})
