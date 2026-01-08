# TCP Adapter

TCP uses a length-prefixed framing for JSON envelopes.

```
[4 bytes length][N bytes JSON]
```

The JSON payload matches the WebSocket envelope shape.

## Enable TCP

```ts
createServer({ port: 3000 }).tcp({ port: 4000 })
```
