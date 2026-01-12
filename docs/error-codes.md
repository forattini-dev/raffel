# Error Codes

Reference for all Raffel error codes.

---

## Error Structure

All Raffel errors follow this structure:

```typescript
interface RaffelError {
  code: string          // Machine-readable code
  message: string       // Human-readable message
  details?: unknown     // Additional context
  statusCode?: number   // HTTP status code
}
```

Response format:

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

### VALIDATION_ERROR

**HTTP Status:** 400 Bad Request

Input validation failed.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "path": ["email"], "message": "Invalid email" },
      { "path": ["age"], "message": "Must be a positive number" }
    ]
  }
}
```

**Fix:** Check input against the procedure's schema.

---

### BAD_REQUEST

**HTTP Status:** 400 Bad Request

Generic client error.

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid request format"
  }
}
```

**Fix:** Check request format and content type.

---

### UNAUTHORIZED

**HTTP Status:** 401 Unauthorized

Authentication required but not provided or invalid.

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

**Fix:** Provide valid authentication credentials.

---

### FORBIDDEN

**HTTP Status:** 403 Forbidden

Authenticated but not authorized for this action.

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

**Fix:** Check user roles/permissions.

---

### NOT_FOUND

**HTTP Status:** 404 Not Found

Resource or procedure not found.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found"
  }
}
```

**Fix:** Verify the resource ID or procedure name.

---

### CONFLICT

**HTTP Status:** 409 Conflict

Resource state conflict (e.g., duplicate).

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Email already exists"
  }
}
```

**Fix:** Use a different value or update instead of create.

---

### RATE_LIMITED

**HTTP Status:** 429 Too Many Requests

Rate limit exceeded.

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "retryAfter": 45
  }
}
```

**Fix:** Wait `retryAfter` seconds before retrying.

---

## Server Errors (5xx)

### INTERNAL_ERROR

**HTTP Status:** 500 Internal Server Error

Unexpected server error.

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  }
}
```

**Fix:** Check server logs for details.

---

### TIMEOUT

**HTTP Status:** 408/504

Request or operation timed out.

```json
{
  "error": {
    "code": "TIMEOUT",
    "message": "Request timed out after 30000ms"
  }
}
```

**Fix:** Retry with a simpler request or contact support.

---

### CIRCUIT_OPEN

**HTTP Status:** 503 Service Unavailable

Circuit breaker is open.

```json
{
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "Service temporarily unavailable",
    "retryAfter": 30
  }
}
```

**Fix:** Wait for the service to recover.

---

### SERVICE_UNAVAILABLE

**HTTP Status:** 503 Service Unavailable

Dependent service unavailable.

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Payment service unavailable"
  }
}
```

**Fix:** Retry later.

---

## Protocol Errors

### PROTOCOL_ERROR

Invalid protocol-specific request.

```json
{
  "error": {
    "code": "PROTOCOL_ERROR",
    "message": "Invalid JSON-RPC request: missing 'method' field"
  }
}
```

---

### PROCEDURE_NOT_FOUND

**HTTP Status:** 404

Procedure doesn't exist.

```json
{
  "error": {
    "code": "PROCEDURE_NOT_FOUND",
    "message": "Procedure 'users.foo' not found"
  }
}
```

---

### STREAM_ERROR

Streaming operation failed.

```json
{
  "error": {
    "code": "STREAM_ERROR",
    "message": "Stream terminated unexpectedly"
  }
}
```

---

## Authentication Errors

### TOKEN_EXPIRED

**HTTP Status:** 401

JWT or session token expired.

```json
{
  "error": {
    "code": "TOKEN_EXPIRED",
    "message": "Token has expired",
    "expiredAt": "2024-01-01T00:00:00Z"
  }
}
```

**Fix:** Refresh the token.

---

### TOKEN_INVALID

**HTTP Status:** 401

Token signature or format invalid.

```json
{
  "error": {
    "code": "TOKEN_INVALID",
    "message": "Invalid token signature"
  }
}
```

**Fix:** Re-authenticate to get a new token.

---

### SESSION_NOT_FOUND

**HTTP Status:** 401

Session doesn't exist or was deleted.

```json
{
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session not found or expired"
  }
}
```

**Fix:** Log in again.

---

## Using Errors in Code

### Throwing Errors

```typescript
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from 'raffel'

server.procedure('users.get')
  .handler(async ({ id }) => {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) {
      throw new NotFoundError('User not found')
    }
    return user
  })

server.procedure('users.create')
  .handler(async (input) => {
    const exists = await db.users.findUnique({ where: { email: input.email } })
    if (exists) {
      throw new ConflictError('Email already exists')
    }
    return db.users.create({ data: input })
  })
```

### Custom Error Codes

```typescript
import { RaffelError } from 'raffel'

class InsufficientFundsError extends RaffelError {
  constructor(balance: number, required: number) {
    super({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient account balance',
      statusCode: 400,
      details: { balance, required },
    })
  }
}

server.procedure('payments.process')
  .handler(async ({ amount }) => {
    const balance = await getBalance()
    if (balance < amount) {
      throw new InsufficientFundsError(balance, amount)
    }
    // Process payment
  })
```

### Catching Errors

```typescript
import { RaffelError, NotFoundError } from 'raffel'

try {
  await client.call('users.get', { id: '123' })
} catch (err) {
  if (err instanceof NotFoundError) {
    console.log('User not found')
  } else if (err instanceof RaffelError) {
    console.log(`Error: ${err.code} - ${err.message}`)
  } else {
    throw err
  }
}
```

---

## Error Code Reference Table

| Code | HTTP Status | Description |
|:-----|:------------|:------------|
| `VALIDATION_ERROR` | 400 | Input validation failed |
| `BAD_REQUEST` | 400 | Invalid request |
| `UNAUTHORIZED` | 401 | Authentication required |
| `TOKEN_EXPIRED` | 401 | Token has expired |
| `TOKEN_INVALID` | 401 | Invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `PROCEDURE_NOT_FOUND` | 404 | Procedure doesn't exist |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected error |
| `TIMEOUT` | 504 | Request timed out |
| `CIRCUIT_OPEN` | 503 | Circuit breaker open |
| `SERVICE_UNAVAILABLE` | 503 | Service unavailable |

---

## Next Steps

- **[Logging](logging.md)** — Error logging and debugging
- **[Interceptors](interceptors.md)** — Error handling middleware
