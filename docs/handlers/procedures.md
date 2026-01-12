# Procedures (RPC)

Procedures are the fundamental handler type in Raffel. One request, one response.

---

## Overview

A procedure is a remote procedure call (RPC) pattern:

```typescript
server.procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .output(z.object({ id: z.string(), name: z.string(), email: z.string() }))
  .handler(async (input, ctx) => {
    const user = await db.users.create({ data: input })
    return user
  })
```

**Key characteristics:**
- Request-response pattern (unary RPC)
- Input validation before handler execution
- Output validation before response
- Works across all protocols (HTTP, WebSocket, gRPC, etc.)

---

## Basic Procedure

The simplest procedure:

```typescript
server.procedure('ping')
  .handler(async () => ({ pong: Date.now() }))
```

Access via any protocol:

```bash
# HTTP
curl -X POST http://localhost:3000/ping

# WebSocket
wscat -c ws://localhost:3000/ws
> {"procedure":"ping","payload":{}}

# JSON-RPC
curl -X POST http://localhost:3000/rpc \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}'
```

---

## Input Validation

Define input schema using Zod (or Yup, Joi, Ajv):

```typescript
import { createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

server.procedure('users.create')
  .input(z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    age: z.number().int().min(0).max(150).optional(),
    role: z.enum(['user', 'admin']).default('user'),
  }))
  .handler(async (input) => {
    // input is fully typed and validated
    console.log(input.name)   // string
    console.log(input.email)  // string
    console.log(input.age)    // number | undefined
    console.log(input.role)   // 'user' | 'admin'

    return { success: true }
  })
```

Invalid input returns an error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "path": ["email"], "message": "Invalid email" }
    ]
  }
}
```

---

## Output Validation

Define output schema for type safety and documentation:

```typescript
import { Errors } from 'raffel'

server.procedure('users.get')
  .input(z.object({ id: z.string().uuid() }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    createdAt: z.string().datetime(),
  }))
  .handler(async ({ id }) => {
    const user = await db.users.findUnique({ where: { id } })
    if (!user) throw Errors.notFound('User', id)
    return user
  })
```

Output validation:
- Ensures handler returns correct shape
- Strips extra fields (security)
- Auto-generates API documentation

---

## Context

Every handler receives a context object:

```typescript
server.procedure('users.me')
  .handler(async (input, ctx) => {
    // Request metadata
    console.log(ctx.id)         // Request correlation ID
    console.log(ctx.procedure)  // 'users.me'
    console.log(ctx.protocol)   // 'http' | 'websocket' | 'grpc' | ...

    // Authentication (if middleware applied)
    console.log(ctx.auth?.userId)
    console.log(ctx.auth?.roles)

    // Cancellation
    if (ctx.signal.aborted) {
      throw new Error('Request cancelled')
    }

    // Custom context (from interceptors)
    console.log(ctx.custom?.requestedAt)

    return { userId: ctx.auth?.userId }
  })
```

---

## Procedure Naming

Procedure names can be any string. Adapters interpret them:

| Procedure Name | HTTP | gRPC | GraphQL |
|:---------------|:-----|:-----|:--------|
| `ping` | `POST /ping` | `Service.Ping` | `query { ping }` |
| `users.create` | `POST /users.create` | `Users.Create` | `mutation { usersCreate }` |
| `users.list` | `POST /users.list` | `Users.List` | `query { usersList }` |
| `orders.items.add` | `POST /orders.items.add` | `OrdersItems.Add` | `mutation { ordersItemsAdd }` |

---

## Applying Interceptors

Add interceptors (middleware) to procedures:

```typescript
import { createAuthMiddleware, createRateLimitInterceptor } from 'raffel'

const auth = createAuthMiddleware({ /* ... */ })
const rateLimit = createRateLimitInterceptor({ windowMs: 60000, maxRequests: 10 })

server.procedure('admin.deleteUser')
  .use(auth)                    // Require authentication
  .use(rateLimit)               // Rate limit this endpoint
  .input(z.object({ userId: z.string() }))
  .handler(async ({ userId }, ctx) => {
    // Only authenticated users can reach here
    if (!ctx.auth?.roles.includes('admin')) {
      throw new ForbiddenError('Admin only')
    }
    await db.users.delete({ where: { id: userId } })
    return { deleted: true }
  })
```

---

## Error Handling

Throw errors to return error responses:

```typescript
import { NotFoundError, ValidationError, ForbiddenError } from 'raffel'

server.procedure('users.get')
  .input(z.object({ id: z.string() }))
  .handler(async ({ id }) => {
    const user = await db.users.findUnique({ where: { id } })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    return user
  })
```

Built-in error types:

| Error | HTTP Status | Code |
|:------|:------------|:-----|
| `ValidationError` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `RateLimitError` | 429 | `RATE_LIMITED` |
| `InternalError` | 500 | `INTERNAL_ERROR` |

---

## Procedure Metadata

Add metadata for documentation and tooling:

```typescript
server.procedure('users.create')
  .meta({
    description: 'Create a new user account',
    tags: ['users', 'authentication'],
    deprecated: false,
    rateLimit: { requests: 10, window: '1m' },
  })
  .input(z.object({ name: z.string(), email: z.string() }))
  .handler(async (input) => {
    // ...
  })
```

Metadata is used by:
- USD (Universal Service Docs)
- OpenAPI generation
- GraphQL schema
- gRPC reflection

---

## File-Based Procedures

Define procedures in files for auto-discovery:

```typescript
// src/http/users/create.ts
import { z } from 'zod'

export const input = z.object({
  name: z.string(),
  email: z.string().email(),
})

export const output = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
})

export const handler = async (input: z.infer<typeof input>) => {
  const user = await db.users.create({ data: input })
  return user
}
```

The file path determines the procedure name:
- `src/http/users/create.ts` → `users.create`
- `src/http/orders/items/add.ts` → `orders.items.add`

---

## Chaining Example

Full procedure definition:

```typescript
server
  .procedure('payments.process')
  .meta({
    description: 'Process a payment',
    tags: ['payments'],
  })
  .use(auth)
  .use(rateLimit)
  .input(z.object({
    amount: z.number().positive(),
    currency: z.enum(['USD', 'EUR', 'GBP']),
    paymentMethodId: z.string(),
  }))
  .output(z.object({
    transactionId: z.string(),
    status: z.enum(['pending', 'completed', 'failed']),
    amount: z.number(),
    currency: z.string(),
  }))
  .handler(async (input, ctx) => {
    const result = await paymentService.process({
      ...input,
      userId: ctx.auth?.principal,
    })
    return result
  })
```

---

## Next Steps

- **[Streams](streams.md)** — Server-sent and bidirectional streaming
- **[Events](events.md)** — Fire-and-forget pub/sub
- **[Interceptors](interceptors.md)** — Cross-cutting concerns
