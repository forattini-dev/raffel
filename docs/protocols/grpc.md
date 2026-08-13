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

## Shared-Port support

`gRPC` can now ride the unified `singlePort/sharedPort` listener in `h2c`
(insecure HTTP/2 prior-knowledge) mode when the gRPC port matches the server
entrypoint port.

```ts
createServer({
  port: 50051,
  host: '127.0.0.1',
  sharedPort: { protocolFusion: true, protocols: ['grpc'] },
  grpc: { port: 50051, host: '127.0.0.1', protoPath: './proto/app.proto' },
})
```

In this mode, external clients connect to the shared port, while Raffel proxies
the `h2c` stream to the internal gRPC adapter. `inspect`, `preview`, runtime
addresses, and protocol-fusion diagnostics report `source=singlePort`.

Current limitation: TLS/ALPN gRPC still remains on a dedicated listener. If you
configure `grpc.tls`, keep gRPC on its own port for now.

## Front-Door support

`gRPC` is still not parsed by the HTTP-based front-door detector itself.
When listed in `frontDoor.protocols`, it is marked as `offload` and continues to
run on its own port unless you explicitly use shared-port `h2c` as described above.

```ts
createServer({
  port: 3000,
  frontDoor: { enabled: true, port: 443, protocols: ['http', 'grpc'] },
  grpc: { port: 50051, protoPath: './proto/app.proto' },
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on |
| `host` | string | `'127.0.0.1'` | Host to bind to |
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

## Playground Support

`raffel playground src/server.ts --port 4301` can exercise:

- unary methods with direct invoke
- server-streaming methods as live read sessions
- client-streaming methods as writable sessions that close into a final response
- bidirectional methods as duplex sessions

The playground uses the same runtime inspection graph and loaded proto metadata
that power `raffel inspect` and `raffel explain`, so the transport view stays
aligned with the actual gRPC bindings.

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
