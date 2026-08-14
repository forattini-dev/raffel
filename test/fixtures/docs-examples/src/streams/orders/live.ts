// src/streams/orders/live.ts
import { z } from 'zod'
import type { AppContext } from '../../application/context.js'

export const input = z.object({
  region: z.string(),
})

export const output = z.object({
  orderId: z.string(),
  status: z.string(),
})

export const meta = {
  description: 'Live order updates for one region',
  direction: 'server' as const,
  controls: {
    heartbeatMs: 15_000,
    retryMs: 2_000,
    maxDurationMs: 55 * 60_000,
    idleTimeoutMs: 60_000,
  },
}

export default async function* liveOrders(
  request: z.infer<typeof input>,
  ctx: AppContext,
): AsyncGenerator<z.infer<typeof output>> {
  const subscription = await ctx.services.orders.subscribe(request.region)
  try {
    for await (const update of subscription) {
      if (ctx.signal.aborted) break
      yield update
    }
  } finally {
    await subscription.close()
  }
}
