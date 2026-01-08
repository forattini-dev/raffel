# Streams

Streams return async iterables and are wrapped into stream envelopes by the router.
RaffelStream provides backpressure, priority, and cancellation support.

## Example

```ts
server
  .stream('metrics.live')
  .handler(async function* () {
    while (true) {
      yield { cpu: Math.random() }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })
```

HTTP streams are delivered as SSE. WebSocket and TCP send stream envelopes.

## Directions

Streams default to server -> client. Use `direction` to enable client or bidirectional
streaming when the protocol supports it (for example gRPC, WebSocket, TCP). Client
streams receive an async iterable input and return a single response. Bidi streams
receive and return async iterables.

```ts
server
  .stream('chat.pipe')
  .direction('bidi')
  .handler(async function* (input) {
    for await (const msg of input) {
      yield { echo: msg }
    }
  })
```
