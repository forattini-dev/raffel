/**
 * Shared proxy telemetry options and node resolution helpers.
 */
import type { Labels, MetricRegistry } from '../metrics/types.js'
import { createProxyTelemetry, type ProxyFlowProtocol, type ProxyTelemetryCollector } from './telemetry.js'

export type ProxyTelemetryPercentile = number | `p${number}`

export interface ProxyNodeResolutionContext {
  role: 'source' | 'destination'
  protocol: ProxyFlowProtocol
  clientAddress?: string
  host?: string
  port?: number
  method?: string
  path?: string
  headers?: Record<string, string>
  authUsername?: string | null
  atype?: 'ipv4' | 'ipv6' | 'hostname'
}

export interface ProxyTelemetryOptionsBase {
  /** Reuse an existing collector to aggregate multiple proxy servers into one graph. */
  collector?: ProxyTelemetryCollector
  /** Reuse an existing metrics registry when creating a collector. */
  registry?: MetricRegistry
  /** Default labels applied to all proxy metrics. */
  defaultLabels?: Labels
  /** Percentiles exposed in graph snapshots and quantile metrics. Default: p50, p90, p95. */
  percentiles?: ProxyTelemetryPercentile[]
  /** Preferred header for identifying the source service, e.g. 'x-service-name'. */
  sourceHeader?: string
  /** Sliding window used for realtime edge rates and failure ratios. Default: 60 seconds. */
  rateWindowSeconds?: number
  /** Custom node resolver. Return a label to override source/destination naming. */
  resolveNode?: (ctx: ProxyNodeResolutionContext) => string | null | undefined
}

function normalizePercentile(percentile: ProxyTelemetryPercentile): number | null {
  if (typeof percentile === 'number') {
    if (!Number.isFinite(percentile) || percentile <= 0) return null
    return percentile > 1 ? percentile / 100 : percentile
  }

  const match = /^p?(\d+(?:\.\d+)?)$/i.exec(percentile)
  if (!match) return null

  const numeric = Number.parseFloat(match[1])
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return numeric > 1 ? numeric / 100 : numeric
}

export function createOrReuseProxyTelemetry(
  options?: ProxyTelemetryOptionsBase,
): ProxyTelemetryCollector | null {
  if (!options) return null
  if (options.collector) return options.collector
  return createProxyTelemetry({
    registry: options.registry,
    defaultLabels: options.defaultLabels,
    percentiles: options.percentiles
      ?.map(normalizePercentile)
      .filter((value): value is number => value != null && value <= 1),
    rateWindowMs: typeof options.rateWindowSeconds === 'number' && Number.isFinite(options.rateWindowSeconds)
      ? Math.max(1, options.rateWindowSeconds) * 1000
      : undefined,
  })
}

export function resolveNodeName(
  options: Pick<ProxyTelemetryOptionsBase, 'sourceHeader' | 'resolveNode'> | undefined,
  ctx: ProxyNodeResolutionContext,
): string {
  const custom = options?.resolveNode?.(ctx)
  if (typeof custom === 'string' && custom.length > 0) {
    return custom
  }

  if (ctx.role === 'source') {
    const headerName = options?.sourceHeader?.toLowerCase()
    const headerValue = headerName ? ctx.headers?.[headerName] : undefined
    if (headerValue) return headerValue
    if (ctx.authUsername) return ctx.authUsername
    return ctx.clientAddress ?? 'unknown'
  }

  if (ctx.host && ctx.port != null) {
    return `${ctx.host}:${ctx.port}`
  }
  if (ctx.host) return ctx.host
  return 'unknown'
}
