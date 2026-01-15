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

  // Metadados do protocolo (headers, etc.)
  metadata: Record<string, string>

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
  metadata: { /* headers, etc */ },
  context: { /* auth, tracing, etc */ }
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
  requestId: string

  // Informações de autenticação (se houver)
  auth?: {
    authenticated: boolean
    principal?: string      // ID do usuario
    claims?: Record<string, unknown>  // Dados do token
  }

  // Contexto de tracing distribuído
  tracing: {
    traceId: string
    spanId: string
    parentSpanId?: string
  }

  // Sinal de cancelamento (AbortSignal)
  signal: AbortSignal

  // Deadline (ms desde epoch)
  deadline?: number

  // Extensões customizadas
  extensions: Map<symbol, unknown>

  // Chamar outro procedimento mantendo contexto
  call?: (procedure: string, input: unknown) => Promise<unknown>

  // Nível de chamada em cascata (0 = top-level)
  callingLevel?: number
}
```

O Context é passado para seu handler como segundo argumento:

```typescript
const server = createServer({ port: 3000 })

server.procedure('users.me')
  .handler(async (input, ctx) => {
    // ctx.auth contém dados do usuário autenticado
    // ctx.tracing contém trace/span IDs
    // ctx.extensions guarda dados customizados
    return { userId: ctx.auth?.principal }
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

    // 2. Executa interceptors (onion model)
    const ctx = envelope.context
    const result = await this.runInterceptors(envelope, ctx, handler.fn)

    // 3. Retorna resposta
    return createResponseEnvelope(result)
  }
}
```

---

## Interceptors

Interceptors são funções que envolvem o handler no estilo "onion" e têm acesso
ao Envelope completo.

```typescript
type Interceptor = (
  envelope: Envelope,
  ctx: Context,
  next: () => Promise<unknown>
) => Promise<unknown>
```

### Ordem de Execucao

```
Request chega
    │
    ▼
┌─────────────────┐
│ Interceptor 1   │
│   (logging)     │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Interceptor 2   │
│   (rateLimit)   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Interceptor 3   │
│    (auth)       │
└────────┬────────┘
         ▼
┌─────────────────┐
│    Handler      │
└────────┬────────┘
         ▼
    Response sai
```

Cada interceptor pode executar logica antes e depois de `await next()`:

```typescript
const logging: Interceptor = async (envelope, ctx, next) => {
  const start = Date.now()
  try {
    return await next()
  } finally {
    const duration = Date.now() - start
    console.log(`← ${envelope.procedure} ${duration}ms`)
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
  metadata: {
    'content-type': 'application/json',
    'authorization': 'Bearer eyJ...'
  },
  context: {
    requestId: "req_7x8y9z",
    tracing: { traceId: "req_7x8y9z", spanId: "req_7x8y9z" },
    signal: AbortSignal,
    extensions: new Map()
  }
}
```

### 3. Router Processa

```typescript
// Router.handle(envelope)

// 3a. Executa interceptors (onion model)
// logging: marca startTime
// auth: decodifica JWT, preenche ctx.auth
// validation: valida input

// 3b. Executa handler
const result = await handler(envelope.payload, envelope.context)
// result = { id: "usr_abc", name: "Alice", email: "alice@example.com" }

// 3c. Interceptors finalizam
// logging: loga duracao
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
  // Registro de handlers
  procedure(name: string, handler: ProcedureHandler, options?: ProcedureOptions): void
  stream(name: string, handler: StreamHandler, options?: StreamOptions): void
  event(name: string, handler: EventHandler, options?: EventOptions): void

  // Introspecao
  list(): HandlerMeta[]
  listProcedures(): HandlerMeta[]
  listStreams(): HandlerMeta[]
  listEvents(): HandlerMeta[]
}
```

Quando você chama `createServer()`, internamente estamos populando o Registry:

```typescript
// Isso:
const server = createServer({ port: 3000 })
server.procedure('hello').handler(({ name }) => `Hello, ${name}!`)

// Faz isso internamente:
const registry = createRegistry()
registry.procedure('hello', ({ name }) => `Hello, ${name}!`)

const httpAdapter = new HttpAdapter(registry, { port: 3000 })
const wsAdapter = new WebSocketAdapter(registry, { port: 3000 })

await httpAdapter.start()
await wsAdapter.start()
```

---

## Resumo

1. **Envelope** - Formato normalizado que representa qualquer request
2. **Context** - Metadados do request (auth, tracing, cancelamento, extensões)
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
