# AI workload streaming

Raffel can carry an AI workload through its ordinary server, provider, stream,
validation, authentication, cancellation, and observability capabilities. It
does not embed a model SDK, choose a provider, store generated tokens, or become
an AI orchestration runtime. The application owns the model integration and
injects a narrow service into Raffel.

The canonical browser-facing shape is a Live Stream over application SSE. Each
yielded item is a typed business event rather than an unstructured token. This
makes partial text, accounting, terminal results, cancellation, and safe errors
visible in USD and generated documentation.

## Compose the model integration

Put provider-specific code in an application adapter. Expose only the port the
handler needs:

<!-- validated-example: ai-model-gateway -->
```ts
export interface ModelGateway {
  stream(request: {
    prompt: string
    conversationId: string
    signal: AbortSignal
  }): AsyncIterable<
    | { type: 'delta'; text: string }
    | { type: 'usage'; inputTokens: number; outputTokens: number }
    | { type: 'final'; text: string; finishReason: 'stop' | 'length' | 'content_filter' | 'tool' }
  >
}
```

Create and close the adapter during server composition:

```ts
const server = createServer({ port: 3000 })

server.provide('modelGateway', ({ services }) => {
  return createApplicationModelGateway({
    apiKey: services.secrets.modelApiKey,
    model: services.config.model,
  })
}, {
  onShutdown: gateway => gateway.close(),
})
```

`createApplicationModelGateway` belongs to the application. It may wrap a
hosted model, a local inference server, a queue, or a test double without
changing the Raffel route contract.

## Canonical fs-discovery stream

The route declares every event with a discriminated union. `AppContext` is the
application-owned narrowing of Raffel's `Context` that exposes the typed
`modelGateway` port through `services`:

<!-- validated-example: ai-workload-stream -->
```ts
// src/streams/assistant/chat.ts
import { z } from 'zod'
import type { AppContext } from '../../application/context.js'

export const input = z.object({
  conversationId: z.string().uuid(),
  prompt: z.string().min(1).max(32_000),
})

const deltaEvent = z.object({
  type: z.literal('delta'),
  sequence: z.number().int().nonnegative(),
  text: z.string(),
})

const usageEvent = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})

const finalEvent = z.object({
  type: z.literal('final'),
  text: z.string(),
  finishReason: z.enum(['stop', 'length', 'content_filter', 'tool']),
})

const cancelledEvent = z.object({
  type: z.literal('cancelled'),
  reason: z.enum(['client', 'deadline', 'application']),
})

const errorEvent = z.object({
  type: z.literal('error'),
  code: z.enum(['MODEL_UNAVAILABLE', 'MODEL_REJECTED', 'CAPACITY_EXCEEDED']),
  message: z.string(),
  retryable: z.boolean(),
})

export const aiStreamEvent = z.discriminatedUnion('type', [
  deltaEvent,
  usageEvent,
  finalEvent,
  cancelledEvent,
  errorEvent,
])

export const output = aiStreamEvent

export const meta = {
  description: 'Stream one assistant response as typed application events',
  direction: 'server' as const,
  controls: {
    heartbeatMs: 15_000,
    retryMs: 2_000,
    maxDurationMs: 10 * 60_000,
    idleTimeoutMs: 60_000,
  },
}

export default async function* chat(
  request: z.infer<typeof input>,
  ctx: AppContext,
): AsyncGenerator<z.infer<typeof output>> {
  let sequence = 0

  try {
    const events = ctx.services.modelGateway.stream({
      prompt: request.prompt,
      conversationId: request.conversationId,
      signal: ctx.signal,
    })

    for await (const event of events) {
      if (ctx.signal.aborted) {
        yield { type: 'cancelled', reason: 'client' }
        return
      }

      if (event.type === 'delta') {
        yield { ...event, sequence: sequence++ }
      } else {
        yield event
      }
    }
  } catch (cause) {
    if (ctx.signal.aborted) {
      yield { type: 'cancelled', reason: 'client' }
      return
    }

    ctx.logger.warn({ err: cause }, 'Model stream failed')
    yield {
      type: 'error',
      code: 'MODEL_UNAVAILABLE',
      message: 'The model is temporarily unavailable',
      retryable: true,
    }
  }
}
```

The application adapter must honor `ctx.signal`. Client disconnect, stream
limits, server shutdown, or another Raffel cancellation source can abort it.
Always close model streams, release leases, and stop background generation in
the adapter's `finally` path.

The `cancelled` event represents a business-visible terminal outcome while the
connection can still accept data, such as an application cancellation command
observed by the model gateway. After a browser has disconnected there is no
consumer to receive a final cancellation event; `ctx.signal` cleanup is the
authoritative server-side behavior.

The `error` event is a deliberately safe business outcome. Do not expose raw
provider errors, credentials, prompts, or moderation details. Failures that
must become protocol errors may instead be thrown, but after SSE headers have
started the client can only observe the stream error/close path.

## Browser consumption

Application SSE uses Raffel's named `data`, `end`, and `error` events. The
business discriminator remains inside each `data` payload:

<!-- validated-example: ai-browser-sse -->
```ts
// src/browser/assistant-chat.ts
const source = new EventSource(
  `/streams/assistant/chat?conversationId=${conversationId}&prompt=${encodeURIComponent(userPrompt)}`,
)

source.addEventListener('data', event => {
  const message = event as MessageEvent<string>
  const item = JSON.parse(message.data)

  switch (item.type) {
    case 'delta': appendText(item.text); break
    case 'usage': recordUsage(item); break
    case 'final': finishMessage(item); break
    case 'cancelled': markCancelled(item.reason); source.close(); break
    case 'error': showSafeError(item); source.close(); break
  }
})

source.addEventListener('end', () => source.close())
```

Avoid sensitive or large prompts in query strings because URLs leak through
history and logs. For production chat, create a conversation/request resource
with authenticated HTTP first, then open an SSE stream using its opaque ID; or
use a fetch-based SSE client when authorization headers and a request body are
required.

## Live delivery versus replay

Live reconnection is not replay. `retryMs` only tells an SSE client when to
reconnect. A normal Live Stream may lose deltas emitted while the browser is
disconnected. Raffel does not persist generated tokens as part of this pattern.

If the product must resume without regenerating or duplicating visible output,
opt into a Source-Backed Resumable Stream. The application must supply both a
Replay Provider and a Durable Stream Source, persist opaque cursors with the
events, define retention, and make consumers tolerate at-least-once delivery.
It must also provide an application snapshot for expired cursors. Merely adding
an SSE `id` or sequence number to the live example does not create durability.

For many chat products, persist the authoritative assistant message separately
and treat live token deltas as disposable presentation. After reconnection,
fetch the current message resource. Choose a Resumable Stream only when replay
of the individual event history is a real product requirement.

## Four distinct surfaces

These names all involve AI or SSE, but they are not interchangeable:

| Surface | Purpose | Transport and contract |
|---|---|---|
| Raffel MCP | Raffel's built-in assistant/control-plane and the library used to expose application tools, resources, and prompts to MCP clients. | MCP JSON-RPC semantics, not the chat token stream above. |
| MCP Streamable HTTP | The modern remote MCP transport: requests use `POST /mcp`, notifications can use `GET /mcp`, and sessions use MCP headers. | Governed by the MCP protocol and session lifecycle. |
| legacy MCP SSE | Compatibility transport started with `startSse()` for older MCP clients. | Carries MCP messages; prefer Streamable HTTP for new MCP integrations. |
| application SSE | A Raffel Live or Resumable Stream whose payload is the application's own schema, such as `aiStreamEvent`. | Served from the application's stream route and consumed as domain events. |

Do not expose an AI chat stream as MCP solely because a model produced it. Use
MCP when an MCP client needs tools, resources, prompts, sampling, or progress
semantics. Use application SSE when an application client needs one-way domain
updates. One service may expose both, but authentication, schema, lifecycle,
and operational limits remain separate.

## Production checklist

- Authenticate and authorize before model work starts; never trust a
  conversation ID alone.
- Bound prompt size, output tokens, duration, idle time, concurrent generations,
  and per-identity spend.
- Pass `ctx.signal` through every model wait and verify cancellation actually
  stops billable generation.
- Emit usage as application data only after deciding who may see it; record
  authoritative billing/accounting server-side.
- Redact prompts, generated text, credentials, and raw model errors from logs
  and trace attributes.
- Disable proxy buffering for application SSE and align proxy idle timeouts with
  `heartbeatMs` and `maxDurationMs`.
- Test partial deltas, moderation rejection, provider timeout, client
  disconnect, process shutdown, duplicate delivery, and reconnect behavior.
- State explicitly whether the client may retry a generation. Use an
  idempotency key when repeated creation must return the same logical request.
