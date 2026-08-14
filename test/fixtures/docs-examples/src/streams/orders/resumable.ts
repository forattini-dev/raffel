// src/streams/orders/resumable.ts
import { z } from 'zod'

export const input = z.object({
  region: z.string(),
  cursor: z.string().optional(),
})

export const output = z.object({
  orderId: z.string(),
  status: z.string(),
})

export const snapshot = z.object({
  region: z.string(),
  orders: z.array(output),
})

export const resumable = {
  provider: 'orderChanges',
  delivery: 'at-least-once' as const,
  cursor: { header: 'Last-Event-ID' as const, query: 'cursor' },
  expiredCursor: { event: 'snapshot' as const },
}
