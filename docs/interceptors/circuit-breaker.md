# Circuit Breaker

Prevent cascading failures by failing fast when a service is unhealthy.

---

## Overview

The circuit breaker pattern monitors for failures and "trips" when a threshold is exceeded, returning errors immediately without attempting the operation.

**States:**
- **Closed** - Normal operation, requests pass through
- **Open** - Failing fast, returning errors immediately
- **Half-Open** - Testing if service recovered

---

## Basic Usage

```typescript
import { createServer, createCircuitBreakerInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('external.api')
  .use(createCircuitBreakerInterceptor({
    failureThreshold: 5,      // Open after 5 failures
    resetTimeout: 30000,      // Try again after 30s
  }))
  .handler(async (input) => {
    return await externalApi.call(input)
  })
```

---

## Configuration

```typescript
createCircuitBreakerInterceptor({
  // Number of failures before opening circuit
  failureThreshold: 5,

  // Time to wait before testing recovery (ms)
  resetTimeout: 30000,

  // Number of successful requests to close circuit
  successThreshold: 2,

  // Window for counting failures (ms)
  failureWindow: 60000,

  // What counts as a failure
  isFailure: (error) => {
    // Don't count client errors as failures
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return false
    }
    return true
  },

  // Error to return when open
  fallback: (ctx) => {
    return { error: 'Service temporarily unavailable' }
  },

  // Called when state changes
  onStateChange: (from, to, ctx) => {
    console.log(`Circuit ${ctx.procedure}: ${from} -> ${to}`)
  },
})
```

---

## Circuit States

### Closed (Normal)

```
Request → Handler → Response
         ↓ (failure)
    Count failure
         ↓ (threshold reached)
    → Open
```

### Open (Failing Fast)

```
Request → Return fallback immediately
         ↓ (timeout elapsed)
    → Half-Open
```

### Half-Open (Testing)

```
Request → Handler
         ↓ success
    → Closed
         ↓ failure
    → Open
```

---

## Per-Procedure Circuits

Each procedure has its own circuit:

```typescript
// Payment service circuit
server.procedure('payments.process')
  .use(createCircuitBreakerInterceptor({
    failureThreshold: 3,
    resetTimeout: 60000,
  }))
  .handler(async (input) => {
    return await paymentGateway.charge(input)
  })

// Email service circuit (separate)
server.procedure('emails.send')
  .use(createCircuitBreakerInterceptor({
    failureThreshold: 10,
    resetTimeout: 30000,
  }))
  .handler(async (input) => {
    return await emailService.send(input)
  })
```

---

## Shared Circuits

Share a circuit across multiple procedures:

```typescript
const externalServiceCircuit = createCircuitBreakerInterceptor({
  name: 'external-service',
  failureThreshold: 5,
  resetTimeout: 30000,
})

server.procedure('service.methodA')
  .use(externalServiceCircuit)
  .handler(async () => { /* ... */ })

server.procedure('service.methodB')
  .use(externalServiceCircuit)
  .handler(async () => { /* ... */ })
```

---

## Fallback Strategies

### Return Default Value

```typescript
createCircuitBreakerInterceptor({
  fallback: () => ({
    items: [],
    cached: true,
    message: 'Using cached data',
  }),
})
```

### Return Cached Data

```typescript
createCircuitBreakerInterceptor({
  fallback: async (ctx) => {
    const cached = await cache.get(`${ctx.procedure}:${ctx.id}`)
    if (cached) return cached
    throw new Error('Service unavailable')
  },
})
```

### Throw Custom Error

```typescript
createCircuitBreakerInterceptor({
  fallback: (ctx) => {
    throw new ServiceUnavailableError(
      'Payment service is temporarily unavailable',
      { retryAfter: 30 }
    )
  },
})
```

---

## Failure Detection

### Default (All Errors)

```typescript
createCircuitBreakerInterceptor({
  isFailure: () => true,
})
```

### Only Server Errors

```typescript
createCircuitBreakerInterceptor({
  isFailure: (error) => {
    // 5xx = service failure
    // 4xx = client error (don't count)
    return error.statusCode >= 500
  },
})
```

### Specific Error Types

```typescript
createCircuitBreakerInterceptor({
  isFailure: (error) => {
    // Only count timeouts and connection errors
    return (
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET'
    )
  },
})
```

---

## Monitoring

### State Change Events

```typescript
createCircuitBreakerInterceptor({
  onStateChange: (from, to, ctx) => {
    metrics.gauge('circuit_state', to === 'open' ? 1 : 0, {
      procedure: ctx.procedure,
    })

    if (to === 'open') {
      alerting.notify({
        severity: 'warning',
        message: `Circuit opened for ${ctx.procedure}`,
      })
    }
  },
})
```

### Metrics

```typescript
createCircuitBreakerInterceptor({
  onTrip: (ctx, failures) => {
    metrics.increment('circuit_trips', { procedure: ctx.procedure })
  },
  onReset: (ctx) => {
    metrics.increment('circuit_resets', { procedure: ctx.procedure })
  },
  onReject: (ctx) => {
    metrics.increment('circuit_rejections', { procedure: ctx.procedure })
  },
})
```

---

## Error Response

When circuit is open:

```json
{
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "Service temporarily unavailable",
    "retryAfter": 30
  }
}
```

---

## With Other Interceptors

Combine with retry and timeout:

```typescript
import {
  createCircuitBreakerInterceptor,
  createRetryInterceptor,
  createTimeoutInterceptor,
} from 'raffel'

server.procedure('external.call')
  // Timeout first (innermost)
  .use(createTimeoutInterceptor({ timeout: 5000 }))
  // Then retry
  .use(createRetryInterceptor({ maxRetries: 2 }))
  // Circuit breaker last (outermost)
  .use(createCircuitBreakerInterceptor({
    failureThreshold: 5,
    resetTimeout: 30000,
  }))
  .handler(async (input) => {
    return await externalService.call(input)
  })
```

Order matters:
1. Circuit breaker checks if open
2. Retry wraps the timeout
3. Timeout wraps the handler

---

## Advanced Configuration

### Sliding Window

```typescript
createCircuitBreakerInterceptor({
  // Only count failures in last 60 seconds
  failureWindow: 60000,
  failureThreshold: 5,
})
```

### Success Threshold

```typescript
createCircuitBreakerInterceptor({
  // Require 3 successes in half-open to close
  successThreshold: 3,
})
```

### Volume Threshold

```typescript
createCircuitBreakerInterceptor({
  // Only trip if at least 10 requests in window
  volumeThreshold: 10,
  failureThreshold: 5,  // 5 of 10 = 50% failure rate
})
```

---

## Next Steps

- **[Retry](retry.md)** - Automatic retry with backoff
- **[Timeout](timeout.md)** - Request deadlines
- **[Bulkhead](bulkhead.md)** - Limit concurrent requests
- **[Fallback](fallback.md)** - Default responses on failure
