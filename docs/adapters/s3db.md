# S3DB Adapter

The S3DB adapter transforms s3db.js resources into Raffel procedures, providing instant RESTful APIs with full CRUD support.

## Quick Start

```ts
import { createServer, createS3DBAdapter, generateS3DBHttpPaths } from 'raffel'
import { Database } from 's3db.js'

// Create s3db database and resources
const db = new Database({ bucket: 'my-bucket' })
const users = db.createResource('users', {
  attributes: {
    name: 'string',
    email: 'string',
    role: 'string',
  },
})

// Create Raffel server
const server = createServer({ port: 3000 })
  .enableHttp({
    paths: generateS3DBHttpPaths('users', 'api/v1'),
  })
  .mount('api/v1', createS3DBAdapter(users))

await server.start()
```

## Generated Procedures

For each s3db resource, the adapter generates:

| Procedure | HTTP Equivalent | Description |
|:--|:--|:--|
| `{prefix}.{resource}.list` | `GET /resource` | List all records |
| `{prefix}.{resource}.get` | `GET /resource/:id` | Get single record |
| `{prefix}.{resource}.count` | `GET /resource/count` | Count records |
| `{prefix}.{resource}.create` | `POST /resource` | Create record |
| `{prefix}.{resource}.update` | `PUT /resource/:id` | Full update |
| `{prefix}.{resource}.patch` | `PATCH /resource/:id` | Partial update |
| `{prefix}.{resource}.delete` | `DELETE /resource/:id` | Delete record |
| `{prefix}.{resource}.options` | `OPTIONS /resource` | Available operations |
| `{prefix}.{resource}.head` | `HEAD /resource` | Pagination metadata |

## Configuration

### Basic Options

```ts
createS3DBAdapter(users, {
  // Limit which HTTP methods generate procedures
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],

  // Authorization callback
  authorize: async (operation, resourceName, ctx) => {
    return ctx.auth?.authenticated ?? false
  },

  // Fields to filter from responses
  protectedFields: ['password', 'apiKey'],

  // Map context to user info for audit
  contextToUser: (ctx) => ctx.auth,
})
```

### Multiple Resources

```ts
const users = db.createResource('users', { ... })
const posts = db.createResource('posts', { ... })
const comments = db.createResource('comments', { ... })

// Mount multiple resources at once
server.mount('api/v1', createS3DBAdapter([users, posts, comments]))

// Generates:
// - api/v1.users.list, api/v1.users.get, etc.
// - api/v1.posts.list, api/v1.posts.get, etc.
// - api/v1.comments.list, api/v1.comments.get, etc.
```

## Authorization

Control access per operation:

```ts
createS3DBAdapter(users, {
  authorize: async (operation, resourceName, ctx) => {
    const user = ctx.auth

    // Public read, authenticated write
    if (['list', 'get', 'count'].includes(operation)) {
      return true
    }

    if (!user?.authenticated) {
      return false
    }

    // Admin-only delete
    if (operation === 'delete') {
      return user.roles?.includes('admin')
    }

    return true
  },
})
```

**Operations:**
- `list` - List/query records
- `get` - Get single record
- `count` - Count records
- `create` - Create record
- `update` - Full update (PUT)
- `patch` - Partial update (PATCH)
- `delete` - Delete record
- `options` - Get available methods/operations
- `head` - Get pagination metadata

## Protected Fields

Filter sensitive fields from responses:

```ts
// In s3db resource schema
const users = db.createResource('users', {
  attributes: {
    name: 'string',
    email: 'string',
    password: 'string',
  },
  $schema: {
    api: {
      protected: ['password'], // Schema-level protection
    },
  },
})

// Additional protection via adapter
createS3DBAdapter(users, {
  protectedFields: ['apiKey', 'secretToken'],
})

// Response will exclude: password, apiKey, secretToken
```

## Procedure Input/Output

### List

**Input:**
```ts
{
  limit?: number      // Default: 100
  offset?: number     // Default: 0
  filters?: Record<string, unknown>  // Query filters
  partition?: string  // Partition name
  partitionValues?: Record<string, unknown>
}
```

**Output:**
```ts
{
  data: Record<string, unknown>[]
  pagination: {
    total: number
    page: number
    pageSize: number
    pageCount: number
  }
}
```

### Get

**Input:**
```ts
{
  id: string
  include?: string[]  // Related data to include
  partition?: string
  partitionValues?: Record<string, unknown>
}
```

**Output:**
```ts
{
  data: Record<string, unknown>
}
```

### Count

**Input:** None

**Output:**
```ts
{
  count: number
}
```

### Create

**Input:**
```ts
{
  data: Record<string, unknown>
}
```

**Output:**
```ts
{
  data: Record<string, unknown>  // Created record with ID
}
```

### Update (PUT)

**Input:**
```ts
{
  id: string
  data: Record<string, unknown>
}
```

**Output:**
```ts
{
  data: Record<string, unknown>  // Updated record
}
```

### Patch

**Input:**
```ts
{
  id: string
  data: Record<string, unknown>  // Partial update
}
```

**Output:**
```ts
{
  data: Record<string, unknown>  // Updated record
}
```

### Delete

**Input:**
```ts
{
  id: string
}
```

**Output:**
```ts
{
  success: true
}
```

### Options

Returns available HTTP methods and operations for the resource.

**Input:** None

**Output:**
```ts
{
  resource: string         // Resource name
  methods: string[]        // Available HTTP methods
  operations: {
    list: boolean
    get: boolean
    count: boolean
    create: boolean
    update: boolean
    patch: boolean
    delete: boolean
    head: boolean
    options: boolean
  }
}
```

### Head

Returns pagination metadata without data (lightweight alternative to list).

**Input:**
```ts
{
  limit?: number      // Default: 100
  offset?: number     // Default: 0
}
```

**Output:**
```ts
{
  total: number       // Total record count
  page: number        // Current page (1-based)
  pageSize: number    // Records per page
  pageCount: number   // Total pages
}
```

## HTTP Path Mapping

Generate HTTP routes for the procedures:

```ts
import { generateS3DBHttpPaths } from 'raffel'

const paths = generateS3DBHttpPaths('users', 'api/v1')
// {
//   'api/v1.users.list':    { method: 'GET',     path: '/api/v1/users' },
//   'api/v1.users.get':     { method: 'GET',     path: '/api/v1/users/:id' },
//   'api/v1.users.count':   { method: 'GET',     path: '/api/v1/users/count' },
//   'api/v1.users.create':  { method: 'POST',    path: '/api/v1/users' },
//   'api/v1.users.update':  { method: 'PUT',     path: '/api/v1/users/:id' },
//   'api/v1.users.patch':   { method: 'PATCH',   path: '/api/v1/users/:id' },
//   'api/v1.users.delete':  { method: 'DELETE',  path: '/api/v1/users/:id' },
//   'api/v1.users.options': { method: 'OPTIONS', path: '/api/v1/users' },
//   'api/v1.users.head':    { method: 'HEAD',    path: '/api/v1/users' },
// }

server.enableHttp({ paths })
```

## Context Interceptor

Inject s3db resources into handler context:

```ts
import { createS3DBContextInterceptor } from 'raffel'

const interceptor = createS3DBContextInterceptor({
  users,
  posts,
  comments,
})

server.use(interceptor)

// In handlers:
server.procedure('custom.action').handler(async (input, ctx) => {
  const s3db = ctx.extensions.get(Symbol.for('raffel.s3db'))
  const user = await s3db.users.get(input.userId)
  return user
})
```

## Error Handling

The adapter throws standard Raffel errors:

| Error | Code | When |
|:--|:--|:--|
| `NOT_FOUND` | 404 | Record doesn't exist |
| `PERMISSION_DENIED` | 403 | Authorization failed |
| `VALIDATION_ERROR` | 400 | Invalid input |

```ts
// Errors are automatically converted to proper responses:
// {
//   "type": "error",
//   "payload": {
//     "code": "NOT_FOUND",
//     "message": "users not found: user-123"
//   }
// }
```

## Filtering Records

Query with filters:

```ts
// List users with role 'admin'
await server.router.handle({
  procedure: 'api/v1.users.list',
  payload: {
    filters: { role: 'admin' },
  },
})

// Pagination
await server.router.handle({
  procedure: 'api/v1.users.list',
  payload: {
    limit: 10,
    offset: 20,
    filters: { status: 'active' },
  },
})
```

## Partitioned Resources

Work with s3db partitions:

```ts
// List from specific partition
await server.router.handle({
  procedure: 'api/v1.orders.list',
  payload: {
    partition: 'byCustomer',
    partitionValues: { customerId: 'cust-123' },
  },
})

// Get from partition
await server.router.handle({
  procedure: 'api/v1.orders.get',
  payload: {
    id: 'order-456',
    partition: 'byCustomer',
    partitionValues: { customerId: 'cust-123' },
  },
})
```

## Complete Example

```ts
import { createServer, createS3DBAdapter, generateS3DBHttpPaths } from 'raffel'
import { Database } from 's3db.js'

// Initialize s3db
const db = new Database({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
})

// Define resources
const users = db.createResource('users', {
  attributes: {
    name: 'string',
    email: 'string',
    role: 'string',
    password: 'string',
  },
  $schema: {
    api: { protected: ['password'] },
  },
})

const posts = db.createResource('posts', {
  attributes: {
    title: 'string',
    content: 'string',
    authorId: 'string',
    published: 'boolean',
  },
})

// Create server
const server = createServer({ port: 3000 })
  .enableHttp({
    paths: {
      ...generateS3DBHttpPaths('users', 'api/v1'),
      ...generateS3DBHttpPaths('posts', 'api/v1'),
    },
  })
  .mount('api/v1', createS3DBAdapter([users, posts], {
    authorize: async (op, resource, ctx) => {
      // Public read
      if (['list', 'get', 'count'].includes(op)) {
        return true
      }

      // Authenticated write
      if (!ctx.auth?.authenticated) {
        return false
      }

      // Users can only modify their own posts
      if (resource === 'posts' && ['update', 'patch', 'delete'].includes(op)) {
        const post = await posts.get(ctx.envelope?.payload?.id)
        return post?.authorId === ctx.auth.principal
      }

      // Admin-only user management
      if (resource === 'users') {
        return ctx.auth.roles?.includes('admin')
      }

      return true
    },
    protectedFields: ['password'],
  }))

await server.start()
console.log('Server running on http://localhost:3000')
```

## API Reference

### createS3DBAdapter(resources, options?)

Creates a RouterModule with CRUD procedures for s3db resources.

| Parameter | Type | Description |
|:--|:--|:--|
| `resources` | `S3DBResourceLike \| S3DBResourceLike[]` | s3db resource(s) |
| `options` | `S3DBAdapterOptions` | Configuration options |

### S3DBAdapterOptions

| Option | Type | Default | Description |
|:--|:--|:--|:--|
| `methods` | `string[]` | All methods | HTTP methods to generate |
| `authorize` | `Function` | - | Authorization callback |
| `protectedFields` | `string[]` | `[]` | Fields to filter |
| `contextToUser` | `Function` | `ctx.auth` | User info extractor |

### generateS3DBHttpPaths(resourceName, basePath?)

Generates HTTP path mappings for s3db procedures.

| Parameter | Type | Description |
|:--|:--|:--|
| `resourceName` | `string` | Resource name |
| `basePath` | `string` | Base path prefix |

### createS3DBContextInterceptor(resources)

Creates an interceptor that injects resources into context.

| Parameter | Type | Description |
|:--|:--|:--|
| `resources` | `Record<string, S3DBResourceLike>` | Named resources |
