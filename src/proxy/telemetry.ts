/**
 * Proxy telemetry primitives for metrics and service graph snapshots.
 */
import { createMetricRegistry } from '../metrics/index.js'
import type { HistogramBucket, Labels, MetricRegistry } from '../metrics/types.js'

export type ProxyFlowProtocol =
  | 'http'
  | 'https'
  | 'connect'
  | 'ws'
  | 'wss'
  | 'socks5'
  | 'socks5h'
  | 'socks5-bind'
  | 'socks5h-bind'
  | 'socks5-udp'
  | 'socks5h-udp'
  | 'tcp'

export interface ProxyGraphNode {
  id: string
  label: string
  inboundEdges: number
  outboundEdges: number
  lastSeenAt: string
  requestsOut: number
  requestsIn: number
  errorsOut: number
  errorsIn: number
  bytesOut: number
  bytesIn: number
  activeFlows: number
  protocols: Record<string, number>
}

export interface ProxyGraphLatency {
  averageSeconds: number | null
  percentiles: Record<string, number | null>
}

export interface ProxyGraphRates {
  windowSeconds: number
  flowsPerSecond: number
  requestsPerSecond: number
  errorsPerSecond: number
  bytesFromSourcePerSecond: number
  bytesToSourcePerSecond: number
  bytesPerSecond: number
  failureRatio: number | null
}

export interface ProxyGraphEdge {
  id: string
  source: string
  target: string
  protocol: ProxyFlowProtocol
  firstSeenAt: string
  lastSeenAt: string
  activeFlows: number
  flowsTotal: number
  requestsTotal: number
  errorsTotal: number
  bytesFromSource: number
  bytesToSource: number
  durationCount: number
  durationSumSeconds: number
  latency: ProxyGraphLatency
  rates: ProxyGraphRates
  statusClassCounts: Record<string, number>
  methodCounts: Record<string, number>
  topPaths: Array<{ path: string; count: number }>
}

export interface ProxyGraphSnapshot {
  seq: number
  generatedAt: string
  windowStart: string
  windowEnd: string
  percentiles: string[]
  rateWindowSeconds: number
  nodes: ProxyGraphNode[]
  edges: ProxyGraphEdge[]
}

export type ProxyTelemetryEvent =
  | { type: 'node:new'; seq: number; nodeId: string; firstSeenAt: string }
  | { type: 'edge:new'; seq: number; edge: ProxyGraphEdge }
  | { type: 'edge:update'; seq: number; edge: ProxyGraphEdge }
  | { type: 'edge:expire'; seq: number; edgeId: string; source: string; target: string; protocol: ProxyFlowProtocol }
  | { type: 'reset'; seq: number }

export type ProxyTelemetryListener = (event: ProxyTelemetryEvent) => void

export interface ProxyTelemetryLabels extends Labels {
  source: string
  destination: string
  protocol: ProxyFlowProtocol
}

export interface ProxyFlowFinishInput {
  status?: string
  error?: string
  method?: string
  path?: string
  durationSeconds?: number
}

export interface ProxyFlowHandle {
  addBytesFromSource(delta: number): void
  addBytesToSource(delta: number): void
  finish(input?: ProxyFlowFinishInput): void
}

export interface ProxyTelemetryCollector {
  readonly registry: MetricRegistry
  readonly percentiles: ReadonlyArray<{ label: string; value: number }>
  readonly rateWindowSeconds: number
  startFlow(labels: ProxyTelemetryLabels): ProxyFlowHandle
  snapshot(): ProxyGraphSnapshot
  /**
   * Subscribe to incremental telemetry events.
   * Listeners are called synchronously after each state mutation.
   * Returns an unsubscribe function.
   */
  subscribe(listener: ProxyTelemetryListener): () => void
  /**
   * Clear all edges, nodes and reset seq to 0.
   * Emits a single 'reset' event to all subscribers.
   */
  reset(): void
  /**
   * Remove edges whose lastSeenAt is strictly before the given ISO timestamp.
   * Also removes nodes that have no remaining edges.
   * Returns the number of edges removed.
   */
  expireEdgesBefore(iso: string): number
}

export const PROXY_AUTO_METRICS = {
  FLOWS_TOTAL: 'raffel_proxy_edge_flows_total',
  ACTIVE_FLOWS: 'raffel_proxy_edge_active_flows',
  BYTES_FROM_SOURCE: 'raffel_proxy_edge_bytes_from_source_total',
  BYTES_TO_SOURCE: 'raffel_proxy_edge_bytes_to_source_total',
  REQUESTS_TOTAL: 'raffel_proxy_edge_requests_total',
  REQUEST_DURATION: 'raffel_proxy_edge_request_duration_seconds',
  FLOW_DURATION: 'raffel_proxy_edge_flow_duration_seconds',
  FLOW_DURATION_QUANTILE: 'raffel_proxy_edge_flow_duration_quantile_seconds',
  ERRORS_TOTAL: 'raffel_proxy_edge_errors_total',
  FLOW_RATE: 'raffel_proxy_edge_flow_rate_per_second',
  REQUEST_RATE: 'raffel_proxy_edge_request_rate_per_second',
  ERROR_RATE: 'raffel_proxy_edge_error_rate_per_second',
  BYTES_FROM_SOURCE_RATE: 'raffel_proxy_edge_bytes_from_source_rate_per_second',
  BYTES_TO_SOURCE_RATE: 'raffel_proxy_edge_bytes_to_source_rate_per_second',
  FAILURE_RATIO: 'raffel_proxy_edge_failure_ratio',
} as const

export const DEFAULT_PROXY_PERCENTILES = [0.5, 0.9, 0.95] as const
const DEFAULT_PROXY_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60]
const DEFAULT_PROXY_RATE_WINDOW_MS = 60_000
const RATE_BUCKET_MS = 1_000

interface ProxyTelemetryConfig {
  registry?: MetricRegistry
  defaultLabels?: Labels
  percentiles?: number[]
  rateWindowMs?: number
}

interface PercentileDefinition {
  label: string
  value: number
}

interface EdgeDurationState {
  buckets: HistogramBucket[]
  sum: number
  count: number
}

interface EdgeRateBucket {
  bucketStartMs: number
  flows: number
  requests: number
  errors: number
  bytesFromSource: number
  bytesToSource: number
}

interface EdgeRateState {
  buckets: Map<number, EdgeRateBucket>
}

interface EdgeState {
  id: string
  source: string
  target: string
  protocol: ProxyFlowProtocol
  firstSeenAt: string
  activeFlows: number
  flowsTotal: number
  requestsTotal: number
  errorsTotal: number
  bytesFromSource: number
  bytesToSource: number
  duration: EdgeDurationState
  rates: EdgeRateState
  lastSeenAt: string
  statusClassCounts: Record<string, number>
  methodCounts: Record<string, number>
  pathCounts: Map<string, number>
}

interface NodeState {
  id: string
  lastSeenAt: string
}

interface EdgeRateDelta {
  flows?: number
  requests?: number
  errors?: number
  bytesFromSource?: number
  bytesToSource?: number
}

function isErrorStatus(status: string | undefined): boolean {
  if (!status) return false
  const numeric = Number.parseInt(status, 10)
  return Number.isFinite(numeric) ? numeric >= 400 : status !== 'success'
}

function statusClass(status: string | undefined): string {
  if (!status) return 'other'
  const numeric = Number.parseInt(status, 10)
  if (!Number.isFinite(numeric)) return 'other'
  if (numeric >= 500) return '5xx'
  if (numeric >= 400) return '4xx'
  if (numeric >= 300) return '3xx'
  if (numeric >= 200) return '2xx'
  if (numeric >= 100) return '1xx'
  return 'other'
}

function edgeKey(labels: ProxyTelemetryLabels): string {
  return `${labels.source}\u0000${labels.destination}\u0000${labels.protocol}`
}

function percentileLabel(value: number): string {
  const percentage = value * 100
  if (Number.isInteger(percentage)) {
    return `p${percentage}`
  }
  return `p${percentage.toFixed(2).replace(/\.?0+$/, '').replace('.', '_')}`
}

function normalizePercentiles(percentiles?: number[]): PercentileDefinition[] {
  const input = percentiles && percentiles.length > 0
    ? percentiles
    : [...DEFAULT_PROXY_PERCENTILES]

  const values = Array.from(new Set(
    input
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
      .map((value) => Number(value)),
  )).sort((a, b) => a - b)

  const safeValues = values.length > 0 ? values : [...DEFAULT_PROXY_PERCENTILES]
  return safeValues.map((value) => ({
    label: percentileLabel(value),
    value,
  }))
}

function normalizeRateWindowMs(rateWindowMs?: number): number {
  if (!Number.isFinite(rateWindowMs) || rateWindowMs == null || rateWindowMs <= 0) {
    return DEFAULT_PROXY_RATE_WINDOW_MS
  }
  return Math.max(RATE_BUCKET_MS, Math.round(rateWindowMs))
}

function cloneBuckets(buckets: readonly number[]): HistogramBucket[] {
  return buckets.map((le) => ({ le, count: 0 }))
}

function observeDuration(state: EdgeDurationState, value: number): void {
  state.sum += value
  state.count += 1
  for (const bucket of state.buckets) {
    if (value <= bucket.le) {
      bucket.count += 1
    }
  }
}

function estimatePercentile(state: EdgeDurationState, percentile: number): number | null {
  if (state.count === 0) return null

  const target = state.count * percentile
  let previousCount = 0
  let previousLe = 0

  for (const bucket of state.buckets) {
    if (bucket.count >= target) {
      const bucketCount = bucket.count - previousCount
      if (bucketCount <= 0) {
        return bucket.le
      }

      const offset = Math.max(0, target - previousCount)
      const ratio = Math.min(1, offset / bucketCount)
      return previousLe + ((bucket.le - previousLe) * ratio)
    }

    previousCount = bucket.count
    previousLe = bucket.le
  }

  return state.buckets.at(-1)?.le ?? null
}

function summarizeLatency(
  state: EdgeDurationState,
  percentiles: readonly PercentileDefinition[],
): ProxyGraphLatency {
  return {
    averageSeconds: state.count > 0 ? state.sum / state.count : null,
    percentiles: Object.fromEntries(
      percentiles.map((definition) => [
        definition.label,
        estimatePercentile(state, definition.value),
      ]),
    ),
  }
}

function pruneRateBuckets(state: EdgeRateState, nowMs: number, rateWindowMs: number): void {
  const cutoff = nowMs - rateWindowMs
  for (const [bucketStartMs] of state.buckets) {
    if (bucketStartMs < cutoff) {
      state.buckets.delete(bucketStartMs)
    }
  }
}

function ensureRateBucket(state: EdgeRateState, nowMs: number): EdgeRateBucket {
  const bucketStartMs = Math.floor(nowMs / RATE_BUCKET_MS) * RATE_BUCKET_MS
  const existing = state.buckets.get(bucketStartMs)
  if (existing) return existing

  const created: EdgeRateBucket = {
    bucketStartMs,
    flows: 0,
    requests: 0,
    errors: 0,
    bytesFromSource: 0,
    bytesToSource: 0,
  }
  state.buckets.set(bucketStartMs, created)
  return created
}

function recordRateDelta(state: EdgeRateState, nowMs: number, rateWindowMs: number, delta: EdgeRateDelta): void {
  pruneRateBuckets(state, nowMs, rateWindowMs)
  const bucket = ensureRateBucket(state, nowMs)
  bucket.flows += delta.flows ?? 0
  bucket.requests += delta.requests ?? 0
  bucket.errors += delta.errors ?? 0
  bucket.bytesFromSource += delta.bytesFromSource ?? 0
  bucket.bytesToSource += delta.bytesToSource ?? 0
}

function summarizeRates(state: EdgeRateState, nowMs: number, rateWindowMs: number): ProxyGraphRates {
  pruneRateBuckets(state, nowMs, rateWindowMs)

  let flows = 0
  let requests = 0
  let errors = 0
  let bytesFromSource = 0
  let bytesToSource = 0

  for (const bucket of state.buckets.values()) {
    flows += bucket.flows
    requests += bucket.requests
    errors += bucket.errors
    bytesFromSource += bucket.bytesFromSource
    bytesToSource += bucket.bytesToSource
  }

  const windowSeconds = rateWindowMs / 1000
  const denominator = requests > 0 ? requests : flows > 0 ? flows : 0

  return {
    windowSeconds,
    flowsPerSecond: flows / windowSeconds,
    requestsPerSecond: requests / windowSeconds,
    errorsPerSecond: errors / windowSeconds,
    bytesFromSourcePerSecond: bytesFromSource / windowSeconds,
    bytesToSourcePerSecond: bytesToSource / windowSeconds,
    bytesPerSecond: (bytesFromSource + bytesToSource) / windowSeconds,
    failureRatio: denominator > 0 ? errors / denominator : null,
  }
}

function ensureProxyMetricsRegistered(registry: MetricRegistry): void {
  if (!registry.getMetric(PROXY_AUTO_METRICS.FLOWS_TOTAL)) {
    registry.counter(PROXY_AUTO_METRICS.FLOWS_TOTAL, {
      description: 'Completed proxy flows grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol', 'status'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.ACTIVE_FLOWS)) {
    registry.gauge(PROXY_AUTO_METRICS.ACTIVE_FLOWS, {
      description: 'Active proxy flows grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE)) {
    registry.counter(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE, {
      description: 'Bytes proxied from source to destination grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.BYTES_TO_SOURCE)) {
    registry.counter(PROXY_AUTO_METRICS.BYTES_TO_SOURCE, {
      description: 'Bytes proxied from destination back to source grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.REQUESTS_TOTAL)) {
    registry.counter(PROXY_AUTO_METRICS.REQUESTS_TOTAL, {
      description: 'Proxy requests grouped by edge, protocol, method, and status',
      labels: ['source', 'destination', 'protocol', 'method', 'status'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.REQUEST_DURATION)) {
    registry.histogram(PROXY_AUTO_METRICS.REQUEST_DURATION, {
      description: 'Proxy request duration in seconds grouped by edge, protocol, and method',
      labels: ['source', 'destination', 'protocol', 'method'],
      buckets: [...DEFAULT_PROXY_DURATION_BUCKETS],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.FLOW_DURATION)) {
    registry.histogram(PROXY_AUTO_METRICS.FLOW_DURATION, {
      description: 'Proxy flow duration in seconds grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
      buckets: [...DEFAULT_PROXY_DURATION_BUCKETS],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.FLOW_DURATION_QUANTILE)) {
    registry.gauge(PROXY_AUTO_METRICS.FLOW_DURATION_QUANTILE, {
      description: 'Estimated proxy flow duration quantiles grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol', 'quantile'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.ERRORS_TOTAL)) {
    registry.counter(PROXY_AUTO_METRICS.ERRORS_TOTAL, {
      description: 'Proxy edge errors grouped by edge, protocol, and error reason',
      labels: ['source', 'destination', 'protocol', 'error'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.FLOW_RATE)) {
    registry.gauge(PROXY_AUTO_METRICS.FLOW_RATE, {
      description: 'Recent proxy flow rate per second grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.REQUEST_RATE)) {
    registry.gauge(PROXY_AUTO_METRICS.REQUEST_RATE, {
      description: 'Recent proxy request rate per second grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.ERROR_RATE)) {
    registry.gauge(PROXY_AUTO_METRICS.ERROR_RATE, {
      description: 'Recent proxy error rate per second grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE_RATE)) {
    registry.gauge(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE_RATE, {
      description: 'Recent bytes per second flowing from source to destination grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.BYTES_TO_SOURCE_RATE)) {
    registry.gauge(PROXY_AUTO_METRICS.BYTES_TO_SOURCE_RATE, {
      description: 'Recent bytes per second flowing from destination back to source grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }

  if (!registry.getMetric(PROXY_AUTO_METRICS.FAILURE_RATIO)) {
    registry.gauge(PROXY_AUTO_METRICS.FAILURE_RATIO, {
      description: 'Recent proxy failure ratio grouped by edge and protocol',
      labels: ['source', 'destination', 'protocol'],
    })
  }
}

export function createProxyTelemetry(config: ProxyTelemetryConfig = {}): ProxyTelemetryCollector {
  const registry = config.registry ?? createMetricRegistry()
  const currentDefaults = registry.getDefaultLabels()
  if (config.defaultLabels) {
    registry.setDefaultLabels({ ...currentDefaults, ...config.defaultLabels })
  }
  ensureProxyMetricsRegistered(registry)

  const percentiles = normalizePercentiles(config.percentiles)
  const flowDurationBuckets = registry.getMetric(PROXY_AUTO_METRICS.FLOW_DURATION)?.buckets
    ?? [...DEFAULT_PROXY_DURATION_BUCKETS]
  const rateWindowMs = normalizeRateWindowMs(config.rateWindowMs)

  let seq = 0
  const nodes = new Map<string, NodeState>()
  const edges = new Map<string, EdgeState>()
  const listeners = new Set<ProxyTelemetryListener>()

  function emit(event: ProxyTelemetryEvent): void {
    for (const listener of listeners) {
      listener(event)
    }
  }

  function buildEdgeSnapshot(edge: EdgeState, nowMs: number): ProxyGraphEdge {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      protocol: edge.protocol,
      firstSeenAt: edge.firstSeenAt,
      lastSeenAt: edge.lastSeenAt,
      activeFlows: edge.activeFlows,
      flowsTotal: edge.flowsTotal,
      requestsTotal: edge.requestsTotal,
      errorsTotal: edge.errorsTotal,
      bytesFromSource: edge.bytesFromSource,
      bytesToSource: edge.bytesToSource,
      durationCount: edge.duration.count,
      durationSumSeconds: edge.duration.sum,
      latency: summarizeLatency(edge.duration, percentiles),
      rates: summarizeRates(edge.rates, nowMs, rateWindowMs),
      statusClassCounts: { ...edge.statusClassCounts },
      methodCounts: { ...edge.methodCounts },
      topPaths: Array.from(edge.pathCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, count]) => ({ path, count })),
    }
  }

  function ensureNode(id: string, seenAt: string): NodeState {
    const existing = nodes.get(id)
    if (existing) {
      existing.lastSeenAt = seenAt
      return existing
    }

    const created: NodeState = { id, lastSeenAt: seenAt }
    nodes.set(id, created)
    emit({ type: 'node:new', seq, nodeId: id, firstSeenAt: seenAt })
    return created
  }

  function ensureEdge(labels: ProxyTelemetryLabels, seenAt: string): { edge: EdgeState; isNew: boolean } {
    const key = edgeKey(labels)
    const existing = edges.get(key)
    if (existing) {
      existing.lastSeenAt = seenAt
      return { edge: existing, isNew: false }
    }

    const created: EdgeState = {
      id: key,
      source: labels.source,
      target: labels.destination,
      protocol: labels.protocol,
      firstSeenAt: seenAt,
      activeFlows: 0,
      flowsTotal: 0,
      requestsTotal: 0,
      errorsTotal: 0,
      bytesFromSource: 0,
      bytesToSource: 0,
      duration: {
        buckets: cloneBuckets(flowDurationBuckets),
        sum: 0,
        count: 0,
      },
      rates: {
        buckets: new Map<number, EdgeRateBucket>(),
      },
      lastSeenAt: seenAt,
      statusClassCounts: {},
      methodCounts: {},
      pathCounts: new Map(),
    }
    edges.set(key, created)
    return { edge: created, isNew: true }
  }

  function updateRateMetrics(labels: ProxyTelemetryLabels, edge: EdgeState, nowMs: number): void {
    const rates = summarizeRates(edge.rates, nowMs, rateWindowMs)
    registry.set(PROXY_AUTO_METRICS.FLOW_RATE, rates.flowsPerSecond, labels)
    registry.set(PROXY_AUTO_METRICS.REQUEST_RATE, rates.requestsPerSecond, labels)
    registry.set(PROXY_AUTO_METRICS.ERROR_RATE, rates.errorsPerSecond, labels)
    registry.set(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE_RATE, rates.bytesFromSourcePerSecond, labels)
    registry.set(PROXY_AUTO_METRICS.BYTES_TO_SOURCE_RATE, rates.bytesToSourcePerSecond, labels)
    registry.set(PROXY_AUTO_METRICS.FAILURE_RATIO, rates.failureRatio ?? 0, labels)
  }

  return {
    registry,
    percentiles,
    rateWindowSeconds: rateWindowMs / 1000,

    subscribe(listener: ProxyTelemetryListener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    reset(): void {
      nodes.clear()
      edges.clear()
      seq = 0
      emit({ type: 'reset', seq })
    },

    expireEdgesBefore(iso: string): number {
      let removed = 0
      for (const [key, edge] of edges) {
        if (edge.lastSeenAt < iso) {
          edges.delete(key)
          seq++
          emit({
            type: 'edge:expire',
            seq,
            edgeId: edge.id,
            source: edge.source,
            target: edge.target,
            protocol: edge.protocol,
          })
          removed++
        }
      }

      if (removed > 0) {
        const referencedNodes = new Set<string>()
        for (const edge of edges.values()) {
          referencedNodes.add(edge.source)
          referencedNodes.add(edge.target)
        }
        for (const nodeId of nodes.keys()) {
          if (!referencedNodes.has(nodeId)) {
            nodes.delete(nodeId)
          }
        }
      }

      return removed
    },

    startFlow(labels: ProxyTelemetryLabels): ProxyFlowHandle {
      const startedAt = new Date().toISOString()
      const startedAtMs = Date.now()
      ensureNode(labels.source, startedAt)
      ensureNode(labels.destination, startedAt)
      const { edge, isNew } = ensureEdge(labels, startedAt)

      edge.activeFlows++
      edge.flowsTotal++
      seq++
      recordRateDelta(edge.rates, startedAtMs, rateWindowMs, { flows: 1 })
      registry.set(PROXY_AUTO_METRICS.ACTIVE_FLOWS, edge.activeFlows, labels)
      updateRateMetrics(labels, edge, startedAtMs)

      emit({
        type: isNew ? 'edge:new' : 'edge:update',
        seq,
        edge: buildEdgeSnapshot(edge, startedAtMs),
      })

      let finished = false

      return {
        addBytesFromSource(delta: number): void {
          if (finished || delta <= 0) return
          const nowMs = Date.now()
          edge.bytesFromSource += delta
          edge.lastSeenAt = new Date(nowMs).toISOString()
          recordRateDelta(edge.rates, nowMs, rateWindowMs, { bytesFromSource: delta })
          registry.increment(PROXY_AUTO_METRICS.BYTES_FROM_SOURCE, labels, delta)
          updateRateMetrics(labels, edge, nowMs)
        },

        addBytesToSource(delta: number): void {
          if (finished || delta <= 0) return
          const nowMs = Date.now()
          edge.bytesToSource += delta
          edge.lastSeenAt = new Date(nowMs).toISOString()
          recordRateDelta(edge.rates, nowMs, rateWindowMs, { bytesToSource: delta })
          registry.increment(PROXY_AUTO_METRICS.BYTES_TO_SOURCE, labels, delta)
          updateRateMetrics(labels, edge, nowMs)
        },

        finish(input: ProxyFlowFinishInput = {}): void {
          if (finished) return
          finished = true

          const nowMs = Date.now()
          const seenAt = new Date(nowMs).toISOString()
          edge.lastSeenAt = seenAt
          edge.activeFlows = Math.max(0, edge.activeFlows - 1)

          const errorLabel = input.error ?? (isErrorStatus(input.status) ? `status_${input.status}` : undefined)
          const rateDelta: EdgeRateDelta = {}

          if (input.method) {
            const method = input.method.toUpperCase()
            edge.requestsTotal++
            edge.methodCounts[method] = (edge.methodCounts[method] ?? 0) + 1
            rateDelta.requests = 1
          }

          if (input.path) {
            edge.pathCounts.set(input.path, (edge.pathCounts.get(input.path) ?? 0) + 1)
          }

          if (input.status) {
            const cls = statusClass(input.status)
            edge.statusClassCounts[cls] = (edge.statusClassCounts[cls] ?? 0) + 1
          }

          if (errorLabel) {
            edge.errorsTotal++
            rateDelta.errors = 1
            registry.increment(PROXY_AUTO_METRICS.ERRORS_TOTAL, { ...labels, error: errorLabel })
          }

          if (rateDelta.requests || rateDelta.errors) {
            recordRateDelta(edge.rates, nowMs, rateWindowMs, rateDelta)
          }

          if (typeof input.durationSeconds === 'number') {
            observeDuration(edge.duration, input.durationSeconds)
            registry.observe(PROXY_AUTO_METRICS.FLOW_DURATION, input.durationSeconds, labels)

            for (const percentile of percentiles) {
              const estimated = estimatePercentile(edge.duration, percentile.value)
              if (estimated != null) {
                registry.set(PROXY_AUTO_METRICS.FLOW_DURATION_QUANTILE, estimated, {
                  ...labels,
                  quantile: percentile.label,
                })
              }
            }
          }

          registry.set(PROXY_AUTO_METRICS.ACTIVE_FLOWS, edge.activeFlows, labels)
          registry.increment(PROXY_AUTO_METRICS.FLOWS_TOTAL, {
            ...labels,
            status: input.status ?? (errorLabel ? 'error' : 'success'),
          })

          if (input.method) {
            registry.increment(PROXY_AUTO_METRICS.REQUESTS_TOTAL, {
              ...labels,
              method: input.method,
              status: input.status ?? (errorLabel ? 'error' : 'success'),
            })

            if (typeof input.durationSeconds === 'number') {
              registry.observe(PROXY_AUTO_METRICS.REQUEST_DURATION, input.durationSeconds, {
                ...labels,
                method: input.method,
              })
            }
          }

          seq++
          updateRateMetrics(labels, edge, nowMs)

          emit({ type: 'edge:update', seq, edge: buildEdgeSnapshot(edge, nowMs) })
        },
      }
    },

    snapshot(): ProxyGraphSnapshot {
      const inboundCounts = new Map<string, number>()
      const outboundCounts = new Map<string, number>()
      const nodeRequestsOut = new Map<string, number>()
      const nodeRequestsIn = new Map<string, number>()
      const nodeErrorsOut = new Map<string, number>()
      const nodeErrorsIn = new Map<string, number>()
      const nodeBytesOut = new Map<string, number>()
      const nodeBytesIn = new Map<string, number>()
      const nodeActiveFlows = new Map<string, number>()
      const nodeProtocols = new Map<string, Record<string, number>>()
      const nowMs = Date.now()

      for (const edge of edges.values()) {
        outboundCounts.set(edge.source, (outboundCounts.get(edge.source) ?? 0) + 1)
        inboundCounts.set(edge.target, (inboundCounts.get(edge.target) ?? 0) + 1)

        nodeRequestsOut.set(edge.source, (nodeRequestsOut.get(edge.source) ?? 0) + edge.requestsTotal)
        nodeErrorsOut.set(edge.source, (nodeErrorsOut.get(edge.source) ?? 0) + edge.errorsTotal)
        nodeBytesOut.set(edge.source, (nodeBytesOut.get(edge.source) ?? 0) + edge.bytesFromSource)
        nodeActiveFlows.set(edge.source, (nodeActiveFlows.get(edge.source) ?? 0) + edge.activeFlows)

        const srcProtocols = nodeProtocols.get(edge.source) ?? {}
        srcProtocols[edge.protocol] = (srcProtocols[edge.protocol] ?? 0) + edge.flowsTotal
        nodeProtocols.set(edge.source, srcProtocols)

        nodeRequestsIn.set(edge.target, (nodeRequestsIn.get(edge.target) ?? 0) + edge.requestsTotal)
        nodeErrorsIn.set(edge.target, (nodeErrorsIn.get(edge.target) ?? 0) + edge.errorsTotal)
        nodeBytesIn.set(edge.target, (nodeBytesIn.get(edge.target) ?? 0) + edge.bytesFromSource)
      }

      return {
        seq,
        generatedAt: new Date(nowMs).toISOString(),
        windowStart: new Date(nowMs - rateWindowMs).toISOString(),
        windowEnd: new Date(nowMs).toISOString(),
        percentiles: percentiles.map((percentile) => percentile.label),
        rateWindowSeconds: rateWindowMs / 1000,
        nodes: Array.from(nodes.values())
          .map((node) => ({
            id: node.id,
            label: node.id,
            inboundEdges: inboundCounts.get(node.id) ?? 0,
            outboundEdges: outboundCounts.get(node.id) ?? 0,
            lastSeenAt: node.lastSeenAt,
            requestsOut: nodeRequestsOut.get(node.id) ?? 0,
            requestsIn: nodeRequestsIn.get(node.id) ?? 0,
            errorsOut: nodeErrorsOut.get(node.id) ?? 0,
            errorsIn: nodeErrorsIn.get(node.id) ?? 0,
            bytesOut: nodeBytesOut.get(node.id) ?? 0,
            bytesIn: nodeBytesIn.get(node.id) ?? 0,
            activeFlows: nodeActiveFlows.get(node.id) ?? 0,
            protocols: nodeProtocols.get(node.id) ?? {},
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        edges: Array.from(edges.values())
          .map((edge) => buildEdgeSnapshot(edge, nowMs))
          .sort((a, b) =>
            a.source.localeCompare(b.source)
            || a.target.localeCompare(b.target)
            || a.protocol.localeCompare(b.protocol),
          ),
      }
    },
  }
}
