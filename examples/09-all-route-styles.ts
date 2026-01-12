/**
 * All Route Definition Styles
 *
 * Comprehensive demonstration of every route definition style in Raffel.
 * Each style has trade-offs - choose based on your use case and preferences.
 *
 * Styles covered:
 * 1. Fluent Builder API - .procedure().input().output().handler()
 * 2. Resource Builder API - .resource().list().get().create()
 * 3. Object Map API - .procedures({...}), .resources({...})
 * 4. Programmatic API - .addProcedure()
 * 5. Grouping - .group(), .mount()
 * 6. Custom Resource Actions - .action(), .itemAction()
 * 7. HTTP Namespace - server.http.get(), server.http.post()
 */

import { createServer, createRouterModule } from '../src/server/index.js'
import { z } from 'zod'

// === Schemas ===

const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

const Post = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
})

const Comment = z.object({
  id: z.string(),
  postId: z.string(),
  content: z.string(),
})

// === Mock Database ===

const db = {
  users: new Map<string, z.infer<typeof User>>(),
  posts: new Map<string, z.infer<typeof Post>>(),
  comments: new Map<string, z.infer<typeof Comment>>(),
}

// === Server ===

const server = createServer({
  port: 3009,
})
  .enableUSD({
    info: {
      title: 'All Route Definition Styles',
      version: '1.0.0',
      description: `
# Route Definition Styles in Raffel

Raffel provides **7 different ways** to define routes, each optimized for different use cases.

---

## 1. Fluent Builder API
Most flexible, ideal for complex endpoints with custom configuration.

\`\`\`typescript
server.procedure('auth.login')
  .input(z.object({ email: z.string(), password: z.string() }))
  .output(z.object({ token: z.string() }))
  .http('/auth/login', 'POST')
  .tags(['Auth'])
  .summary('User login')
  .handler(async (input, ctx) => {
    return { token: 'jwt-token' }
  })
\`\`\`

---

## 2. Resource Builder API
Perfect for REST CRUD operations - **5x less code** than fluent builder.

\`\`\`typescript
server.resource('users', User)
  .tags(['Users'])
  .list(async () => db.users.list())
  .get(async (id) => db.users.get(id))
  .create(CreateInput, async (input) => db.users.create(input))
  .update(UpdateInput, async (id, input) => db.users.update(id, input))
  .delete(async (id) => db.users.delete(id))
\`\`\`

---

## 3. Object Map API
Most concise, define multiple endpoints at once.

\`\`\`typescript
// Multiple procedures
server.procedures({
  'health.check': {
    output: z.object({ status: z.string() }),
    http: ['GET', '/health'],
    handler: async () => ({ status: 'ok' })
  }
})

// Multiple resources
server.resources({
  posts: {
    schema: Post,
    list: async () => db.posts.list(),
    get: async (id) => db.posts.get(id)
  }
})
\`\`\`

---

## 4. Programmatic API
For dynamic route registration from external sources.

\`\`\`typescript
// Add routes programmatically
server.addProcedure({
  name: 'dynamic.endpoint',
  handler: async () => ({ loaded: 'dynamically' }),
  metadata: {
    httpPath: '/dynamic',
    httpMethod: 'GET'
  }
})

// Useful for:
// - Loading routes from database
// - Plugin systems
// - Auto-generated routes
\`\`\`

---

## 5. Grouping (group & mount)
Organize routes with prefixes and shared middleware.

\`\`\`typescript
// Simple grouping
const admin = server.group('admin')
admin.procedure('stats').handler(async () => ({ ... }))
// → admin.stats at /admin/stats

// Router modules (for code splitting)
const usersModule = createRouterModule()
usersModule.procedure('list').http('/').handler(...)
usersModule.procedure('get').http('/:id').handler(...)

server.mount('users', usersModule)
// → /users/, /users/:id
\`\`\`

---

## 6. Custom Resource Actions
Extend resources beyond CRUD.

\`\`\`typescript
server.resource('posts', Post)
  // Standard CRUD
  .list(...)
  .get(...)
  // Collection actions (POST /posts/bulkDelete)
  .action('bulkDelete', BulkDeleteInput, async (input) => { ... })
  // Item actions (POST /posts/:id/publish)
  .itemAction('publish', async (id) => { ... })
\`\`\`

---

## 7. HTTP Namespace (Hono-style)
Direct HTTP route definition for simple endpoints.

\`\`\`typescript
// Simple routes without procedure names
server.http
  .get('/version', async (ctx) => ({ version: '1.0.0' }))
  .post('/webhook', async (ctx) => {
    const body = await ctx.req.json()
    return { received: true }
  })

// With typed input/output
server.http.get('/metrics', {
  input: z.object({ format: z.enum(['json', 'prometheus']) }),
  output: z.object({ metrics: z.array(z.object({ name: z.string(), value: z.number() })) })
}, async (input, ctx) => {
  return { metrics: [] }
})
\`\`\`

---

## When to Use Each Style

| Style | Best For |
|-------|----------|
| Fluent Builder | Complex procedures with many options |
| Resource Builder | Standard REST CRUD resources |
| Object Map | Bulk definition, config-driven routes |
| Programmatic | Dynamic/runtime route registration |
| Grouping | Organizing routes, shared middleware |
| Custom Actions | Extending resources beyond CRUD |
| HTTP Namespace | Simple HTTP-only endpoints |
      `,
    },
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management (Resource Builder)' },
      { name: 'Posts', description: 'Post management (Object Map)' },
      { name: 'Comments', description: 'Comments (Router Module)' },
      { name: 'Admin', description: 'Admin group' },
      { name: 'System', description: 'System endpoints' },
      { name: 'HTTP', description: 'HTTP namespace endpoints' },
    ],
  })

// ============================================================
// STYLE 1: Fluent Builder API
// Best for: Complex endpoints with custom configuration
// ============================================================

server
  .procedure('auth.login')
  .input(
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
    })
  )
  .output(
    z.object({
      token: z.string(),
      user: User,
    })
  )
  .http('/auth/login', 'POST')
  .tags(['Auth'])
  .summary('Login with email and password')
  .description('Returns a JWT token and user info')
  .handler(async (input, ctx) => {
    const user = { id: '1', name: 'Demo User', email: input.email }
    return { token: 'jwt-token-here', user }
  })

server
  .procedure('auth.logout')
  .http('/auth/logout', 'POST')
  .tags(['Auth'])
  .summary('Logout current session')
  .handler(async () => {
    return { success: true }
  })

// ============================================================
// STYLE 2: Resource Builder API
// Best for: Standard REST resources with CRUD operations
// ============================================================

server
  .resource('users', User)
  .tags(['Users'])
  .list(async () => {
    return Array.from(db.users.values())
  })
  .get(async (id) => {
    return db.users.get(id) ?? null
  })
  .create(
    z.object({
      name: z.string().min(2),
      email: z.string().email(),
    }),
    async (input) => {
      const user = { id: crypto.randomUUID(), ...input }
      db.users.set(user.id, user)
      return user
    }
  )
  .update(
    z.object({
      name: z.string().min(2).optional(),
      email: z.string().email().optional(),
    }),
    async (id, input) => {
      const existing = db.users.get(id)
      if (!existing) throw new Error('User not found')
      const updated = { ...existing, ...input }
      db.users.set(id, updated)
      return updated
    }
  )
  .delete(async (id) => {
    db.users.delete(id)
  })
  // STYLE 6: Custom Resource Actions
  .action(
    'invite',
    z.object({ emails: z.array(z.string().email()) }),
    async (input) => {
      return { invited: input.emails.length }
    }
  )
  .itemAction('deactivate', async (id) => {
    const user = db.users.get(id)
    if (!user) throw new Error('User not found')
    return { ...user, active: false }
  })

// ============================================================
// STYLE 3: Object Map API
// Best for: Bulk definition, config-driven routes
// ============================================================

// Define multiple procedures at once
server.procedures({
  'health.check': {
    output: z.object({ status: z.string(), timestamp: z.string() }),
    http: ['GET', '/health'],
    tags: ['System'],
    summary: 'Health check',
    handler: async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
  },

  'system.version': {
    output: z.object({
      version: z.string(),
      nodeVersion: z.string(),
    }),
    http: ['GET', '/version'],
    tags: ['System'],
    summary: 'Get version info',
    handler: async () => ({
      version: '1.0.0',
      nodeVersion: process.version,
    }),
  },
})

// Define multiple resources at once
server.resources({
  posts: {
    schema: Post,
    tags: ['Posts'],
    list: async () => Array.from(db.posts.values()),
    get: async (id: string) => db.posts.get(id) ?? null,
    create: {
      input: z.object({
        title: z.string().min(1),
        content: z.string(),
        authorId: z.string(),
      }),
      handler: async (input: { title: string; content: string; authorId: string }) => {
        const post: z.infer<typeof Post> = {
          id: crypto.randomUUID(),
          title: input.title,
          content: input.content,
          authorId: input.authorId,
        }
        db.posts.set(post.id, post)
        return post
      },
    },
    delete: async (id: string) => {
      db.posts.delete(id)
    },
    // Custom actions in object style
    actions: {
      bulkDelete: {
        input: z.object({ ids: z.array(z.string()) }),
        handler: async (input: { ids: string[] }) => {
          for (const id of input.ids) db.posts.delete(id)
          return { deleted: input.ids.length }
        },
      },
    },
    itemActions: {
      publish: async (id: string) => {
        const post = db.posts.get(id)
        if (!post) throw new Error('Post not found')
        return { id: post.id, title: post.title, content: post.content, authorId: post.authorId, published: true }
      },
    },
  },
})

// ============================================================
// STYLE 4: Programmatic API
// Best for: Dynamic route registration, plugins, auto-generation
// ============================================================

// Add a procedure programmatically
server.addProcedure({
  name: 'dynamic.loaded',
  handler: async () => ({
    message: 'This route was added programmatically',
    loadedAt: new Date().toISOString(),
  }),
  httpPath: '/dynamic',
  httpMethod: 'GET',
  tags: ['System'],
  summary: 'Dynamically loaded endpoint',
})

// Useful for loading routes from external sources
const dynamicRoutes = [
  { name: 'plugin.feature1', path: '/plugin/feature1' },
  { name: 'plugin.feature2', path: '/plugin/feature2' },
]

for (const route of dynamicRoutes) {
  server.addProcedure({
    name: route.name,
    handler: async () => ({ feature: route.name }),
    httpPath: route.path,
    httpMethod: 'GET',
    tags: ['System'],
  })
}

// ============================================================
// STYLE 5: Grouping (group & mount)
// Best for: Organizing routes with prefixes, shared middleware
// ============================================================

// Simple grouping - creates prefixed procedures
const admin = server.group('admin')

admin
  .procedure('stats')
  .output(
    z.object({
      totalUsers: z.number(),
      totalPosts: z.number(),
    })
  )
  .http('/admin/stats', 'GET')
  .tags(['Admin'])
  .summary('Get admin statistics')
  .handler(async () => ({
    totalUsers: db.users.size,
    totalPosts: db.posts.size,
  }))

admin
  .procedure('config')
  .output(z.object({ settings: z.record(z.string(), z.string()) }))
  .http('/admin/config', 'GET')
  .tags(['Admin'])
  .handler(async () => ({
    settings: { debug: 'false', maxUpload: '10mb' },
  }))

// Router modules - for code splitting and reuse
const commentsModule = createRouterModule()

commentsModule
  .procedure('list')
  .output(z.array(Comment))
  .http('/', 'GET')
  .tags(['Comments'])
  .summary('List all comments')
  .handler(async () => Array.from(db.comments.values()))

commentsModule
  .procedure('get')
  .input(z.object({ id: z.string() }))
  .output(Comment.nullable())
  .http('/:id', 'GET')
  .tags(['Comments'])
  .handler(async (input) => db.comments.get(input.id) ?? null)

commentsModule
  .procedure('create')
  .input(z.object({ postId: z.string(), content: z.string() }))
  .output(Comment)
  .http('/', 'POST')
  .tags(['Comments'])
  .handler(async (input: { postId: string; content: string }) => {
    const comment: z.infer<typeof Comment> = {
      id: crypto.randomUUID(),
      postId: input.postId,
      content: input.content,
    }
    db.comments.set(comment.id, comment)
    return comment
  })

// Mount the module with a prefix
server.mount('comments', commentsModule)

// ============================================================
// STYLE 7: HTTP Namespace (Hono-style)
// Best for: Simple HTTP-only endpoints without procedure names
// ============================================================

server.http
  .get('/api/ping', async () => ({ pong: true }))

  .get(
    '/api/metrics',
    {
      output: z.object({
        uptime: z.number(),
        memory: z.object({
          used: z.number(),
          total: z.number(),
        }),
      }),
      tags: ['HTTP'],
      summary: 'Get server metrics',
    },
    async () => {
      const mem = process.memoryUsage()
      return {
        uptime: process.uptime(),
        memory: {
          used: mem.heapUsed,
          total: mem.heapTotal,
        },
      }
    }
  )

  .post(
    '/api/echo',
    {
      input: z.object({ message: z.string() }),
      output: z.object({ echo: z.string(), timestamp: z.string() }),
      tags: ['HTTP'],
      summary: 'Echo back a message',
    },
    async (input) => ({
      echo: input.message,
      timestamp: new Date().toISOString(),
    })
  )

// ============================================================
// Start Server
// ============================================================

server.start().then(() => {
  console.log('\n🚀 Server running at http://localhost:3009')
  console.log('📚 Docs at http://localhost:3009/docs\n')

  console.log('='.repeat(60))
  console.log('ALL ROUTE DEFINITION STYLES DEMONSTRATED')
  console.log('='.repeat(60))

  console.log('\n📌 STYLE 1: Fluent Builder API')
  console.log('   POST /auth/login    → auth.login')
  console.log('   POST /auth/logout   → auth.logout')

  console.log('\n📌 STYLE 2: Resource Builder API')
  console.log('   GET    /users       → users.list')
  console.log('   GET    /users/:id   → users.get')
  console.log('   POST   /users       → users.create')
  console.log('   PUT    /users/:id   → users.update')
  console.log('   DELETE /users/:id   → users.delete')

  console.log('\n📌 STYLE 3: Object Map API')
  console.log('   GET  /health      → health.check')
  console.log('   GET  /version     → system.version')
  console.log('   GET  /posts       → posts.list')
  console.log('   POST /posts       → posts.create')

  console.log('\n📌 STYLE 4: Programmatic API')
  console.log('   GET  /dynamic          → dynamic.loaded')
  console.log('   GET  /plugin/feature1  → plugin.feature1')
  console.log('   GET  /plugin/feature2  → plugin.feature2')

  console.log('\n📌 STYLE 5: Grouping (group & mount)')
  console.log('   GET  /admin/stats    → admin.stats')
  console.log('   GET  /admin/config   → admin.config')
  console.log('   GET  /comments       → comments.list')
  console.log('   GET  /comments/:id   → comments.get')
  console.log('   POST /comments       → comments.create')

  console.log('\n📌 STYLE 6: Custom Resource Actions')
  console.log('   POST /users/invite        → users.invite')
  console.log('   POST /users/:id/deactivate → users.deactivate')
  console.log('   POST /posts/bulkDelete    → posts.bulkDelete')
  console.log('   POST /posts/:id/publish   → posts.publish')

  console.log('\n📌 STYLE 7: HTTP Namespace')
  console.log('   GET  /api/ping    → (anonymous)')
  console.log('   GET  /api/metrics → (anonymous)')
  console.log('   POST /api/echo    → (anonymous)')

  console.log('\n' + '='.repeat(60))
})
