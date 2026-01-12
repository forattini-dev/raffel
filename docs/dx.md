# Developer Experience (DX)

Raffel provides production-ready utilities for API development and operations:

- **Health Check System**: Kubernetes-style liveness and readiness probes
- **HTTP Request Logging**: Apache/Nginx-style request logging
- **OpenAPI UI**: Interactive API documentation with Swagger UI and ReDoc

## Health Check System

Kubernetes-compatible health endpoints for container orchestration.

### Basic Setup

```ts
import { createServer, createHealthCheckProcedures } from 'raffel'

const server = createServer({ port: 3000 })

// Create health procedures
const health = createHealthCheckProcedures()

// Register with server
server.addProcedure({ name: 'health', handler: health.health.handler })
server.addProcedure({ name: 'health.live', handler: health.live!.handler })
server.addProcedure({ name: 'health.ready', handler: health.ready!.handler })
```

Endpoints:
- `GET /health` - Overall health with all probes
- `GET /health/live` - Liveness probe (is process running?)
- `GET /health/ready` - Readiness probe (can accept traffic?)

### Custom Probes

```ts
const health = createHealthCheckProcedures({
  probes: {
    database: async () => {
      const start = Date.now()
      await db.ping()
      return { status: 'ok', latency: Date.now() - start }
    },

    redis: async () => {
      try {
        await redis.ping()
        return { status: 'ok' }
      } catch (err) {
        return { status: 'error', error: err.message }
      }
    },

    externalApi: async () => {
      const res = await fetch('https://api.example.com/health')
      if (res.ok) return { status: 'ok' }
      if (res.status >= 500) return { status: 'error' }
      return { status: 'degraded' }
    },
  },
})
```

### Probe Status Values

| Status | Description | HTTP Status |
|--------|-------------|-------------|
| `ok` | Healthy | 200 |
| `degraded` | Partially healthy | 200 |
| `error` | Unhealthy | 503 |

### Configuration

```ts
interface HealthCheckConfig {
  basePath?: string                    // Default: '/health'
  timeout?: number                     // Probe timeout (ms), default: 5000
  includeProbeDetails?: boolean        // Include probe results, default: true
  probes?: Record<string, HealthProbe> // Custom probes
  liveness?: boolean | HealthProbeGroupConfig
  readiness?: boolean | HealthProbeGroupConfig
  startTime?: number                   // For uptime calculation
}
```

### Separate Liveness and Readiness

```ts
const health = createHealthCheckProcedures({
  // Liveness: lightweight check (is process alive?)
  liveness: {
    timeout: 1000,
    probes: {}, // No external dependencies
  },

  // Readiness: full check (ready to serve traffic?)
  readiness: {
    timeout: 5000,
    probes: {
      database: async () => {
        await db.ping()
        return { status: 'ok' }
      },
    },
  },
})
```

### Common Probes

Raffel provides helper functions for common probe types:

```ts
import { CommonProbes } from 'raffel'

const health = createHealthCheckProcedures({
  probes: {
    // Ping-based probe
    ...CommonProbes.ping(() => db.ping(), 'database'),

    // HTTP health check
    ...CommonProbes.http('https://api.example.com/health', 'external-api'),

    // Memory usage (degraded if over threshold)
    ...CommonProbes.memory(1024), // 1GB threshold
  },
})
```

### Response Format

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "probes": {
    "database": { "status": "ok", "latency": 5 },
    "redis": { "status": "ok", "latency": 2 },
    "external-api": { "status": "degraded", "latency": 150 }
  }
}
```

### Kubernetes Manifests

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      livenessProbe:
        httpGet:
          path: /health/live
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 10
        timeoutSeconds: 2
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 5
        timeoutSeconds: 5
        failureThreshold: 3
```

## HTTP Request Logging

Industry-standard request logging with Apache/Nginx-style formats.

### Basic Setup

```ts
import { createHttpLoggingMiddleware } from 'raffel'

const logging = createHttpLoggingMiddleware()

// Use with Node.js HTTP server
http.createServer((req, res) => {
  logging(req, res, () => {
    // Handle request
  })
})
```

### Predefined Formats

```ts
// Apache combined (default)
const logging = createHttpLoggingMiddleware({ format: 'combined' })
// Output: 127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /users HTTP/1.1" 200 532 "-" "Mozilla/5.0"

// Apache common
const logging = createHttpLoggingMiddleware({ format: 'common' })
// Output: 127.0.0.1 - - [01/Jan/2024:00:00:00 +0000] "GET /users HTTP/1.1" 200 532

// Development (colored)
const logging = createHttpLoggingMiddleware({ format: 'dev' })
// Output: GET /users 200 15.234 ms - 532

// Tiny
const logging = createHttpLoggingMiddleware({ format: 'tiny' })
// Output: GET /users 200 15.234 ms

// Short
const logging = createHttpLoggingMiddleware({ format: 'short' })
// Output: 127.0.0.1 - GET /users HTTP/1.1 200 532 - 15.234 ms
```

### Custom Format Strings

```ts
const logging = createHttpLoggingMiddleware({
  format: ':method :url :status - :response-time ms',
})
// Output: GET /users 200 - 15.234 ms
```

Available tokens:

| Token | Description |
|-------|-------------|
| `:remote-addr` | Remote IP address |
| `:remote-user` | Authenticated user |
| `:method` | HTTP method |
| `:url` | Request URL |
| `:http-version` | HTTP protocol version |
| `:status` | Response status code |
| `:res[header]` | Response header value |
| `:req[header]` | Request header value |
| `:response-time` | Response time in milliseconds |
| `:response-time[3]` | Response time with 3 decimal places |
| `:date` | Date in CLF format |
| `:date[iso]` | Date in ISO format |
| `:referrer` | Referrer header |
| `:user-agent` | User agent header |
| `:content-length` | Response content length |

### Skip Requests

```ts
const logging = createHttpLoggingMiddleware({
  format: 'combined',
  skip: (req) => {
    // Skip health checks
    return req.url?.startsWith('/health') ?? false
  },
})
```

### Custom Logger

```ts
import pino from 'pino'

const logger = pino()

const logging = createHttpLoggingMiddleware({
  format: 'combined',
  logger: {
    info: (msg) => logger.info(msg),
    error: (msg) => logger.error(msg),
  },
})
```

### Convenience Functions

```ts
import {
  createDevLoggingMiddleware,
  createTinyLoggingMiddleware,
  createProductionHttpLoggingMiddleware,
} from 'raffel'

// Development with colors
const devLogging = createDevLoggingMiddleware()

// Minimal output
const tinyLogging = createTinyLoggingMiddleware()

// Production (skips health checks)
const prodLogging = createProductionHttpLoggingMiddleware()
```

### Configuration

```ts
interface HttpLoggingConfig {
  format?: LogFormat | string    // 'combined' | 'common' | 'dev' | 'tiny' | 'short' | custom
  skip?: (req, res) => boolean   // Skip logging for certain requests
  logger?: {                     // Custom logger
    info: (msg: string) => void
    error?: (msg: string) => void
  }
  immediate?: boolean            // Log on request start (not response end)
  redactHeaders?: string[]       // Headers to redact (default: auth, cookies, api keys)
}
```

## OpenAPI UI

Interactive API documentation with Swagger UI and ReDoc.

### Basic Setup

```ts
import { createServer, createOpenAPIUIMiddleware } from 'raffel'

const server = createServer({ port: 3000 })

// ... register procedures ...

const openapi = createOpenAPIUIMiddleware(server.getRegistry(), server.getSchemaRegistry(), {
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'A sample API',
  },
})

// Use with HTTP server
server.options.middleware = [
  async (req, res) => {
    if (openapi(req, res)) return true
    return false
  },
]
```

Endpoints:
- `GET /docs` - Swagger UI
- `GET /redoc` - ReDoc UI
- `GET /openapi.json` - OpenAPI spec

### Custom Paths

```ts
const handlers = createOpenAPIUIHandlers(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  ui: {
    swagger: '/api-docs',
    redoc: '/documentation',
    spec: '/api/openapi.json',
    specYaml: '/api/openapi.yaml',
  },
})
```

### Swagger UI Only

```ts
import { OpenAPIUI } from 'raffel'

const handlers = OpenAPIUI.swagger(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  path: '/docs',
  swaggerOptions: {
    deepLinking: true,
    displayOperationId: true,
  },
})
```

### ReDoc Only

```ts
const handlers = OpenAPIUI.redoc(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  path: '/redoc',
  redocOptions: {
    hideDownloadButton: true,
    expandResponses: '200,201',
  },
})
```

### Spec Only (No UI)

```ts
const handlers = OpenAPIUI.specOnly(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  specPath: '/openapi.json',
  specYamlPath: '/openapi.yaml',
})
```

### Security Schemes

```ts
const handlers = createOpenAPIUIHandlers(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  generator: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
    security: [{ bearerAuth: [] }],
  },
})
```

### Configuration

```ts
interface OpenAPIUIConfig {
  info: {
    title: string
    version: string
    description?: string
    termsOfService?: string
    contact?: { name?: string; url?: string; email?: string }
    license?: { name: string; url?: string }
  }
  servers?: Array<{ url: string; description?: string }>
  ui?: {
    swagger?: string | SwaggerUIConfig | false
    redoc?: string | ReDocConfig | false
    spec?: string          // Default: '/openapi.json'
    specYaml?: string      // Optional YAML spec path
  }
  generator?: {
    openApiVersion?: '3.0.3' | '3.1.0'
    basePath?: string
    streamPath?: string
    eventPath?: string
    securitySchemes?: Record<string, SecurityScheme>
    security?: SecurityRequirement[]
    groupByNamespace?: boolean
  }
}
```

### Manual Handler Usage

```ts
const handlers = createOpenAPIUIHandlers(registry, schemaRegistry, config)

// Get paths
console.log(handlers.paths)
// { swagger: '/docs', redoc: '/redoc', spec: '/openapi.json' }

// Handle requests manually
if (req.url === handlers.paths.swagger) {
  const { html, contentType } = handlers.handleSwagger!()
  res.setHeader('Content-Type', contentType)
  res.end(html)
}

if (req.url === handlers.paths.spec) {
  const { json, contentType } = handlers.handleSpec()
  res.setHeader('Content-Type', contentType)
  res.end(json)
}

// Get document programmatically
const doc = handlers.getDocument()
```

## Integration Example

Complete server setup with all DX features:

```ts
import {
  createServer,
  createHealthCheckProcedures,
  createProductionHttpLoggingMiddleware,
  createOpenAPIUIMiddleware,
  CommonProbes,
} from 'raffel'
import { db, redis } from './connections'

const server = createServer({ port: 3000 })

// Health checks
const health = createHealthCheckProcedures({
  probes: {
    ...CommonProbes.ping(() => db.ping(), 'database'),
    ...CommonProbes.ping(() => redis.ping(), 'redis'),
    ...CommonProbes.memory(1024),
  },
  liveness: true,
  readiness: true,
})

server.addProcedure({ name: 'health', handler: health.health.handler })
server.addProcedure({ name: 'health.live', handler: health.live!.handler })
server.addProcedure({ name: 'health.ready', handler: health.ready!.handler })

// HTTP logging
const logging = createProductionHttpLoggingMiddleware()

// OpenAPI UI
const openapi = createOpenAPIUIMiddleware(server.getRegistry(), server.getSchemaRegistry(), {
  info: { title: 'My API', version: '1.0.0' },
})

// Combine middleware
server.options.middleware = [
  async (req, res) => {
    // Logging wrapper
    return new Promise((resolve) => {
      logging(req, res, () => resolve(false))
    })
  },
  async (req, res) => {
    // OpenAPI UI
    if (openapi(req, res)) return true
    return false
  },
]

// Your procedures
server
  .procedure('users.list')
  .handler(async () => {
    return db.query('SELECT * FROM users')
  })

await server.start()
```
