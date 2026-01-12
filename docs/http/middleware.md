# HTTP Middleware

The Raffel HTTP module ships a rich middleware suite for production-grade APIs.

---

## Core Middleware

```typescript
import { cors, compress, secureHeaders, bodyLimit } from 'raffel/http'

app.use(cors({
  origin: ['https://app.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}))

app.use(compress({ threshold: 1024 }))
app.use(secureHeaders())
app.use(bodyLimit({ maxSize: '10mb' }))
```

---

## Rate Limiting + Validation

```typescript
import { rateLimitMiddleware, validate } from 'raffel/http'
import { z } from 'zod'

app.use(rateLimitMiddleware({ windowMs: 60_000, maxRequests: 100 }))

app.post('/users', validate({
  body: z.object({ name: z.string(), email: z.string().email() }),
}), async (c) => {
  return c.json({ ok: true })
})
```

---

## Auth & Sessions

```typescript
import { basicAuth, bearerAuth, cookieSession } from 'raffel/http'

app.use('/admin/*', basicAuth({ username: 'admin', password: 'secret' }))
app.use('/api/*', bearerAuth({ verifyToken: verifyJwt }))
app.use(cookieSession({ secret: process.env.COOKIE_SECRET! }))
```

---

## OAuth2 / OIDC

```typescript
import { oauth2, oidc } from 'raffel/http'

app.use('/auth/*', oauth2({ providers: [githubProvider], onSuccess }))
app.use('/sso/*', oidc({ providers: [oidcProvider], onSuccess }))
```

---

## Failban (IP Banning)

```typescript
import { createFailban, failbanMiddleware } from 'raffel/http'

const failban = createFailban({ maxViolations: 5, banDuration: 3600_000 })
app.use('*', failbanMiddleware(failban))
```
