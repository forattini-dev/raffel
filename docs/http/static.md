# Static Files

Serve assets from the filesystem or S3 with caching and range support.

---

## serveStatic

```typescript
import { serveStatic } from 'raffel/http'

app.use('/assets/*', serveStatic({
  root: './public',
  maxAge: 86400,
  immutable: true,
  index: 'index.html',
  dotfiles: 'ignore',
}))
```

### SPA Fallback

```typescript
app.use('/*', serveStatic({ root: './dist', fallback: 'index.html' }))
```

---

## serveStaticS3

```typescript
import { serveStaticS3 } from 'raffel/http'
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const client = new S3Client({ region: 'us-east-1' })

app.use('/static/*', serveStaticS3({
  client,
  bucket: 'my-bucket',
  prefix: 'assets/',
  maxAge: 31536000,
  immutable: true,
  GetObjectCommand,
  HeadObjectCommand,
}))
```

### SPA + API + WebSocket routes

Use `fallbackIgnore` to keep protocol/backend prefixes out of SPA fallback:

```typescript
app.get('/api/ping', (c) => c.json({ ok: true }))

app.use('/*', serveStatic({
  root: './dist',
  fallback: 'index.html',
  fallbackIgnore: ['/api', '/ws'],
}))
```

`/api/*` and `/ws*` will continue to your HTTP/WebSocket handlers, while every
other unknown path goes to `index.html` for React Router and similar SPA
routing.

The same `fallbackIgnore` option is available in `serveStaticS3`.
