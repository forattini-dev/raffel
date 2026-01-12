/**
 * Span Samplers
 *
 * Implementations for different sampling strategies.
 */

import type { Sampler, SamplingResult, SpanContext, SpanKind } from './types.js'

/**
 * Always sample all spans
 */
export function createAlwaysOnSampler(): Sampler {
  return {
    shouldSample(): SamplingResult {
      return { decision: 'record_and_sample' }
    },
  }
}

/**
 * Never sample any spans
 */
export function createAlwaysOffSampler(): Sampler {
  return {
    shouldSample(): SamplingResult {
      return { decision: 'drop' }
    },
  }
}

/**
 * Sample based on probability (0.0 to 1.0)
 */
export function createProbabilitySampler(ratio: number): Sampler {
  // Clamp ratio to valid range
  const effectiveRatio = Math.max(0, Math.min(1, ratio))

  return {
    shouldSample(): SamplingResult {
      if (effectiveRatio === 0) {
        return { decision: 'drop' }
      }
      if (effectiveRatio === 1) {
        return { decision: 'record_and_sample' }
      }
      if (Math.random() < effectiveRatio) {
        return { decision: 'record_and_sample' }
      }
      return { decision: 'drop' }
    },
  }
}

/**
 * Rate-limited sampler (max spans per second)
 */
export function createRateLimitedSampler(maxPerSecond: number): Sampler {
  let tokenBucket = maxPerSecond
  let lastRefill = Date.now()

  function refillBucket(): void {
    const now = Date.now()
    const elapsed = (now - lastRefill) / 1000
    lastRefill = now
    tokenBucket = Math.min(maxPerSecond, tokenBucket + elapsed * maxPerSecond)
  }

  return {
    shouldSample(): SamplingResult {
      refillBucket()

      if (tokenBucket >= 1) {
        tokenBucket -= 1
        return { decision: 'record_and_sample' }
      }

      return { decision: 'drop' }
    },
  }
}

/**
 * Parent-based sampler (respects parent's sampling decision)
 * Falls back to provided sampler for root spans
 */
export function createParentBasedSampler(rootSampler: Sampler): Sampler {
  return {
    shouldSample(
      traceId: string,
      spanName: string,
      spanKind: SpanKind,
      parentContext?: SpanContext
    ): SamplingResult {
      // If parent exists, follow its decision
      if (parentContext) {
        const isSampled = (parentContext.traceFlags & 1) === 1
        return {
          decision: isSampled ? 'record_and_sample' : 'drop',
          traceState: parentContext.traceState,
        }
      }

      // Root span: use root sampler
      return rootSampler.shouldSample(traceId, spanName, spanKind)
    },
  }
}

/**
 * Composite sampler that combines probability + rate limiting
 */
export function createCompositeSampler(
  probabilityRatio: number,
  maxPerSecond: number
): Sampler {
  const probabilitySampler = createProbabilitySampler(probabilityRatio)
  const rateLimiter = maxPerSecond > 0 ? createRateLimitedSampler(maxPerSecond) : null

  return {
    shouldSample(
      traceId: string,
      spanName: string,
      spanKind: SpanKind,
      parentContext?: SpanContext
    ): SamplingResult {
      // First check probability
      const probResult = probabilitySampler.shouldSample(
        traceId,
        spanName,
        spanKind,
        parentContext
      )

      if (probResult.decision !== 'record_and_sample') {
        return probResult
      }

      // Then check rate limit
      if (rateLimiter) {
        return rateLimiter.shouldSample(traceId, spanName, spanKind, parentContext)
      }

      return probResult
    },
  }
}
