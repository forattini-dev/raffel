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
