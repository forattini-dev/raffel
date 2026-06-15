# REST Auto-CRUD

Schema-first REST API generation from `src/rest/*.ts` files.

> Looking for the simpler handler-based variant? Resource files in
> `src/resources/*.ts` (no schema required) reach the HTTP plane the same
> way and follow REST status conventions: `POST` create → `201`,
> `DELETE` → `204`. See [`routing/file-system.md`](./file-system.md).

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
  pagination: true,
  searchable: ['name', 'email'],
  filterable: ['email'],
  sortable: ['name', 'createdAt'],
  auth: {
    list: 'none',
    create: 'required',
    delete: 'required',
  },
  softDelete: 'deletedAt',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
}
```

`auth` controls authentication only: `none`, `optional`, or `required`.
Authorization belongs in Raffel policies/authz, including roles, permissions,
tenant checks, and resource ownership.

---

## Pagination

Pagination is opt-in per resource. Without `pagination`, `GET /users` returns a
plain array:

```json
[
  { "id": "usr_1", "name": "Ada" }
]
```

Use `pagination: true` for offset pagination defaults:

```typescript
export const config = {
  operations: ['list', 'get'],
  pagination: true,
}
```

That enables `limit`, `page`, and `offset` query parameters and returns:

```json
{
  "data": [{ "id": "usr_1", "name": "Ada" }],
  "meta": {
    "total": 42,
    "limit": 20,
    "offset": 0,
    "page": 1,
    "hasMore": true
  }
}
```

For high-write lists, configure cursor pagination explicitly:

```typescript
export const config = {
  operations: ['list', 'get'],
  pagination: {
    style: 'cursor',
    defaultLimit: 25,
    maxLimit: 100,
    cursorField: 'id',
  },
}
```

Cursor lists use `limit` and `cursor` query parameters and return
`meta.nextCursor` only when another page exists.

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

Add custom REST actions beyond CRUD as an escape hatch for commands and state
transitions. Prefer normal REST subresources when the concept can be modeled as
a noun; use actions for commands such as `archive`, `retry`, `publish`, or
`cancel`.

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

S3DB integration is available through a dedicated package (not a core adapter).
