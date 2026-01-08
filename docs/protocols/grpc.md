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

- `serviceNames`: register only a subset of services
- `packageName`: scope services under a proto package
- `loaderOptions`: pass options to `@grpc/proto-loader`

## Streaming

gRPC streaming methods map to Raffel stream handlers:

- server streaming -> `direction: 'server'`
- client streaming -> `direction: 'client'`
- bidi streaming -> `direction: 'bidi'`

Use the fluent builder with `.direction(...)` or register via `registry.stream` with
`direction`.

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
