# ⚡ Raffel

> **One function. Seven protocols. Zero config.**

Raffel é um runtime de servidor multi-protocolo. Você escreve sua lógica uma vez e ela funciona automaticamente em HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP e UDP.

Sem adaptadores manuais. Sem duplicação. Sem configuração complexa.

---

## O Problema

Hoje, se você quer expor uma API em múltiplos protocolos, precisa:

```typescript
// ❌ Código duplicado para cada protocolo
app.post('/users', async (req, res) => { /* lógica */ })
wsServer.on('message', (msg) => { /* mesma lógica, diferente */ })
grpcService.CreateUser = async (call) => { /* mesma lógica, diferente */ })
```

Com Raffel, você escreve uma vez:

```typescript
import { createServer } from 'raffel'

// ✅ Uma função, todos os protocolos
const server = createServer({ port: 3000 })

server.procedure('users.create')
  .handler(async (input) => {
    // Sua lógica de negócio
    return { id: crypto.randomUUID(), ...input }
  })

await server.start()
```

Essa função agora responde em:
- **HTTP**: `POST /users.create`
- **WebSocket**: `{ procedure: 'users.create', payload: {...} }`
- **JSON-RPC**: `{ method: 'users.create', params: {...} }`
- **GraphQL**: `mutation { usersCreate(...) }`
- **gRPC**: `UsersService.Create()`
- **TCP/UDP**: protocolo binário com frames

---

## Hello World

O exemplo mais simples possível:

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('hello')
  // 'hello' é o nome do procedimento
  // O cliente envia { name: 'World' }
  // O servidor retorna 'Hello, World!'
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Teste com curl:

```bash
curl localhost:3000/hello \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'

# Resposta: "Hello, World!"
```

---

## File-Based Routes

Se você prefere organizar por arquivos (como Next.js), basta ativar o discovery:

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  discovery: true  // Ativa descoberta automática de rotas
})
```

Agora crie arquivos na pasta `src/rpc/`:

```typescript
// src/rpc/hello.ts
// Este arquivo vira o procedimento 'hello'
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// src/rpc/users/create.ts
// Este arquivo vira o procedimento 'users.create'
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

A estrutura de pastas define os nomes:

```
src/rpc/
├── hello.ts           → procedimento: hello
├── users/
│   ├── create.ts      → procedimento: users.create
│   ├── list.ts        → procedimento: users.list
│   └── [id].ts        → procedimento: users.get (com parâmetro)
└── _middleware.ts     → middleware aplicado a todos os handlers
```

---

## Validação de Input

Para validar os dados de entrada, passe um schema Zod (ou Yup, Joi):

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  // Schema de validação - rejeita requests inválidos automaticamente
  .input(z.object({
    name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
    email: z.string().email('Email inválido'),
  }))
  // Handler só é chamado se a validação passar
  .handler(async (input) => ({
    id: crypto.randomUUID(),
    ...input,
    createdAt: new Date().toISOString(),
  }))

await server.start()
```

Se o cliente enviar dados inválidos:

```bash
curl localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "email": "invalido"}'

# Resposta: 400 Bad Request
# {
#   "error": "VALIDATION_ERROR",
#   "details": [
#     { "field": "name", "message": "Nome deve ter pelo menos 2 caracteres" },
#     { "field": "email", "message": "Email inválido" }
#   ]
# }
```

---

## Interceptors (Middlewares)

Interceptors são middlewares que rodam antes/depois de cada request. Use para logging, rate limiting, timeout, etc:

```typescript
import {
  createServer,
  createLoggingInterceptor,
  createTimeoutInterceptor,
  createRateLimitInterceptor,
} from 'raffel'

const server = createServer({ port: 3000 })
  // Interceptors globais - aplicados a TODAS as rotas
  .use(createLoggingInterceptor())
  .use(createTimeoutInterceptor({ defaultMs: 30000 }))
  .use(createRateLimitInterceptor({ maxRequests: 100, windowMs: 60_000 }))

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Interceptors disponíveis:

| Interceptor | O que faz |
|:------------|:----------|
| `createLoggingInterceptor()` | Loga cada request com método, duração e status |
| `createTimeoutInterceptor({ defaultMs })` | Cancela requests lentos |
| `createRateLimitInterceptor({ maxRequests, windowMs })` | Limita requests por IP |
| `createRetryInterceptor({ maxAttempts })` | Retry automático em caso de falha |
| `createCircuitBreakerInterceptor()` | Para de chamar serviços que estão falhando |
| `createCacheInterceptor({ ttlMs })` | Cache de respostas |
| `createBulkheadInterceptor({ concurrency })` | Limita requests concorrentes |

---

## Autenticação

Proteja rotas com JWT, API Key ou outros métodos:

```typescript
import {
  createServer,
  createAuthMiddleware,
  createBearerStrategy,
  requireAuth,
  hasRole,
  RaffelError,
} from 'raffel'

const server = createServer({ port: 3000 })
  // Configura autenticação JWT globalmente
  .use(createAuthMiddleware({
    strategies: [
      createBearerStrategy({
        verify: async (token) => verifyJwt(token),
      }),
    ],
  }))

// Rota pública - qualquer um pode acessar
server.procedure('health')
  .handler(async () => ({ ok: true }))

// Rota protegida - requer token valido
server.procedure('users.me')
  .handler(async (_input, ctx) => {
    const auth = requireAuth(ctx)
    return {
      id: auth.principal,
      email: auth.claims?.email,
    }
  })

// Rota com roles especificos
server.procedure('admin.stats')
  .handler(async (_input, ctx) => {
    if (!hasRole(ctx, 'admin')) {
      throw new RaffelError('PERMISSION_DENIED', 'Admin only')
    }
    return getAdminStats()
  })

await server.start()
```

---

## Streaming

Para dados em tempo real, use generators:

```typescript
const server = createServer({ port: 3000 })

// Stream de logs em tempo real
server.stream('logs.tail')
  .handler(async function* ({ file }) {
    // O asterisco (*) indica que e um generator
    for await (const line of readLines(file)) {
      // yield envia cada linha para o cliente
      yield { line, timestamp: Date.now() }
    }
  })

// Stream de progresso de upload
server.stream('upload.progress')
  .handler(async function* ({ uploadId }) {
    while (true) {
      const progress = await getUploadProgress(uploadId)
      yield { percent: progress.percent }

      if (progress.percent >= 100) break
      await sleep(500)  // Atualiza a cada 500ms
    }
  })

await server.start()
```

---

## Protocolos Disponíveis

Por padrão, HTTP e WebSocket estão habilitados. Para customizar:

```typescript
const server = createServer({ port: 3000 })
  // Configuracao por protocolo
  .protocols({
    websocket: '/ws',
    jsonrpc: '/rpc',
    graphql: '/graphql',
    grpc: { port: 50051 },
    tcp: { port: 9000 },
  })

server.udp
  .handler('metrics', { port: 9001 })
  .onMessage((msg, rinfo, ctx) => {
    console.log(`UDP ${rinfo.address}:${rinfo.port} -> ${msg.length} bytes`)
  })
  .end()

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

---

## Próximos Passos

<div class="grid-3">
<a href="#/quickstart" class="card">
<div class="icon">🚀</div>
<h4>Quickstart</h4>
<p>Tutorial completo de 5 minutos</p>
</a>

<a href="#/file-system-discovery" class="card">
<div class="icon">📂</div>
<h4>File-Based Routes</h4>
<p>Organize rotas por arquivos</p>
</a>

<a href="#/interceptors" class="card">
<div class="icon">🛡️</div>
<h4>Interceptors</h4>
<p>Rate limit, cache, retry e mais</p>
</a>
</div>

---

## Features Completas

| Categoria | O que está incluído |
|:----------|:--------------------|
| **Protocolos** | HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP |
| **Validação** | Zod, Yup, Joi, Ajv (escolha o seu) |
| **Auth** | JWT, API Key, OAuth2, OIDC, Sessions |
| **Resiliência** | Rate limit, Circuit breaker, Retry, Timeout, Bulkhead |
| **Observabilidade** | Prometheus metrics, OpenTelemetry tracing, Logging |
| **Cache** | Memory, Redis, S3DB |
| **Real-time** | Channels (Pusher-like), Presence, Broadcasting |
| **DX** | Hot reload, Auto-discovery, REST Auto-CRUD |

---

<div style="text-align: center; padding: 2rem 0;">
<strong>⚡ Write once. Run everywhere.</strong>
</div>
