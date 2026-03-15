# Tracing

Raffel provides OpenTelemetry-compatible distributed tracing with W3C Trace Context support. Track requests across services, identify bottlenecks, and debug issues.

## Quick Start

```ts
import {
  createServer,
  createTracer,
  createTracingInterceptor,
  createConsoleExporter,
} from 'raffel'

const tracer = createTracer({
  serviceName: 'my-api',
  exporter: createConsoleExporter(),
})

const server = createServer({ port: 3000 })

// Auto-trace all procedures
server.use(createTracingInterceptor(tracer))

await server.start()
```

## Concepts

### Traces and Spans

- **Trace**: A complete request flow across services
- **Span**: A single unit of work within a trace
- **Context**: Propagated data (trace ID, span ID, flags)

```
Trace: user.create
├── Span: validate-input (2ms)
├── Span: db.query (15ms)
│   └── Span: postgres.connect (3ms)
└── Span: send-email (50ms)
```

### W3C Trace Context

Raffel supports W3C Trace Context headers for cross-service propagation:

```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
tracestate: rojo=00f067aa0ba902b7
```

## Configuration

```ts
const tracer = createTracer({
  // Required
  serviceName: 'my-api',

  // Sampling (default: always on)
  sampler: createProbabilitySampler(0.1),

  // Export destination (default: noop)
  exporter: createJaegerExporter({
    endpoint: 'http://jaeger:14268/api/traces',
  }),

  // Resource attributes
  resource: {
    'service.version': '1.0.0',
    'deployment.environment': 'production',
  },
})
```

## Samplers

Control which traces are recorded to reduce overhead:

### Always On/Off

```ts
import { createAlwaysOnSampler, createAlwaysOffSampler } from 'raffel'

const sampler = createAlwaysOnSampler()  // Sample everything
const sampler = createAlwaysOffSampler() // Sample nothing
```

### Probability-Based

```ts
import { createProbabilitySampler } from 'raffel'

// Sample 10% of traces
const sampler = createProbabilitySampler(0.1)
```

### Rate-Limited

```ts
import { createRateLimitedSampler } from 'raffel'

// Max 100 traces per second
const sampler = createRateLimitedSampler(100)
```

### Parent-Based

```ts
import { createParentBasedSampler, createProbabilitySampler } from 'raffel'

// If parent is sampled, sample child; otherwise use fallback
const sampler = createParentBasedSampler({
  root: createProbabilitySampler(0.1),
})
```

### Composite

```ts
import { createCompositeSampler } from 'raffel'

// Chain multiple samplers
const sampler = createCompositeSampler([
  createRateLimitedSampler(100),
  createProbabilitySampler(0.5),
])
```

## Exporters

### Console (Development)

```ts
import { createConsoleExporter } from 'raffel'

const exporter = createConsoleExporter({
  pretty: true, // Format output
})
```

### Jaeger

```ts
import { createJaegerExporter } from 'raffel'

const exporter = createJaegerExporter({
  endpoint: 'http://jaeger:14268/api/traces',
  // Optional
  username: 'user',
  password: 'pass',
  headers: { 'X-Custom': 'value' },
})
```

### Zipkin

```ts
import { createZipkinExporter } from 'raffel'

const exporter = createZipkinExporter({
  endpoint: 'http://zipkin:9411/api/v2/spans',
})
```

### No-Op

```ts
import { createNoopExporter } from 'raffel'

const exporter = createNoopExporter() // Discards all spans
```

## Manual Instrumentation

### Creating Spans

```ts
server
  .procedure('users.create')
  .handler(async (input, ctx) => {
    // Create a child span
    const span = tracer.startSpan('validate-email', {
      parent: ctx.tracing?.spanContext,
      kind: 'internal',
      attributes: {
        'input.email': input.email,
      },
    })

    try {
      await validateEmail(input.email)
      span.addEvent('validation-passed')
      span.end()
    } catch (error) {
      span.setStatus({ code: 'ERROR', message: error.message })
      span.recordException(error)
      span.end()
      throw error
    }

    // Create another span for database
    const dbSpan = tracer.startSpan('db.insert', {
      parent: ctx.tracing?.spanContext,
      kind: 'client',
      attributes: {
        'db.system': 'postgres',
        'db.operation': 'INSERT',
        'db.table': 'users',
      },
    })

    const user = await db.users.create({ data: input })
    dbSpan.end()

    return user
  })
```

### Span Kinds

| Kind | Description |
|:--|:--|
| `internal` | Internal operation (default) |
| `server` | Server handling a request |
| `client` | Client making a request |
| `producer` | Message producer |
| `consumer` | Message consumer |

### Span Attributes

Semantic conventions for common operations:

```ts
// HTTP
span.setAttribute('http.method', 'GET')
span.setAttribute('http.url', 'https://api.example.com/users')
span.setAttribute('http.status_code', 200)

// Database
span.setAttribute('db.system', 'postgres')
span.setAttribute('db.operation', 'SELECT')
span.setAttribute('db.statement', 'SELECT * FROM users WHERE id = $1')

// Messaging
span.setAttribute('messaging.system', 'rabbitmq')
span.setAttribute('messaging.destination', 'orders.created')
span.setAttribute('messaging.operation', 'publish')
```

### Adding Events

```ts
span.addEvent('cache-miss', { key: 'user:123' })
span.addEvent('retry-attempt', { attempt: 2, delay: 1000 })
```

### Recording Exceptions

```ts
try {
  await riskyOperation()
} catch (error) {
  span.recordException(error)
  span.setStatus({ code: 'ERROR', message: error.message })
  throw error
}
```

## Context Propagation

### Extract from HTTP Headers

```ts
import { extractTraceHeaders } from 'raffel'

const headers = {
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
}

const context = extractTraceHeaders(headers)
// { traceId, spanId, traceFlags, traceState }
```

### Inject into HTTP Headers

```ts
import { injectTraceHeaders } from 'raffel'

const headers = {}
injectTraceHeaders(spanContext, headers)
// headers.traceparent = '00-...'
```

### Cross-Service Example

```ts
// Service A
server
  .procedure('orders.create')
  .handler(async (input, ctx) => {
    const span = tracer.startSpan('call-inventory-service', {
      parent: ctx.tracing?.spanContext,
      kind: 'client',
    })

    const headers = {}
    injectTraceHeaders(span.spanContext(), headers)

    const response = await fetch('http://inventory/reserve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers, // Include trace headers
      },
      body: JSON.stringify({ items: input.items }),
    })

    span.end()
    return response.json()
  })
```

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
