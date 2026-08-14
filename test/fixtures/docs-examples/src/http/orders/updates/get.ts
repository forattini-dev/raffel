// src/http/orders/updates/get.ts
import { z } from 'zod'
import { runLongPoll } from 'raffel/http'
import type { AppContext } from '../../../application/context.js'

export const input = z.object({
  cursor: z.string().nullable().default(null),
})

export const output = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('change'),
    cursor: z.string(),
    retryAfterMs: z.number(),
    data: z.unknown(),
  }),
  z.object({
    outcome: z.literal('timeout'),
    cursor: z.string().nullable(),
    retryAfterMs: z.number(),
  }),
])

export const meta = {
  httpPath: '/orders/updates',
  httpMethod: 'GET' as const,
  longPoll: {
    cursor: { input: 'cursor', output: 'cursor', semantics: 'exclusive' as const },
    waitMs: 25_000,
    retryMs: 1_000,
    timeoutOutcome: 'timeout' as const,
  },
}

export default function getOrderUpdate(
  request: z.infer<typeof input>,
  ctx: AppContext,
): Promise<z.infer<typeof output>> {
  return runLongPoll({
    cursor: request.cursor,
    waitMs: meta.longPoll.waitMs,
    retryMs: meta.longPoll.retryMs,
    signal: ctx.signal,
    wait: ({ after, signal }) => ctx.services.orderChanges.waitAfter(after, { signal }),
  })
}
