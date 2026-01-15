# Quickstart

Veja como é fácil criar um servidor com Raffel.

---

## Instalação

```bash
pnpm add raffel
```

---

## O Mais Simples Possível

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  websocket: { path: '/ws' },
})

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

await server.start()
```

Pronto. Você tem um servidor HTTP + WebSocket funcionando.

```bash
# HTTP
curl localhost:3000/hello -d '{"name":"World"}'
# → "Hello, World!"

# WebSocket
wscat -c ws://localhost:3000/ws
> {"procedure":"hello","payload":{"name":"World"}}
< {"success":true,"data":"Hello, World!"}
```

**Uma linha de código, dois protocolos.**

---

## Várias Rotas

```typescript
const server = createServer({ port: 3000 })

server.procedure('hello')
  .handler(async ({ name }) => `Hello, ${name}!`)

server.procedure('users.create')
  .handler(async (input) => ({ id: crypto.randomUUID(), ...input }))

server.procedure('users.list')
  .handler(async () => db.users.findMany())

server.procedure('health')
  .handler(async () => ({ ok: true }))

await server.start()
```

Cada chave vira um endpoint:

| Rota | HTTP | WebSocket |
|:-----|:-----|:----------|
| `hello` | `POST /hello` | `{ procedure: 'hello' }` |
| `users.create` | `POST /users.create` | `{ procedure: 'users.create' }` |
| `users.list` | `POST /users.list` | `{ procedure: 'users.list' }` |

---

## Com Validação

```typescript
import { z } from 'zod'
import { createZodAdapter, registerValidator } from 'raffel'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })

server.procedure('users.create')
  .input(z.object({
    name: z.string().min(2),
    email: z.string().email(),
  }))
  .handler(async (input) => ({ id: crypto.randomUUID(), ...input }))

await server.start()
```

Dados inválidos? Erro automático:

```json
{ "error": "VALIDATION_ERROR", "details": [...] }
```

---

## File-Based (Zero Config)

Prefere organizar por arquivos?

```typescript
// server.ts
await createServer({ port: 3000, discovery: true })
```

```typescript
// src/rpc/hello.ts
export default ({ name }) => `Hello, ${name}!`

// src/rpc/users/create.ts
export default async (input) => ({ id: crypto.randomUUID(), ...input })
```

A estrutura de pastas define os endpoints automaticamente.

---

## Streaming

```typescript
const server = createServer({ port: 3000 })

server.stream('logs.tail')
  .handler(async function* ({ file }) {
    for await (const line of readLines(file)) {
      yield { line, ts: Date.now() }
    }
  })

await server.start()
```

Cada `yield` envia dados em tempo real para o cliente.

---

## Próximos Passos

- **[HTTP em Detalhes](/protocols/http.md)** - REST, middlewares, controle total
- **[Arquitetura](/architecture.md)** - Como o Raffel funciona por baixo
- **[Interceptors](/interceptors.md)** - Rate limit, cache, retry
- **[Auth](/auth/overview.md)** - JWT, API Key, OAuth2
