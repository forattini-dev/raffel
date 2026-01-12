# HTTP Responses

Standard response helpers for consistent JSON output.

---

## Success & Errors

```typescript
import { success, error, created, noContent } from 'raffel/http'

return success({ id: '123' })
return created({ id: '123' })
return noContent()
return error('User not found', 404)
```

---

## Lists + Pagination

```typescript
import { list } from 'raffel/http'

return list(users, { page: 1, pageSize: 20, total: 240 })
```

---

## Convenience Helpers

```typescript
import {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  validationError,
  tooManyRequests,
  serverError,
  serviceUnavailable,
} from 'raffel/http'

return validationError([{ field: 'email', message: 'Invalid email' }])
```

---

## Field Filtering

```typescript
import { filterProtectedFields } from 'raffel/http'

const safeUser = filterProtectedFields(user, ['password', 'secret'])
return success(safeUser)
```
