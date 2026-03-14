/**
 * Auto-reconnection Logic
 *
 * Exponential backoff reconnection with jitter.
 */

export interface ReconnectConfig {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoff: number
}

export interface ReconnectState {
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

/**
 * Calculate delay for next reconnect attempt with jitter
 */
export function getReconnectDelay(config: ReconnectConfig, attempt: number): number {
  const delay = Math.min(
    config.initialDelay * Math.pow(config.backoff, attempt),
    config.maxDelay
  )
  // Add ±25% jitter
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.round(delay + jitter)
}

/**
 * Create a reconnect controller
 */
export function createReconnectController(
  config: ReconnectConfig,
  connect: () => void,
  onAttempt?: (attempt: number) => void
) {
  const state: ReconnectState = {
    attempt: 0,
    timer: null,
    stopped: false,
  }

  return {
    /** Schedule a reconnection attempt */
    schedule() {
      if (state.stopped) return
      if (state.attempt >= config.maxAttempts) return

      const delay = getReconnectDelay(config, state.attempt)
      state.attempt++
      onAttempt?.(state.attempt)

      state.timer = setTimeout(() => {
        if (!state.stopped) connect()
      }, delay)
    },

    /** Reset attempt counter (on successful connect) */
    reset() {
      state.attempt = 0
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
    },

    /** Stop all reconnection */
    stop() {
      state.stopped = true
      if (state.timer) {
        clearTimeout(state.timer)
        state.timer = null
      }
    },

    get attempts() {
      return state.attempt
    },
  }
}
