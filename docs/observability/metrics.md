# Metrics

Raffel provides a Prometheus-style metrics system for monitoring and observability. Track counters, gauges, and histograms with automatic instrumentation.

## Quick Start

```ts
import { createServer, createMetricRegistry, createMetricsInterceptor } from 'raffel'

const metrics = createMetricRegistry()
const server = createServer({ port: 3000 })

// Auto-instrument all procedures
server.use(createMetricsInterceptor(metrics))

// Expose metrics endpoint
server.procedure('metrics').handler(async () => metrics.export('prometheus'))

await server.start()
```

## Metric Types

### Counter

Monotonically increasing values (e.g., total requests, errors):

```ts
const requestCounter = metrics.counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labels: ['method', 'path', 'status'],
})

// Increment
requestCounter.inc({ method: 'GET', path: '/users', status: '200' })
requestCounter.inc({ method: 'POST', path: '/users', status: '201' }, 1)
```

### Gauge

Values that can go up and down (e.g., active connections, queue size):

```ts
const activeConnections = metrics.gauge({
  name: 'ws_active_connections',
  help: 'Active WebSocket connections',
  labels: ['channel'],
})

// Set, increment, decrement
activeConnections.set({ channel: 'chat' }, 42)
activeConnections.inc({ channel: 'chat' })
activeConnections.dec({ channel: 'chat' })
```

### Histogram

Distribution of values in buckets (e.g., request duration, response size):

```ts
const requestDuration = metrics.histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labels: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10],
})

// Observe values
requestDuration.observe({ method: 'GET', path: '/users' }, 0.042)

// Or use a timer
const timer = requestDuration.startTimer({ method: 'GET', path: '/users' })
// ... do work ...
timer() // Records elapsed time
```

## Auto-Instrumentation

The metrics interceptor automatically tracks:

- `raffel_procedure_calls_total` - Total procedure calls
- `raffel_procedure_duration_seconds` - Procedure duration histogram
- `raffel_procedure_errors_total` - Total errors by type

```ts
server.use(createMetricsInterceptor(metrics, {
  // Customize metric names
  prefix: 'myapp',
  // Exclude procedures
  exclude: ['health.check', 'metrics'],
  // Custom labels
  labels: (ctx) => ({
    tenant: ctx.auth?.claims?.tenantId,
  }),
}))
```

## Process Metrics

Collect Node.js process metrics:

```ts
import { registerProcessMetrics, startProcessMetricsCollection } from 'raffel'

registerProcessMetrics(metrics)

// Start collecting every 5 seconds
startProcessMetricsCollection(metrics, 5000)
```

Metrics collected:
- `process_cpu_user_seconds_total`
- `process_cpu_system_seconds_total`
- `process_resident_memory_bytes`
- `process_heap_bytes`
- `process_open_fds` (Linux)
- `nodejs_eventloop_lag_seconds`
- `nodejs_gc_duration_seconds`

## WebSocket Metrics

Track WebSocket connections and messages:

```ts
import { registerWsMetrics } from 'raffel'

registerWsMetrics(metrics)
// Registers:
// - ws_connections_total
// - ws_disconnections_total
// - ws_messages_received_total
// - ws_messages_sent_total
// - ws_active_connections
```

## Export Formats

### Prometheus

```ts
const output = metrics.export('prometheus')
// # HELP http_requests_total Total HTTP requests
// # TYPE http_requests_total counter
// http_requests_total{method="GET",path="/users",status="200"} 42
```

### JSON

```ts
const output = metrics.export('json')
// {
//   "http_requests_total": {
//     "type": "counter",
//     "help": "Total HTTP requests",
//     "values": [
//       { "labels": {"method":"GET","path":"/users","status":"200"}, "value": 42 }
//     ]
//   }
// }
```

## Best Practices

1. **Use consistent naming**: Follow Prometheus naming conventions (`snake_case`, suffix with unit)
2. **Keep cardinality low**: Avoid labels with high cardinality (e.g., user IDs, request IDs)
3. **Use histograms for latency**: Not averages, which hide distribution
4. **Set appropriate buckets**: Match your SLOs (e.g., p50, p90, p99 targets)

```ts
// Good: Low cardinality
const counter = metrics.counter({
  name: 'api_requests_total',
  labels: ['method', 'endpoint', 'status_class'], // status_class: 2xx, 4xx, 5xx
})

// Bad: High cardinality (will explode memory)
const counter = metrics.counter({
  name: 'api_requests_total',
  labels: ['user_id', 'request_id'], // Don't do this!
})
```

## Integration with Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'raffel-api'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

## API Reference

### createMetricRegistry()

Creates a new metric registry.

### metrics.counter(options)

Creates a counter metric.

| Option | Type | Description |
|:--|:--|:--|
| `name` | `string` | Metric name |
| `help` | `string` | Description |
| `labels` | `string[]` | Label names |

### metrics.gauge(options)

Creates a gauge metric.

| Option | Type | Description |
|:--|:--|:--|
| `name` | `string` | Metric name |
| `help` | `string` | Description |
| `labels` | `string[]` | Label names |

### metrics.histogram(options)

Creates a histogram metric.

| Option | Type | Description |
|:--|:--|:--|
| `name` | `string` | Metric name |
| `help` | `string` | Description |
| `labels` | `string[]` | Label names |
| `buckets` | `number[]` | Bucket boundaries |

### createMetricsInterceptor(registry, options?)

Creates an interceptor for auto-instrumentation.

| Option | Type | Description |
|:--|:--|:--|
| `prefix` | `string` | Metric name prefix |
| `exclude` | `string[]` | Procedures to exclude |
| `labels` | `(ctx) => Record<string, string>` | Custom labels |
