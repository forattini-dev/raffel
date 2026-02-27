/**
 * Telemetry bootstrap tests
 */

import { describe, it, expect } from 'vitest'
import {
  configureMetrics,
  createTelemetryState,
  initializeTelemetry,
  collectTelemetryShutdownTasks,
} from '../../src/server/telemetry-bootstrap.js'

describe('telemetry bootstrap', () => {
  it('registers request metrics interceptor and /metrics route when enabled', async () => {
    const state = createTelemetryState()
    const globalInterceptors: Array<() => Promise<unknown>> = []
    const procedures: string[] = []

    configureMetrics(state, { collectRequestMetrics: true })

    await initializeTelemetry(state, {
      registry: {
        procedure(name) {
          procedures.push(name)
        },
      },
      startupStopTasks: [],
      globalInterceptors,
      logger: {
        debug: () => {},
        info: () => {},
      },
    })

    expect(procedures).toContain('__metrics__')
    expect(globalInterceptors).toHaveLength(1)
  })

  it('registers and exposes process metrics shutdown task', async () => {
    const state = createTelemetryState()
    const globalInterceptors: Array<() => Promise<unknown>> = []
    const startupStopTasks: Array<{ stop: () => Promise<void> }> = []

    configureMetrics(state, {
      collectRequestMetrics: false,
      collectProcessMetrics: true,
    })

    await initializeTelemetry(state, {
      registry: {
        procedure() {},
      },
      startupStopTasks,
      globalInterceptors,
      logger: {
        debug: () => {},
        info: () => {},
      },
    })

    const stopTasks: Array<{ stop: () => Promise<void> }> = []
    collectTelemetryShutdownTasks(state, stopTasks)

    expect(startupStopTasks).toHaveLength(1)
    expect(stopTasks).toHaveLength(1)

    await stopTasks[0].stop()
    expect(globalInterceptors).toHaveLength(0)
    expect((state as { processMetricsCleanup: (() => void) | null }).processMetricsCleanup).toBeNull()
  })
})
