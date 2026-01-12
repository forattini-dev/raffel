/**
 * Example 1: Complete REST API Server
 *
 * Features demonstrated:
 * - Programmatic procedure registration
 * - Authentication (Bearer token)
 * - Authorization (RBAC)
 * - GraphQL endpoint
 * - Metrics and Tracing
 * - USD (Universal Service Documentation)
 */

import { z } from 'zod'
import {
  createServer,
  createLogger,
  createZodAdapter,
  registerValidator,
  createBearerStrategy,
  createAuthMiddleware,
  hasRole,
  Errors,
  sid,
} from '../src/index.js'

const logger = createLogger({ name: 'rest-api', level: 'debug' })

// Register Zod validator
registerValidator(createZodAdapter(z))

// =============================================================================
// In-Memory Data Store
// =============================================================================

interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'user' | 'moderator'
  createdAt: Date
}

interface Post {
  id: string
  title: string
  content: string
  authorId: string
  published: boolean
  createdAt: Date
}

const db = {
  users: new Map<string, User>([
    ['user-1', { id: 'user-1', email: 'admin@example.com', name: 'Admin User', role: 'admin', createdAt: new Date() }],
    ['user-2', { id: 'user-2', email: 'alice@example.com', name: 'Alice Smith', role: 'user', createdAt: new Date() }],
    ['user-3', { id: 'user-3', email: 'bob@example.com', name: 'Bob Johnson', role: 'moderator', createdAt: new Date() }],
  ]),
  posts: new Map<string, Post>([
    ['post-1', { id: 'post-1', title: 'Hello World', content: 'First post!', authorId: 'user-1', published: true, createdAt: new Date() }],
    ['post-2', { id: 'post-2', title: 'Draft Post', content: 'Work in progress...', authorId: 'user-2', published: false, createdAt: new Date() }],
  ]),
}

// Token -> User mapping
const tokens: Record<string, string> = {
  'admin-token': 'user-1',
  'alice-token': 'user-2',
  'bob-token': 'user-3',
}

// =============================================================================
// Schemas
// =============================================================================

const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'user', 'moderator']),
  createdAt: z.date(),
})

const PostSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  published: z.boolean(),
  createdAt: z.date(),
})

const CreatePostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  published: z.boolean().default(false),
})

// =============================================================================
// Server Setup
// =============================================================================

const server = createServer({
  port: 3001,
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  },
})
  // Authentication
  .use(
    createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          async verify(token) {
            const userId = tokens[token]
            if (!userId) return null

            const user = db.users.get(userId)
            if (!user) return null

            return {
              authenticated: true,
              principal: user.id,
              roles: [user.role],
              claims: { email: user.email, name: user.name },
            }
          },
        }),
      ],
      publicProcedures: ['health'],
    })
  )

  // Metrics
  .enableMetrics({
    path: '/metrics',
    includeProcessMetrics: true,
  })

  // Tracing
  .enableTracing({
    serviceName: 'rest-api-example',
    sampler: { type: 'probability', probability: 0.1 },
  })

  // USD Documentation (Universal Service Documentation)
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'REST API Example',
      version: '1.0.0',
      description: 'Complete REST API with authentication, authorization, metrics, tracing, and GraphQL support.',
    },
  })

  // GraphQL
  .enableGraphQL({
    path: '/graphql',
    graphiql: true,
  })

// =============================================================================
// Procedures
// =============================================================================

// Health check
server
  .procedure('health')
  .description('Health check')
  .output(z.object({ status: z.string(), timestamp: z.string() }))
  .handler(async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  }))

// List users
server
  .procedure('users.list')
  .description('List all users')
  .output(z.array(UserSchema))
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    return Array.from(db.users.values())
  })

// Get user by ID
server
  .procedure('users.get')
  .description('Get user by ID')
  .input(z.object({ id: z.string() }))
  .output(UserSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const user = db.users.get(input.id)
    if (!user) throw Errors.notFound(`User ${input.id} not found`)
    return user
  })

// Get current user
server
  .procedure('me')
  .description('Get current authenticated user')
  .output(UserSchema)
  .handler(async (_, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()
    const user = db.users.get(ctx.auth.principal!)
    if (!user) throw Errors.notFound('User not found')
    return user
  })

// List posts
server
  .procedure('posts.list')
  .description('List all posts')
  .input(z.object({ onlyPublished: z.boolean().default(true) }).optional())
  .output(z.array(PostSchema))
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()

    const posts = Array.from(db.posts.values())
    if (input?.onlyPublished && !hasRole('admin')(ctx)) {
      return posts.filter(p => p.published || p.authorId === ctx.auth!.principal)
    }
    return posts
  })

// Create post
server
  .procedure('posts.create')
  .description('Create a new post')
  .input(CreatePostSchema)
  .output(PostSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()

    const post: Post = {
      id: sid(),
      title: input.title,
      content: input.content,
      authorId: ctx.auth.principal!,
      published: input.published,
      createdAt: new Date(),
    }
    db.posts.set(post.id, post)
    logger.info({ postId: post.id }, 'Post created')
    return post
  })

// Get post by ID
server
  .procedure('posts.get')
  .description('Get post by ID')
  .input(z.object({ id: z.string() }))
  .output(PostSchema)
  .handler(async (input, ctx) => {
    if (!ctx.auth?.authenticated) throw Errors.unauthenticated()

    const post = db.posts.get(input.id)
    if (!post) throw Errors.notFound(`Post ${input.id} not found`)

    // Only show draft posts to author or admin
    if (!post.published && post.authorId !== ctx.auth.principal && !hasRole('admin')(ctx)) {
      throw Errors.notFound(`Post ${input.id} not found`)
    }
    return post
  })

// Delete post (admin only)
server
  .procedure('posts.delete')
  .description('Delete a post (admin only)')
  .input(z.object({ id: z.string() }))
  .output(z.object({ success: z.boolean() }))
  .handler(async (input, ctx) => {
    if (!hasRole('admin')(ctx)) throw Errors.permissionDenied('Admin only')

    const post = db.posts.get(input.id)
    if (!post) throw Errors.notFound(`Post ${input.id} not found`)

    db.posts.delete(input.id)
    logger.info({ postId: input.id }, 'Post deleted')
    return { success: true }
  })

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  await server.start()

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ██████╗ ███████╗███████╗████████╗     █████╗ ██████╗ ██╗                    ║
║  ██╔══██╗██╔════╝██╔════╝╚══██╔══╝    ██╔══██╗██╔══██╗██║                    ║
║  ██████╔╝█████╗  ███████╗   ██║       ███████║██████╔╝██║                    ║
║  ██╔══██╗██╔══╝  ╚════██║   ██║       ██╔══██║██╔═══╝ ██║                    ║
║  ██║  ██║███████╗███████║   ██║       ██║  ██║██║     ██║                    ║
║  ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝       ╚═╝  ╚═╝╚═╝     ╚═╝                    ║
║                                                                              ║
║              Complete REST API with Auth, Metrics, and GraphQL               ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🌐 HTTP:       http://localhost:3001                                        ║
║  📚 Swagger:    http://localhost:3001/docs                                   ║
║  📖 RaffelDocs: http://localhost:3001/raffeldocs                             ║
║  🔮 GraphQL:    http://localhost:3001/graphql                                ║
║  📊 Metrics:    http://localhost:3001/metrics                                ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  🔑 Auth Tokens:                                                             ║
║     admin-token  → Admin (full access)                                       ║
║     alice-token  → Regular user                                              ║
║     bob-token    → Moderator                                                 ║
║                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  📋 Example Requests:                                                        ║
║                                                                              ║
║  # Health check (public)                                                     ║
║  curl http://localhost:3001/health                                           ║
║                                                                              ║
║  # Get current user (requires auth)                                          ║
║  curl http://localhost:3001/me -H "Authorization: Bearer alice-token"        ║
║                                                                              ║
║  # List users                                                                ║
║  curl http://localhost:3001/users.list \\                                     ║
║    -H "Authorization: Bearer admin-token"                                    ║
║                                                                              ║
║  # Create post                                                               ║
║  curl -X POST http://localhost:3001/posts.create \\                           ║
║    -H "Content-Type: application/json" \\                                     ║
║    -H "Authorization: Bearer alice-token" \\                                  ║
║    -d '{"title":"My Post","content":"Hello!","published":true}'              ║
║                                                                              ║
║  # GraphQL query                                                             ║
║  curl -X POST http://localhost:3001/graphql \\                                ║
║    -H "Content-Type: application/json" \\                                     ║
║    -H "Authorization: Bearer admin-token" \\                                  ║
║    -d '{"query":"{ users_list { id name email } }"}'                         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)

  logger.info('REST API server started')
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
