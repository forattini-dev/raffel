# Error Codes

Reference for Raffel error codes and how to use them.

---

## Error Structure

All Raffel errors follow this structure:

```typescript
interface RaffelErrorPayload {
  code: string
  message: string
  details?: unknown
}
```

Example response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "path": ["email"], "message": "Invalid email format" }
    ]
  }
}
```

---

## Client Errors (4xx)

| Code | HTTP Status | Description |
|:-----|:------------|:------------|
| `INVALID_ARGUMENT` | 400 | Invalid argument |
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `INVALID_TYPE` | 400 | Invalid envelope type |
| `INVALID_ENVELOPE` | 400 | Invalid envelope shape |
| `PARSE_ERROR` | 400 | Parse error |
| `UNAUTHENTICATED` | 401 | Authentication required |
| `PERMISSION_DENIED` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `NOT_ACCEPTABLE` | 406 | Not acceptable |
| `ALREADY_EXISTS` | 409 | Resource already exists |
| `FAILED_PRECONDITION` | 412 | Precondition failed |
| `PAYLOAD_TOO_LARGE` | 413 | Payload too large |
| `MESSAGE_TOO_LARGE` | 413 | Message too large |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Unsupported media type |
| `UNPROCESSABLE_ENTITY` | 422 | Business logic validation failed |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `RESOURCE_EXHAUSTED` | 429 | Quota or resource exhausted |
| `CANCELLED` | 499 | Client cancelled request |
| `DEADLINE_EXCEEDED` | 504 | Local deadline exceeded |

---

## Server Errors (5xx)

| Code | HTTP Status | Description |
|:-----|:------------|:------------|
| `INTERNAL_ERROR` | 500 | Unexpected error |
| `UNIMPLEMENTED` | 501 | Not implemented |
| `BAD_GATEWAY` | 502 | Upstream returned invalid response |
| `UNAVAILABLE` | 503 | Service unavailable |
| `GATEWAY_TIMEOUT` | 504 | Upstream timeout |
| `DATA_LOSS` | 500 | Data loss or corruption |
| `STREAM_ERROR` | 500 | Stream error |
| `OUTPUT_VALIDATION_ERROR` | 500 | Output validation failed |
| `UNKNOWN` | 500 | Unknown error |

---

## Throwing Errors

```typescript
import { Errors } from 'raffel'

server.procedure('users.get')
  .handler(async ({ id }) => {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) throw Errors.notFound('User', id)
    return user
  })
```

---

## Custom Error Codes

```typescript
import { RaffelError } from 'raffel'

class InsufficientFundsError extends RaffelError {
  constructor(balance: number, required: number) {
    super('INSUFFICIENT_FUNDS', 'Insufficient account balance', { balance, required }, 400)
  }
}
```

---

## Catching Errors

```typescript
import { RaffelError } from 'raffel'

try {
  await client.call('users.get', { id: '123' })
} catch (err) {
  if (err instanceof RaffelError) {
    console.log(`Error: ${err.code} - ${err.message}`)
  } else {
    throw err
  }
}
```

---

## Related Docs

- **[Logging](logging.md)** - Error logging and debugging
- **[Interceptors](interceptors.md)** - Error handling middleware
