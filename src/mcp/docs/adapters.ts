/**
 * Raffel MCP - Adapter Documentation
 *
 * All protocol adapters with options, features, and mapping examples.
 */

import type { AdapterDoc } from '../types.js'

export const adapters: AdapterDoc[] = [
  {
    name: 'HTTP',
    protocol: 'HTTP/1.1, HTTP/2',
    description:
      'REST-like HTTP adapter. Maps procedures to endpoints, supports SSE for streaming, and handles CORS.',
    options: [
      {
        name: 'prefix',
        type: 'string',
        required: false,
        default: "'/api'",
        description: 'Base path prefix for all endpoints',
      },
      {
        name: 'cors',
        type: 'CorsOptions | boolean',
        required: false,
        default: 'false',
        description: 'CORS configuration (true enables permissive defaults)',
      },
      {
        name: 'bodyLimit',
        type: 'number',
        required: false,
        default: '1048576',
        description: 'Maximum request body size in bytes (1MB default)',
      },
      {
        name: 'trustProxy',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Trust X-Forwarded-* headers from reverse proxy',
      },
      {
        name: 'streaming',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Enable SSE for streaming procedures',
      },
    ],
    features: [
      'Automatic procedure → REST mapping',
      'SSE (Server-Sent Events) for streaming',
      'CORS with preflight support',
      'Gzip/Brotli compression',
      'Request ID propagation',
      'Health check endpoints',
      'OpenAPI spec generation',
    ],
    mapping: `
## HTTP Mapping

| Handler Type | HTTP Method | Path Pattern | Response |
|--------------|-------------|--------------|----------|
| Procedure | POST | /api/{procedure.name} | JSON |
| Stream (server) | GET | /api/streams/{name} | SSE |
| Event | POST | /api/events/{name} | 202 Accepted |

### Headers → Metadata

| HTTP Header | Envelope Metadata |
|-------------|-------------------|
| Authorization | metadata.authorization |
| X-Request-ID | envelope.id |
| X-Trace-ID | context.tracing.traceId |
| Content-Type | metadata.contentType |
| Accept | metadata.accept |

### Status Code Mapping

| Error Code | HTTP Status |
|------------|-------------|
| INVALID_ARGUMENT | 400 |
| UNAUTHENTICATED | 401 |
| PERMISSION_DENIED | 403 |
| NOT_FOUND | 404 |
| ALREADY_EXISTS | 409 |
| RESOURCE_EXHAUSTED | 429 |
| INTERNAL | 500 |
| UNAVAILABLE | 503 |
| DEADLINE_EXCEEDED | 504 |
`,
    examples: [
      {
        title: 'Basic HTTP Server',
        code: `import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .procedure('users.list')
    .handler(async () => db.users.findMany())

  .procedure('users.create')
    .handler(async (input) => db.users.create({ data: input }))

await server.start()

// Endpoints created:
// POST /api/users.list
// POST /api/users.create`,
      },
      {
        title: 'SSE Streaming',
        code: `import { createServer, createStream } from 'raffel'

const server = createServer({ port: 3000 })
  .stream('logs.tail')
    .handler(async function* (input, ctx) {
      const stream = createStream()

      // Write log entries as they arrive
      logEmitter.on('log', (entry) => {
        stream.write(entry)
      })

      // Yield chunks from the stream
      for await (const chunk of stream) {
        yield chunk
      }
    })

// Client: GET /api/streams/logs.tail (SSE)
// Receives: data: {"level":"info","message":"..."}`,
      },
      {
        title: 'CORS Configuration',
        code: `import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
    credentials: true,
  }
})`,
      },
    ],
  },
  {
    name: 'WebSocket',
    protocol: 'WebSocket (RFC 6455)',
    description:
      'Full-duplex WebSocket adapter with JSON envelope protocol. Supports bidirectional streaming, pub/sub channels, and presence.',
    options: [
      {
        name: 'path',
        type: 'string',
        required: false,
        default: "'/ws'",
        description: 'WebSocket endpoint path',
      },
      {
        name: 'heartbeatInterval',
        type: 'number',
        required: false,
        default: '30000',
        description: 'Ping interval in milliseconds',
      },
      {
        name: 'maxConnections',
        type: 'number',
        required: false,
        description: 'Maximum concurrent connections',
      },
      {
        name: 'perMessageDeflate',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Enable per-message compression',
      },
      {
        name: 'channels',
        type: 'ChannelOptions',
        required: false,
        description: 'Enable Pusher-like pub/sub channels',
      },
    ],
    features: [
      'Full-duplex bidirectional communication',
      'JSON envelope protocol',
      'Automatic heartbeat/ping-pong',
      'Per-message compression',
      'Pusher-compatible pub/sub channels',
      'Presence channels with member tracking',
      'Automatic reconnection support (client)',
      'Stream multiplexing',
    ],
    mapping: `
## WebSocket Protocol

### Message Format (JSON Envelope)

\`\`\`typescript
// Request
{
  "id": "req_abc123",
  "procedure": "users.get",
  "type": "request",
  "payload": { "id": "user_1" }
}

// Response
{
  "id": "req_abc123",
  "procedure": "users.get",
  "type": "response",
  "payload": { "id": "user_1", "name": "Alice" }
}

// Stream Data
{
  "id": "stream_xyz",
  "procedure": "logs.tail",
  "type": "stream:data",
  "payload": { "level": "info", "message": "..." }
}

// Event
{
  "id": "evt_789",
  "procedure": "user.updated",
  "type": "event",
  "payload": { "userId": "user_1" }
}
\`\`\`

### Channel Messages (Pusher-like)

\`\`\`typescript
// Subscribe to public channel
{ "event": "pusher:subscribe", "data": { "channel": "updates" } }

// Subscribe to private channel (requires auth)
{ "event": "pusher:subscribe", "data": { "channel": "private-user-123", "auth": "..." } }

// Subscribe to presence channel
{ "event": "pusher:subscribe", "data": { "channel": "presence-room-1", "auth": "...", "channel_data": {...} } }

// Publish event
{ "event": "client-message", "channel": "presence-room-1", "data": { "text": "Hello!" } }
\`\`\`
`,
    examples: [
      {
        title: 'WebSocket Server',
        code: `import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .enableWebSocket({
    path: '/ws',
    heartbeatInterval: 30000
  })

  .procedure('chat.send')
    .handler(async (input, ctx) => {
      const message = await db.messages.create({ data: input })

      // Broadcast to all connected clients
      server.ws?.broadcast({ type: 'new_message', data: message })

      return message
    })

await server.start()

// Client connects to: ws://localhost:3000/ws`,
      },
      {
        title: 'Bidirectional Streaming',
        code: `import { createServer, createStream } from 'raffel'

const server = createServer()
  .enableWebSocket()

  .stream('chat.room', { direction: 'bidi' })
    .handler(async function* (inputStream, ctx) {
      const output = createStream()

      // Read from client stream
      for await (const message of inputStream) {
        // Process and broadcast
        const saved = await db.messages.create({ data: message })
        output.write({ type: 'message', data: saved })
      }

      return output
    })`,
      },
      {
        title: 'Pub/Sub Channels',
        code: `import { createServer } from 'raffel'

const server = createServer()
  .enableWebSocket({
    channels: {
      authorize: async (socket, channel, ctx) => {
        // Authorize private/presence channels
        if (channel.startsWith('private-user-')) {
          const userId = channel.replace('private-user-', '')
          return ctx.auth?.principal === userId
        }
        return true
      },
      onSubscribe: (socket, channel) => {
        console.log(\`Client subscribed to \${channel}\`)
      }
    }
  })

await server.start()

// Server-side broadcast
server.channels?.broadcast('updates', 'price-changed', { symbol: 'BTC', price: 45000 })

// Presence tracking
const members = server.channels?.getMembers('presence-room-1')`,
      },
    ],
  },
  {
    name: 'gRPC',
    protocol: 'gRPC (HTTP/2 + Protobuf)',
    description:
      'High-performance gRPC adapter with Protobuf serialization. Supports unary, server/client/bidi streaming.',
    options: [
      {
        name: 'port',
        type: 'number',
        required: false,
        default: '50051',
        description: 'gRPC server port',
      },
      {
        name: 'tls',
        type: 'GrpcTlsOptions',
        required: false,
        description: 'TLS configuration for secure connections',
      },
      {
        name: 'maxReceiveMessageLength',
        type: 'number',
        required: false,
        default: '4194304',
        description: 'Maximum message size (4MB default)',
      },
      {
        name: 'reflection',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Enable gRPC reflection for tools like grpcurl',
      },
      {
        name: 'protoPath',
        type: 'string',
        required: false,
        description: 'Path to .proto files (auto-generates if not provided)',
      },
    ],
    features: [
      'HTTP/2 multiplexing',
      'Protobuf binary serialization',
      'All streaming modes (unary, server, client, bidi)',
      'gRPC reflection',
      'Deadline/timeout propagation',
      'Metadata (headers) support',
      'TLS/mTLS encryption',
      'Health check protocol',
    ],
    mapping: `
## gRPC Mapping

### Procedure Name → gRPC Method

\`\`\`
Raffel: users.Create
gRPC:   /raffel.Users/Create

Raffel: orders.getById
gRPC:   /raffel.Orders/GetById
\`\`\`

### Handler Type → gRPC Method Type

| Handler | gRPC Method | Proto |
|---------|-------------|-------|
| Procedure | Unary | \`rpc Method(Req) returns (Res)\` |
| Stream (server) | Server streaming | \`rpc Method(Req) returns (stream Res)\` |
| Stream (client) | Client streaming | \`rpc Method(stream Req) returns (Res)\` |
| Stream (bidi) | Bidirectional | \`rpc Method(stream Req) returns (stream Res)\` |

### Metadata Mapping

| gRPC Metadata | Raffel Context |
|---------------|----------------|
| authorization | ctx.auth |
| x-request-id | envelope.id |
| grpc-timeout | ctx.deadline |
| traceparent | ctx.tracing |
`,
    examples: [
      {
        title: 'gRPC Server',
        code: `import { createServer } from 'raffel'

const server = createServer()
  .grpc({ port: 50051, reflection: true })

  .procedure('users.Create')
    .handler(async (input) => db.users.create({ data: input }))

  .procedure('users.Get')
    .handler(async ({ id }) => db.users.findUnique({ where: { id } }))

await server.start()

// Test with grpcurl:
// grpcurl -plaintext localhost:50051 list
// grpcurl -plaintext -d '{"name":"Alice"}' localhost:50051 raffel.Users/Create`,
      },
      {
        title: 'Server Streaming',
        code: `import { createServer, createStream } from 'raffel'

const server = createServer()
  .grpc({ port: 50051 })

  .stream('metrics.Subscribe')
    .handler(async function* (input, ctx) {
      while (!ctx.signal.aborted) {
        yield collectMetrics()
        await sleep(1000)
      }
    })`,
      },
      {
        title: 'Secure gRPC with TLS',
        code: `import { createServer } from 'raffel'
import { readFileSync } from 'fs'

const server = createServer()
  .grpc({
    port: 50051,
    tls: {
      cert: readFileSync('server.crt'),
      key: readFileSync('server.key'),
      ca: readFileSync('ca.crt'),        // For mTLS
      requestCert: true,                  // Require client cert
    }
  })`,
      },
    ],
  },
  {
    name: 'JSON-RPC',
    protocol: 'JSON-RPC 2.0',
    description:
      'JSON-RPC 2.0 adapter for simple RPC-style communication. Supports batch requests and notifications.',
    options: [
      {
        name: 'path',
        type: 'string',
        required: false,
        default: "'/jsonrpc'",
        description: 'JSON-RPC endpoint path',
      },
      {
        name: 'batchLimit',
        type: 'number',
        required: false,
        default: '100',
        description: 'Maximum requests in a batch',
      },
      {
        name: 'strictMode',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Strict JSON-RPC 2.0 compliance',
      },
    ],
    features: [
      'JSON-RPC 2.0 compliant',
      'Batch requests',
      'Notifications (no response)',
      'Named and positional parameters',
      'Standard error codes',
    ],
    mapping: `
## JSON-RPC Mapping

### Request Format

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "users.create",
  "params": { "name": "Alice", "email": "alice@example.com" }
}
\`\`\`

### Response Format

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "id": "user_123", "name": "Alice" }
}
\`\`\`

### Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
`,
    examples: [
      {
        title: 'JSON-RPC Server',
        code: `import { createServer } from 'raffel'

const server = createServer()
  .enableJsonRpc({ path: '/rpc' })

  .procedure('math.add')
    .handler(async ({ a, b }) => a + b)

  .procedure('math.multiply')
    .handler(async ({ a, b }) => a * b)

await server.start()

// POST /rpc
// {"jsonrpc":"2.0","id":1,"method":"math.add","params":{"a":2,"b":3}}
// => {"jsonrpc":"2.0","id":1,"result":5}`,
      },
      {
        title: 'Batch Requests',
        code: `// POST /rpc
[
  {"jsonrpc":"2.0","id":1,"method":"math.add","params":{"a":1,"b":2}},
  {"jsonrpc":"2.0","id":2,"method":"math.multiply","params":{"a":3,"b":4}},
  {"jsonrpc":"2.0","method":"logs.info","params":{"message":"no response"}}
]

// Response (notifications excluded):
[
  {"jsonrpc":"2.0","id":1,"result":3},
  {"jsonrpc":"2.0","id":2,"result":12}
]`,
      },
    ],
  },
  {
    name: 'GraphQL',
    protocol: 'GraphQL (HTTP + WebSocket)',
    description:
      'Auto-generates GraphQL schema from procedures. Queries for reads, Mutations for writes, Subscriptions for streams.',
    options: [
      {
        name: 'path',
        type: 'string',
        required: false,
        default: "'/graphql'",
        description: 'GraphQL endpoint path',
      },
      {
        name: 'playground',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Enable GraphQL Playground',
      },
      {
        name: 'introspection',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Enable schema introspection',
      },
      {
        name: 'subscriptions',
        type: 'boolean | SubscriptionOptions',
        required: false,
        default: 'true',
        description: 'Enable WebSocket subscriptions',
      },
    ],
    features: [
      'Auto-schema generation from procedures',
      'Query/Mutation/Subscription mapping',
      'GraphQL Playground/GraphiQL',
      'WebSocket subscriptions',
      'Schema introspection',
      'Custom scalars (JSON, DateTime)',
    ],
    mapping: `
## GraphQL Mapping

### Procedure Name → GraphQL Field

\`\`\`
users.list    → Query { usersList(...) }
users.create  → Mutation { usersCreate(...) }
users.updated → Subscription { usersUpdated }
\`\`\`

### Naming Convention

| Raffel | GraphQL |
|--------|---------|
| users.list | usersList |
| users.getById | usersGetById |
| orders.create | ordersCreate |
| notifications.new | Subscription: notificationsNew |

### Type Generation

Input/Output schemas automatically generate GraphQL types.
`,
    examples: [
      {
        title: 'GraphQL Server',
        code: `import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer()
  .enableGraphQL({ path: '/graphql', playground: true })

  // Becomes Query.usersList
  .procedure('users.list')
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .handler(async () => db.users.findMany())

  // Becomes Mutation.usersCreate
  .procedure('users.create')
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .handler(async (input) => db.users.create({ data: input }))

await server.start()

// Query:
// query { usersList { id name } }

// Mutation:
// mutation { usersCreate(input: {name: "Alice", email: "a@b.com"}) { id } }`,
      },
      {
        title: 'GraphQL Subscriptions',
        code: `import { createServer, createStream } from 'raffel'

const server = createServer()
  .enableGraphQL({ subscriptions: true })

  // Becomes Subscription.messagesNew
  .stream('messages.new')
    .handler(async function* (input, ctx) {
      const stream = createStream()

      messageEmitter.on('new', (msg) => stream.write(msg))
      ctx.signal.addEventListener('abort', () => stream.end())

      for await (const msg of stream) {
        yield msg
      }
    })

// Client subscription:
// subscription { messagesNew { id text sender } }`,
      },
    ],
  },
  {
    name: 'TCP',
    protocol: 'TCP (Custom)',
    description:
      'Raw TCP socket adapter with configurable framing. For custom binary protocols and high-performance scenarios.',
    options: [
      {
        name: 'port',
        type: 'number',
        required: true,
        description: 'TCP server port',
      },
      {
        name: 'framing',
        type: "'length-prefixed' | 'newline' | 'custom'",
        required: false,
        default: "'length-prefixed'",
        description: 'Message framing strategy',
      },
      {
        name: 'maxMessageSize',
        type: 'number',
        required: false,
        default: '1048576',
        description: 'Maximum message size (1MB default)',
      },
      {
        name: 'serialization',
        type: "'json' | 'msgpack' | 'cbor' | 'custom'",
        required: false,
        default: "'json'",
        description: 'Message serialization format',
      },
      {
        name: 'tls',
        type: 'TlsOptions',
        required: false,
        description: 'TLS configuration for secure connections',
      },
    ],
    features: [
      'Length-prefixed framing',
      'Multiple serialization formats',
      'TLS encryption',
      'Keep-alive support',
      'Connection pooling (client)',
      'Binary protocol support',
    ],
    mapping: `
## TCP Protocol

### Length-Prefixed Framing

\`\`\`
[4 bytes: length][N bytes: message]
\`\`\`

### Message Format (JSON)

Same as WebSocket envelope format.

### Binary Serialization

MessagePack and CBOR supported for reduced bandwidth.
`,
    examples: [
      {
        title: 'TCP Server',
        code: `import { createServer } from 'raffel'

const server = createServer()
  .tcp({
    port: 9000,
    framing: 'length-prefixed',
    serialization: 'msgpack'
  })

  .procedure('data.process')
    .handler(async (input) => processData(input))

await server.start()`,
      },
      {
        title: 'TCP with TLS',
        code: `import { createServer } from 'raffel'
import { readFileSync } from 'fs'

const server = createServer()
  .tcp({
    port: 9443,
    tls: {
      cert: readFileSync('server.crt'),
      key: readFileSync('server.key')
    }
  })`,
      },
    ],
  },
  {
    name: 'S3DB',
    protocol: 'REST → S3DB Resource Adapter',
    description:
      'Auto-generates CRUD endpoints from s3db.js resources. Maps HTTP verbs to S3DB operations.',
    options: [
      {
        name: 'database',
        type: 'S3DBDatabaseLike',
        required: true,
        description: 's3db.js database instance',
      },
      {
        name: 'resources',
        type: 'string[]',
        required: false,
        description: 'Resource names to expose (all if not specified)',
      },
      {
        name: 'prefix',
        type: 'string',
        required: false,
        default: "'/api'",
        description: 'API prefix for generated routes',
      },
      {
        name: 'guards',
        type: 'S3DBGuardsOptions',
        required: false,
        description: 'Flexible guards system for authorization (roles, scopes, custom functions)',
      },
    ],
    features: [
      'Auto-CRUD from s3db.js resources',
      'Filtering, sorting, pagination',
      'Relation expansion',
      'Authorization hooks',
      'OpenAPI spec generation',
    ],
    mapping: `
## S3DB HTTP Mapping

| HTTP | Path | S3DB Operation |
|------|------|----------------|
| GET | /api/users | resource.list() |
| GET | /api/users/:id | resource.get(id) |
| POST | /api/users | resource.create(data) |
| PUT | /api/users/:id | resource.update(id, data) |
| PATCH | /api/users/:id | resource.update(id, data, {partial: true}) |
| DELETE | /api/users/:id | resource.delete(id) |
| HEAD | /api/users/:id | resource.exists(id) |
| OPTIONS | /api/users | resource.schema() |

### Query Parameters

| Param | Description |
|-------|-------------|
| ?filter[field]=value | Filter by field |
| ?sort=field,-other | Sort (- for desc) |
| ?page=1&limit=20 | Pagination |
| ?expand=relation | Include relations |
`,
    examples: [
      {
        title: 'S3DB REST API',
        code: `import { createServer, createS3DBAdapter } from 'raffel'
import { createDatabase, createResource } from 's3db.js'

const db = createDatabase({ bucket: 'my-bucket' })

const users = createResource(db, 'users', {
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'email', required: true, unique: true },
    createdAt: { type: 'timestamp', default: () => Date.now() }
  }
})

const server = createServer()
  .use(createS3DBAdapter({
    database: db,
    resources: ['users'],
    prefix: '/api',
    authorize: async (operation, resource, ctx) => {
      if (operation === 'delete' && !ctx.auth?.roles?.includes('admin')) {
        throw new Error('Only admins can delete')
      }
      return true
    }
  }))

await server.start()

// Generated endpoints:
// GET    /api/users
// GET    /api/users/:id
// POST   /api/users
// PUT    /api/users/:id
// PATCH  /api/users/:id
// DELETE /api/users/:id`,
      },
    ],
  },
]

export function getAdapter(name: string): AdapterDoc | undefined {
  return adapters.find((a) => a.name.toLowerCase() === name.toLowerCase())
}

export function listAdapters(): AdapterDoc[] {
  return adapters
}
