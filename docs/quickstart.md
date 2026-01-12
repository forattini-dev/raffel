# Quickstart

Este guia vai te levar do zero a um servidor multi-protocolo funcionando em 5 minutos.

---

## 1. Instalação

Primeiro, instale o Raffel no seu projeto:

```bash
pnpm add raffel
```

O Raffel não tem dependências obrigatórias além do Node.js 18+. Validadores como Zod são opcionais.

---

## 2. Seu Primeiro Servidor

Crie um arquivo `server.ts`:

```typescript
import { createServer } from 'raffel'

// createServer retorna uma Promise, então usamos await
await createServer({
  // Porta onde o servidor vai rodar
  port: 3000,

  // Suas rotas/procedimentos
  routes: {
    // Cada chave é o nome do procedimento
    // O valor é a função que processa o request
    'hello': ({ name }) => {
      return `Hello, ${name}!`
    }
  }
})

console.log('🚀 Servidor rodando em http://localhost:3000')
```

Execute:

```bash
npx tsx server.ts
```

Teste:

```bash
curl localhost:3000/hello \
  -H 'Content-Type: application/json' \
  -d '{"name": "World"}'

# Resposta: "Hello, World!"
```

**O que aconteceu?**
- O Raffel criou um servidor HTTP na porta 3000
- O procedimento `hello` ficou disponível em `POST /hello`
- O input `{ name: "World" }` foi passado para sua função
- O retorno da função virou a resposta JSON

---

## 3. Múltiplos Procedimentos

Adicione mais procedimentos ao objeto `routes`:

```typescript
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  routes: {
    // Procedimento simples
    'hello': ({ name }) => `Hello, ${name}!`,

    // Procedimento com lógica de negócio
    'users.create': async (input) => {
      // Aqui você conectaria ao banco de dados
      const user = {
        id: crypto.randomUUID(),
        name: input.name,
        email: input.email,
        createdAt: new Date().toISOString()
      }
      return user
    },

    // Procedimento que retorna lista
    'users.list': async () => {
      // Simula busca no banco
      return [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' }
      ]
    },

    // Procedimento de health check
    'health': () => ({ ok: true, timestamp: Date.now() })
  }
})
```

Cada procedimento fica disponível como endpoint HTTP:

| Procedimento | Endpoint HTTP |
|:-------------|:--------------|
| `hello` | `POST /hello` |
| `users.create` | `POST /users.create` |
| `users.list` | `POST /users.list` |
| `health` | `POST /health` |

---

## 4. Validação de Input

Para garantir que os dados de entrada estão corretos, use Zod (ou Yup, Joi):

```bash
pnpm add zod
```

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

await createServer({
  port: 3000,
  routes: {
    'users.create': {
      // Define o schema de validação
      input: z.object({
        name: z.string()
          .min(2, 'Nome precisa ter pelo menos 2 caracteres')
          .max(100, 'Nome não pode ter mais de 100 caracteres'),
        email: z.string()
          .email('Formato de email inválido'),
        age: z.number()
          .int('Idade precisa ser um número inteiro')
          .min(0, 'Idade não pode ser negativa')
          .optional()  // Campo opcional
      }),

      // O handler só é chamado se a validação passar
      // O TypeScript já sabe que input tem name, email e age
      handler: async (input) => {
        return {
          id: crypto.randomUUID(),
          ...input,
          createdAt: new Date().toISOString()
        }
      }
    }
  }
})
```

**Request válido:**

```bash
curl localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Resposta: 200 OK
# {"id": "abc-123", "name": "Alice", "email": "alice@example.com", ...}
```

**Request inválido:**

```bash
curl localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -d '{"name": "A", "email": "invalido"}'

# Resposta: 400 Bad Request
# {
#   "error": "VALIDATION_ERROR",
#   "details": [
#     {"field": "name", "message": "Nome precisa ter pelo menos 2 caracteres"},
#     {"field": "email", "message": "Formato de email inválido"}
#   ]
# }
```

---

## 5. WebSocket

O WebSocket é habilitado automaticamente. O mesmo procedimento funciona em ambos:

```typescript
await createServer({
  port: 3000,
  websocket: true,  // Habilitado por padrão em /ws
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

Teste via WebSocket:

```bash
# Instale wscat se não tiver: npm install -g wscat
wscat -c ws://localhost:3000/ws

# Envie uma mensagem JSON:
> {"procedure": "hello", "payload": {"name": "World"}}

# Resposta:
< {"success": true, "data": "Hello, World!"}
```

**Por que isso importa?**
- HTTP é request-response: cliente faz pergunta, servidor responde
- WebSocket é bidirecional: servidor pode enviar dados a qualquer momento
- Mesma lógica de negócio, dois padrões de comunicação

---

## 6. Interceptors

Interceptors são middlewares que rodam em todas as rotas. Use para cross-cutting concerns:

```typescript
import { createServer, logging, timeout, rateLimit } from 'raffel'

await createServer({
  port: 3000,

  interceptors: [
    // 1. Logging - loga cada request
    logging({
      // Opcional: customizar formato
      format: ({ procedure, duration }) =>
        `${procedure} completed in ${duration}ms`
    }),

    // 2. Timeout - cancela requests lentos
    timeout(30000),  // 30 segundos

    // 3. Rate Limit - protege contra abuse
    rateLimit({
      max: 100,      // Máximo de requests
      window: '1m',  // Por minuto
      // Opcional: usar IP ou user ID
      keyBy: (ctx) => ctx.ip
    })
  ],

  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})
```

**Ordem importa!** Os interceptors rodam na ordem que você define:
1. `logging` começa a medir o tempo
2. `timeout` define o prazo
3. `rateLimit` verifica se pode processar
4. Sua rota executa
5. `logging` loga o resultado

---

## 7. Autenticação

Proteja rotas que precisam de login:

```typescript
import { createServer, bearer } from 'raffel'

await createServer({
  port: 3000,

  // Configura JWT como método de autenticação
  auth: bearer({
    secret: process.env.JWT_SECRET,
  }),

  routes: {
    // ❌ Rota PÚBLICA - qualquer um acessa
    'health': () => ({ ok: true }),

    // ✅ Rota PROTEGIDA - precisa de token
    'users.me': {
      auth: true,
      handler: (input, ctx) => {
        // ctx.auth é preenchido automaticamente
        // com os dados do token JWT decodificado
        return {
          userId: ctx.auth.principal,
          email: ctx.auth.claims.email
        }
      }
    }
  }
})
```

**Chamando rota protegida:**

```bash
# Primeiro, obtenha um token (do seu sistema de login)
TOKEN="eyJhbGciOiJIUzI1NiIs..."

# Depois, use o token no header Authorization
curl localhost:3000/users.me \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. File-Based Routes

Se preferir organizar por arquivos (estilo Next.js):

```typescript
// server.ts
import { createServer } from 'raffel'

await createServer({
  port: 3000,
  discovery: true  // Ativa descoberta automática
})
```

Agora crie a pasta `routes/` e adicione arquivos:

```typescript
// routes/hello.ts
export default ({ name }) => `Hello, ${name}!`
```

```typescript
// routes/users/create.ts
import { z } from 'zod'

// Opcional: schema de validação
export const input = z.object({
  name: z.string().min(2),
  email: z.string().email()
})

// Handler principal
export default async (input) => ({
  id: crypto.randomUUID(),
  ...input
})
```

```typescript
// routes/users/[id].ts
// Arquivos com [param] capturam parâmetros dinâmicos

export default async (input, ctx) => {
  // ctx.params.id contém o valor do parâmetro
  const user = await db.users.findById(ctx.params.id)
  return user
}
```

**Estrutura → Procedimentos:**

```
routes/
├── hello.ts              → hello
├── health.ts             → health
├── users/
│   ├── create.ts         → users.create
│   ├── list.ts           → users.list
│   └── [id].ts           → users.get (com params.id)
└── _middleware.ts        → aplica a todas as rotas
```

---

## 9. Streaming

Para dados em tempo real, use generators (funções com `function*`):

```typescript
await createServer({
  port: 3000,
  streams: {
    'events.subscribe': async function* ({ topic }) {
      // Conecta a uma fonte de eventos (ex: Redis, Kafka)
      const subscription = await pubsub.subscribe(topic)

      try {
        // Loop infinito que yield eventos conforme chegam
        for await (const event of subscription) {
          yield {
            type: event.type,
            data: event.data,
            timestamp: Date.now()
          }
        }
      } finally {
        // Cleanup quando o cliente desconecta
        await subscription.unsubscribe()
      }
    }
  }
})
```

**Como funciona:**
1. Cliente conecta via WebSocket
2. Servidor inicia o generator
3. Cada `yield` envia dados para o cliente
4. Quando cliente desconecta, `finally` faz cleanup

---

## 10. Exemplo Completo

Juntando tudo em um servidor production-ready:

```typescript
import { createServer, logging, timeout, rateLimit, bearer } from 'raffel'
import { z } from 'zod'

await createServer({
  port: 3000,

  // Interceptors globais
  interceptors: [
    logging(),
    timeout(30000),
    rateLimit({ max: 100, window: '1m' })
  ],

  // Autenticação JWT
  auth: bearer({ secret: process.env.JWT_SECRET }),

  routes: {
    // Health check público
    'health': () => ({
      ok: true,
      timestamp: Date.now()
    }),

    // Criar usuário (público, com validação)
    'users.create': {
      input: z.object({
        name: z.string().min(2),
        email: z.string().email()
      }),
      handler: async (input) => ({
        id: crypto.randomUUID(),
        ...input
      })
    },

    // Perfil do usuário logado (protegido)
    'users.me': {
      auth: true,
      handler: (_, ctx) => ({
        id: ctx.auth.principal,
        email: ctx.auth.claims.email
      })
    }
  },

  // Streams para real-time
  streams: {
    'notifications': {
      auth: true,
      handler: async function* (_, ctx) {
        for await (const notif of getNotifications(ctx.auth.principal)) {
          yield notif
        }
      }
    }
  }
})

console.log('⚡ Servidor rodando!')
console.log('   HTTP:      http://localhost:3000')
console.log('   WebSocket: ws://localhost:3000/ws')
```

---

## Próximos Passos

Agora que você tem um servidor rodando, explore:

- **[File-Based Routes](/file-system-discovery.md)** - Organize rotas por arquivos
- **[Interceptors](/interceptors.md)** - Rate limit, cache, retry, circuit breaker
- **[Autenticação](/auth/overview.md)** - JWT, OAuth2, API Keys, Sessions
- **[Protocolos](/protocols/http.md)** - Detalhes de cada protocolo
- **[Streaming](/streams.md)** - Streams server-side e bidirecionais
