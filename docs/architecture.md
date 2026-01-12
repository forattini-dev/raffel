# Arquitetura

Esta página explica como o Raffel funciona por baixo dos panos. Entender a arquitetura vai te ajudar a usar o framework de forma mais eficiente e debugar problemas.

---

## A Ideia Central

O Raffel resolve um problema comum: você quer expor a mesma lógica de negócio em múltiplos protocolos (HTTP, WebSocket, gRPC, etc), mas não quer duplicar código.

A solução é simples: **normalizar tudo para um formato único**.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Cliente   │     │   Cliente   │     │   Cliente   │
│    HTTP     │     │  WebSocket  │     │    gRPC     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Adapter   │     │   Adapter   │     │   Adapter   │
│    HTTP     │     │  WebSocket  │     │    gRPC     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Envelope  │  ← Formato normalizado
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Router    │  ← Encontra o handler
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Interceptors│  ← Logging, auth, etc
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Handler   │  ← Sua lógica de negócio
                    └─────────────┘
```

Não importa de onde veio o request - HTTP, WebSocket, gRPC - ele é convertido para um **Envelope** e processado da mesma forma.

---

## O Envelope

O Envelope é o coração do Raffel. É a estrutura de dados que representa qualquer request, independente do protocolo:

```typescript
interface Envelope {
  // Identificador único do request (para tracing/correlação)
  id: string

  // Nome do procedimento (ex: 'users.create')
  procedure: string

  // Tipo da mensagem
  type: 'request' | 'response' | 'stream:data' | 'stream:end' | 'event'

  // Os dados enviados pelo cliente
  payload: unknown

  // Metadados e estado
  context: Context
}
```

### Exemplos de Conversão

**HTTP Request → Envelope:**

```
POST /users.create HTTP/1.1
Content-Type: application/json

{"name": "Alice", "email": "alice@example.com"}
```

Vira:

```typescript
{
  id: "req_abc123",
  procedure: "users.create",
  type: "request",
  payload: { name: "Alice", email: "alice@example.com" },
  context: { /* headers, auth, etc */ }
}
```

**WebSocket Message → Envelope:**

```json
{"procedure": "users.create", "payload": {"name": "Alice"}}
```

Vira o mesmo Envelope! A diferença é só o transporte.

**gRPC Call → Envelope:**

```protobuf
service Users {
  rpc Create(CreateRequest) returns (CreateResponse);
}
```

Também vira o mesmo Envelope. O nome do procedimento é `Users.Create`.

---

## O Context

O Context carrega informações sobre o request que não são os dados em si:

```typescript
interface Context {
  // Identificador único do request
  id: string

  // Informações de autenticação (se houver)
  auth?: {
    authenticated: boolean
    principal: string      // ID do usuário
    claims: Record<string, unknown>  // Dados do token
    roles: string[]
  }

  // Headers HTTP (quando aplicável)
  headers: Record<string, string>

  // Parâmetros de rota (ex: /users/:id)
  params: Record<string, string>

  // Query string (ex: ?page=1)
  query: Record<string, string>

  // Sinal de cancelamento (AbortSignal)
  signal: AbortSignal

  // Deadline (quando o request expira)
  deadline?: Date

  // Metadados customizados
  metadata: Record<string, unknown>
}
```

O Context é passado para seu handler como segundo argumento:

```typescript
await createServer({
  routes: {
    'users.me': (input, ctx) => {
      // ctx.auth contém dados do usuário autenticado
      // ctx.headers contém headers HTTP
      // ctx.params contém parâmetros de rota
      return { userId: ctx.auth?.principal }
    }
  }
})
```

---

## Adapters

Adapters são responsáveis por converter requests do protocolo específico para Envelope e vice-versa.

### Como um Adapter Funciona

```typescript
// Simplificado - o adapter HTTP faz isso internamente
class HttpAdapter {
  async handleRequest(req: Request): Promise<Response> {
    // 1. Extrai informações do request HTTP
    const procedure = req.url.pathname.slice(1)  // /users.create → users.create
    const payload = await req.json()
    const headers = Object.fromEntries(req.headers)

    // 2. Cria o Envelope
    const envelope: Envelope = {
      id: generateId(),
      procedure,
      type: 'request',
      payload,
      context: {
        id: generateId(),
        headers,
        params: {},
        query: parseQuery(req.url),
        signal: req.signal,
        metadata: {}
      }
    }

    // 3. Passa para o Router
    const result = await this.router.handle(envelope)

    // 4. Converte resposta de volta para HTTP
    return new Response(JSON.stringify(result.payload), {
      status: result.type === 'error' ? 400 : 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
```

### Adapters Disponíveis

| Adapter | Protocolo | Porta Padrão |
|:--------|:----------|:-------------|
| `HttpAdapter` | HTTP/HTTPS | 3000 |
| `WebSocketAdapter` | WebSocket | 3000 (mesmo que HTTP) |
| `JsonRpcAdapter` | JSON-RPC 2.0 | 3000/rpc |
| `GraphQLAdapter` | GraphQL | 3000/graphql |
| `GrpcAdapter` | gRPC | 50051 |
| `TcpAdapter` | TCP raw | 9000 |
| `UdpAdapter` | UDP raw | 9001 |

---

## Router

O Router recebe um Envelope e encontra o handler correto para processá-lo.

```typescript
// Internamente, o Router mantém um registro de handlers
class Router {
  private handlers: Map<string, Handler> = new Map()

  register(procedure: string, handler: Handler) {
    this.handlers.set(procedure, handler)
  }

  async handle(envelope: Envelope): Promise<Envelope> {
    // 1. Encontra o handler
    const handler = this.handlers.get(envelope.procedure)
    if (!handler) {
      return createErrorEnvelope('PROCEDURE_NOT_FOUND')
    }

    // 2. Executa interceptors (antes)
    const ctx = await this.runBeforeInterceptors(envelope)

    // 3. Valida input (se tiver schema)
    if (handler.inputSchema) {
      const validation = handler.inputSchema.safeParse(envelope.payload)
      if (!validation.success) {
        return createErrorEnvelope('VALIDATION_ERROR', validation.error)
      }
    }

    // 4. Executa o handler
    const result = await handler.fn(envelope.payload, ctx)

    // 5. Executa interceptors (depois)
    await this.runAfterInterceptors(envelope, result)

    // 6. Retorna resposta
    return createResponseEnvelope(result)
  }
}
```

---

## Interceptors

Interceptors são funções que rodam antes e/ou depois do handler. Eles têm acesso ao Envelope completo.

```typescript
interface Interceptor {
  // Roda ANTES do handler
  before?: (envelope: Envelope) => Promise<Envelope | void>

  // Roda DEPOIS do handler
  after?: (envelope: Envelope, result: unknown) => Promise<unknown>

  // Roda em caso de ERRO
  onError?: (envelope: Envelope, error: Error) => Promise<void>
}
```

### Ordem de Execução

```
Request chega
    │
    ▼
┌─────────────────┐
│ Interceptor 1   │ ← before()
│   (logging)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interceptor 2   │ ← before()
│   (rateLimit)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interceptor 3   │ ← before()
│    (auth)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Handler      │ ← Sua lógica
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interceptor 3   │ ← after()
│    (auth)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interceptor 2   │ ← after()
│   (rateLimit)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interceptor 1   │ ← after()
│   (logging)     │
└────────┬────────┘
         │
         ▼
    Response sai
```

A ordem é: `before()` na ordem definida, handler, `after()` na ordem inversa.

### Exemplo: Como o Logging Interceptor Funciona

```typescript
function createLoggingInterceptor() {
  return {
    before: async (envelope) => {
      // Marca o tempo de início
      envelope.context.metadata.startTime = Date.now()
      console.log(`→ ${envelope.procedure} started`)
    },

    after: async (envelope, result) => {
      // Calcula duração
      const duration = Date.now() - envelope.context.metadata.startTime
      console.log(`← ${envelope.procedure} completed in ${duration}ms`)
    },

    onError: async (envelope, error) => {
      const duration = Date.now() - envelope.context.metadata.startTime
      console.error(`✗ ${envelope.procedure} failed in ${duration}ms:`, error)
    }
  }
}
```

---

## Fluxo Completo

Vamos seguir um request do início ao fim:

### 1. Cliente Faz Request HTTP

```bash
curl -X POST http://localhost:3000/users.create \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer eyJ...' \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

### 2. HTTP Adapter Recebe

```typescript
// HttpAdapter.handleRequest()
const envelope = {
  id: "req_7x8y9z",
  procedure: "users.create",
  type: "request",
  payload: { name: "Alice", email: "alice@example.com" },
  context: {
    id: "req_7x8y9z",
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer eyJ...'
    },
    params: {},
    query: {},
    signal: AbortSignal,
    metadata: {}
  }
}
```

### 3. Router Processa

```typescript
// Router.handle(envelope)

// 3a. Executa interceptors (before)
// logging: marca startTime
// auth: decodifica JWT, preenche ctx.auth

// 3b. Valida input
// Zod valida { name, email }

// 3c. Executa handler
const result = await handler(envelope.payload, envelope.context)
// result = { id: "usr_abc", name: "Alice", email: "alice@example.com" }

// 3d. Executa interceptors (after)
// auth: nada a fazer
// logging: loga duração
```

### 4. HTTP Adapter Responde

```typescript
// Converte resultado para HTTP Response
return new Response(JSON.stringify({
  id: "usr_abc",
  name: "Alice",
  email: "alice@example.com"
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
})
```

### 5. Cliente Recebe

```json
{"id": "usr_abc", "name": "Alice", "email": "alice@example.com"}
```

---

## Streaming

Para streams, o fluxo é um pouco diferente. Em vez de um único response, o handler é um generator que yield múltiplos valores:

```typescript
// Handler de stream
async function* logsHandler({ file }) {
  yield { line: "Log 1", ts: 1234 }
  yield { line: "Log 2", ts: 1235 }
  yield { line: "Log 3", ts: 1236 }
}
```

O Adapter converte cada `yield` para o formato do protocolo:

**WebSocket:**
```
← {"type": "stream:data", "data": {"line": "Log 1", "ts": 1234}}
← {"type": "stream:data", "data": {"line": "Log 2", "ts": 1235}}
← {"type": "stream:data", "data": {"line": "Log 3", "ts": 1236}}
← {"type": "stream:end"}
```

**HTTP (Server-Sent Events):**
```
data: {"line": "Log 1", "ts": 1234}

data: {"line": "Log 2", "ts": 1235}

data: {"line": "Log 3", "ts": 1236}

event: end
```

**gRPC:**
```
ServerStream<LogEntry> → múltiplas mensagens protobuf
```

---

## Registry

O Registry é onde todos os handlers, interceptors e configurações ficam armazenados:

```typescript
interface Registry {
  // Handlers de procedimentos
  procedures: Map<string, ProcedureHandler>

  // Handlers de streams
  streams: Map<string, StreamHandler>

  // Handlers de eventos
  events: Map<string, EventHandler>

  // Interceptors globais
  interceptors: Interceptor[]

  // Configurações de auth
  auth?: AuthConfig

  // Adapters ativos
  adapters: Adapter[]
}
```

Quando você chama `createServer()`, internamente estamos populando o Registry:

```typescript
// Isso:
await createServer({
  port: 3000,
  routes: {
    'hello': ({ name }) => `Hello, ${name}!`
  }
})

// Faz isso internamente:
const registry = new Registry()
registry.procedures.set('hello', {
  handler: ({ name }) => `Hello, ${name}!`,
  inputSchema: undefined,
  outputSchema: undefined,
  interceptors: []
})

const httpAdapter = new HttpAdapter(registry, { port: 3000 })
const wsAdapter = new WebSocketAdapter(registry, { port: 3000 })

await httpAdapter.start()
await wsAdapter.start()
```

---

## Resumo

1. **Envelope** - Formato normalizado que representa qualquer request
2. **Context** - Metadados do request (auth, headers, params)
3. **Adapters** - Convertem protocolos específicos para/de Envelope
4. **Router** - Encontra e executa o handler correto
5. **Interceptors** - Lógica que roda antes/depois de todo handler
6. **Registry** - Armazena toda a configuração do servidor

A beleza do design é que sua lógica de negócio (o handler) não sabe nada sobre protocolos. Ela recebe dados, processa, retorna. Os adapters cuidam do resto.

---

## Próximos Passos

- **[HTTP em Detalhes](/protocols/http.md)** - Customização do adapter HTTP
- **[Interceptors](/interceptors.md)** - Todos os interceptors disponíveis
- **[Streaming](/streams.md)** - Como streams funcionam em detalhes
