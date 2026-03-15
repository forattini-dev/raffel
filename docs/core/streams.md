# Streams

Raffel provides first-class support for streaming data. Streams return async iterables
and are wrapped into stream envelopes by the router. The underlying `RaffelStream`
provides backpressure, priority, and cancellation support.

## Basic Example

```ts
server
  .stream('metrics.live')
  .handler(async function* () {
    while (true) {
      yield { cpu: Math.random(), memory: process.memoryUsage() }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })
```

HTTP streams are delivered as SSE (Server-Sent Events). WebSocket and TCP send
stream envelopes.

## USD Content Types

USD defaults to JSON for streams. You can document protocol defaults or
per-stream overrides:

```ts
server.enableUSD({
  streams: {
    contentTypes: {
      default: 'application/json',
      supported: ['application/json', 'application/x-ndjson'],
    },
  },
})
```

For file-system discovery, attach metadata to a stream handler:

```ts
export const meta = {
  contentType: 'application/x-ndjson',
}
```

## Stream Builder API

The stream builder provides a fluent interface for defining streams:

```ts
server
  .stream('logs.tail')
  .input(z.object({ level: z.string().optional(), limit: z.number().default(100) }))
  .output(z.object({ timestamp: z.date(), message: z.string(), level: z.string() }))
  .description('Stream log entries in real-time')
  .direction('server')
  .use(authInterceptor)
  .handler(async function* (input, ctx) {
    const logs = await tailLogs(input)
    for await (const log of logs) {
      if (ctx.signal?.aborted) break
      yield log
    }
  })
```

### Builder Methods

| Method | Description |
|--------|-------------|
| `.input(schema)` | Define input validation schema (Zod) |
| `.output(schema)` | Define output validation schema (Zod) |
| `.description(text)` | Add description for documentation |
| `.direction(dir)` | Set stream direction (`server`, `client`, `bidi`) |
| `.use(interceptor)` | Add interceptor/middleware |
| `.handler(fn)` | Define the stream handler function |

## Stream Directions

Raffel supports three stream directions:

### Server Streams (default)

Server sends data to client. The handler is an async generator:

```ts
server
  .stream('prices.watch')
  .direction('server') // optional, this is the default
  .handler(async function* (input) {
    while (true) {
      const prices = await fetchPrices(input.symbols)
      yield prices
      await sleep(1000)
    }
  })
```

### Client Streams

Client sends data to server. The handler receives an async iterable and returns a
single response:

```ts
server
  .stream('files.upload')
  .direction('client')
  .handler(async (chunks, ctx) => {
    const parts: Buffer[] = []
    for await (const chunk of chunks) {
      parts.push(chunk)
    }
    const file = Buffer.concat(parts)
    await saveFile(file)
    return { size: file.length, success: true }
  })
```

### Bidirectional Streams (bidi)

Both client and server can send data simultaneously. The handler receives an async
iterable and returns an async generator:

```ts
server
  .stream('chat.conversation')
  .direction('bidi')
  .handler(async function* (messages, ctx) {
    for await (const msg of messages) {
      // Echo back with processing
      yield { echo: msg.content, processed: true }

      // Can also yield unprompted messages
      if (msg.content === 'status') {
        yield { type: 'status', online: true }
      }
    }
  })
```

## Protocol Support

| Protocol | Server Stream | Client Stream | Bidi Stream |
|----------|---------------|---------------|-------------|
| HTTP (SSE) | ✅ | ❌ | ❌ |
| WebSocket | ✅ | ✅ | ✅ |
| TCP | ✅ | ✅ | ✅ |
| gRPC | ✅ | ✅ | ✅ |
| JSON-RPC | ❌ | ❌ | ❌ |

## RaffelStream API

Under the hood, Raffel uses a custom stream abstraction with backpressure support:

```ts
import { createStream } from 'raffel'

const stream = createStream<string>({
  id: 'my-stream',        // Optional ID for multiplexing
  highWaterMark: 16,      // Buffer size before backpressure (default: 16)
  priority: 0,            // Higher = processed first
})

// Writing
await stream.write('hello')    // Blocks if buffer full
await stream.write('world')
stream.end()                   // Signal end of writes

// Reading
const chunk = await stream.read()  // { done: false, value: 'hello' }
const chunk2 = await stream.read() // { done: false, value: 'world' }
const chunk3 = await stream.read() // { done: true }

// Or use async iterator
for await (const value of stream) {
  console.log(value)
}
```

### Stream Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | string | auto-generated | Stream ID for multiplexing |
| `highWaterMark` | number | `16` | Max items in buffer before backpressure |
| `priority` | number | `0` | Priority level (higher = processed first) |

### Stream Interface

```ts
interface RaffelStream<T> {
  // Reading
  read(): Promise<StreamChunk<T>>
  [Symbol.asyncIterator](): AsyncIterator<T>

  // Writing
  write(value: T): Promise<void>
  end(): void
  error(err: Error): void

  // Control
  pause(): void
  resume(): void
  cancel(reason?: string): void

  // State (readonly)
  readonly readable: boolean
  readonly writable: boolean
  readonly closed: boolean
  readonly errored: Error | null

  // Metadata (readonly)
  readonly id: string
  readonly priority: number
  readonly bufferedAmount: number
}
```

### Stream States

| State | Description |
|-------|-------------|
| `open` | Stream is active, can read and write |
| `closing` | `end()` called, draining buffer |
| `closed` | All data consumed, stream finished |
| `errored` | Error occurred or stream cancelled |

## Cancellation

Streams can be cancelled via the context's AbortSignal:

```ts
server
  .stream('long.running')
  .handler(async function* (input, ctx) {
    while (true) {
      // Check for cancellation
      if (ctx.signal?.aborted) {
        console.log('Stream cancelled:', ctx.signal.reason)
        break
      }

      yield { data: await fetchData() }
      await sleep(1000)
    }
  })
```

Or call `cancel()` on the stream directly:

```ts
const stream = createStream()

// Later...
stream.cancel('User disconnected')
```

## Backpressure

RaffelStream automatically handles backpressure via `highWaterMark`:

```ts
const stream = createStream<number>({ highWaterMark: 2 })

// These complete immediately (buffer has space)
await stream.write(1)  // buffer: [1]
await stream.write(2)  // buffer: [1, 2]

// This blocks until a read makes space
const writePromise = stream.write(3)  // Waiting...

// Reading unblocks the write
await stream.read()  // Returns 1, writePromise resolves
```

For zero-buffering (direct producer-consumer handoff):

```ts
const stream = createStream({ highWaterMark: 0 })

// Writer blocks until reader is ready
const writePromise = stream.write('data')

// Reader unblocks the writer
const chunk = await stream.read()  // Both resolve
```

## HTTP (SSE) Streaming

Server streams over HTTP use Server-Sent Events:

```bash
curl -N http://localhost:3000/streams/logs.tail?level=error
```

Response:

```
data: {"timestamp":"2024-01-01T00:00:00Z","message":"Error occurred","level":"error"}

data: {"timestamp":"2024-01-01T00:00:01Z","message":"Another error","level":"error"}

event: end
data: {}
```

SSE event types:
- `data` (default) - Stream chunk
- `end` - Stream completed successfully
- `error` - Stream error occurred

## WebSocket Streaming

WebSocket streams use envelope messages:

```json
// Start stream
{ "type": "stream:start", "id": "stream_1", "procedure": "logs.tail", "payload": { "level": "error" } }

// Stream chunks
{ "type": "stream:data", "id": "stream_1", "payload": { "message": "Error..." } }
{ "type": "stream:data", "id": "stream_1", "payload": { "message": "Another..." } }

// Stream end
{ "type": "stream:end", "id": "stream_1" }
```

Errors use the `stream:error` type with a standard error payload.

## File-Based Streams

Streams can also be defined in the routes directory:

```ts
// routes/metrics/live.stream.ts
import { z } from 'zod'

export const meta = {
  description: 'Stream live metrics',
  direction: 'server' as const,
}

export const inputSchema = z.object({
  interval: z.number().default(1000),
})

export const outputSchema = z.object({
  cpu: z.number(),
  memory: z.number(),
})

export default async function* handler(input, ctx) {
  while (!ctx.signal?.aborted) {
    yield {
      cpu: process.cpuUsage().user / 1000000,
      memory: process.memoryUsage().heapUsed,
    }
    await new Promise((r) => setTimeout(r, input.interval))
  }
}
```

## Best Practices

1. **Always check for cancellation** in long-running streams:
   ```ts
   if (ctx.signal?.aborted) break
   ```

2. **Use appropriate `highWaterMark`** based on your use case:
   - Higher for throughput (batch processing)
   - Lower for latency (real-time updates)
   - Zero for strict synchronization

3. **Clean up resources** when stream ends:
   ```ts
   async function* handler(input, ctx) {
     const connection = await openConnection()
     try {
       for await (const data of connection) {
         yield data
       }
     } finally {
       await connection.close()
     }
   }
   ```

4. **Use `output` schema** for type safety and documentation:
   ```ts
   .output(z.object({ timestamp: z.date(), value: z.number() }))
   ```

5. **Prefer server streams** when client just needs to receive data - they work
   across all protocols including HTTP.
