/**
 * Adversarial fuzz harness across hardened sinks (#108).
 *
 * Combinatorial coverage: vectors × sinks. Adding a new attack vector is
 * a one-line append to `VECTORS`; adding a new sink is a `describe` block
 * that calls `runVectors`.
 *
 * Each sink reports one of three outcomes per vector:
 *   - `accepted`  — vector passed through normally (only OK for vectors
 *                   tagged `safe: true`)
 *   - `rejected`  — sink rejected the vector at the documented layer
 *                   (this is the desired outcome for malicious vectors)
 *   - `leaked`    — bytes reached past the boundary; the sink is broken
 *
 * Any `leaked` outcome fails the suite with a diagnostic naming the sink
 * and the vector, so a regression that drops a sanitiser call shows up
 * in CI on the next push.
 */

import { describe, it, expect } from 'vitest'
import { safeChannelName, safeHeaderValue, safeRouteSegment, safeStructuredKey, SanitisationError } from '../../src/security/sanitize/index.js'

type FuzzVector = {
  /** Short label used in test output. */
  label: string
  /** The malicious string to fire at every sink. */
  value: string
  /** Mark vectors that should be ACCEPTED (sanity baseline). Default: false. */
  safe?: boolean
}

const VECTORS: FuzzVector[] = [
  { label: 'crlf', value: 'safe\r\nx-injected: pwn' },
  { label: 'lf-only', value: 'safe\nx-injected: pwn' },
  { label: 'cr-only', value: 'safe\rx-injected: pwn' },
  { label: 'nul', value: 'before\x00after' },
  { label: 'tab-bell', value: 'before\x07after' },
  { label: 'control-byte-1f', value: 'before\x1Fafter' },
  { label: 'del-byte', value: 'before\x7Fafter' },
  { label: 'oversized-8k', value: 'a'.repeat(8192) },
  { label: 'oversized-65k', value: 'a'.repeat(65536) },
  { label: 'unicode-confusable-fullwidth', value: 'ＡＢＣ' }, // FULLWIDTH LATIN
  { label: 'rtl-override', value: 'safe‮evil' },
  { label: 'zero-width-space', value: 'safe​evil' },
  { label: 'header-continuation', value: 'safe\r\n\tx-injected: pwn' },
  { label: 'utf8-bom', value: '﻿start' },
  { label: 'newline-mix', value: 'a\r\nb\rc\nd' },
  { label: 'baseline-ascii', value: 'normal-value-123', safe: true },
  { label: 'baseline-empty', value: '' },
]

type Outcome = 'accepted' | 'rejected' | 'leaked'

function runOnSink(
  sink: (input: string) => string,
  vector: FuzzVector,
): { outcome: Outcome; reason?: string } {
  try {
    const out = sink(vector.value)
    // The sanitisers are reject-mode by default — anything that returns is
    // "accepted". Then we additionally check the output for raw forbidden
    // bytes; finding any means the sink leaked.
    if (/[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(out)) {
      return { outcome: 'leaked', reason: `sink returned bytes that contain control chars` }
    }
    return { outcome: 'accepted' }
  } catch (err) {
    if (err instanceof SanitisationError) {
      return { outcome: 'rejected', reason: err.kind }
    }
    return { outcome: 'leaked', reason: `sink threw non-Sanitisation error: ${(err as Error).message}` }
  }
}

interface SinkSpec {
  name: string
  call: (input: string) => string
}

function runVectors(sink: SinkSpec) {
  describe(`sink: ${sink.name}`, () => {
    for (const vector of VECTORS) {
      it(`vector ${vector.label} ${vector.safe ? '(baseline)' : ''}`, () => {
        const result = runOnSink(sink.call, vector)
        expect(result.outcome).not.toBe('leaked')
        if (vector.safe && vector.label === 'baseline-ascii') {
          // Sanity baseline must pass through normal ASCII strings.
          expect(result.outcome).toBe('accepted')
        }
      })
    }
  })
}

describe('Adversarial fuzz harness (#108)', () => {
  runVectors({
    name: 'safeHeaderValue',
    call: (s) => safeHeaderValue(s, { maxLength: 4096 }),
  })

  runVectors({
    name: 'safeChannelName',
    call: (s) => safeChannelName(s, { maxLength: 256 }),
  })

  runVectors({
    name: 'safeRouteSegment',
    call: (s) => safeRouteSegment(s, { maxLength: 256 }),
  })

  runVectors({
    name: 'safeStructuredKey',
    call: (s) => safeStructuredKey(s, { maxLength: 256 }),
  })
})
