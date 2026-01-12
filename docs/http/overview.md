# HTTP Module

Raffel includes a complete HTTP toolkit that can be used standalone or with the multi-protocol server.

---

## Import

```typescript
import {
  // Server
  HttpApp, serve,

  // Middleware
  cors, compress, secureHeaders, bodyLimit,
  basicAuth, bearerAuth, cookieSession, oauth2, oidc,
  rateLimitMiddleware, validate,

  // Static files
  serveStatic, serveStaticS3,

  // Responses
  success, error, list, created, notFound, validationError,

  // Session
  createSessionTracker, createRedisSessionStore,
} from 'raffel/http'
```

---

## Standalone HTTP Server

Use the HTTP module independently:

```typescript
import { HttpApp, serve } from 'raffel/http'

const app = new HttpApp()

app.get('/health', (req) => {
  return { status: 'ok' }
})

app.post('/users', async (req) => {
  const body = await req.json()
  const user = await createUser(body)
  return { id: user.id, ...body }
})

serve(app, { port: 3000 })
```

---

## Middleware

### CORS

```typescript
import { cors } from 'raffel/http'

app.use(cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Authorization', 'Content-Type'],
  exposeHeaders: ['X-Request-Id'],
  credentials: true,
  maxAge: 86400,
}))
```

### Compression

```typescript
import { compress } from 'raffel/http'

app.use(compress({
  threshold: 1024,  // Only compress if > 1KB
  encodings: ['gzip', 'deflate', 'br'],
}))
```

### Security Headers

```typescript
import { secureHeaders } from 'raffel/http'

app.use(secureHeaders({
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  xXssProtection: '1; mode=block',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  contentSecurityPolicy: "default-src 'self'",
}))
```

### Body Limit

```typescript
import { bodyLimit } from 'raffel/http'

app.use(bodyLimit({
  maxSize: '10mb',
  types: ['application/json', 'multipart/form-data'],
}))
```

---

## Authentication Middleware

### Basic Auth

```typescript
import { basicAuth } from 'raffel/http'

app.use('/admin/*', basicAuth({
  username: 'admin',
  password: process.env.ADMIN_PASSWORD!,
}))
```

### Bearer Auth

```typescript
import { bearerAuth } from 'raffel/http'

app.use('/api/*', bearerAuth({
  verifyToken: async (token) => {
    const payload = await verifyJwt(token)
    return payload ?? null
  },
}))
```

### Cookie Session

```typescript
import { cookieSession } from 'raffel/http'

app.use(cookieSession({
  secret: process.env.COOKIE_SECRET!,
  cookieName: 'session',
  maxAge: 60 * 60 * 24 * 7, // seconds
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
}))
```

---

## Rate Limiting

```typescript
import { rateLimitMiddleware } from 'raffel/http'

app.use(rateLimitMiddleware({
  windowMs: 60 * 1000,    // 1 minute
  maxRequests: 100,        // 100 requests per window
  keyGenerator: (req) => req.headers.get('X-Forwarded-For') || req.ip,
  message: 'Too many requests, please try again later',
}))

// Per-route rate limit
app.post('/auth/login', rateLimitMiddleware({ maxRequests: 5 }), async (req) => {
  // Login logic
})
```

---

## Validation

```typescript
import { validate } from 'raffel/http'
import { z } from 'zod'

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
})

app.post('/users', validate({ body: createUserSchema }), async (req) => {
  // req.body is validated and typed
  const user = await createUser(req.body)
  return user
})

// Validate query params
app.get('/users', validate({
  query: z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().max(100).default(20),
  })
}), async (req) => {
  return getUsers(req.query.page, req.query.limit)
})
```

---

## Response Helpers

Standardized API responses:

```typescript
import {
  success, error, list, created, notFound, validationError
} from 'raffel/http'

app.get('/users/:id', async (req) => {
  const user = await db.users.findUnique({ where: { id: req.params.id } })
  if (!user) {
    return notFound('User not found')
  }
  return success(user)
})

app.get('/users', async (req) => {
  const { items, total } = await db.users.findMany()
  return list(items, { total, page: 1, pageSize: 20 })
})

app.post('/users', async (req) => {
  const user = await db.users.create({ data: req.body })
  return created(user, `/users/${user.id}`)
})

app.post('/login', async (req) => {
  const result = await authenticate(req.body)
  if (!result.success) {
    return error('INVALID_CREDENTIALS', 'Invalid email or password', 401)
  }
  return success({ token: result.token })
})
```

Response format:

```json
// success(data)
{ "success": true, "data": { ... } }

// list(items, pagination)
{
  "success": true,
  "data": [...],
  "pagination": { "total": 100, "page": 1, "pageSize": 20, "totalPages": 5 }
}

// error(code, message, status)
{ "success": false, "error": { "code": "NOT_FOUND", "message": "User not found" } }

// created(data, location)
// Status 201, Location header set
{ "success": true, "data": { ... } }
```

---

## Static Files

### Local Files

```typescript
import { serveStatic } from 'raffel/http'

app.use('/static/*', serveStatic({
  root: './public',
  index: 'index.html',
  maxAge: 86400,
  gzip: true,
  brotli: true,
}))
```

### S3 Files

```typescript
import { serveStaticS3 } from 'raffel/http'

app.use('/assets/*', serveStaticS3({
  bucket: 'my-assets-bucket',
  region: 'us-east-1',
  prefix: 'uploads/',
  maxAge: 86400,
}))
```

---

## Routing

```typescript
// Path parameters
app.get('/users/:id', (req) => {
  return { id: req.params.id }
})

// Wildcards
app.get('/files/*', (req) => {
  return { path: req.params['*'] }
})

// Method routing
app.all('/api/*', apiHandler)

// Route groups
app.group('/api/v1', (api) => {
  api.get('/users', listUsers)
  api.post('/users', createUser)
  api.get('/users/:id', getUser)
})
```

---

## Error Handling

```typescript
import { HttpError, serverError, notFound } from 'raffel/http'

// Global error handler
app.onError((err, req) => {
  console.error(err)

  if (err instanceof HttpError) {
    return err.toResponse()
  }

  return serverError('An unexpected error occurred')
})

// 404 handler
app.notFound((req) => {
  return notFound(`Route ${req.method} ${req.url} not found`)
})
```

---

## Request Context

```typescript
app.get('/example', (req) => {
  // URL info
  req.url          // Full URL
  req.path         // Path only
  req.method       // GET, POST, etc.

  // Headers
  req.headers.get('Authorization')
  req.headers.get('Content-Type')

  // Query params
  req.query.get('page')
  req.query.getAll('tags')

  // Path params
  req.params.id

  // Body (async)
  const json = await req.json()
  const text = await req.text()
  const form = await req.formData()

  // IP address
  req.ip

  // Custom context
  req.get('userId')  // Set by middleware
})
```

---

## Integration with Raffel Server

The HTTP module integrates seamlessly with the main server:

```typescript
import { createServer } from 'raffel'
import { cors, compress, secureHeaders } from 'raffel/http'

const server = createServer({ port: 3000 })

// Apply HTTP middleware
server.use(cors({ origin: '*' }))
server.use(compress())
server.use(secureHeaders())

// Define procedures
server.procedure('users.list')
  .handler(async () => db.users.findMany())

await server.start()
```

---

## Next Steps

- **[Middleware](middleware.md)** - All available middleware
- **[Responses](responses.md)** - Response helpers in detail
- **[Static Files](static.md)** - Serving static assets
- **[Health Checks](health.md)** - Health and readiness endpoints
