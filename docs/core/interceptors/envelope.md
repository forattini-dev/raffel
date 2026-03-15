# Response Envelope Interceptor

Standardize responses with a consistent success/error envelope across protocols.

---

## Basic Usage

```typescript
import { createServer, createEnvelopeInterceptor } from 'raffel'

const server = createServer({ port: 3000 })
server.use(createEnvelopeInterceptor())
```

---

## Response Format

```json
// Success
{
  "success": true,
  "data": { "id": "123" },
  "meta": { "timestamp": "2024-01-01T00:00:00.000Z", "requestId": "req_1", "duration": 12 }
}

// Error
{
  "success": false,
  "error": { "message": "User not found", "code": "NOT_FOUND" },
  "meta": { "timestamp": "2024-01-01T00:00:00.000Z", "requestId": "req_1", "duration": 12 }
}
```

---

## Configuration

```typescript
createEnvelopeInterceptor({
  includeRequestId: true,
  includeDuration: true,
  includeTimestamp: true,
  includeErrorDetails: true,
  includeErrorStack: process.env.NODE_ENV === 'development',
  errorCodeMapper: (error) => error.code ?? 'INTERNAL_ERROR',
})
```

---

## Presets

```typescript
import {
  createEnvelopeInterceptor,
  EnvelopePresets,
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
  createDetailedEnvelopeInterceptor,
} from 'raffel'

server.use(createEnvelopeInterceptor(EnvelopePresets.minimal))
server.use(createStandardEnvelopeInterceptor())
```

---

## Type Guards

```typescript
import { isEnvelopeResponse, isEnvelopeSuccess } from 'raffel'

const result = await server.call(...)
if (isEnvelopeResponse(result) && isEnvelopeSuccess(result)) {
  console.log(result.data)
}
```
