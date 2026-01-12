/**
 * Declarative API Example
 *
 * Demonstrates three ways to define endpoints in Raffel:
 * 1. Builder pattern (fluent)
 * 2. Resource builder (fluent for CRUD)
 * 3. Object-based (declarative)
 *
 * Choose based on your preference and use case!
 */

import { createServer } from '../src/server/index.js'
import { z } from 'zod'

// === Schemas ===

const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

const CreateUserInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
})

const UpdateUserInput = CreateUserInput.partial()

const Post = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
})

const CreatePostInput = z.object({
  title: z.string().min(1),
  content: z.string(),
  authorId: z.string(),
})

// === Mock Database ===

const db = {
  users: new Map<string, z.infer<typeof User>>(),
  posts: new Map<string, z.infer<typeof Post>>(),
}

// === Server ===

const server = createServer({
  port: 3008,
})
  .enableUSD({
    info: {
      title: 'Declarative API Demo',
      version: '1.0.0',
      description: `
## Three Ways to Define Endpoints

### 1. Builder Pattern (Fluent)
Most flexible, good for complex cases with custom configuration.

\`\`\`typescript
server.procedure('auth.login')
  .input(LoginInput)
  .output(AuthResponse)
  .http('/auth/login', 'POST')
  .tags(['Auth'])
  .handler(async (input) => { ... })
\`\`\`

### 2. Resource Builder (Fluent CRUD)
Perfect for standard REST resources.

\`\`\`typescript
server.resource('users', User)
  .list(async () => db.users.list())
  .get(async (id) => db.users.get(id))
  .create(CreateInput, async (input) => db.users.create(input))
\`\`\`

### 3. Object-Based (Declarative)
Most concise, define everything as plain objects.

\`\`\`typescript
server.procedures({
  'users.list': {
    output: z.array(User),
    http: ['GET', '/users'],
    handler: async () => db.users.list()
  }
})

server.resources({
  posts: {
    schema: Post,
    list: async () => db.posts.list(),
    get: async (id) => db.posts.get(id)
  }
})
\`\`\`
      `,
    },
  })

// ============================================================
// STYLE 1: Builder Pattern (Fluent)
// Best for: Complex procedures with many options
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
  .handler(async (input, ctx) => {
    // Mock login
    const user = { id: '1', name: 'Demo User', email: input.email }
    return { token: 'jwt-token-here', user }
  })

server
  .procedure('auth.me')
  .output(User)
  .http(['GET', '/auth/me'])
  .tags(['Auth'])
  .handler(async (input, ctx) => {
    return { id: '1', name: 'Demo User', email: 'demo@example.com' }
  })

// ============================================================
// STYLE 2: Resource Builder (Fluent CRUD)
// Best for: Standard REST resources with CRUD operations
// ============================================================

server
  .resource('users', User)
  .tags(['Users'])
  .list(async (input, ctx) => {
    return Array.from(db.users.values())
  })
  .get(async (id, ctx) => {
    return db.users.get(id) ?? null
  })
  .create(CreateUserInput, async (input, ctx) => {
    const user = { id: crypto.randomUUID(), ...input }
    db.users.set(user.id, user)
    return user
  })
  .update(UpdateUserInput, async (id, input, ctx) => {
    const existing = db.users.get(id)
    if (!existing) throw new Error('User not found')
    const updated = { ...existing, ...input }
    db.users.set(id, updated)
    return updated
  })
  .delete(async (id, ctx) => {
    db.users.delete(id)
  })

// ============================================================
// STYLE 3: Object-Based (Declarative)
// Best for: Concise definitions, multiple endpoints at once
// ============================================================

// Define multiple procedures at once
server.procedures({
  'health.check': {
    output: z.object({ status: z.string(), timestamp: z.string() }),
    http: ['GET', '/health'],
    tags: ['System'],
    summary: 'Health check endpoint',
    handler: async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),
  },

  'system.info': {
    output: z.object({
      version: z.string(),
      uptime: z.number(),
      nodeVersion: z.string(),
    }),
    http: ['GET', '/system/info'],
    tags: ['System'],
    handler: async () => ({
      version: '1.0.0',
      uptime: process.uptime(),
      nodeVersion: process.version,
    }),
  },
})

// Define multiple resources at once
server.resources({
  posts: {
    schema: Post,
    tags: ['Posts'],

    // Simple function for list
    list: async () => Array.from(db.posts.values()),

    // Simple function for get
    get: async (id) => db.posts.get(id) ?? null,

    // Object with input schema for create
    create: {
      input: CreatePostInput,
      handler: async (input) => {
        const post = { id: crypto.randomUUID(), ...input } as z.infer<typeof Post>
        db.posts.set(post.id, post)
        return post
      },
    },

    // Object with input schema for update
    update: {
      input: CreatePostInput.partial(),
      handler: async (id, input) => {
        const existing = db.posts.get(id)
        if (!existing) throw new Error('Post not found')
        const updated = { ...existing, ...input }
        db.posts.set(id, updated)
        return updated
      },
    },

    // Simple function for delete
    delete: async (id) => {
      db.posts.delete(id)
    },

    // Custom actions
    actions: {
      bulkDelete: {
        input: z.object({ ids: z.array(z.string()) }),
        handler: async (input) => {
          for (const id of input.ids) {
            db.posts.delete(id)
          }
          return { deleted: input.ids.length }
        },
      },
    },

    // Custom item actions
    itemActions: {
      publish: async (id) => {
        const post = db.posts.get(id)
        if (!post) throw new Error('Post not found')
        return { ...post, published: true }
      },
    },
  },
})

// === Start ===

server.start().then(() => {
  console.log('Server running at http://localhost:3008')
  console.log('Docs at http://localhost:3008/docs')
  console.log('')
  console.log('=== API Styles Demonstrated ===')
  console.log('')
  console.log('1. BUILDER PATTERN (Fluent):')
  console.log('   POST /auth/login   → auth.login')
  console.log('   GET  /auth/me      → auth.me')
  console.log('')
  console.log('2. RESOURCE BUILDER (Fluent CRUD):')
  console.log('   GET    /users      → users.list')
  console.log('   GET    /users/:id  → users.get')
  console.log('   POST   /users      → users.create')
  console.log('   PUT    /users/:id  → users.update')
  console.log('   DELETE /users/:id  → users.delete')
  console.log('')
  console.log('3. OBJECT-BASED (Declarative):')
  console.log('   GET    /health        → health.check')
  console.log('   GET    /system/info   → system.info')
  console.log('   GET    /posts         → posts.list')
  console.log('   GET    /posts/:id     → posts.get')
  console.log('   POST   /posts         → posts.create')
  console.log('   PUT    /posts/:id     → posts.update')
  console.log('   DELETE /posts/:id     → posts.delete')
  console.log('   POST   /posts/bulkDelete      → posts.bulkDelete')
  console.log('   POST   /posts/:id/publish     → posts.publish')
})
