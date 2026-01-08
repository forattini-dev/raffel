# Schemas and Validation

Raffel supports pluggable validators (Zod, fastest-validator, or custom).
Register a validator adapter once at startup.

## Register Zod

```ts
import { z } from 'zod'
import { createZodAdapter, registerValidator } from 'raffel'

registerValidator(createZodAdapter(z))
```

## Procedure example

```ts
import { z } from 'zod'

server
  .procedure('users.create')
  .input(z.object({ name: z.string() }))
  .output(z.object({ id: z.string() }))
  .handler(async (input) => ({ id: `user-${input.name}` }))
```

Validation errors return `VALIDATION_ERROR` or `OUTPUT_VALIDATION_ERROR`.

## Advanced: schema registry

If you build the core manually, you can manage schemas with a registry:
```ts
import { createSchemaRegistry, createSchemaValidationInterceptor } from 'raffel'

const schemaRegistry = createSchemaRegistry()
const validate = createSchemaValidationInterceptor(schemaRegistry)
```
