# HTTP Health Checks

Kubernetes-style health endpoints for HTTP servers.

---

## Basic Usage

```typescript
import { healthCheck, livenessCheck, readinessCheck } from 'raffel/http'

app.get('/health', healthCheck())
app.get('/health/live', livenessCheck())
app.get('/health/ready', readinessCheck())
```

---

## Combined Middleware

```typescript
import { createHealthMiddleware } from 'raffel/http'

app.use('*', createHealthMiddleware({
  basePath: '/health',
  checks: {
    database: async () => {
      await db.ping()
      return { status: 'ok', latency: 5 }
    },
    redis: async () => {
      await redis.ping()
      return { status: 'ok' }
    },
  },
}))
```

---

## Status Semantics

- `ok` - healthy (HTTP 200)
- `degraded` - partially healthy (HTTP 200)
- `unhealthy` - not ready (HTTP 503)
