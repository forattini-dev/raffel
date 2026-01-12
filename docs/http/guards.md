# HTTP Guards

Declarative route guards for authorization in the HTTP module.

---

## Built-in Guards

```typescript
import { requireUser, requireRole, requireScope } from 'raffel/http'

app.get('/profile', requireUser(), profileHandler)
app.get('/admin', requireRole('admin'), adminHandler)
app.get('/billing', requireScope('billing:read'), billingHandler)
```

---

## Guard Registry

```typescript
import { createGuardsRegistry } from 'raffel/http'

const guards = createGuardsRegistry()

guards.register('isOwner', (c) => c.get('user')?.id === c.req.param('id'))

guards.register('isVerified', (c) => c.get('user')?.verified === true)

app.delete('/users/:id', guards.all('isOwner', 'isVerified'), deleteHandler)
```

---

## Any / All Combinators

```typescript
import { anyGuard, allGuards } from 'raffel/http'

const adminOrMod = anyGuard(requireRole('admin'), requireRole('moderator'))
app.get('/moderate', adminOrMod, moderateHandler)
```
