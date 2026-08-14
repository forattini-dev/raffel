// src/http/orders/create/post.ts
import { z } from 'zod'
import type { AppContext } from '../../../application/context.js'

export const input = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  idempotencyKey: z.string(),
})

export const output = z.object({
  orderId: z.string(),
  paymentId: z.string(),
})

export const meta = {
  httpPath: '/orders',
  httpMethod: 'POST' as const,
}

export default async function createOrder(
  request: z.infer<typeof input>,
  ctx: AppContext,
): Promise<z.infer<typeof output>> {
  const payment = await ctx.services.billing.charge({
    amount: request.amount,
    idempotencyKey: request.idempotencyKey,
    signal: ctx.signal,
    deadline: ctx.deadline,
  })
  return { orderId: request.orderId, paymentId: payment.paymentId }
}
