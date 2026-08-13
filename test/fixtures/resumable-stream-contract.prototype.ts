import { z } from 'zod'

export type ResumeCursor = string

export interface StreamRecord<TData> {
  cursor: ResumeCursor
  data: TData
}

export interface StreamSnapshot<TState> {
  cursor: ResumeCursor
  data: TState
}

export type ReplayOutcome<TData, TState> =
  | {
      outcome: 'records'
      records: AsyncIterable<StreamRecord<TData>>
      through: ResumeCursor
    }
  | {
      outcome: 'cursor-expired'
      snapshot: StreamSnapshot<TState>
    }

export interface DurableStreamSource<TInput, TData> {
  subscribe(
    input: TInput,
    options: { after?: ResumeCursor; signal: AbortSignal }
  ): AsyncIterable<StreamRecord<TData>>
}

export interface ReplayProvider<TInput, TData, TState> {
  replay(
    input: TInput,
    options: { after: ResumeCursor; signal: AbortSignal }
  ): Promise<ReplayOutcome<TData, TState>>
}

export interface ResumableStreamProvider<TInput, TData, TState> {
  source: DurableStreamSource<TInput, TData>
  replay: ReplayProvider<TInput, TData, TState>
}

export interface ResumableStreamConfig {
  provider: string
  delivery: 'at-least-once'
  cursor: {
    header: 'Last-Event-ID'
    query?: string
  }
  expiredCursor: {
    event: 'snapshot'
  }
}

export const orderInput = z.object({ orderId: z.string().uuid() })
export const orderOutput = z.object({ status: z.enum(['pending', 'paid']) })
export const orderSnapshot = z.object({ status: z.enum(['pending', 'paid', 'cancelled']) })

export const orderRecovery = {
  provider: 'orderChanges',
  delivery: 'at-least-once',
  cursor: {
    header: 'Last-Event-ID',
    query: 'cursor',
  },
  expiredCursor: {
    event: 'snapshot',
  },
} satisfies ResumableStreamConfig

// Exact fs-discovery exports: a Source-Backed Stream has no connection-scoped
// default handler. The application provider supplies both initial and replayed
// records.
export const resumable = orderRecovery
export const snapshot = orderSnapshot

export const fsDiscoveredResumableStream = {
  input: orderInput,
  output: orderOutput,
  snapshot,
  meta: {
    description: 'Watch durable order status changes.',
    direction: 'server' as const,
  },
  resumable,
}

interface ResumablePrototypeBuilder {
  input(schema: z.ZodType): this
  output(schema: z.ZodType): this
  snapshot(schema: z.ZodType): this
  resumable(config: ResumableStreamConfig): void
}

export interface ResumablePrototypeServer {
  provide<T>(
    name: string,
    factory: () => T,
    options: { onShutdown(instance: T): void | Promise<void> },
  ): this
  stream(name: string): ResumablePrototypeBuilder
}

/** Exact imperative authoring shape approved for implementation. */
export function authorImperativeResumableStream(server: ResumablePrototypeServer): void {
  server.provide('orderChanges', createOrderChangesProvider, {
    onShutdown: provider => provider.close(),
  })
  server.stream('orders/watch')
    .input(orderInput)
    .output(orderOutput)
    .snapshot(orderSnapshot)
    .resumable(orderRecovery)
}

export const liveStream = {
  input: orderInput,
  output: orderOutput,
  default: async function* live() {
    yield { status: 'pending' as const }
  },
}

export function createOrderChangesProvider(): ResumableStreamProvider<
  z.infer<typeof orderInput>,
  z.infer<typeof orderOutput>,
  z.infer<typeof orderSnapshot>
> & { close(): Promise<void> } {
  return {
    source: {
      async *subscribe(_input, { after, signal }) {
        if (!signal.aborted) {
          yield { cursor: after ?? 'opaque:first', data: { status: 'pending' } }
        }
      },
    },
    replay: {
      async replay(_input, { after }) {
        if (after === 'opaque:expired') {
          return {
            outcome: 'cursor-expired',
            snapshot: { cursor: 'opaque:current', data: { status: 'paid' } },
          }
        }

        return {
          outcome: 'records',
          records: (async function* () {
            yield { cursor: 'opaque:next', data: { status: 'paid' as const } }
          })(),
          through: 'opaque:next',
        }
      },
    },
    async close() {},
  }
}
