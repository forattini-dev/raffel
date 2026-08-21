/**
 * Telemetry bootstrap tests
 */

import { afterEach, describe, it, expect } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import {
  configureMetrics,
  createTelemetryState,
  initializeTelemetry,
  collectTelemetryShutdownTasks,
} from '../../src/server/telemetry-bootstrap.js'
import type { ProcedureOptions } from '../../src/core/registry.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

describe('telemetry bootstrap', () => {
  let runningServer: ReturnType<typeof createServer> | undefined

  afterEach(async () => {
    if (runningServer?.isRunning) await runningServer.stop()
    runningServer = undefined
  })

  it('serves the configured metrics endpoint over HTTP GET', async () => {
    const port = await getFreePort()
    runningServer = createServer({ port, host: '127.0.0.1' })
      .enableMetrics({
        endpoint: '/internal/metrics',
        additionalCollectors: [() => 'host_collector_total 7'],
      })

    await runningServer.start()
    const response = await fetch(`http://127.0.0.1:${port}/internal/metrics`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toContain('host_collector_total 7')
  })

  it('registers request metrics interceptor and /metrics route when enabled', async () => {
    const state = createTelemetryState()
    const globalInterceptors: Array<() => Promise<unknown>> = []
    const procedures: string[] = []
    let metricsHandler: (() => Promise<unknown>) | undefined
    let metricsOptions: ProcedureOptions | undefined

    configureMetrics(state, {
      collectRequestMetrics: true,
      additionalCollectors: [() => 'custom_total 3'],
    })

    await initializeTelemetry(state, {
      registry: {
        procedure(name, handler, options) {
          procedures.push(name)
          metricsHandler = handler
          metricsOptions = options
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
    expect(metricsOptions).toMatchObject({ httpPath: '/metrics', httpMethod: 'GET' })
    const response = await metricsHandler!() as Response
    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(await response.text()).toContain('custom_total 3')
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
