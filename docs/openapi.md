# OpenAPI

Generate OpenAPI 3.0/3.1 specifications from your Raffel server. The generator
automatically creates paths for procedures, streams, and events with proper
schemas, tags, and error responses.

## Basic Usage

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .enableUSD({
    info: {
      title: 'My API',
      version: '1.0.0',
      description: 'A sample API built with Raffel',
    },
  })

// ... register procedures, streams, events ...

await server.start()

// Generate OpenAPI document (available after enableUSD)
const document = server.getOpenAPIDocument()
```

If you want to generate OpenAPI without enabling USD, use the generator directly:

```ts
import { createServer, generateOpenAPI } from 'raffel'

const server = createServer({ port: 3000 })

// ... register procedures, streams, events ...

const document = generateOpenAPI(server.registry, undefined, {
  info: {
    title: 'My API',
    version: '1.0.0',
    description: 'A sample API built with Raffel',
  },
})
```

## Output Formats

```ts
import {
  generateOpenAPI,
  generateOpenAPIJson,
  generateOpenAPIYaml,
} from 'raffel'

// Object (for programmatic use)
const doc = generateOpenAPI(registry, schemaRegistry, options)

// JSON string (for /openapi.json endpoint)
const json = generateOpenAPIJson(registry, schemaRegistry, options)

// YAML string (for /openapi.yaml endpoint)
const yaml = generateOpenAPIYaml(registry, schemaRegistry, options)
```

## Generator Options

```ts
interface GeneratorOptions {
  // Required: API info
  info: {
    title: string
    version: string
    description?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
    }
  }

  // OpenAPI version (default: '3.0.3')
  openApiVersion?: '3.0.0' | '3.0.3' | '3.1.0'

  // Server URLs
  servers?: Array<{
    url: string
    description?: string
  }>

  // Path configuration
  basePath?: string      // Base path for procedures (default: '/')
  streamPath?: string    // Path prefix for streams (default: '/streams')
  eventPath?: string     // Path prefix for events (default: '/events')

  // Security
  securitySchemes?: Record<string, SecurityScheme>
  security?: Array<Record<string, string[]>>

  // Organization
  groupByNamespace?: boolean  // Tag by first namespace (default: true)
  includeExamples?: boolean   // Include schema examples (default: false)

  // REST resources (for proper RESTful APIs)
  restResources?: RestResource[]
}
```

## Path Generation

### Procedures → POST Endpoints

Procedures become POST endpoints with the name converted to a path:

```ts
server.procedure('users.create').handler(...)
// → POST /users/create

server.procedure('orders.items.add').handler(...)
// → POST /orders/items/add
```

### Streams → GET Endpoints (SSE)

Streams become GET endpoints with Server-Sent Events:

```ts
server.stream('metrics.live').handler(...)
// → GET /streams/metrics/live
// Content-Type: text/event-stream
```

### Events → POST Endpoints

Events become POST endpoints that return 202 Accepted:

```ts
server.event('audit.log').handler(...)
// → POST /events/audit/log
// Response: 202 Accepted
```

## REST Resources

For proper RESTful APIs with HTTP method semantics, use `restResources`:

```ts
import { z } from 'zod'

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date(),
})

const document = generateOpenAPI(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  restResources: [
    {
      name: 'users',
      schema: UserSchema,
      routes: [
        { method: 'GET', path: '/users', operation: 'list' },
        { method: 'GET', path: '/users/:id', operation: 'get' },
        { method: 'POST', path: '/users', operation: 'create' },
        { method: 'PUT', path: '/users/:id', operation: 'update' },
        { method: 'PATCH', path: '/users/:id', operation: 'patch' },
        { method: 'DELETE', path: '/users/:id', operation: 'delete' },
      ],
    },
  ],
})
```

This generates proper OpenAPI paths:

```yaml
paths:
  /users:
    get:
      operationId: users_list
      summary: List all users
      responses:
        '200':
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Users'
                  total:
                    type: integer
                  page:
                    type: integer
    post:
      operationId: users_create
      summary: Create a new user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Users'
      responses:
        '201':
          description: Created resource

  /users/{id}:
    get:
      operationId: users_get
      summary: Get a user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
```

### REST Route Options

```ts
interface RestRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  path: string                    // URL path (use :id for params)
  operation: string               // Operation name for summaries
  inputSchema?: ZodSchema         // Request body schema
  outputSchema?: ZodSchema        // Response schema (overrides resource schema)
  auth?: 'none' | 'required' | 'optional'
  operationId?: string            // Custom operation ID
}
```

### Standard Operations

The generator provides automatic summaries and descriptions for standard operations:

| Operation | Summary | Description |
|-----------|---------|-------------|
| `list` | List all {resources} | Returns paginated list with filtering |
| `get` | Get a {resource} by ID | Returns single resource |
| `create` | Create a new {resource} | Creates and returns resource |
| `update` | Update a {resource} | Full replacement |
| `patch` | Partially update | Partial modification |
| `delete` | Delete a {resource} | Permanent removal |
| `head` | Check if exists | Headers only |
| `options` | Get allowed methods | CORS preflight |

## Security Schemes

```ts
const document = generateOpenAPI(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },

  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT authentication token',
    },
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description: 'API key for server-to-server calls',
    },
    oauth2: {
      type: 'oauth2',
      description: 'OAuth 2.0 authentication',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: {
            'read:users': 'Read user data',
            'write:users': 'Modify user data',
          },
        },
      },
    },
  },

  // Default security requirement (applied to all endpoints)
  security: [{ bearerAuth: [] }],
})
```

### Per-Route Security

For REST resources, use the `auth` property:

```ts
restResources: [{
  name: 'users',
  routes: [
    // Public endpoints
    { method: 'GET', path: '/users', operation: 'list', auth: 'none' },

    // Protected endpoints
    { method: 'POST', path: '/users', operation: 'create', auth: 'required' },
    { method: 'DELETE', path: '/users/:id', operation: 'delete', auth: 'required' },
  ],
}]
```

## Automatic Schema Generation

### From Zod Schemas

Schemas registered with `SchemaRegistry` are automatically converted:

```ts
const schemaRegistry = createSchemaRegistry()

server
  .procedure('users.create')
  .input(z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    age: z.number().int().min(0).max(150).optional(),
  }))
  .output(z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string(),
    createdAt: z.date(),
  }))
  .handler(...)
```

Generates:

```yaml
components:
  schemas:
    users.createInput:
      type: object
      required: [name, email]
      properties:
        name:
          type: string
          minLength: 1
          maxLength: 100
        email:
          type: string
          format: email
        age:
          type: integer
          minimum: 0
          maximum: 150

    users.createOutput:
      type: object
      required: [id, name, email, createdAt]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        email:
          type: string
        createdAt:
          type: string
          format: date-time
```

### Error Schema

The generator automatically includes a standard `ApiError` schema:

```yaml
components:
  schemas:
    ApiError:
      type: object
      required: [code, message]
      properties:
        code:
          type: string
          description: Error code identifier
          example: VALIDATION_ERROR
        message:
          type: string
          description: Human-readable error message
        status:
          type: integer
          description: HTTP status code
        details:
          type: object
          description: Additional error details
        requestId:
          type: string
          description: Request ID for tracking
```

## Tags and Organization

### Automatic Namespace Tagging

With `groupByNamespace: true` (default), handlers are tagged by their first
namespace:

```ts
server.procedure('users.create').handler(...)   // Tag: users
server.procedure('users.delete').handler(...)   // Tag: users
server.procedure('orders.create').handler(...)  // Tag: orders
server.stream('metrics.live').handler(...)      // Tag: metrics
```

Generates:

```yaml
tags:
  - name: users
    description: Operations related to users
  - name: orders
    description: Operations related to orders
  - name: metrics
    description: Operations related to metrics
```

### Custom Tags

Override for REST resources:

```ts
restResources: [{
  name: 'user-management',  // Used as tag
  routes: [...],
}]
```

## Server Configuration

```ts
const document = generateOpenAPI(registry, schemaRegistry, {
  info: { title: 'My API', version: '1.0.0' },
  servers: [
    {
      url: 'https://api.example.com',
      description: 'Production server',
    },
    {
      url: 'https://staging-api.example.com',
      description: 'Staging server',
    },
    {
      url: 'http://localhost:3000',
      description: 'Local development',
    },
  ],
})
```

## Integration with USD UI

Use Raffel's USD documentation UI to serve OpenAPI and USD from the same endpoint:

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .enableUSD({
    info: { title: 'My API', version: '1.0.0' },
  })

// ... register procedures ...

await server.start()

// Endpoints:
// GET /docs            → USD UI
// GET /docs/usd.json   → USD (JSON)
// GET /docs/usd.yaml   → USD (YAML)
// GET /docs/openapi.json → OpenAPI 3.1
```

See [Developer Experience](dx.md) for full USD UI configuration options.

## TypeScript Types

All OpenAPI types are exported for customization:

```ts
import type {
  OpenAPIDocument,
  OpenAPIInfo,
  OpenAPIServer,
  OpenAPIPathItem,
  OpenAPIOperation,
  OpenAPIResponse,
  OpenAPISecurityScheme,
  OpenAPITag,
  GeneratorOptions,
  OpenAPIRestResource,
  OpenAPIRestRoute,
} from 'raffel'
```

## Complete Example

```ts
import { createServer, generateOpenAPI, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

// Define schemas
const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  createdAt: z.date(),
})

const CreateUserInput = UserSchema.omit({ id: true, createdAt: true })

// Register procedures
server
  .procedure('users.create')
  .description('Create a new user')
  .input(CreateUserInput)
  .output(UserSchema)
  .handler(async (input) => {
    return {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date(),
    }
  })

server
  .procedure('users.get')
  .description('Get user by ID')
  .input(z.object({ id: z.string().uuid() }))
  .output(UserSchema)
  .handler(async ({ id }) => {
    return getUserById(id)
  })

// Register stream
server
  .stream('users.activity')
  .description('Stream user activity in real-time')
  .output(z.object({
    userId: z.string(),
    action: z.string(),
    timestamp: z.date(),
  }))
  .handler(async function* () {
    while (true) {
      yield await getNextActivity()
    }
  })

// Register event
server
  .event('users.notify')
  .description('Send notification to user')
  .input(z.object({
    userId: z.string(),
    message: z.string(),
  }))
  .delivery('at-least-once')
  .handler(async (payload) => {
    await sendNotification(payload)
  })

// Generate OpenAPI
const document = generateOpenAPI(server.registry, undefined, {
  info: {
    title: 'User Management API',
    version: '2.0.0',
    description: 'API for managing users and notifications',
    contact: {
      name: 'API Support',
      email: 'support@example.com',
    },
  },
  servers: [
    { url: 'https://api.example.com', description: 'Production' },
  ],
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
  },
  security: [{ bearerAuth: [] }],
  groupByNamespace: true,
})

// Serve as endpoint
server.procedure('openapi').handler(() => document)
```

## Best Practices

1. **Always include descriptions** in your handlers for better documentation:
   ```ts
   .procedure('users.create')
   .description('Create a new user account')
   ```

2. **Use proper schemas** for input and output validation - they generate better
   OpenAPI specs automatically.

3. **Group related endpoints** using dot notation (`users.create`, `users.get`)
   for automatic tag grouping.

4. **Add server URLs** for each environment to make the spec portable.

5. **Use security schemes** to document authentication requirements clearly.

6. **Prefer REST resources** for CRUD operations - they generate proper HTTP
   method semantics (GET, POST, PUT, PATCH, DELETE).
