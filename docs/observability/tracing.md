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
