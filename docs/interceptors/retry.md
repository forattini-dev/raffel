# Retry Interceptor

Retry failed requests with configurable backoff, jitter, and predicates.

---

## Basic Usage

```typescript
import { createServer, createRetryInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createRetryInterceptor())
```

---

## Configuration

```typescript
createRetryInterceptor({
  maxAttempts: 5,
  initialDelayMs: 200,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  backoffStrategy: 'exponential', // 'linear' | 'exponential' | 'decorrelated'
  jitter: true,
  retryableCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED'],
  respectRetryAfter: true,
  shouldRetry: (error, attempt) => {
    return error.message.includes('ECONNRESET') && attempt < 3
  },
  onRetry: ({ attempt, delayMs, procedure, error }) => {
    logger.warn({ attempt, delayMs, procedure }, error.message)
  },
})
```

---

## Backoff Strategies

- **linear** - delay grows linearly: 100, 200, 300...
- **exponential** - delay doubles: 100, 200, 400...
- **decorrelated** - randomized jitter (best to avoid thundering herd)

```typescript
createRetryInterceptor({ backoffStrategy: 'decorrelated' })
```

---

## Retry-After Support

When `respectRetryAfter` is enabled (default), Raffel will honor
`Retry-After` hints from errors or upstream services.

```typescript
createRetryInterceptor({ respectRetryAfter: true })
```

---

## Selective Retry

Retry only specific procedures with custom settings:

```typescript
import { createSelectiveRetryInterceptor } from 'raffel'

const retry = createSelectiveRetryInterceptor({
  procedures: ['payments.*', 'search.*'],
  config: { maxAttempts: 4, backoffStrategy: 'decorrelated' },
})

server.use(retry)
```

---

## Default Retryable Codes

By default, retries apply to:

```
UNAVAILABLE
DEADLINE_EXCEEDED
RESOURCE_EXHAUSTED
ABORTED
INTERNAL_ERROR
RATE_LIMITED
```

Override with `retryableCodes` or `shouldRetry` for custom logic.
