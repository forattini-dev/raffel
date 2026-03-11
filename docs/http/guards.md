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

guards.register('isOwner', (c) => c.runtime?.auth.principalId === c.req.param('id'))

guards.register('isVerified', (c) => Boolean(c.get('auth')?.claims?.verified))

app.delete('/users/:id', guards.all('isOwner', 'isVerified'), deleteHandler)
```

Prefer canonical auth (`c.runtime?.auth` or `c.get('auth')`) for new code. `c.get('user')`
remains a compatibility path for legacy middleware.

---

## Any / All Combinators

```typescript
import { anyGuard, allGuards } from 'raffel/http'

const adminOrMod = anyGuard(requireRole('admin'), requireRole('moderator'))
app.get('/moderate', adminOrMod, moderateHandler)
```
