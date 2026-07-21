import { describe, expect, it } from 'vitest'
import { createRegistry } from '../../src/core/registry.js'
import { createRouter } from '../../src/core/router.js'
import { createStream } from '../../src/stream/index.js'
import { createTracer, createTracingInterceptor } from '../../src/tracing/index.js'
import type { SpanData, SpanExporter } from '../../src/tracing/types.js'
import { createContext } from '../../src/types/context.js'
import type { Envelope, Interceptor, RaffelStream } from '../../src/types/index.js'

function createCapturingTracer() {
  const exportedSpans: SpanData[] = []
  const exporter: SpanExporter = {
    async export(spans) {
      exportedSpans.push(...spans)
    },
    async shutdown() {},
  }
  const tracer = createTracer({
    serviceName: 'router-handler-test',
    sampleRate: 1,
    exporters: [exporter],
    batchSize: 1,
  })
  return { tracer, exportedSpans }
}

function createEnvelope(procedure: string, type: Envelope['type'], payload: unknown): Envelope {
  return {
    id: `${procedure}-id`,
    procedure,
    type,
    payload,
    metadata: {},
    context: createContext(`${procedure}-request`),
  }
}

describe('router handler tracing', () => {
  it('creates a handler span when invoking a stream handler', async () => {
    const { tracer, exportedSpans } = createCapturingTracer()
    const registry = createRegistry()
    registry.stream('numbers', async function* () {
      yield 1
    })
    const router = createRouter(registry, {
      interceptors: [createTracingInterceptor(tracer, {
        spanName: 'raffel.procedure',
        spanKind: 'internal',
      })],
    })

    try {
      const result = await router.handle(createEnvelope('numbers', 'stream:start', {}))
      await tracer.flush()
      expect(exportedSpans.some((span) => span.name === 'raffel.handler')).toBe(false)

      for await (const _envelope of result as AsyncIterable<Envelope>) {
        // Consume the stream so its handler lifecycle completes.
      }
      await tracer.flush()

      const procedureSpan = exportedSpans.find((span) => span.name === 'raffel.procedure')
      const handlerSpan = exportedSpans.find((span) => span.name === 'raffel.handler')
      expect(handlerSpan?.attributes).toMatchObject({
        'raffel.procedure': 'numbers',
        'raffel.handler.kind': 'stream',
      })
      expect(handlerSpan?.parentSpanId).toBe(procedureSpan?.spanId)
    } finally {
      router.stop()
      await tracer.shutdown()
    }
  })

  it('creates a handler span when invoking an event handler', async () => {
    const { tracer, exportedSpans } = createCapturingTracer()
    const registry = createRegistry()
    registry.event('order.created', async () => {}, { delivery: 'at-most-once' })
    const router = createRouter(registry, {
      interceptors: [createTracingInterceptor(tracer, {
        spanName: 'raffel.procedure',
        spanKind: 'internal',
      })],
    })

    try {
      await router.handle(createEnvelope('order.created', 'event', { orderId: 'order-1' }))
      await tracer.flush()

      const procedureSpan = exportedSpans.find((span) => span.name === 'raffel.procedure')
      const handlerSpan = exportedSpans.find((span) => span.name === 'raffel.handler')
      expect(handlerSpan?.attributes).toMatchObject({
        'raffel.procedure': 'order.created',
        'raffel.handler.kind': 'event',
      })
      expect(handlerSpan?.parentSpanId).toBe(procedureSpan?.spanId)
    } finally {
      router.stop()
      await tracer.shutdown()
    }
  })

  it('records errors raised while consuming a stream handler', async () => {
    const { tracer, exportedSpans } = createCapturingTracer()
    const registry = createRegistry()
    registry.stream('failing-stream', async function* () {
      yield 1
      throw new Error('stream failed')
    })
    const router = createRouter(registry, {
      interceptors: [createTracingInterceptor(tracer, {
        spanName: 'raffel.procedure',
        spanKind: 'internal',
      })],
    })

    try {
      const result = await router.handle(
        createEnvelope('failing-stream', 'stream:start', {})
      )
      const envelopes: Envelope[] = []
      for await (const envelope of result as AsyncIterable<Envelope>) {
        envelopes.push(envelope)
      }
      await tracer.flush()

      expect(envelopes.at(-1)?.type).toBe('stream:error')
      const handlerSpan = exportedSpans.find((span) => span.name === 'raffel.handler')
      expect(handlerSpan?.status).toMatchObject({
        code: 'error',
        message: 'stream failed',
      })
    } finally {
      router.stop()
      await tracer.shutdown()
    }
  })

  it('preserves RaffelStream capabilities while tracing its iterator', async () => {
    const { tracer } = createCapturingTracer()
    const registry = createRegistry()
    let observedResult: RaffelStream<number> | undefined
    const observeResult: Interceptor = async (_envelope, _ctx, next) => {
      const result = await next() as RaffelStream<number>
      observedResult = result
      return result
    }
    registry.stream('duplex', () => {
      const stream = createStream<number>()
      void stream.write(1).then(() => stream.end())
      return stream
    })
    const router = createRouter(registry, {
      interceptors: [
        createTracingInterceptor(tracer, {
          spanName: 'raffel.procedure',
          spanKind: 'internal',
        }),
        observeResult,
      ],
    })

    try {
      const result = await router.handle(createEnvelope('duplex', 'stream:start', {}))
      expect(typeof observedResult?.read).toBe('function')
      expect(typeof observedResult?.write).toBe('function')
      expect(typeof observedResult?.cancel).toBe('function')

      for await (const _envelope of result as AsyncIterable<Envelope>) {
        // Consume the stream so the traced iterator completes.
      }
    } finally {
      router.stop()
      await tracer.shutdown()
    }
  })
})
