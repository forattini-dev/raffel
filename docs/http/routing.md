# HTTP Routing Contract

`HttpApp` uses Raffel-native routing semantics. The matcher is designed for a
fast HTTP front door, not as a compatibility layer for other routers.

## Matching Model

- Requests are matched against `URL.pathname`.
- Exact paths are indexed and resolved before dynamic patterns.
- Dynamic patterns keep registration order when more than one pattern can match.
- Path parameters are percent-decoded before they reach `c.req.param()`.
- Trailing slash differences are significant: `/users` and `/users/` are different routes.

## Route Patterns

| Pattern | Meaning | Example match |
|---------|---------|---------------|
| `/users` | Exact path | `/users` |
| `/users/:id` | Named segment | `/users/123` |
| `/users/:id?` | Optional segment | `/users` and `/users/123` |
| `/assets/*` | Terminal wildcard, captures the remainder | `/assets`, `/assets/app.js`, `/assets/css/main.css` |
| `*` | App-wide catch-all | `/`, `/health`, `/nested/path` |

Terminal wildcards capture the remainder into `c.req.param('*')`. When the
remainder is omitted, the route still matches and the wildcard param is absent.

## Precedence

Exact routes win over dynamic routes:

```ts
const app = new HttpApp()

app.get('/users/:id', (c) => c.text(`dynamic:${c.req.param('id')}`))
app.get('/users/new', (c) => c.text('exact:new'))
```

`GET /users/new` resolves to the exact route.

Dynamic routes are still evaluated in registration order:

```ts
const app = new HttpApp()

app.get('/:scope/:id', (c) => c.text(`generic:${c.req.param('scope')}`))
app.get('/users/:id', (c) => c.text(`users:${c.req.param('id')}`))
```

`GET /users/42` resolves to the first dynamic route above.

## Performance Posture

Exact-route lookup cost does not depend on registration order. Raffel keeps exact
routes in indexed buckets and benchmarks both early and late exact-route matches
in CI.

## Examples

```ts
const app = new HttpApp()

app.get('/users/:id?', (c) => c.json({ id: c.req.param('id') ?? null }))
app.get('/assets/*', (c) => c.json({ path: c.req.param('*') ?? null }))
app.all('*', (c) => c.text(`fallback:${c.req.path}`))
```
