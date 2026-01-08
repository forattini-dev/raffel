# JSON-RPC Adapter

Raffel supports JSON-RPC 2.0 over HTTP. Methods map to procedure names.
Batch requests and notifications are supported.

## Request example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "users.create",
  "params": { "name": "Lia" }
}
```

## Enable JSON-RPC

```ts
createServer({ port: 3000 }).enableJsonRpc('/rpc')
```

Notifications (no `id`) are accepted and do not return responses.

## Batch example

```json
[
  { "jsonrpc": "2.0", "id": 1, "method": "users.create", "params": { "name": "Lia" } },
  { "jsonrpc": "2.0", "method": "audit.write", "params": { "action": "user.create" } }
]
```
