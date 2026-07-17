/**
 * Log ↔ trace correlation profiles.
 *
 * Different observability backends expect different JSON field names for
 * trace IDs, span IDs, service identity, and environment. Raffel picks the
 * right set automatically, but operators can pin a profile explicitly via
 * `createLoggingInterceptor({ correlationProfile: 'honeycomb' })`.
 *
 * The four profiles:
 *
 * | Profile    | When to use                                | Field shapes (besides raffel hex traceId/spanId) |
 * |------------|--------------------------------------------|--------------------------------------------------|
 * | `datadog`  | Datadog Agent sidecar tailing stdout JSON  | `dd.trace_id`, `dd.span_id` (decimal), `dd.service`, `dd.env`, `dd.version` |
 * | `otel`     | Any OTel-compatible backend (Honeycomb,    | `trace_id`, `span_id` (snake_case hex),          |
 * |            | Tempo, Lightstep, New Relic, Dynatrace)    | `service.name`, `service.version`,               |
 * |            |                                            | `deployment.environment.name` (per OTel semconv) |
 * | `honeycomb`| Honeycomb (or anything expecting            | `trace.trace_id`, `trace.span_id` (hex),         |
 * |            | dotted nested namespacing)                 | `service.name`                                   |
 * | `none`     | Operator opt-out; only hex camelCase       | (nothing extra)                                  |
 *
 * **Default auto-detection:** if `DD_SERVICE` (or any `DD_*`) is set, the
 * profile resolves to `datadog` (Datadog Agent sidecar). Otherwise `otel`.
 * Explicit `correlationProfile` in the config always wins over detection.
 *
 * **Always emitted, regardless of profile:**
 *   - `traceId` / `spanId` / `parentSpanId` — raffel legacy hex (camelCase)
 *
 * This keeps every existing log pipeline that already parses those keys
 * working unchanged; the profile-specific fields are purely additive.
 */

import type { TracingContext } from '../types/context.js'

export type CorrelationProfile = 'datadog' | 'otel' | 'honeycomb' | 'none'

/**
 * Resolve the effective correlation profile.
 *
 * Precedence:
 *   1. Explicit `config` argument (when caller passed one).
 *   2. Auto-detect: any `DD_*` env var set → `datadog`; else → `otel`.
 *
 * The auto-detection only fires when `config` is `undefined`. Passing
 * `null` is treated like `'none'` (explicit opt-out).
 */
export function resolveCorrelationProfile(
  config: CorrelationProfile | null | undefined
): CorrelationProfile {
  if (config !== undefined && config !== null) return config
  if (config === null) return 'none'

  // Auto-detect: any of the well-known Datadog sidecar env vars means the
  // host is running with the Datadog Agent.
  if (
    process.env.DD_SERVICE ||
    process.env.DD_ENV ||
    process.env.DD_VERSION ||
    process.env.DD_AGENT_HOST
  ) {
    return 'datadog'
  }
  return 'otel'
}

/**
 * Emit the profile-specific correlation fields onto the log entry.
 *
 * Mutates `logData` in place. Each profile contributes the subset of
 * fields it can fill from available data (env vars + the tracing context
 * the tracing interceptor stashed on `ctx.tracing`).
 */
export function applyCorrelationFields(
  logData: Record<string, unknown>,
  profile: CorrelationProfile,
  tracing: TracingContext | undefined
): void {
  switch (profile) {
    case 'datadog':
      emitDatadogFields(logData, tracing)
      return
    case 'otel':
      emitOtelFields(logData, tracing)
      return
    case 'honeycomb':
      emitHoneycombFields(logData, tracing)
      return
    case 'none':
      // Operator opted out of profile-specific fields. Raffel's hex
      // camelCase `traceId` / `spanId` are still emitted by the caller —
      // see `createLoggingInterceptor`.
      return
  }
}

// ─── profile implementations ──────────────────────────────────────────────

function emitDatadogFields(
  logData: Record<string, unknown>,
  tracing: TracingContext | undefined
): void {
  // The Datadog Agent log correlator specifically requires `dd.trace_id`
  // and `dd.span_id` to be **decimal** (BigInt) forms of the hex IDs, and
  // it wants `dd.service` / `dd.env` / `dd.version` so it can route the log
  // to the right service / env. We populate from env vars, with the same
  // names the Datadog Agent itself reads when run as a sidecar — single
  // source of truth between host process and sidecar.
  if (tracing?.ddTraceId) {
    logData['dd.trace_id'] = tracing.ddTraceId
  }
  if (tracing?.ddSpanId) {
    logData['dd.span_id'] = tracing.ddSpanId
  }

  const ddService = process.env.DD_SERVICE
  const ddEnv = process.env.DD_ENV
  const ddVersion = process.env.DD_VERSION
  if (ddService) logData['dd.service'] = ddService
  if (ddEnv) logData['dd.env'] = ddEnv
  if (ddVersion) logData['dd.version'] = ddVersion
}

function emitOtelFields(
  logData: Record<string, unknown>,
  tracing: TracingContext | undefined
): void {
  // OpenTelemetry log data model uses snake_case `trace_id` / `span_id`
  // (and, per the v1.5 spec, also `trace_id` flat). Backends that
  // understand OTel logs (Grafana Loki with the OTel collector, New
  // Relic via OTel exporter, Honeycomb via field-mapping, Dynatrace) can
  // pick these up without configuration.
  //
  // We emit BOTH the OTel-canonical names (so modern pipelines work) AND
  // keep the raffel hex camelCase from the caller — they're cheap and
  // any pipeline already parsing `traceId` keeps working.
  if (tracing) {
    if (tracing.traceId) logData['trace_id'] = tracing.traceId
    if (tracing.spanId) logData['span_id'] = tracing.spanId
    if (tracing.parentSpanId) logData['parent_span_id'] = tracing.parentSpanId
  }

  // OTel resource semantic conventions for service identity. Read from
  // the standard OTel SDK env vars, not the Datadog ones, so a generic
  // OTel pipeline picks them up. We accept `DD_*` as a fallback when the
  // host is already exporting Datadog env vars but using a non-Datadog
  // collector — saves operators from maintaining two parallel sets.
  const serviceName =
    process.env.OTEL_SERVICE_NAME ?? process.env.DD_SERVICE
  const serviceVersion =
    process.env.OTEL_SERVICE_VERSION ?? process.env.DD_VERSION
  const deploymentEnv =
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT ?? process.env.DD_ENV

  if (serviceName) logData['service.name'] = serviceName
  if (serviceVersion) logData['service.version'] = serviceVersion
  if (deploymentEnv) {
    // Per semconv `deployment.environment.name` (newer) — we fall back to
    // the older `deployment.environment` only when no operator is on a
    // recent enough SDK to read the new key.
    logData['deployment.environment.name'] = deploymentEnv
  }
}

function emitHoneycombFields(
  logData: Record<string, unknown>,
  tracing: TracingContext | undefined
): void {
  // Honeycomb's UI groups by top-level keys, and operators routinely set
  // up derived columns from `trace.trace_id` / `trace.span_id`. The hex
  // IDs go straight into those columns.
  if (tracing?.traceId) {
    logData['trace.trace_id'] = tracing.traceId
  }
  if (tracing?.spanId) {
    logData['trace.span_id'] = tracing.spanId
  }
  if (tracing?.parentSpanId) {
    logData['trace.parent_id'] = tracing.parentSpanId
  }

  // Honeycomb also recognises `service.name` — same shape OTel uses —
  // so emitting it here keeps parity with the otel profile for any
  // downstream tooling.
  const serviceName =
    process.env.OTEL_SERVICE_NAME ?? process.env.DD_SERVICE ?? process.env.HONEYCOMB_SERVICE
  if (serviceName) logData['service.name'] = serviceName
}
