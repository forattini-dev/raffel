/**
 * Circuit Breaker Interceptor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCircuitBreakerInterceptor,
  createProcedureCircuitBreaker,
  createCircuitBreakerManager,
} from './circuit-breaker.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

function createEnvelope(procedure: string): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: {},
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

describe('createCircuitBreakerInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests when circuit is closed', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 3,
    })

    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'success'
    )

    expect(result).toBe('success')
  })

  it('should open circuit after failure threshold', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 3,
      resetTimeoutMs: 30000,
      failureCodes: ['UNAVAILABLE'],
    })

    // Cause 3 failures with matching error code
    for (let i = 0; i < 3; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', `Failure ${i + 1}`)
          }
        )
      ).rejects.toThrow()
    }

    // Circuit should be open now - throws UNAVAILABLE with "Circuit breaker is open"
    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext(),
        async () => 'success'
      )
    ).rejects.toThrow('Circuit breaker is open')
  })

  it('should transition to half-open after reset timeout', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      failureCodes: ['UNAVAILABLE'],
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    // Circuit is open
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'success')
    ).rejects.toThrow('Circuit breaker is open')

    // Wait for reset timeout
    vi.advanceTimersByTime(1100)

    // Now in half-open state, should allow one request
    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'success'
    )

    expect(result).toBe('success')
  })

  it('should close circuit after success in half-open state', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 2,
      successThreshold: 2,
      resetTimeoutMs: 1000,
      failureCodes: ['UNAVAILABLE'],
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    // Wait for reset timeout
    vi.advanceTimersByTime(1100)

    // Successful requests in half-open state should close circuit
    await interceptor(createEnvelope('test'), createTestContext(), async () => 'success')
    await interceptor(createEnvelope('test'), createTestContext(), async () => 'success')

    // Circuit should be closed now, multiple requests should work
    for (let i = 0; i < 5; i++) {
      await expect(
        interceptor(createEnvelope('test'), createTestContext(), async () => 'ok')
      ).resolves.toBe('ok')
    }
  })

  it('should re-open circuit on failure in half-open state', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      failureCodes: ['UNAVAILABLE'],
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    // Wait for reset timeout
    vi.advanceTimersByTime(1100)

    // Fail in half-open state
    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          throw new RaffelError('UNAVAILABLE', 'Still failing')
        }
      )
    ).rejects.toThrow('Still failing')

    // Should be open again
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'success')
    ).rejects.toThrow('Circuit breaker is open')
  })

  it('should only count errors with matching codes as failures', async () => {
    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 2,
      failureCodes: ['UNAVAILABLE'], // Only count UNAVAILABLE as failure
    })

    // Non-matching error codes should not count toward opening
    for (let i = 0; i < 5; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('INVALID_ARGUMENT', 'Bad input')
          }
        )
      ).rejects.toThrow('Bad input')
    }

    // Circuit should still be closed
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'success')
    ).resolves.toBe('success')

    // UNAVAILABLE errors should open circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Service down')
          }
        )
      ).rejects.toThrow('Service down')
    }

    // Now circuit should be open
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'success')
    ).rejects.toThrow('Circuit breaker is open')
  })

  it('should call onStateChange callback', async () => {
    const stateChanges: Array<{ state: string; procedure: string }> = []

    const interceptor = createCircuitBreakerInterceptor({
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      failureCodes: ['UNAVAILABLE'],
      onStateChange: (state, procedure) => {
        stateChanges.push({ state, procedure })
      },
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    expect(stateChanges).toContainEqual({ state: 'open', procedure: 'test' })

    // Wait for half-open
    vi.advanceTimersByTime(1100)

    await interceptor(createEnvelope('test'), createTestContext(), async () => 'success')

    expect(stateChanges.some(s => s.state === 'half-open')).toBe(true)
  })
})

describe('createProcedureCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should track circuits per procedure', async () => {
    const interceptor = createProcedureCircuitBreaker({
      default: {
        failureThreshold: 2,
        failureCodes: ['UNAVAILABLE'],
      },
      procedures: {},
    })

    // Open circuit for procedure-a
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('procedure-a'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    // procedure-a should be open
    await expect(
      interceptor(createEnvelope('procedure-a'), createTestContext(), async () => 'success')
    ).rejects.toThrow('Circuit breaker is open')

    // procedure-b should still work
    await expect(
      interceptor(createEnvelope('procedure-b'), createTestContext(), async () => 'success')
    ).resolves.toBe('success')
  })

  it('should use procedure-specific configuration', async () => {
    const interceptor = createProcedureCircuitBreaker({
      default: {
        failureThreshold: 5,
        failureCodes: ['UNAVAILABLE'],
      },
      procedures: {
        'critical.service': {
          failureThreshold: 2, // More sensitive
        },
      },
    })

    // critical.service should open after 2 failures
    for (let i = 0; i < 2; i++) {
      await expect(
        interceptor(
          createEnvelope('critical.service'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    await expect(
      interceptor(createEnvelope('critical.service'), createTestContext(), async () => 'success')
    ).rejects.toThrow('Circuit breaker is open')
  })
})

describe('createCircuitBreakerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should provide getStates for all circuits', async () => {
    const manager = createCircuitBreakerManager({
      failureThreshold: 2,
      failureCodes: ['UNAVAILABLE'],
    })

    // Cause failures
    for (let i = 0; i < 2; i++) {
      await expect(
        manager.interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    const states = manager.getStates()
    expect(states.get('test')).toBe('open')
  })

  it('should allow resetAll to close all circuits', async () => {
    const manager = createCircuitBreakerManager({
      failureThreshold: 2,
      failureCodes: ['UNAVAILABLE'],
    })

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      await expect(
        manager.interceptor(
          createEnvelope('test'),
          createTestContext(),
          async () => {
            throw new RaffelError('UNAVAILABLE', 'Fail')
          }
        )
      ).rejects.toThrow()
    }

    expect(manager.getStates().get('test')).toBe('open')

    // Manually reset all
    manager.resetAll()

    expect(manager.getStates().get('test')).toBe('closed')
  })

  it('should allow forceState to control circuit state', async () => {
    const manager = createCircuitBreakerManager({
      failureThreshold: 5,
      failureCodes: ['UNAVAILABLE'],
    })

    // Force the circuit to open
    manager.forceState('test', 'open')

    expect(manager.getStates().get('test')).toBe('open')
  })
})
