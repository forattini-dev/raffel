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

## Cenário real mais comum: SPA + API + WebSocket

Quando você tem uma aplicação React/Vue/Svelte com roteamento client-side e também expõe serviços backend no mesmo host, o padrão é:

- `/api/*` -> HTTP API
- `/ws/*` -> WebSocket
- qualquer outra rota -> SPA (index.html)

Para isso, usamos `fallbackIgnore` em `serveStatic` para **não aplicar fallback** nas rotas de backend:

```ts
import { serveStatic } from 'raffel/http'
import { HttpApp } from 'raffel/http'

const app = new HttpApp()

// APIs
app.get('/api/ping', (c) => c.json({ ok: true }))
app.get('/api/users', (c) => c.json({ users: [] }))

// Handshake endpoint (ou rota de health para websocket)
app.get('/ws', (c) => c.text('ok'))

app.use('/*', serveStatic({
  root: './dist',
  fallback: 'index.html',
  fallbackIgnore: ['/api', '/ws'],
}))
```

Assim:
- `/dashboard` → `index.html`
- `/api/ping` → handler da API
- `/ws` e `/ws/notify` continuam sem ser capturados pelo fallback

`fallbackIgnore` funciona por prefixo de path com borda de segmento:
- `'/api'` ignora `/api` e `/api/...`
- `'/ws'` ignora `/ws` e `/ws/...`

Se você quiser mais de um prefixo, basta listar:

```ts
fallbackIgnore: ['/api', '/ws', '/socket', '/internal']
```

---

## SPA + API + WebSocket em S3 (serveStaticS3)

A lógica também vale para `serveStaticS3`:

```ts
import { serveStaticS3 } from 'raffel/http'
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const client = new S3Client({ region: 'us-east-1' })

app.use('/static/*', serveStaticS3({
  client,
  bucket: 'my-bucket',
  prefix: 'assets/',
  maxAge: 31536000,
  immutable: true,
  fallback: 'index.html',
  fallbackIgnore: ['/api', '/ws'],
  GetObjectCommand,
  HeadObjectCommand,
}))
```

### Dica de produção (CloudFront + S3)

Em produção com CDN, esse fallback local resolve o roteamento dentro da aplicação, mas mantenha também o fallback da distribuição para o comportamento padrão de SPA se você servir index diretamente via CloudFront:
- 403 → `/index.html`
- 404 → `/index.html`

No origin, mantenha as rotas de API/WebSocket separadas para não sofrerem fallback indevido.

---

## serveStaticS3

```typescript
import { serveStaticS3 } from 'raffel/http'
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const client = new S3Client({ region: 'us-east-1' })

app.use('/static/*', serveStaticS3({
  client,
  bucket: 'my-bucket',
  maxAge: 31536000,
  immutable: true,
  GetObjectCommand,
  HeadObjectCommand,
}))
```
