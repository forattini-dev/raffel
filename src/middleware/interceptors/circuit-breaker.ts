/**
 * Circuit Breaker Interceptor
 *
 * Protocol-agnostic circuit breaker pattern implementation.
 * Prevents cascading failures by failing fast when a service is unhealthy.
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { CircuitBreakerConfig, CircuitState } from '../types.js'
import { RaffelError } from '../../core/router.js'

/**
 * Default error codes that count as failures
 */
const DEFAULT_FAILURE_CODES = [
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'INTERNAL_ERROR',
  'UNKNOWN',
]

/**
 * Circuit breaker state for a single procedure/service
 */
interface CircuitBreaker {
  state: CircuitState
  failures: number
  successes: number
  lastFailureTime: number
  lastStateChange: number
}

/**
 * Create a circuit breaker interceptor
 *
 * The circuit breaker has three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests fail fast
 * - HALF-OPEN: Testing if service recovered, limited requests allowed
 *
 * @example
 * ```typescript
 * // Basic usage
 * const circuitBreaker = createCircuitBreakerInterceptor()
 *
 * // Custom configuration
 * const circuitBreaker = createCircuitBreakerInterceptor({
 *   failureThreshold: 5,      // Open after 5 failures
 *   successThreshold: 3,      // Close after 3 successes in half-open
 *   resetTimeoutMs: 30000,    // Try to recover after 30s
 * })
 *
 * // With state change callback
 * const circuitBreaker = createCircuitBreakerInterceptor({
 *   onStateChange: (state, procedure) => {
 *     metrics.gauge('circuit_breaker', state === 'open' ? 1 : 0, { procedure })
 *   }
 * })
 *
 * server.use(circuitBreaker)
 * ```
 */
export function createCircuitBreakerInterceptor(config: CircuitBreakerConfig = {}): Interceptor {
  const {
    failureThreshold = 5,
    successThreshold = 3,
    resetTimeoutMs = 30000,
    windowMs = 60000,
    failureCodes = DEFAULT_FAILURE_CODES,
    onStateChange,
  } = config

  // Circuit breakers per procedure
  const circuits = new Map<string, CircuitBreaker>()

  /**
   * Get or create a circuit breaker for a procedure
   */
  const getCircuit = (procedure: string): CircuitBreaker => {
    let circuit = circuits.get(procedure)

    if (!circuit) {
      circuit = {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        lastStateChange: Date.now(),
      }
      circuits.set(procedure, circuit)
    }

    return circuit
  }

  /**
   * Transition to a new state
   */
  const transitionTo = (circuit: CircuitBreaker, procedure: string, newState: CircuitState): void => {
    if (circuit.state !== newState) {
      const _oldState = circuit.state
      circuit.state = newState
      circuit.lastStateChange = Date.now()

      // Reset counters on state change
      if (newState === 'closed') {
        circuit.failures = 0
        circuit.successes = 0
      } else if (newState === 'half-open') {
        circuit.successes = 0
      }

      onStateChange?.(newState, procedure)
    }
  }

  /**
   * Check if a failure is within the counting window
   */
  const isWithinWindow = (circuit: CircuitBreaker): boolean => {
    return Date.now() - circuit.lastFailureTime < windowMs
  }

  /**
   * Record a success
   */
  const recordSuccess = (circuit: CircuitBreaker, procedure: string): void => {
    if (circuit.state === 'half-open') {
      circuit.successes++

      if (circuit.successes >= successThreshold) {
        transitionTo(circuit, procedure, 'closed')
      }
    } else if (circuit.state === 'closed') {
      // Reset failure count on success if outside window
      if (!isWithinWindow(circuit)) {
        circuit.failures = 0
      }
    }
  }

  /**
   * Record a failure
   */
  const recordFailure = (circuit: CircuitBreaker, procedure: string): void => {
    circuit.lastFailureTime = Date.now()

    if (circuit.state === 'half-open') {
      // Any failure in half-open goes back to open
      transitionTo(circuit, procedure, 'open')
    } else if (circuit.state === 'closed') {
      circuit.failures++

      if (circuit.failures >= failureThreshold) {
        transitionTo(circuit, procedure, 'open')
      }
    }
  }

  /**
   * Check if circuit should allow request
   */
  const shouldAllowRequest = (circuit: CircuitBreaker, procedure: string): boolean => {
    const now = Date.now()

    switch (circuit.state) {
      case 'closed':
        return true

      case 'open':
        // Check if reset timeout has passed
        if (now - circuit.lastStateChange >= resetTimeoutMs) {
          transitionTo(circuit, procedure, 'half-open')
          return true
        }
        return false

      case 'half-open':
        // Allow limited requests in half-open state
        return true

      default:
        return true
    }
  }

  /**
   * Check if an error counts as a failure
   */
  const isFailure = (error: Error): boolean => {
    const code = (error as any).code
    return code && failureCodes.includes(code)
  }

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const procedure = envelope.procedure
    const circuit = getCircuit(procedure)

    // Check if request should be allowed
    if (!shouldAllowRequest(circuit, procedure)) {
      throw new RaffelError(
        'UNAVAILABLE',
        'Circuit breaker is open',
        {
          procedure,
          state: circuit.state,
          failures: circuit.failures,
          lastFailureTime: circuit.lastFailureTime,
          resetAfterMs: resetTimeoutMs - (Date.now() - circuit.lastStateChange),
        }
      )
    }

    try {
      const result = await next()
      recordSuccess(circuit, procedure)
      return result
    } catch (error) {
      if (isFailure(error as Error)) {
        recordFailure(circuit, procedure)
      }
      throw error
    }
  }
}

/**
 * Create a circuit breaker with procedure-specific configurations
 *
 * @example
 * ```typescript
 * const circuitBreaker = createProcedureCircuitBreaker({
 *   default: { failureThreshold: 5 },
 *   procedures: {
 *     'external.payment': { failureThreshold: 3, resetTimeoutMs: 60000 },
 *     'external.email': { failureThreshold: 10 },
 *   }
 * })
 * ```
 */
export function createProcedureCircuitBreaker(config: {
  default?: CircuitBreakerConfig
  procedures: Record<string, CircuitBreakerConfig>
}): Interceptor {
  const { default: defaultConfig = {}, procedures } = config

  // Create circuit breakers for each procedure
  const breakers = new Map<string, Interceptor>()

  // Default breaker
  const defaultBreaker = createCircuitBreakerInterceptor(defaultConfig)

  return async (envelope, ctx, next) => {
    const procedure = envelope.procedure

    // Check for exact match
    if (procedures[procedure]) {
      let breaker = breakers.get(procedure)
      if (!breaker) {
        breaker = createCircuitBreakerInterceptor({
          ...defaultConfig,
          ...procedures[procedure],
        })
        breakers.set(procedure, breaker)
      }
      return breaker(envelope, ctx, next)
    }

    // Check for pattern match
    for (const [pattern, procedureConfig] of Object.entries(procedures)) {
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{DOUBLE_STAR}}')
        .replace(/\*/g, '[^.]*')
        .replace(/{{DOUBLE_STAR}}/g, '.*')

      if (new RegExp(`^${regex}$`).test(procedure)) {
        let breaker = breakers.get(pattern)
        if (!breaker) {
          breaker = createCircuitBreakerInterceptor({
            ...defaultConfig,
            ...procedureConfig,
          })
          breakers.set(pattern, breaker)
        }
        return breaker(envelope, ctx, next)
      }
    }

    // Use default breaker
    return defaultBreaker(envelope, ctx, next)
  }
}

/**
 * Create a circuit breaker manager for monitoring and control
 */
export interface CircuitBreakerManager {
  /** Get the current state of all circuits */
  getStates(): Map<string, CircuitState>

  /** Force a circuit to a specific state */
  forceState(procedure: string, state: CircuitState): void

  /** Reset all circuits to closed */
  resetAll(): void

  /** Get the interceptor */
  interceptor: Interceptor
}

export function createCircuitBreakerManager(
  config: CircuitBreakerConfig = {}
): CircuitBreakerManager {
  const circuits = new Map<string, { state: CircuitState }>()

  const interceptor = createCircuitBreakerInterceptor({
    ...config,
    onStateChange: (state, procedure) => {
      circuits.set(procedure, { state })
      config.onStateChange?.(state, procedure)
    },
  })

  return {
    getStates(): Map<string, CircuitState> {
      const states = new Map<string, CircuitState>()
      for (const [procedure, circuit] of circuits) {
        states.set(procedure, circuit.state)
      }
      return states
    },

    forceState(procedure: string, state: CircuitState): void {
      circuits.set(procedure, { state })
      config.onStateChange?.(state, procedure)
    },

    resetAll(): void {
      for (const [procedure] of circuits) {
        circuits.set(procedure, { state: 'closed' })
        config.onStateChange?.('closed', procedure)
      }
    },

    interceptor,
  }
}
