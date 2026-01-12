/**
 * Resource Builder Example
 *
 * Demonstrates the new Resource Builder API that dramatically
 * reduces verbosity for REST CRUD operations.
 */

import { createServer } from '../src/server/index.js'
import { z } from 'zod'

// === Schemas ===

const User = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
})

const CreateUserInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
})

const UpdateUserInput = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
})

const ListUsersInput = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})

// === Mock Database ===

const users = new Map<string, z.infer<typeof User>>()

// === Server ===

const server = createServer({
  port: 3007,
})
  .enableUSD({
    info: {
      title: 'Resource Builder Demo',
      version: '1.0.0',
      description: `
## Comparison: Verbose vs Concise

### Before (Verbose API)

To create full CRUD for a resource, you needed 5+ procedures:

\`\`\`typescript
server.procedure('users.list')
  .input(ListUsersInput)
  .output(z.array(User))
  .http('/users', 'GET')
  .handler(async (input, ctx) => db.users.list(input))

server.procedure('users.get')
  .input(z.object({ id: z.string() }))
  .output(User)
  .http('/users/:id', 'GET')
  .handler(async (input, ctx) => db.users.findById(input.id))

server.procedure('users.create')
  .input(CreateUserInput)
  .output(User)
  .http('/users', 'POST')
  .handler(async (input, ctx) => db.users.create(input))

server.procedure('users.update')
  .input(UpdateUserInput)
  .output(User)
  .http('/users/:id', 'PUT')
  .handler(async (id, input, ctx) => db.users.update(id, input))

server.procedure('users.delete')
  .http('/users/:id', 'DELETE')
  .handler(async (input, ctx) => db.users.delete(input.id))
\`\`\`

### After (Resource Builder)

\`\`\`typescript
server.resource('users', User)
  .list(ListUsersInput, async (input) => db.users.list(input))
  .get(async (id) => db.users.findById(id))
  .create(CreateUserInput, async (input) => db.users.create(input))
  .update(UpdateUserInput, async (id, input) => db.users.update(id, input))
  .delete(async (id) => db.users.delete(id))
\`\`\`

**5x less code!**
      `,
    },
  })

// === Resource Definition (The Concise Way) ===

server
  .resource('users', User)
  .tags(['Users'])
  .list(ListUsersInput, async (input, ctx) => {
    const allUsers = Array.from(users.values())
    const start = (input.page - 1) * input.limit
    return allUsers.slice(start, start + input.limit)
  })
  .get(async (id, ctx) => {
    return users.get(id) ?? null
  })
  .create(CreateUserInput, async (input, ctx) => {
    const user = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
    }
    users.set(user.id, user)
    return user
  })
  .update(UpdateUserInput, async (id, input, ctx) => {
    const existing = users.get(id)
    if (!existing) throw new Error('User not found')
    const updated = { ...existing, ...input }
    users.set(id, updated)
    return updated
  })
  .delete(async (id, ctx) => {
    users.delete(id)
  })
  // Custom actions
  .action(
    'import',
    z.object({ users: z.array(CreateUserInput) }),
    async (input, ctx) => {
      const created: z.infer<typeof User>[] = []
      for (const userData of input.users) {
        const user = {
          id: crypto.randomUUID(),
          ...userData,
          createdAt: new Date().toISOString(),
        }
        users.set(user.id, user)
        created.push(user)
      }
      return created
    }
  )
  .itemAction('deactivate', async (id, ctx) => {
    const user = users.get(id)
    if (!user) throw new Error('User not found')
    // In real app: mark as inactive
    return user
  })

// === Start ===

server.start().then(() => {
  console.log('Server running at http://localhost:3007')
  console.log('Docs at http://localhost:3007/docs')
  console.log('')
  console.log('Endpoints generated:')
  console.log('  GET    /users           → users.list')
  console.log('  GET    /users/:id       → users.get')
  console.log('  POST   /users           → users.create')
  console.log('  PUT    /users/:id       → users.update')
  console.log('  DELETE /users/:id       → users.delete')
  console.log('  POST   /users/import    → users.import')
  console.log('  POST   /users/:id/deactivate → users.deactivate')
})
