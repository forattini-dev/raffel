# gRPC Adapter

Raffel exposes services over gRPC using proto definitions and a service.method mapping.

## Mapping

Given a service `User` with method `Create`, the procedure name is:

```
User.Create
```

If a proto package is present, it is prefixed:

```
package auth;
service User { rpc Create (...) returns (...); }

// procedure name
auth.User.Create
```

## Setup

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.grpc({
  port: 4000,
  protoPath: './proto/app.proto',
})
```

If you use file-system discovery, name RPC files with the service.method name
so the gRPC adapter can match them.

```
src/rpc/User.Create.ts -> User.Create
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on |
| `host` | string | `'0.0.0.0'` | Host to bind to |
| `protoPath` | string | required | Path to `.proto` file |
| `serviceNames` | string[] | - | Register only specific services |
| `packageName` | string | - | Prefix services with proto package |
| `loaderOptions` | object | - | Options for `@grpc/proto-loader` |
| `tls` | object | - | TLS configuration (key/cert/ca) |
| `maxReceiveMessageLength` | number | - | Maximum inbound message size |
| `maxSendMessageLength` | number | - | Maximum outbound message size |

## Streaming

gRPC streaming methods map to Raffel stream handlers:

- server streaming -> `direction: 'server'`
- client streaming -> `direction: 'client'`
- bidi streaming -> `direction: 'bidi'`

Use the fluent builder with `.direction(...)` or register via `registry.stream` with
`direction`.

## USD Documentation Metadata

Use metadata to document gRPC streaming semantics in USD:

```ts
server
  .procedure('chat.stream')
  .grpc({ clientStreaming: true, serverStreaming: true })
  .handler(async () => ({ ok: true }))
```

With file-system discovery:

```ts
export const meta = {
  grpc: {
    clientStreaming: true,
    serverStreaming: false,
  },
}
```

## USD Content Types

USD defaults to `application/x-protobuf` for gRPC messages. You can override
protocol defaults or per-method content types for documentation:

```ts
server.enableUSD({
  grpc: {
    contentTypes: {
      default: 'application/x-protobuf',
      supported: ['application/x-protobuf', 'application/json'],
    },
  },
})
```

For file-system discovery, use handler metadata to override a method:

```ts
export const meta = {
  contentTypes: { default: 'application/x-protobuf' },
}
```

## TLS

```ts
server.grpc({
  port: 4000,
  protoPath: './proto/app.proto',
  tls: {
    key: fs.readFileSync('./certs/server.key'),
    cert: fs.readFileSync('./certs/server.crt'),
    ca: fs.readFileSync('./certs/ca.crt'),
  },
})
```
