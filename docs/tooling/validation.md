# Validation

Raffel supports multiple validation libraries through a pluggable adapter system. Choose the validator that best fits your project.

## Supported Validators

| Validator | Description | Best For |
|-----------|-------------|----------|
| **Zod** | TypeScript-first schema validation | Type inference, TypeScript projects |
| **Yup** | Object schema validation | Form validation, React projects |
| **Joi** | Powerful schema description | Complex validation rules |
| **Ajv** | JSON Schema validator | Existing JSON Schemas, high performance |
| **fastest-validator** | Blazing fast validation | High throughput APIs |

## Installation

Install Raffel and your preferred validator:

```bash
# Core
pnpm add raffel

# Pick one or more validators
pnpm add zod                    # TypeScript-first
pnpm add yup                    # Object schemas
pnpm add joi                    # Powerful validation
pnpm add ajv                    # JSON Schema
pnpm add fastest-validator      # High performance
```

## Quick Start

### Zod (Recommended for TypeScript)

```typescript
import { z } from 'zod'
import { createServer, registerValidator, createZodAdapter } from 'raffel'

// Register Zod as the validator
registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().optional(),
  }))
  .output(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }))
  .handler(async (input) => {
    return {
      id: `user-${Date.now()}`,
      name: input.name,
      email: input.email,
    }
  })
```

### Yup

```typescript
import * as yup from 'yup'
import { createServer, registerValidator, createYupAdapter } from 'raffel'

registerValidator(createYupAdapter(yup))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input(yup.object({
    name: yup.string().required().min(1),
    email: yup.string().required().email(),
    age: yup.number().optional(),
  }))
  .handler(async (input) => {
    return { id: `user-${Date.now()}`, ...input }
  })
```

### Joi

```typescript
import Joi from 'joi'
import { createServer, registerValidator, createJoiAdapter } from 'raffel'

registerValidator(createJoiAdapter(Joi))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input(Joi.object({
    name: Joi.string().required().min(1),
    email: Joi.string().required().email(),
    age: Joi.number().optional(),
  }))
  .handler(async (input) => {
    return { id: `user-${Date.now()}`, ...input }
  })
```

### Ajv (JSON Schema)

```typescript
import Ajv from 'ajv'
import { createServer, registerValidator, createAjvAdapter } from 'raffel'

// Create Ajv instance with allErrors for detailed validation
const ajv = new Ajv({ allErrors: true })
registerValidator(createAjvAdapter(ajv))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input({
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1 },
      email: { type: 'string', format: 'email' },
      age: { type: 'number' },
    },
    required: ['name', 'email'],
  })
  .handler(async (input) => {
    return { id: `user-${Date.now()}`, ...input }
  })
```

### fastest-validator

```typescript
import Validator from 'fastest-validator'
import { createServer, registerValidator, createFastestValidatorAdapter } from 'raffel'

const v = new Validator()
registerValidator(createFastestValidatorAdapter(v))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input({
    name: { type: 'string', min: 1 },
    email: { type: 'email' },
    age: { type: 'number', optional: true },
  })
  .handler(async (input) => {
    return { id: `user-${Date.now()}`, ...input }
  })
```

## Multiple Validators

You can register multiple validators and use different ones per handler:

```typescript
import { z } from 'zod'
import Joi from 'joi'
import { registerValidator, createZodAdapter, createJoiAdapter } from 'raffel'

// Register multiple validators
registerValidator(createZodAdapter(z))
registerValidator(createJoiAdapter(Joi))

// Use Zod (default, first registered)
server
  .procedure('api.zod')
  .input(z.object({ name: z.string() }))
  .handler(async (input) => input)

// Use Joi explicitly
server
  .procedure('api.joi')
  .input(Joi.object({ name: Joi.string().required() }))
  .handler(async (input) => input)
```

## Validation API

### Manual Validation

```typescript
import { validate, registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const schema = z.object({ name: z.string() })

// Throws RaffelError on validation failure
const data = validate(schema, { name: 'John' })

// With explicit type
const user = validate<{ name: string }>(schema, { name: 'John' })
```

### Validation Interceptor

Create reusable validation middleware:

```typescript
import { createValidationInterceptor, createSchemaRegistry } from 'raffel'

const schemas = createSchemaRegistry()
schemas.register('users.create', {
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
})

const validateAll = createSchemaValidationInterceptor(schemas)

server.use(validateAll)
```

## Error Handling

Validation errors are returned as `RaffelError` with code `VALIDATION_ERROR`:

```typescript
// Error response format
{
  "type": "error",
  "payload": {
    "code": "VALIDATION_ERROR",
    "message": "Input validation failed",
    "details": [
      { "field": "email", "message": "Invalid email", "code": "invalid_string" },
      { "field": "age", "message": "Number must be positive", "code": "too_small" }
    ]
  }
}
```

### Converting Errors

Each adapter exports an error converter for custom handling:

```typescript
import { zodErrorToDetails } from 'raffel'
import { z } from 'zod'

const schema = z.object({ email: z.string().email() })
const result = schema.safeParse({ email: 'invalid' })

if (!result.success) {
  const details = zodErrorToDetails(result.error)
  // [{ field: 'email', message: 'Invalid email', code: 'invalid_email' }]
}
```

## OpenAPI Integration

Zod schemas are automatically converted to OpenAPI/JSON Schema:

```typescript
import { generateOpenAPI, createSchemaRegistry } from 'raffel'

const schemas = createSchemaRegistry()
schemas.register('users.create', {
  input: z.object({ name: z.string() }),
  output: z.object({ id: z.string() }),
})

const openapi = generateOpenAPI(server.registry, schemas, {
  info: { title: 'My API', version: '1.0.0' },
})
```

## Comparison

| Feature | Zod | Yup | Joi | Ajv | fastest-validator |
|---------|-----|-----|-----|-----|-------------------|
| TypeScript inference | :white_check_mark: | :x: | :x: | :x: | :x: |
| Bundle size | ~14kb | ~24kb | ~78kb | ~36kb | ~10kb |
| JSON Schema output | :white_check_mark: | :x: | :white_check_mark: | Native | :white_check_mark: |
| Async validation | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: |
| Transformations | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :white_check_mark: |

## Best Practices

1. **Choose one validator per project** - Reduces bundle size and complexity
2. **Use Zod for TypeScript** - Best type inference and DX
3. **Use Ajv for JSON Schema** - If you have existing schemas
4. **Use fastest-validator** - For high-throughput APIs
5. **Register early** - Call `registerValidator()` at app startup

## Tree Shaking

Import only the adapter you need for optimal bundle size:

```typescript
// Full import (all adapters)
import { createZodAdapter } from 'raffel'

// Tree-shakeable import (only Zod adapter)
import { createZodAdapter } from 'raffel/validation/zod'
```
