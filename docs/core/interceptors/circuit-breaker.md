# Circuit Breaker

Prevent cascading failures by failing fast when a service is unhealthy.

---

## Basic Usage

```typescript
import { createServer, createCircuitBreakerInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('external.api')
  .use(createCircuitBreakerInterceptor({
    failureThreshold: 5,     // Open after 5 failures
    resetTimeoutMs: 30000,   // Try again after 30s
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

  // Number of successes needed to close in half-open
  successThreshold: 3,

  // Time to wait before testing recovery (ms)
  resetTimeoutMs: 30_000,

  // Window for counting failures (ms)
  windowMs: 60_000,

  // Error codes that count as failures
  failureCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL_ERROR'],

  // Called when state changes
  onStateChange: (state, procedure) => {
    console.log(`Circuit ${procedure} -> ${state}`)
  },
})
```

---

## Per-Procedure Configuration

```typescript
import { createProcedureCircuitBreaker } from 'raffel'

const breaker = createProcedureCircuitBreaker({
  default: { failureThreshold: 5 },
  procedures: {
    'payments.process': { failureThreshold: 3, resetTimeoutMs: 60_000 },
    'emails.send': { failureThreshold: 10 },
  },
})

server.use(breaker)
```

---

## Behavior

When the circuit is open, Raffel throws a `UNAVAILABLE` error with details:

```json
{
  "code": "UNAVAILABLE",
  "message": "Circuit breaker is open",
  "details": {
    "procedure": "external.api",
    "state": "open",
    "failures": 5,
    "resetAfterMs": 12000
  }
}
```
