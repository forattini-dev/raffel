# Migration Guide

Move from common Node frameworks to Raffel with minimal friction.

---

## From Express

### Express

```typescript
app.post('/users', async (req, res) => {
  const input = req.body
  const user = await db.users.create({ data: input })
  res.json(user)
})
```

### Raffel

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .handler(async (input) => db.users.create({ data: input }))
```

Raffel maps procedures across all protocols automatically.

---

## From Fastify

Fastify routes map directly to procedures. Move your validation to Zod (or another
adapter) and reuse the same handler across protocols.

---

## From tRPC

tRPC routers become Raffel modules or file-based routes. Replace `router` with
`server.procedure()` and keep your schemas.

---

## Use MCP Prompts

Raffel MCP ships migration prompts:

- `migrate_from_express`
- `migrate_from_fastify`
- `migrate_from_trpc`

See [MCP Server](mcp.md).
