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

await createServer({
  port: 3000,
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
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
await createServer({
  port: 3000,
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`,
    'users.create': async (input) => ({ id: crypto.randomUUID(), ...input }),
    'users.list': async () => db.users.findMany(),
    'health': () => ({ ok: true })
  }
})
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

await createServer({
  port: 3000,
  routes: {
    'users.create': {
      input: z.object({
        name: z.string().min(2),
        email: z.string().email()
      }),
      handler: async (input) => ({ id: crypto.randomUUID(), ...input })
    }
  }
})
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
// routes/hello.ts
export default ({ name }) => `Hello, ${name}!`

// routes/users/create.ts
export default async (input) => ({ id: crypto.randomUUID(), ...input })
```

A estrutura de pastas define os endpoints automaticamente.

---

## Streaming

```typescript
await createServer({
  port: 3000,
  streams: {
    'logs.tail': async function* ({ file }) {
      for await (const line of readLines(file)) {
        yield { line, ts: Date.now() }
      }
    }
  }
})
```

Cada `yield` envia dados em tempo real para o cliente.

---

## Próximos Passos

- **[HTTP em Detalhes](/protocols/http.md)** - REST, middlewares, controle total
- **[Arquitetura](/architecture.md)** - Como o Raffel funciona por baixo
- **[Interceptors](/interceptors.md)** - Rate limit, cache, retry
- **[Auth](/auth/overview.md)** - JWT, API Key, OAuth2
