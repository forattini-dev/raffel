# Fallback Interceptor

Provide graceful degradation by returning a fallback response when errors occur.

---

## Basic Usage

```typescript
import { createServer, createFallbackInterceptor } from 'raffel'

const server = createServer({ port: 3000 })

server.use(createFallbackInterceptor({
  response: { status: 'unavailable', cached: true },
}))
```

---

## Dynamic Fallback

```typescript
createFallbackInterceptor({
  handler: async (ctx, error) => {
    const cached = await cache.get(ctx.requestId)
    return cached ?? { status: 'degraded', reason: error.message }
  },
})
```

---

## Conditional Fallback

```typescript
createFallbackInterceptor({
  response: { status: 'degraded' },
  when: (error) => error.message.includes('UNAVAILABLE'),
})
```

---

## Per-Procedure Fallbacks

```typescript
import { createProcedureFallback } from 'raffel'

const fallback = createProcedureFallback({
  default: { response: { status: 'degraded' } },
  procedures: {
    'users.get': { response: { id: 'guest', name: 'Guest' } },
    'config.get': { handler: async () => ({ featureFlags: [] }) },
  },
})

server.use(fallback)
```

---

## Circuit-Aware Fallback

```typescript
import { createCircuitAwareFallback } from 'raffel'

server.use(createCircuitAwareFallback({
  response: { status: 'cached' },
  errorCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED'],
}))
```
