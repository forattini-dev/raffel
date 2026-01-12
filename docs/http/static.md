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
