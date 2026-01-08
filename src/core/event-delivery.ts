/**
 * Event Delivery Engine
 *
 * Implements delivery guarantees for events with retry and deduplication.
 */

import type { RetryPolicy } from '../types/handlers.js'

export interface EventDeliveryOptions {
  /** Delivery state store (default: in-memory) */
  store?: EventDeliveryStore
  /** Default retry policy for at-least-once events */
  defaultRetryPolicy?: RetryPolicy
  /** Default deduplication window for at-most-once events (ms) */
  defaultDeduplicationWindow?: number
}

export interface EventDeliveryStore {
  getRetryState(eventId: string): Promise<RetryState | null>
  setRetryState(eventId: string, state: RetryState): Promise<void>
  deleteRetryState(eventId: string): Promise<void>
  isDuplicate(eventId: string): Promise<boolean>
  markDuplicate(eventId: string, ttlMs: number): Promise<void>
}

export interface EventDeliveryEngine {
  deliver(options: {
    eventId: string
    delivery: 'best-effort' | 'at-least-once' | 'at-most-once'
    retryPolicy?: RetryPolicy
    deduplicationWindow?: number
    execute: (ack: () => void) => Promise<void>
  }): Promise<void>
  stop(): void
}

interface RetryState {
  attempts: number
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  initialDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
}

const DEFAULT_DEDUP_WINDOW_MS = 5 * 60 * 1000

export function createInMemoryEventDeliveryStore(): EventDeliveryStore {
  const retryState = new Map<string, RetryState>()
  const dedup = new Map<string, number>()

  function isExpired(expiresAt: number): boolean {
    return Date.now() > expiresAt
  }

  return {
    async getRetryState(eventId: string): Promise<RetryState | null> {
      return retryState.get(eventId) ?? null
    },
    async setRetryState(eventId: string, state: RetryState): Promise<void> {
      retryState.set(eventId, state)
    },
    async deleteRetryState(eventId: string): Promise<void> {
      retryState.delete(eventId)
    },
    async isDuplicate(eventId: string): Promise<boolean> {
      const expiresAt = dedup.get(eventId)
      if (!expiresAt) return false
      if (isExpired(expiresAt)) {
        dedup.delete(eventId)
        return false
      }
      return true
    },
    async markDuplicate(eventId: string, ttlMs: number): Promise<void> {
      dedup.set(eventId, Date.now() + ttlMs)
    },
  }
}

export function createEventDeliveryEngine(options: EventDeliveryOptions = {}): EventDeliveryEngine {
  const store = options.store ?? createInMemoryEventDeliveryStore()
  const defaultRetryPolicy = options.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY
  const defaultDedupWindow = options.defaultDeduplicationWindow ?? DEFAULT_DEDUP_WINDOW_MS
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function scheduleRetry(fn: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, delayMs)
    timers.add(timer)
  }

  function computeBackoff(attempt: number, policy: RetryPolicy): number {
    const delay = policy.initialDelay * Math.pow(policy.backoffMultiplier, attempt - 1)
    return Math.min(policy.maxDelay, delay)
  }

  async function deliverBestEffort(execute: (ack: () => void) => Promise<void>): Promise<void> {
    try {
      await execute(() => {})
    } catch (err) {
      console.error('Event handler error (best-effort):', err)
    }
  }

  async function deliverAtMostOnce(
    eventId: string,
    execute: (ack: () => void) => Promise<void>,
    deduplicationWindow: number
  ): Promise<void> {
    if (await store.isDuplicate(eventId)) {
      return
    }

    await store.markDuplicate(eventId, deduplicationWindow)

    try {
      await execute(() => {})
    } catch (err) {
      console.error('Event handler error (at-most-once):', err)
    }
  }

  async function deliverAtLeastOnce(
    eventId: string,
    execute: (ack: () => void) => Promise<void>,
    policy: RetryPolicy
  ): Promise<void> {
    const state = await store.getRetryState(eventId)
    const attempt = (state?.attempts ?? 0) + 1

    const runAttempt = async (currentAttempt: number): Promise<void> => {
      let acked = false
      const ack = () => {
        acked = true
      }

      try {
        await execute(ack)
      } catch (err) {
        console.error('Event handler error (at-least-once):', err)
      }

      if (acked) {
        await store.deleteRetryState(eventId)
        return
      }

      if (currentAttempt >= policy.maxAttempts) {
        await store.deleteRetryState(eventId)
        return
      }

      await store.setRetryState(eventId, { attempts: currentAttempt })
      const delay = computeBackoff(currentAttempt, policy)

      scheduleRetry(() => {
        void runAttempt(currentAttempt + 1)
      }, delay)
    }

    await runAttempt(attempt)
  }

  return {
    async deliver(options: {
      eventId: string
      delivery: 'best-effort' | 'at-least-once' | 'at-most-once'
      retryPolicy?: RetryPolicy
      deduplicationWindow?: number
      execute: (ack: () => void) => Promise<void>
    }): Promise<void> {
      const {
        eventId,
        delivery,
        retryPolicy,
        deduplicationWindow,
        execute,
      } = options

      if (delivery === 'best-effort') {
        await deliverBestEffort(execute)
        return
      }

      if (delivery === 'at-most-once') {
        await deliverAtMostOnce(
          eventId,
          execute,
          deduplicationWindow ?? defaultDedupWindow
        )
        return
      }

      await deliverAtLeastOnce(eventId, execute, retryPolicy ?? defaultRetryPolicy)
    },
    stop(): void {
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.clear()
    },
  }
}
