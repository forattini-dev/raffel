/**
 * Timeout Interceptor
 *
 * Protocol-agnostic request timeout handling.
 * Prevents long-running requests from blocking resources.
 *
 * Features:
 * - Per-procedure and pattern-based timeouts
 * - Cascading timeouts for nested calls
 * - Deadline propagation across service boundaries
 * - Phase tracking for detailed timeout diagnostics
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { TimeoutConfig } from '../types.js'
import { RaffelError } from '../../core/router.js'

/**
 * Timeout phase for diagnostic purposes
 *
 * Helps identify WHERE the timeout occurred:
 * - `queued`: Request waiting in queue before processing
 * - `handler`: Executing the procedure handler
 * - `downstream`: Waiting for a downstream service/database
 * - `serialization`: Serializing/deserializing data
 * - `unknown`: Phase not tracked
 */
export type TimeoutPhase =
  | 'queued'
  | 'handler'
  | 'downstream'
  | 'serialization'
  | 'unknown'

/**
 * Extended context with phase tracking
 */
interface PhasedContext extends Context {
  timeoutPhase?: TimeoutPhase
  phaseStartTime?: number
}

/**
 * WeakMap for tracking timeout phases per request
 */
const phaseTracking = new WeakMap<
  Context,
  { phase: TimeoutPhase; startTime: number }
>()

/**
 * Set the current timeout phase for a request
 *
 * Call this from handlers to track where time is being spent.
 * If timeout occurs, the error will include the current phase.
 *
 * @example
 * ```typescript
 * async function myHandler(input: Input, ctx: Context) {
 *   // Mark that we're calling downstream service
 *   setTimeoutPhase(ctx, 'downstream')
 *   const result = await externalApi.fetch(input)
 *
 *   // Mark that we're processing the response
 *   setTimeoutPhase(ctx, 'handler')
 *   return processResult(result)
 * }
 * ```
 */
export function setTimeoutPhase(ctx: Context, phase: TimeoutPhase): void {
  phaseTracking.set(ctx, { phase, startTime: Date.now() })
}

/**
 * Get the current timeout phase for a request
 */
export function getTimeoutPhase(ctx: Context): TimeoutPhase {
  return phaseTracking.get(ctx)?.phase ?? 'unknown'
}

/**
 * Get phase timing information
 */
export function getPhaseInfo(ctx: Context): {
  phase: TimeoutPhase
  phaseDuration: number
} {
  const tracking = phaseTracking.get(ctx)
  if (!tracking) {
    return { phase: 'unknown', phaseDuration: 0 }
  }
  return {
    phase: tracking.phase,
    phaseDuration: Date.now() - tracking.startTime,
  }
}

/**
 * Match a procedure name against a glob pattern
 */
function matchPattern(pattern: string, procedure: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^.]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*')

  return new RegExp(`^${regex}$`).test(procedure)
}

/**
 * Find timeout for a procedure
 */
function findTimeout(
  procedure: string,
  procedures?: Record<string, number>,
  patterns?: Record<string, number>,
  defaultMs?: number
): number {
  // Check exact match first
  if (procedures?.[procedure] !== undefined) {
    return procedures[procedure]
  }

  // Check patterns
  if (patterns) {
    for (const [pattern, timeout] of Object.entries(patterns)) {
      if (matchPattern(pattern, procedure)) {
        return timeout
      }
    }
  }

  return defaultMs ?? 30000
}

/**
 * Create a promise that rejects after a timeout
 */
function createTimeoutPromise(
  ms: number,
  procedure: string,
  signal?: AbortSignal,
  ctx?: Context
): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      // Include phase information if available
      const phaseInfo = ctx ? getPhaseInfo(ctx) : { phase: 'unknown', phaseDuration: 0 }

      reject(new RaffelError(
        'DEADLINE_EXCEEDED',
        `Request timed out after ${ms}ms (phase: ${phaseInfo.phase})`,
        {
          procedure,
          timeoutMs: ms,
          phase: phaseInfo.phase,
          phaseDuration: phaseInfo.phaseDuration,
        }
      ))
    }, ms)

    // Clear timeout if signal is aborted
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new RaffelError('CANCELLED', 'Request was cancelled'))
      })
    }
  })
}

/**
 * Create a timeout interceptor
 *
 * @example
 * ```typescript
 * // Basic usage with default 30s timeout
 * const timeout = createTimeoutInterceptor()
 *
 * // Custom default timeout
 * const timeout = createTimeoutInterceptor({
 *   defaultMs: 10000,  // 10 seconds
 * })
 *
 * // Per-procedure timeouts
 * const timeout = createTimeoutInterceptor({
 *   defaultMs: 5000,
 *   procedures: {
 *     'reports.generate': 60000,  // 1 minute for reports
 *     'files.upload': 120000,     // 2 minutes for uploads
 *   }
 * })
 *
 * // Pattern-based timeouts
 * const timeout = createTimeoutInterceptor({
 *   defaultMs: 5000,
 *   patterns: {
 *     'analytics.**': 30000,
 *     'export.*': 60000,
 *   }
 * })
 *
 * server.use(timeout)
 * ```
 */
export function createTimeoutInterceptor(config: TimeoutConfig = {}): Interceptor {
  const { defaultMs = 30000, procedures, patterns } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const procedure = envelope.procedure
    const timeoutMs = findTimeout(procedure, procedures, patterns, defaultMs)

    // Check if context already has a deadline
    const existingDeadline = ctx.deadline
    const now = Date.now()
    const newDeadline = now + timeoutMs

    // Use the shorter deadline
    const effectiveDeadline = existingDeadline
      ? Math.min(existingDeadline, newDeadline)
      : newDeadline

    const effectiveTimeout = effectiveDeadline - now

    // If deadline already passed, fail immediately
    if (effectiveTimeout <= 0) {
      throw new RaffelError(
        'DEADLINE_EXCEEDED',
        'Request deadline has already passed',
        { procedure }
      )
    }

    // Update context with deadline
    ;(ctx as any).deadline = effectiveDeadline

    // Initialize phase tracking
    setTimeoutPhase(ctx, 'handler')

    // Race between the handler and timeout
    return Promise.race([
      next(),
      createTimeoutPromise(effectiveTimeout, procedure, ctx.signal, ctx),
    ])
  }
}

/**
 * Create a cascading timeout interceptor
 *
 * Reduces timeout for each nested call to prevent cascading delays.
 *
 * @example
 * ```typescript
 * const timeout = createCascadingTimeoutInterceptor({
 *   initialMs: 30000,
 *   reductionMs: 5000,  // Each nested call gets 5s less
 *   minimumMs: 5000,    // Never go below 5s
 * })
 * ```
 */
export function createCascadingTimeoutInterceptor(config: {
  initialMs?: number
  reductionMs?: number
  minimumMs?: number
} = {}): Interceptor {
  const {
    initialMs = 30000,
    reductionMs = 5000,
    minimumMs = 5000,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const now = Date.now()

    // Calculate remaining time from existing deadline
    let timeoutMs: number
    if (ctx.deadline) {
      const remaining = ctx.deadline - now
      timeoutMs = Math.max(remaining - reductionMs, minimumMs)
    } else {
      timeoutMs = initialMs
    }

    const newDeadline = now + timeoutMs

    // Update context
    ;(ctx as any).deadline = newDeadline

    // Initialize phase tracking
    setTimeoutPhase(ctx, 'handler')

    return Promise.race([
      next(),
      createTimeoutPromise(timeoutMs, envelope.procedure, ctx.signal, ctx),
    ])
  }
}

/**
 * Create a deadline propagation interceptor
 *
 * Reads deadline from metadata and enforces it.
 * Useful for propagating deadlines across service boundaries.
 */
export function createDeadlinePropagationInterceptor(config: {
  metadataKey?: string
  defaultMs?: number
} = {}): Interceptor {
  const {
    metadataKey = 'x-deadline',
    defaultMs = 30000,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const now = Date.now()

    // Try to read deadline from metadata
    const deadlineStr = envelope.metadata[metadataKey]
    let deadline: number

    if (deadlineStr) {
      deadline = parseInt(deadlineStr, 10)
      if (isNaN(deadline)) {
        deadline = now + defaultMs
      }
    } else {
      deadline = now + defaultMs
    }

    // Check if deadline already passed
    const remaining = deadline - now
    if (remaining <= 0) {
      throw new RaffelError(
        'DEADLINE_EXCEEDED',
        'Request deadline has already passed',
        { procedure: envelope.procedure }
      )
    }

    // Update context
    ;(ctx as any).deadline = deadline

    // Propagate deadline in metadata for downstream calls
    envelope.metadata[metadataKey] = deadline.toString()

    // Initialize phase tracking
    setTimeoutPhase(ctx, 'handler')

    return Promise.race([
      next(),
      createTimeoutPromise(remaining, envelope.procedure, ctx.signal, ctx),
    ])
  }
}
