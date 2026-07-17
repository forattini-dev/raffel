# Error Handling

A practical guide to throwing, structuring, and mapping errors across every
Raffel protocol. Raffel uses **one** canonical error type — `RaffelError` — and
each transport (HTTP, WebSocket, channels, streams, and the envelope-based
protocols) renders that same error in its own representation.

For the full status-code table, see [Error Codes](/reference/error-codes.md).

---

## Overview

Every known error in Raffel is a `RaffelError`. It carries a stable string
`code` (e.g. `NOT_FOUND`), a numeric `status` (HTTP-compatible, e.g. `404`), a
human-readable `message`, and optional `details`.

```typescript
import { RaffelError, Errors, ErrorCodes } from 'raffel'
```

The class lives in `src/core/error.ts`:

```typescript
class RaffelError extends Error {
  readonly code: string      // 'NOT_FOUND'
  readonly status: number    // 404 (derived from code unless overridden)
  readonly details?: unknown // structured, serializable context

  constructor(code: string, message: string, details?: unknown, status?: number)
}
```

When `status` is omitted it is derived from `code` via `getStatusForCode(code)`,
so you only pass a code and the numeric status follows automatically. Throwing a
`RaffelError` from any handler is all you need — the framework catches it and
renders it correctly for whichever protocol the caller used.

```typescript
server.procedure('users.get').handler(async ({ id }, ctx) => {
  if (!ctx.auth?.authenticated) throw Errors.unauthorized()
  const user = await db.users.find(id)
  if (!user) throw Errors.notFound('User', id)
  return user
})
```

Anything else you throw (a plain `Error`, a string, etc.) is caught too and
normalized to `INTERNAL_ERROR` (status `500`). In non-development environments
the stack trace is dropped from the response; in `NODE_ENV=development` the stack
is attached to `details`.

---

## Standard error factories

The `Errors` object (`src/errors/factories.ts`) provides pre-built factories so
you never have to remember codes or status numbers. Each returns a
`RaffelError` with the correct code, status, and a sensible default message.

| Factory | Code | Status | Use when |
|:--------|:-----|:-------|:---------|
| `Errors.badRequest(message)` | `INVALID_ARGUMENT` | 400 | The request is malformed or an argument is invalid. |
| `Errors.validation(field, reason, value?)` | `VALIDATION_ERROR` | 400 | A single field failed schema/syntactic validation. |
| `Errors.validationMultiple(errors)` | `VALIDATION_ERROR` | 400 | Several fields failed validation at once. |
| `Errors.unauthorized(reason?)` | `UNAUTHENTICATED` | 401 | The caller is not authenticated. |
| `Errors.forbidden(reason?)` | `PERMISSION_DENIED` | 403 | The caller is authenticated but not allowed. |
| `Errors.notFound(resource, id?)` | `NOT_FOUND` | 404 | The requested resource does not exist. |
| `Errors.alreadyExists(resource, identifier?)` | `ALREADY_EXISTS` | 409 | A uniqueness constraint would be violated. |
| `Errors.preconditionFailed(condition)` | `FAILED_PRECONDITION` | 412 | A required precondition was not met. |
| `Errors.unprocessable(reason, details?)` | `UNPROCESSABLE_ENTITY` | 422 | The request is well-formed but semantically invalid (business rules). |
| `Errors.rateLimit(retryAfter?)` | `RATE_LIMITED` | 429 | The caller exceeded a rate limit. |
| `Errors.resourceExhausted(resource)` | `RESOURCE_EXHAUSTED` | 429 | A quota, memory, or disk limit was hit. |
| `Errors.cancelled(operation?)` | `CANCELLED` | 499 | The client cancelled the request. |
| `Errors.timeout(operation?)` | `DEADLINE_EXCEEDED` | 408 | A local deadline was exceeded. |
| `Errors.internal(message?, details?)` | `INTERNAL_ERROR` | 500 | An unexpected server-side failure. |
| `Errors.unimplemented(feature?)` | `UNIMPLEMENTED` | 501 | The feature is not implemented. |
| `Errors.badGateway(upstream?, details?)` | `BAD_GATEWAY` | 502 | An upstream service returned an invalid response. |
| `Errors.unavailable(service?)` | `UNAVAILABLE` | 503 | The service is temporarily down. |
| `Errors.gatewayTimeout(upstream?, timeoutMs?)` | `GATEWAY_TIMEOUT` | 504 | An upstream service did not respond in time. |
| `Errors.dataLoss(message)` | `DATA_LOSS` | 500 | Data corruption or loss was detected. |
| `Errors.custom(code, message, details?, status?)` | _custom_ | _custom_ | You need a code not covered above. |

Examples:

```typescript
// Resource lookups
throw Errors.notFound('User', userId)      // "User 'abc' not found"
throw Errors.notFound('User')              // "User not found"

// Auth
throw Errors.unauthorized()                // "Authentication required"
throw Errors.forbidden('Admin only')       // "Admin only"

// Uniqueness
throw Errors.alreadyExists('User', 'email')

// Multiple field errors in one shot
throw Errors.validationMultiple([
  { field: 'email', reason: 'must be valid' },
  { field: 'age', reason: 'must be >= 18' },
])
```

### `VALIDATION_ERROR` vs `UNPROCESSABLE_ENTITY`

- Use `Errors.validation(...)` (`400`) for **syntactic / schema** failures —
  wrong type, missing required field, bad format.
- Use `Errors.unprocessable(...)` (`422`) for **business-logic** failures — the
  payload parsed fine, but the operation is not allowed (e.g. "cannot delete a
  user with active orders").

---

## Custom errors

For anything the standard factories don't cover, use `Errors.custom()` or
construct a `RaffelError` directly. Both let you attach a stable code, a numeric
status, and structured details.

```typescript
import { Errors, RaffelError } from 'raffel'

// Via the factory
throw Errors.custom('PAYMENT_DECLINED', 'Card was declined', { reason: 'insufficient_funds' }, 402)

// Directly
throw new RaffelError('PAYMENT_DECLINED', 'Card was declined', { reason: 'insufficient_funds' }, 402)
```

If you use a code that is not in `ErrorCodes` and omit `status`, the status
defaults to `500`. Always pass an explicit `status` for custom client-facing
errors so callers get the right HTTP semantics.

You can also branch on the built-in codes and helpers from `src/errors/codes.ts`:

```typescript
import { ErrorCodes, isRetryable, isClientError } from 'raffel'

isRetryable('UNAVAILABLE')   // true  — 5xx and rate-limit/timeout codes
isRetryable('NOT_FOUND')     // false
isClientError(404)           // true
```

---

## Standard error response shape

Errors are serialized as a discriminated envelope. The `success: false` flag
distinguishes them from successful responses (`{ success: true, data }`):

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "User 'abc' not found",
    "details": { "resource": "User", "id": "abc" }
  }
}
```

- `code` — stable machine-readable identifier. **Clients should branch on this,
  never on the message.**
- `message` — human-readable, safe to display.
- `details` — optional structured context (the shape depends on the factory;
  e.g. validation errors carry a per-field array).

The internal `RaffelError.toJSON()` and the envelope `ErrorPayload`
(`src/types/envelope.ts`) also include the numeric `status`; over HTTP the
status becomes the response status code rather than a body field.

---

## Mapping per protocol

The same thrown `RaffelError` is rendered differently by each transport, but the
`code`, `message`, and `details` are always preserved.

### HTTP

The router catches the error and the HTTP transport writes:

- **Status line** ← `error.status` (e.g. `404`).
- **Body** ← `{ success: false, error: { code, message, details? } }`.

```
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=UTF-8

{ "success": false, "error": { "code": "NOT_FOUND", "message": "User 'abc' not found" } }
```

Some codes add response headers automatically — e.g. `RATE_LIMITED` /
`RESOURCE_EXHAUSTED` emit `Retry-After` when a retry hint is provided.

If you are using the standalone HTTP module directly, the typed
`HttpError` classes in `src/http/errors.ts` produce the identical body via
`.toResponse()`:

```typescript
import { HttpNotFoundError, createHttpError } from 'raffel/http'

throw new HttpNotFoundError('User not found')
throw createHttpError(403, 'Access denied')
```

### WebSocket & Channels

Envelope-based transports carry the error as an **error envelope** rather than a
status code. The client receives a message whose `type` is `error` and whose
`payload` is the `ErrorPayload`:

```json
{
  "id": "req-1:error",
  "type": "error",
  "procedure": "users.get",
  "payload": {
    "code": "NOT_FOUND",
    "status": 404,
    "message": "User 'abc' not found",
    "details": { "resource": "User", "id": "abc" }
  }
}
```

On the calling side, a Raffel client turns an `error` envelope back into a thrown
`RaffelError`, so `try/catch` works uniformly whether the call went over HTTP or
WebSocket.

### Streams

Errors raised while a stream is producing values are delivered as a
`stream:error` envelope (after any `stream:start` / `stream:data` frames already
sent). The payload matches `ErrorPayload`; a non-`RaffelError` becomes
`STREAM_ERROR` (status `500`):

```json
{
  "id": "req-1:stream:error",
  "type": "stream:error",
  "payload": { "code": "NOT_FOUND", "status": 404, "message": "..." }
}
```

### gRPC / JSON-RPC

These protocols reuse the same envelope. Because Raffel's codes are modeled on
gRPC status semantics (with HTTP-compatible numeric values), the string `code`
maps cleanly to a gRPC status and the numeric `status` maps to an HTTP status —
the single `RaffelError` is the source of truth for both.

---

## Validation errors

When a procedure declares an input schema, Raffel validates the request
automatically before your handler runs. A failure produces a `VALIDATION_ERROR`
with a per-field `details` array — you do not throw it yourself.

In the generated OpenAPI document (`src/docs/generators/http-generator.ts`),
operations that accept a request body with required fields advertise an
automatic **HTTP 422** validation response using the `ValidationError` schema:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "age", "message": "age is required" }
    ]
  }
}
```

Each entry in `details` has `field`, `message`, and optionally the offending
`value`. To raise the same shape by hand, use `Errors.validation()` or
`Errors.validationMultiple()`.

---

## Best practices

- **Branch on `code`, not `message`.** Codes are a stable contract; messages are
  for humans and may change. Keep codes consistent across releases.
- **Prefer the factories.** `Errors.notFound()`, `Errors.forbidden()`, etc.
  guarantee the right code/status pairing and a consistent message style.
- **Never leak internals.** Do not put stack traces, SQL, secrets, or internal
  identifiers in `message` or `details` for client-facing errors. Raffel already
  suppresses stack traces outside `NODE_ENV=development`; keep custom `details`
  free of sensitive data.
- **Pick the right validation code.** `VALIDATION_ERROR` (400) for schema issues,
  `UNPROCESSABLE_ENTITY` (422) for business-rule violations.
- **Set `status` on custom codes.** A custom code with no status defaults to
  `500`; pass an explicit status so HTTP clients get correct semantics.
- **Put actionable context in `details`.** Machine-readable structure (field
  names, resource ids, `retryAfter`) helps clients recover without parsing the
  message.
- **Let the framework map protocols.** Throw one `RaffelError` and rely on each
  transport's rendering rather than hand-crafting per-protocol responses.

---

## See also

- [Error Codes](/reference/error-codes.md) — full code/status reference table.
- [Validation](/tooling/validation.md) — input/output schema validation.
- [HTTP Responses](/http/responses.md) — success and error response envelopes.
