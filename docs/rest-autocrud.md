# REST Auto-CRUD

Schema-first REST API generation from `src/rest/*.ts` files.

---

## Basic Resource

```typescript
// src/rest/users.ts
import { z } from 'zod'

export const schema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  email: z.string().email(),
})

export const adapter = prisma.user
```

Generated routes:

```
GET    /users           → list
GET    /users/:id       → get
POST   /users           → create
PUT    /users/:id       → update
PATCH  /users/:id       → patch
DELETE /users/:id       → delete
```

---

## Configuration

```typescript
export const config = {
  primaryKey: 'id',
  operations: ['list', 'get', 'create', 'update', 'delete'],
  pagination: { defaultLimit: 20, maxLimit: 100 },
  searchable: ['name', 'email'],
  filterable: ['email'],
  sortable: ['name', 'createdAt'],
  auth: {
    list: 'none',
    create: 'required',
    delete: { roles: ['admin'] },
  },
  softDelete: 'deletedAt',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
}
```

---

## Custom Handlers

Override any operation by exporting a handler:

```typescript
export const list = async (input, ctx) => {
  return db.user.findMany({ where: { active: true } })
}

export const create = {
  handler: async (input, ctx) => db.user.create({ data: input }),
  auth: 'required',
}
```

Set an operation to `false` to disable it:

```typescript
export const delete = false
```

---

## Actions

Add custom REST actions beyond CRUD:

```typescript
export const actions = {
  suspend: {
    method: 'POST',
    path: '/users/:id/suspend',
    handler: async ({ id }) => ({ id, status: 'suspended' }),
  },
}
```

---

## Adapters

Adapters power persistence. You can pass:

- Prisma model delegate
- Custom adapter implementing the REST adapter interface

Raffel ships with S3DB adapter support via `createS3DBAdapter`.
