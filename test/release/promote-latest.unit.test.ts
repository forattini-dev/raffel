import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  highestStableVersion,
  reconcileLatest,
} from '../../scripts/promote-latest.mjs'

describe('stable release promotion', () => {
  it('orders stable versions numerically and ignores prereleases', () => {
    expect(
      highestStableVersion([
        '1.9.99',
        '1.10.0-next.abc123',
        '1.10.0',
        '2.0.0-beta.1',
      ]),
    ).toBe('1.10.0')
  })

  it('reconciles latest when a newer release appears during promotion', () => {
    let versions = ['1.1.79']
    let latest = '1.1.78'
    let promotions = 0

    const runNpm = vi.fn((args: string[]) => {
      const command = args.join(' ')

      if (command === 'view raffel versions --json') {
        return JSON.stringify(versions)
      }

      if (command === 'view raffel dist-tags.latest --json') {
        return JSON.stringify(latest)
      }

      if (args[0] === 'dist-tag' && args[1] === 'add') {
        latest = args[2]!.split('@').at(-1)!
        promotions += 1

        if (promotions === 1) {
          versions = [...versions, '1.1.80']
        }

        return `+latest: ${latest}`
      }

      throw new Error(`Unexpected npm invocation: ${command}`)
    })

    expect(reconcileLatest('raffel', runNpm)).toBe('1.1.80')
    expect(latest).toBe('1.1.80')
    expect(promotions).toBe(2)
  })

  it('runs reconciliation for both stable registries', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const stableRelease = workflow.split('  release-stable:')[1]

    expect(stableRelease).toContain('node scripts/promote-latest.mjs raffel')
    expect(stableRelease).toContain(
      'node scripts/promote-latest.mjs @forattini-dev/raffel',
    )
  })

  it('publishes stable releases without external DAST configuration', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const stableRelease = workflow.split('  release-stable:')[1]

    expect(workflow).not.toMatch(
      /DAST_TARGET_URL|security-testing|zaproxy|External DAST/,
    )
    expect(stableRelease).toContain(
      'needs: [check, security-gate, bench, test-unit, test-int]',
    )
  })
})
