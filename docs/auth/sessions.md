# Session Authentication

Sessions are useful for browser-based apps and traditional web flows.

---

## Core Server (All Protocols)

```typescript
import { createAuthMiddleware, createCookieSessionStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategies: [
    createCookieSessionStrategy({
      cookieName: 'session',
      secret: process.env.COOKIE_SECRET,
      validate: async (sessionId) => {
        const session = await redis.get(`session:${sessionId}`)
        if (!session) return null
        return { authenticated: true, principal: session.userId, claims: session }
      },
    }),
  ],
})
```

---

## HTTP Module

```typescript
import { cookieSession } from 'raffel/http'

app.use(cookieSession({
  secret: process.env.COOKIE_SECRET!,
  cookieName: 'session',
  maxAge: 60 * 60 * 24 * 7, // seconds
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
}))
```

### Server-Side Sessions

```typescript
import { createSessionTracker, sessionMiddleware, createRedisSessionStore } from 'raffel/http'

const sessions = createSessionTracker({
  store: createRedisSessionStore({ url: process.env.REDIS_URL! }),
  maxAge: 60 * 60 * 24,
})

app.use('*', sessionMiddleware(sessions, { autoCreate: true }))
```
