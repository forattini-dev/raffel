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
// ✅ Uma função, todos os protocolos
await createServer({
  port: 3000,
  routes: {
    'users.create': async (input) => {
      // Sua lógica de negócio
      return { id: crypto.randomUUID(), ...input }
    }
  }
})
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

await createServer({
  port: 3000,
  routes: {
    // 'hello' é o nome do procedimento
    // O cliente envia { name: 'World' }
    // O servidor retorna 'Hello, World!'
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
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

Agora crie arquivos na pasta `routes/`:

```typescript
// routes/hello.ts
// Este arquivo vira o procedimento 'hello'
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// routes/users/create.ts
// Este arquivo vira o procedimento 'users.create'
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

A estrutura de pastas define os nomes:

```
routes/
├── hello.ts           → procedimento: hello
├── users/
│   ├── create.ts      → procedimento: users.create
│   ├── list.ts        → procedimento: users.list
│   └── [id].ts        → procedimento: users.get (com parâmetro)
└── _middleware.ts     → middleware aplicado a todas as rotas
```

---

## Validação de Input

Para validar os dados de entrada, passe um schema Zod (ou Yup, Joi):

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

await createServer({
  port: 3000,
  routes: {
    'users.create': {
      // Schema de validação - rejeita requests inválidos automaticamente
      input: z.object({
        name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
        email: z.string().email('Email inválido')
      }),

      // Handler só é chamado se a validação passar
      handler: async (input) => ({
        id: crypto.randomUUID(),
        ...input,
        createdAt: new Date().toISOString()
      })
    }
  }
})
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
import { createServer, logging, timeout, rateLimit } from 'raffel'

await createServer({
  port: 3000,

  // Interceptors globais - aplicados a TODAS as rotas
  interceptors: [
    // Loga cada request com duração
    logging(),

    // Cancela requests que demoram mais de 30 segundos
    timeout(30000),

    // Máximo 100 requests por minuto por IP
    rateLimit({ max: 100, window: '1m' })
  ],

  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

Interceptors disponíveis:

| Interceptor | O que faz |
|:------------|:----------|
| `logging()` | Loga cada request com método, duração e status |
| `timeout(ms)` | Cancela requests lentos |
| `rateLimit({ max, window })` | Limita requests por IP |
| `retry({ attempts })` | Retry automático em caso de falha |
| `circuitBreaker()` | Para de chamar serviços que estão falhando |
| `cache({ ttl })` | Cache de respostas |
| `bulkhead({ max })` | Limita requests concorrentes |

---

## Autenticação

Proteja rotas com JWT, API Key ou outros métodos:

```typescript
import { createServer, bearer } from 'raffel'

await createServer({
  port: 3000,

  // Configura autenticação JWT globalmente
  auth: bearer({
    secret: process.env.JWT_SECRET,
    // Opcional: buscar usuário do banco
    getUser: async (payload) => db.users.findById(payload.sub)
  }),

  routes: {
    // Rota pública - qualquer um pode acessar
    'health': () => ({ ok: true }),

    // Rota protegida - requer token válido
    'users.me': {
      auth: true,  // Exige autenticação
      handler: (input, ctx) => {
        // ctx.auth contém os dados do usuário autenticado
        return {
          id: ctx.auth.principal,
          email: ctx.auth.claims.email
        }
      }
    },

    // Rota com roles específicos
    'admin.stats': {
      auth: { roles: ['admin'] },  // Só admins
      handler: async () => getAdminStats()
    }
  }
})
```

---

## Streaming

Para dados em tempo real, use generators:

```typescript
await createServer({
  port: 3000,
  streams: {
    // Stream de logs em tempo real
    'logs.tail': async function* ({ file }) {
      // O asterisco (*) indica que é um generator
      for await (const line of readLines(file)) {
        // yield envia cada linha para o cliente
        yield { line, timestamp: Date.now() }
      }
    },

    // Stream de progresso de upload
    'upload.progress': async function* ({ uploadId }) {
      while (true) {
        const progress = await getUploadProgress(uploadId)
        yield { percent: progress.percent }

        if (progress.percent >= 100) break
        await sleep(500)  // Atualiza a cada 500ms
      }
    }
  }
})
```

---

## Protocolos Disponíveis

Por padrão, HTTP e WebSocket estão habilitados. Para customizar:

```typescript
await createServer({
  port: 3000,

  // Configuração por protocolo
  http: true,                    // Habilitado por padrão
  websocket: true,               // Habilitado por padrão em /ws
  jsonrpc: '/rpc',               // JSON-RPC 2.0 em /rpc
  graphql: '/graphql',           // GraphQL com schema auto-gerado
  grpc: { port: 50051 },         // gRPC em porta separada
  tcp: { port: 9000 },           // TCP raw
  udp: { port: 9001 },           // UDP raw

  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
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
