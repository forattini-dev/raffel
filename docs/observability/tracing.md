# Tracing

Raffel provides OpenTelemetry-compatible distributed tracing with W3C Trace Context propagation.

## Quick Start

```ts
import {
  createServer,
  createOtlpHttpExporter,
} from 'raffel'

const server = createServer({ port: 3000 })

server.enableTracing({
  serviceName: 'orders-api',
  sampleRate: 1,
  exporters: [
    createOtlpHttpExporter({
      serviceName: 'orders-api',
      endpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        ?? 'http://localhost:4318/v1/traces',
    }),
  ],
  defaultAttributes: {
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  },
})

await server.start()
```

`enableTracing()` creates one server span per incoming HTTP request and child spans for Raffel procedure execution.

HTTP request spans include stable OpenTelemetry-style attributes:

- `http.request.method`
- `http.route`
- `http.response.status_code`
- `url.path`
- `url.scheme`
- `server.address`
- `server.port`
- `network.peer.address`
- `network.peer.port`

Responses also include `x-trace-id` and `x-span-id` headers for operational lookup.

## Datadog

Use OTLP/HTTP with a Datadog Agent or OpenTelemetry Collector configured to receive traces:

```ts
server.enableTracing({
  serviceName: 'orders-api',
  exporters: [
    createOtlpHttpExporter({
      serviceName: 'orders-api',
      endpoint: 'http://datadog-agent:4318/v1/traces',
    }),
  ],
})
```

Raffel binds `trace_id` and `span_id` to request loggers created inside traced contexts. Datadog recognizes those OpenTelemetry field names for log/trace correlation.

## W3C Trace Context

Incoming `traceparent` and `tracestate` headers are extracted automatically by HTTP tracing and procedure tracing.

```http
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
tracestate: rojo=00f067aa0ba902b7
```

To propagate context manually on outgoing calls:

```ts
const span = server.tracer?.startSpan('inventory.reserve', {
  kind: 'client',
})

const headers = span && server.tracer
  ? server.tracer.injectContext(span.context)
  : {}

const response = await fetch('http://inventory/reserve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...headers,
  },
  body: JSON.stringify({ items }),
})

span?.finish()
```

## HttpApp

Fetch-native `HttpApp` users can opt in with middleware:

```ts
import {
  HttpApp,
  createHttpTracingMiddleware,
} from 'raffel/http'
import { createTracer, createOtlpHttpExporter } from 'raffel'

const tracer = createTracer({
  serviceName: 'edge-api',
  exporters: [
    createOtlpHttpExporter({
      serviceName: 'edge-api',
    }),
  ],
})

const app = new HttpApp()
app.use(createHttpTracingMiddleware(tracer))
app.get('/users/:id', (ctx) => ctx.json({ id: ctx.req.param('id') }))
```

## Manual Spans

```ts
const span = server.tracer?.startSpan('db.query', {
  kind: 'client',
  attributes: {
    'db.system': 'postgres',
    'db.operation': 'SELECT',
    'db.table': 'orders',
  },
})

try {
  const orders = await db.orders.findMany()
  span?.setStatus('ok')
  return orders
} catch (error) {
  if (error instanceof Error) {
    span?.recordError(error)
  }
  throw error
} finally {
  span?.finish()
}
```

## Exporters

```ts
import {
  createConsoleExporter,
  createJaegerExporter,
  createNoopExporter,
  createOtlpHttpExporter,
  createZipkinExporter,
} from 'raffel'
```

- `createOtlpHttpExporter({ serviceName, endpoint })`: OpenTelemetry Collector and Datadog Agent OTLP/HTTP.
- `createConsoleExporter()`: local development.
- `createJaegerExporter({ serviceName, endpoint })`: Jaeger collector.
- `createZipkinExporter({ serviceName, endpoint })`: Zipkin-compatible collectors.
- `createNoopExporter()`: tests or disabled export.

## API Notes

`createTracer()` accepts:

| Option | Description |
|:--|:--|
| `serviceName` | Value for `service.name` on spans |
| `sampleRate` | Probability from `0` to `1` |
| `rateLimit` | Maximum sampled spans per second, `0` disables the limit |
| `exporters` | Array of span exporters |
| `batchSize` | Export batch size |
| `batchTimeout` | Export interval in milliseconds |
| `defaultAttributes` | Attributes added to every span |

`Span` supports `setAttribute`, `setAttributes`, `log`, `setStatus`, `recordError`, `updateName`, and `finish`.

### Span Attributes

Semantic conventions for common operations:

```ts
// HTTP
span.setAttribute('http.request.method', 'GET')
span.setAttribute('url.path', '/users/123')
span.setAttribute('http.response.status_code', 200)

// Database
span.setAttribute('db.system', 'postgres')
span.setAttribute('db.operation', 'SELECT')
span.setAttribute('db.statement', 'SELECT * FROM users WHERE id = $1')

// Messaging
span.setAttribute('messaging.system', 'rabbitmq')
span.setAttribute('messaging.destination', 'orders.created')
span.setAttribute('messaging.operation', 'publish')
```

### Recording Exceptions

```ts
try {
  await riskyOperation()
} catch (error) {
  span.recordError(error)
  span.finish()
  throw error
}
```

## Context Propagation

Context propagation is what turns isolated per-request spans into one
connected trace across services. See
[Distributed tracing across two Raffel apps](#distributed-tracing-across-two-raffel-apps)
below for the full picture — this section covers just the low-level
primitives `extractTraceHeaders`/`injectTraceHeaders` wrap.

### Extract from HTTP Headers

```ts
import { extractTraceHeaders } from 'raffel'

const headers = {
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
}

const { traceparent, tracestate } = extractTraceHeaders(headers)
// Pass to tracer.extractContext({ traceparent, tracestate }) to get a SpanContext
```

### Inject into HTTP Headers

```ts
import { injectTraceHeaders } from 'raffel'

// Merges traceparent/tracestate from the tracer's active span into `headers`
const headers = injectTraceHeaders(tracer, { 'content-type': 'application/json' })
// headers.traceparent = '00-...'
```

In practice, prefer `tracedFetch` (below) over calling `injectTraceHeaders`
by hand — it does the same thing with less boilerplate and a safe no-op
fallback when tracing is disabled.

## Auto-Instrumentation

The tracing interceptor automatically:

- Creates a root span for each procedure call
- Extracts trace context from incoming requests
- Records procedure name, input size, and duration
- Captures errors and sets span status

```ts
server.use(createTracingInterceptor(tracer, {
  // Skip procedures
  exclude: ['health.check'],

  // Custom span naming
  spanName: (procedure) => `rpc.${procedure}`,

  // Add custom attributes
  attributes: (input, ctx) => ({
    'user.id': ctx.auth?.principal,
    'tenant.id': ctx.auth?.claims?.tenantId,
  }),
}))
```

## Integration with Observability Platforms

### Jaeger

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # UI
      - "14268:14268"  # HTTP collector
```

### Grafana Tempo

```ts
const exporter = createZipkinExporter({
  endpoint: 'http://tempo:9411/api/v2/spans',
})
```

### Datadog

```ts
const exporter = createJaegerExporter({
  endpoint: 'http://datadog-agent:8126/v0.4/traces',
})
```

## Best Practices

1. **Sample appropriately**: Use probability or rate-limited sampling in production
2. **Keep spans focused**: One span per logical operation
3. **Use semantic conventions**: Follow OpenTelemetry naming standards
4. **Don't over-instrument**: Focus on boundaries and slow operations
5. **Include useful attributes**: Add context that helps debugging

```ts
// Good: Focused spans with useful context
const span = tracer.startSpan('db.query', {
  attributes: {
    'db.system': 'postgres',
    'db.operation': 'SELECT',
    'db.table': 'users',
  },
})

// Bad: Too granular
const span1 = tracer.startSpan('parse-json')
const span2 = tracer.startSpan('validate-field-name')
const span3 = tracer.startSpan('validate-field-email')
// ... creates noise
```

## API Reference

### createTracer(options)

Creates a new tracer instance.

| Option | Type | Description |
|:--|:--|:--|
| `serviceName` | `string` | Service name for spans |
| `sampler` | `Sampler` | Sampling strategy |
| `exporter` | `SpanExporter` | Export destination |
| `resource` | `Record<string, string>` | Resource attributes |

### tracer.startSpan(name, options?)

Creates a new span.

| Option | Type | Description |
|:--|:--|:--|
| `parent` | `SpanContext` | Parent span context |
| `kind` | `SpanKind` | Span kind |
| `attributes` | `Record<string, unknown>` | Initial attributes |
| `startTime` | `number` | Custom start time |

### span.end(endTime?)

Ends the span and exports it.

### span.setAttribute(key, value)

Sets a single attribute.

### span.setAttributes(attributes)

Sets multiple attributes.

### span.addEvent(name, attributes?)

Adds a timestamped event.

### span.setStatus(status)

Sets the span status.

### span.recordException(error)

Records an exception event.

## Datadog Sidecar Integration

Raffel emits tracing data in a format the Datadog Agent (run as a sidecar that tail-reads JSON logs from stdout) can consume out of the box.

### What the sidecar picks up

Every request log emitted by `createLoggingInterceptor` now includes the following top-level JSON fields when the relevant transport populated `ctx.http`:

| Field | Source | Purpose |
|:--|:--|:--|
| `http.method` | `ctx.http.method` | Datadog auto-creates a facet for grouping |
| `http.route` | `ctx.http.route` (template, e.g. `/users/:id`) | Same — groups endpoints, not raw URLs |
| `http.target` | `ctx.http.path` (raw path) | Filtering; only emitted when it differs from `http.route` |
| `dd.trace_id` | `ctx.tracing.ddTraceId` | Agent log correlation |
| `dd.span_id` | `ctx.tracing.ddSpanId` | Same |
| `dd.service` | `process.env.DD_SERVICE` | Agent log routing |
| `dd.env` | `process.env.DD_ENV` | Same |
| `dd.version` | `process.env.DD_VERSION` | Same |

The legacy `traceId` / `spanId` (hex) and `procedure` fields remain, so any in-house log pipeline that already parses them keeps working unchanged.

### Span naming for Datadog APM

The `createTracingInterceptor` sets the span name to `${http.method} ${http.route}` (e.g. `GET /users/:id`) when the request came in over HTTP, plus the OpenTelemetry HTTP semantic attributes:

- `http.request.method`
- `http.route`
- `url.path`
- `rpc.method` (kept for back-compat with existing dashboards)
- `rpc.system: "raffel"`

Non-HTTP transports (gRPC, JSON-RPC, WS, TCP, UDP) keep the span name as the procedure (e.g. `chat.message`) so they don't collapse into HTTP resource groups.

### Distributed tracing across two Raffel apps

For the sidecar to stitch spans into one trace across services, the W3C `traceparent` header has to flow both ways:

**Inbound (already works).** `extractMetadataFromHeaders` (in `src/utils/header-metadata.ts`) already includes `traceparent` and `tracestate` in the request metadata. `createTracingInterceptor` reads it and uses the upstream span as parent.

**Outbound (use `tracedFetch`).** Raffel has no built-in HTTP client, so callers usually use the global `fetch`. Replace it with `tracedFetch(tracer, ...)` to inject `traceparent` automatically:

```ts
import { createServer, tracedFetch } from 'raffel'

server.procedure('orders.create').handler(async (input, ctx) => {
  // No manual header wiring — `traceparent` is set from the current span
  const res = await tracedFetch(ctx.services.tracer, 'http://billing-svc.internal/payments.charge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: input.orderId }),
  })
  return res.json()
})
```

If there's no active span (tracing disabled, or this is a background task), `tracedFetch` falls back to plain `fetch` — wiring it unconditionally is safe.

### Required environment variables for the sidecar

The Datadog Agent needs `DD_SERVICE`, `DD_ENV`, and `DD_VERSION` to know where to route logs and spans. Set these in the same environment as the Raffel process — the logging interceptor reads them straight from `process.env`:

```bash
DD_SERVICE=checkout-svc \
DD_ENV=prod \
DD_VERSION=1.4.2 \
node dist/server.js
```

Both the host process and the sidecar should agree on these (the sidecar reads them from its own env in any case). The 128-bit `dd.trace_id` produced by Raffel is accepted by Datadog Agent ≥7.34.

## Backend-Agnostic Correlation Profiles

Datadog is just one backend. The `createLoggingInterceptor` accepts a `correlationProfile` option that switches the extra JSON fields it emits to match whichever observability stack is reading the logs:

```ts
import { createLoggingInterceptor } from 'raffel'

createLoggingInterceptor({
  format: 'json',
  correlationProfile: 'datadog',    // or 'otel' | 'honeycomb' | 'none'
})
```

| Profile    | When to use | Extra fields beyond raffel hex `traceId`/`spanId` |
|:--|:--|:--|
| `datadog`  | Datadog Agent sidecar tailing stdout JSON | `dd.trace_id` (decimal), `dd.span_id` (decimal), `dd.service`, `dd.env`, `dd.version` |
| `otel`     | Any OTel-compatible backend (Honeycomb, Tempo, Lightstep, New Relic, Dynatrace, Grafana Loki via OTel collector) | `trace_id`, `span_id` (snake_case hex), `parent_span_id`, `service.name`, `service.version`, `deployment.environment.name` |
| `honeycomb`| Honeycomb (or anything expecting dotted nested namespacing) | `trace.trace_id`, `trace.span_id`, `trace.parent_id`, `service.name` |
| `none`     | Operator opt-out — only raffel hex camelCase survives | (nothing extra) |

### Auto-detection

When `correlationProfile` is left `undefined`, the interceptor picks based on environment:

1. Any `DD_*` env var set (`DD_SERVICE`, `DD_ENV`, `DD_VERSION`, `DD_AGENT_HOST`) → `datadog`
2. Otherwise → `otel`

To pin a profile regardless of environment, pass it explicitly:

```ts
// Always OTel-shaped fields, even if DD_SERVICE leaks in from somewhere
createLoggingInterceptor({ correlationProfile: 'otel' })
```

### Resource / service identity env vars

Different backends read different env vars. The OTel profile reads the standard OTel SDK ones first and falls back to Datadog's so a single host can ship to multiple backends without double-configuring:

| Field emitted by `otel` profile | Env vars read (in order) |
|:--|:--|
| `service.name` | `OTEL_SERVICE_NAME` → `DD_SERVICE` |
| `service.version` | `OTEL_SERVICE_VERSION` → `DD_VERSION` |
| `deployment.environment.name` | `OTEL_DEPLOYMENT_ENVIRONMENT` → `DD_ENV` |

The Honeycomb profile adds `HONEYCOMB_SERVICE` as an extra fallback before `DD_SERVICE`. The Datadog profile reads only `DD_*` (matching the Datadog Agent's own conventions).

### The span side is already portable

Spans emitted by Raffel carry the OpenTelemetry HTTP semantic attributes (`http.request.method`, `http.route`, `url.path`, plus the legacy `rpc.method` / `rpc.system`). Any OTel-compatible APM (Datadog, Honeycomb, Tempo, Lightstep, Dynatrace, New Relic, AWS X-Ray via OTel, GCP Cloud Trace, etc.) groups by these without further configuration. The only backend-specific piece is the **log** ↔ trace correlation, which is what `correlationProfile` solves.
