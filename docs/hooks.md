# Procedure Hooks

Hooks provide a way to run code before, after, or on error of procedure execution. They're ideal for cross-cutting concerns like logging, validation, caching, and error handling.

## Quick Start

```ts
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  hooks: {
    before: [
      async (input, ctx, meta) => {
        console.log(`Starting ${meta.procedure}`)
      },
    ],
    after: [
      async (result, input, ctx, meta) => {
        console.log(`Completed ${meta.procedure}`)
      },
    ],
    error: [
      async (error, input, ctx, meta) => {
        console.error(`Failed ${meta.procedure}:`, error.message)
      },
    ],
  },
})
```

## Hook Types

### Before Hooks

Run before the procedure handler. Can modify input or short-circuit execution.

```ts
const server = createServer({
  port: 3000,
  hooks: {
    before: [
      // Logging
      async (input, ctx, meta) => {
        console.log(`[${new Date().toISOString()}] ${meta.procedure}`)
      },

      // Input transformation
      async (input, ctx, meta) => {
        return {
          ...input,
          timestamp: Date.now(),
          requestId: ctx.id,
        }
      },

      // Validation
      async (input, ctx, meta) => {
        if (!ctx.auth?.authenticated && meta.procedure.startsWith('admin.')) {
          throw new Error('Unauthorized')
        }
      },

      // Rate limiting check
      async (input, ctx, meta) => {
        const key = `${ctx.auth?.principal}:${meta.procedure}`
        if (await isRateLimited(key)) {
          throw new Error('Too many requests')
        }
      },
    ],
  },
})
```

**Signature:**
```ts
type BeforeHook = (
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown | void>
```

**Return values:**
- `undefined` or `void`: Use original input
- Any other value: Use as new input

### After Hooks

Run after successful procedure execution. Can modify the result.

```ts
const server = createServer({
  port: 3000,
  hooks: {
    after: [
      // Logging
      async (result, input, ctx, meta) => {
        console.log(`${meta.procedure} returned:`, result)
      },

      // Response transformation
      async (result, input, ctx, meta) => {
        return {
          data: result,
          meta: {
            procedure: meta.procedure,
            timestamp: Date.now(),
          },
        }
      },

      // Caching
      async (result, input, ctx, meta) => {
        if (meta.procedure.startsWith('cache.')) {
          await cache.set(cacheKey(meta.procedure, input), result, 60)
        }
        return result
      },

      // Audit logging
      async (result, input, ctx, meta) => {
        await auditLog.record({
          user: ctx.auth?.principal,
          action: meta.procedure,
          input,
          result,
          timestamp: Date.now(),
        })
      },
    ],
  },
})
```

**Signature:**
```ts
type AfterHook = (
  result: unknown,
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown | void>
```

**Return values:**
- `undefined` or `void`: Use original result
- Any other value: Use as new result

### Error Hooks

Run when the procedure throws an error. Can handle, transform, or re-throw.

```ts
const server = createServer({
  port: 3000,
  hooks: {
    error: [
      // Logging
      async (error, input, ctx, meta) => {
        console.error(`[${meta.procedure}] Error:`, {
          message: error.message,
          stack: error.stack,
          input,
          user: ctx.auth?.principal,
        })
        throw error // Re-throw to propagate
      },

      // Error transformation
      async (error, input, ctx, meta) => {
        if (error.code === 'VALIDATION_ERROR') {
          throw new Error(`Invalid input for ${meta.procedure}`)
        }
        throw error
      },

      // Recovery
      async (error, input, ctx, meta) => {
        if (error.code === 'NOT_FOUND' && meta.procedure === 'users.get') {
          return { user: null } // Return fallback instead of error
        }
        throw error
      },

      // Alerting
      async (error, input, ctx, meta) => {
        if (error.severity === 'critical') {
          await alerting.send({
            channel: 'errors',
            message: `Critical error in ${meta.procedure}: ${error.message}`,
          })
        }
        throw error
      },
    ],
  },
})
```

**Signature:**
```ts
type ErrorHook = (
  error: Error,
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown>
```

**Return values:**
- Throw an error: Propagate error to client
- Return a value: Use as successful result (recovery)

## Execution Order

Hooks run in array order:

```
Request
  ↓
before[0] → before[1] → before[2]
  ↓
handler()
  ↓
after[0] → after[1] → after[2]
  ↓
Response

On error:
  ↓
error[0] → error[1] → error[2]
  ↓
Error Response (or Recovery)
```

## Common Patterns

### Request Timing

```ts
const server = createServer({
  port: 3000,
  hooks: {
    before: [
      async (input, ctx, meta) => {
        ctx.extensions.set(Symbol.for('startTime'), Date.now())
        return input
      },
    ],
    after: [
      async (result, input, ctx, meta) => {
        const startTime = ctx.extensions.get(Symbol.for('startTime'))
        const duration = Date.now() - startTime
        console.log(`${meta.procedure} took ${duration}ms`)
        return result
      },
    ],
  },
})
```

### Cache Layer

```ts
const cacheHooks = {
  before: [
    async (input, ctx, meta) => {
      const cached = await cache.get(cacheKey(meta.procedure, input))
      if (cached) {
        ctx.extensions.set(Symbol.for('cached'), true)
        ctx.extensions.set(Symbol.for('cachedResult'), cached)
      }
      return input
    },
  ],
  after: [
    async (result, input, ctx, meta) => {
      const wasCached = ctx.extensions.get(Symbol.for('cached'))
      if (wasCached) {
        return ctx.extensions.get(Symbol.for('cachedResult'))
      }
      await cache.set(cacheKey(meta.procedure, input), result, 300)
      return result
    },
  ],
}
```

### Input Sanitization

```ts
const sanitizeHooks = {
  before: [
    async (input, ctx, meta) => {
      if (typeof input === 'object' && input !== null) {
        return sanitizeObject(input)
      }
      return input
    },
  ],
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.trim()
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
```

### Retry on Transient Errors

```ts
const retryHooks = {
  error: [
    async (error, input, ctx, meta) => {
      const retryCount = ctx.extensions.get(Symbol.for('retryCount')) ?? 0

      if (isTransientError(error) && retryCount < 3) {
        ctx.extensions.set(Symbol.for('retryCount'), retryCount + 1)
        await delay(Math.pow(2, retryCount) * 100) // Exponential backoff

        // Re-execute (this is simplified; real implementation would need router access)
        throw error
      }

      throw error
    },
  ],
}

function isTransientError(error: Error): boolean {
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error.code)
}
```

### Multi-Tenant Context

```ts
const tenantHooks = {
  before: [
    async (input, ctx, meta) => {
      const tenantId = ctx.auth?.claims?.tenantId
      if (!tenantId) {
        throw new Error('Tenant ID required')
      }

      // Set tenant context for database queries
      ctx.extensions.set(Symbol.for('tenantId'), tenantId)

      return input
    },
  ],
}
```

## Hooks vs Interceptors

| Feature | Hooks | Interceptors |
|:--|:--|:--|
| Scope | Global (all procedures) | Can be selective |
| Order | Defined in config | Onion model (wrap each other) |
| Access | Input, result, error separately | Full request/response flow |
| Use case | Cross-cutting concerns | Complex transformations |

**When to use hooks:**
- Logging and auditing
- Simple input/output transformation
- Error handling and alerting
- Caching

**When to use interceptors:**
- Protocol-specific handling
- Authentication/authorization
- Complex request/response manipulation
- Rate limiting with complex logic

## Combining with Interceptors

Hooks run inside interceptors:

```
Interceptor (outer)
  ↓
  Interceptor (inner)
    ↓
    Before Hooks
      ↓
      Handler
      ↓
    After Hooks
    ↓
  Interceptor (inner)
  ↓
Interceptor (outer)
```

## API Reference

### GlobalHooksConfig

```ts
interface GlobalHooksConfig {
  before?: BeforeHook[]
  after?: AfterHook[]
  error?: ErrorHook[]
}
```

### BeforeHook

```ts
type BeforeHook = (
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown | void>
```

### AfterHook

```ts
type AfterHook = (
  result: unknown,
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown | void>
```

### ErrorHook

```ts
type ErrorHook = (
  error: Error,
  input: unknown,
  ctx: Context,
  meta: { procedure: string }
) => Promise<unknown>
```
