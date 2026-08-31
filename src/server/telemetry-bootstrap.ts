/**
 * Telemetry bootstrap module.
 *
 * Encapsulates metrics/tracing runtime initialization and shutdown wiring.
 */

import type { Interceptor } from '../types/index.js'
import type { ProcedureOptions } from '../core/registry.js'
import type { MetricsConfig, MetricRegistry } from '../metrics/index.js'
import type { TracingConfig, Tracer } from '../tracing/index.js'
import { createMetricRegistry, createMetricsInterceptor, startProcessMetricsCollection } from '../metrics/index.js'
import {
  createGlobalOpenTelemetryTracer,
  createTracer,
  createTracingInterceptor,
} from '../tracing/index.js'

export interface StopTask {
  name: string
  stop: () => Promise<void>
}

export interface TelemetryLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
}

export interface TelemetryState {
  metricsConfig: MetricsConfig | null
  metricsRegistry: MetricRegistry | null
  processMetricsCleanup: (() => void) | null
  tracingConfig: TracingConfig | null
  tracerInstance: Tracer | null
}

export interface TelemetryRegistryLike {
  procedure: (
    name: string,
    handler: () => Promise<unknown>,
    options?: ProcedureOptions
  ) => void
}

export interface TelemetryStartupContext {
  registry: TelemetryRegistryLike
  router?: { use(interceptor: Interceptor): void }
  startupStopTasks: StopTask[]
  registerStopTask?: (task: StopTask) => void
  globalInterceptors: Interceptor[]
  logger: TelemetryLogger
}

function addStopTask(context: TelemetryStartupContext, task: StopTask): void {
  if (context.registerStopTask) {
    context.registerStopTask(task)
    return
  }

  context.startupStopTasks.push(task)
}

export function createTelemetryState(): TelemetryState {
  return {
    metricsConfig: null,
    metricsRegistry: null,
    processMetricsCleanup: null,
    tracingConfig: null,
    tracerInstance: null,
  }
}

export function configureMetrics(
  state: TelemetryState,
  config: MetricsConfig = {}
): void {
  state.metricsConfig = {
    enabled: config.enabled ?? true,
    endpoint: config.endpoint ?? '/metrics',
    defaultLabels: config.defaultLabels,
    collectRequestMetrics: config.collectRequestMetrics ?? true,
    collectProcessMetrics: config.collectProcessMetrics ?? false,
    additionalCollectors: config.additionalCollectors ?? [],
  }

  state.metricsRegistry = createMetricRegistry()
  if (state.metricsConfig.defaultLabels) {
    state.metricsRegistry.setDefaultLabels(state.metricsConfig.defaultLabels)
  }
}

export function configureTracing(
  state: TelemetryState,
  config: TracingConfig = {}
): void {
  state.tracingConfig = {
    enabled: config.enabled ?? true,
    serviceName: config.serviceName ?? 'raffel',
    sampleRate: config.sampleRate ?? 1.0,
    rateLimit: config.rateLimit ?? 0,
    exporters: config.exporters ?? [],
    batchSize: config.batchSize ?? 100,
    batchTimeout: config.batchTimeout ?? 5000,
    defaultAttributes: config.defaultAttributes ?? {},
    useGlobalOpenTelemetry: config.useGlobalOpenTelemetry ?? false,
    renameBorrowedSpans: config.renameBorrowedSpans ?? false,
  }

  state.tracerInstance = state.tracingConfig.useGlobalOpenTelemetry
    ? createGlobalOpenTelemetryTracer()
    : createTracer(state.tracingConfig)
}

export async function initializeTelemetry(
  state: TelemetryState,
  context: TelemetryStartupContext
): Promise<void> {
  const { registry, globalInterceptors, logger } = context

  // Initialize metrics if enabled
  if (state.metricsConfig?.enabled && state.metricsRegistry) {
    logger.debug({ endpoint: state.metricsConfig.endpoint }, 'Initializing metrics')

    if (state.metricsConfig.collectRequestMetrics) {
      globalInterceptors.unshift(createMetricsInterceptor(state.metricsRegistry))
    }

    if (state.metricsConfig.collectProcessMetrics) {
      state.processMetricsCleanup = startProcessMetricsCollection(state.metricsRegistry)
      addStopTask(context, {
        name: 'metrics-process-collector',
        stop: async () => {
          if (!state.processMetricsCleanup) return
          state.processMetricsCleanup()
          state.processMetricsCleanup = null
        },
      })
    }

    registry.procedure(
      '__metrics__',
      async () => {
        const nativeMetrics = state.metricsRegistry!.export('prometheus')
        const additionalMetrics = await Promise.all(
          (state.metricsConfig?.additionalCollectors ?? []).map((collector) => collector())
        )
        const body = [nativeMetrics, ...additionalMetrics]
          .map((value) => value.trim())
          .filter(Boolean)
          .join('\n\n')
        return new Response(`${body}\n`, {
          status: 200,
          headers: {
            'cache-control': 'no-store',
            'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          },
        })
      },
      {
        httpPath: state.metricsConfig.endpoint,
        httpMethod: 'GET',
        summary: 'Prometheus metrics exposition',
        // Operational endpoint for scrapers, not part of the API contract.
        docs: { hidden: true },
      }
    )

    logger.info({ endpoint: state.metricsConfig.endpoint }, 'Metrics enabled')
  }

  // Initialize tracing if enabled
  if (state.tracingConfig?.enabled && state.tracerInstance) {
    logger.debug(
      {
        serviceName: state.tracingConfig.serviceName,
        sampleRate: state.tracingConfig.sampleRate,
      },
      'Initializing tracing'
    )

    const tracingInterceptor = createTracingInterceptor(
      state.tracerInstance,
      {
        spanName: 'raffel.procedure',
        spanKind: 'internal',
        preferActiveParent: true,
      }
    )
    if (context.router) {
      context.router.use(tracingInterceptor)
    } else {
      globalInterceptors.unshift(tracingInterceptor)
    }
    addStopTask(context, {
      name: 'tracing',
      stop: async () => {
        if (!state.tracerInstance) return
        await state.tracerInstance.shutdown()
        state.tracerInstance = null
      },
    })

    logger.info(
      {
        serviceName: state.tracingConfig.serviceName,
        sampleRate: state.tracingConfig.sampleRate,
        exporters: state.tracingConfig.exporters?.length ?? 0,
      },
      'Tracing enabled'
    )
  }
}

export function collectTelemetryShutdownTasks(state: TelemetryState, stopTasks: StopTask[]): void {
  if (state.processMetricsCleanup) {
    stopTasks.push({
      name: 'metrics-process-collector',
      stop: async () => {
        if (!state.processMetricsCleanup) return
        state.processMetricsCleanup()
        state.processMetricsCleanup = null
      },
    })
  }

  if (state.tracerInstance) {
    stopTasks.push({
      name: 'tracing',
      stop: async () => {
        if (!state.tracerInstance) return
        await state.tracerInstance.shutdown()
        state.tracerInstance = null
      },
    })
  }
}
