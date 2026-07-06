/**
 * Distributed Tracing Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { createServer } from '../../src/server/builder.js'
import { HttpApp } from '../../src/http/index.js'
import {
  createTracer,
  createSpan,
  generateTraceId,
  generateSpanId,
  createAlwaysOnSampler,
  createAlwaysOffSampler,
  createProbabilitySampler,
  createRateLimitedSampler,
  createParentBasedSampler,
  createConsoleExporter,
  createOtlpHttpExporter,
  createNoopExporter,
  createTracingInterceptor,
  createHttpTracingMiddleware,
  SAMPLING_STRATEGIES,
} from '../../src/tracing/index.js'
import type { Tracer, SpanData, SpanExporter, SpanContext, Span } from '../../src/tracing/types.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

describe('Tracing', () => {
  describe('ID Generation', () => {
    it('should generate valid trace IDs (32 hex chars)', () => {
      const traceId = generateTraceId()
      expect(traceId).toHaveLength(32)
      expect(/^[0-9a-f]+$/.test(traceId)).toBe(true)
    })

    it('should generate valid span IDs (16 hex chars)', () => {
      const spanId = generateSpanId()
      expect(spanId).toHaveLength(16)
      expect(/^[0-9a-f]+$/.test(spanId)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 100; i++) {
        ids.add(generateTraceId())
        ids.add(generateSpanId())
      }
      expect(ids.size).toBe(200)
    })
  })

  describe('Span', () => {
    it('should create span with correct fields', () => {
      const span = createSpan({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'test-operation',
        kind: 'server',
        isRecording: true,
      })

      expect(span.name).toBe('test-operation')
      expect(span.context.traceId).toBe('a'.repeat(32))
      expect(span.context.spanId).toBe('b'.repeat(16))
      expect(span.context.traceFlags).toBe(1) // sampled
      expect(span.isRecording).toBe(true)
    })

    it('should set attributes', () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: true,
      })

      span.setAttribute('key', 'value')
      span.setAttributes({ foo: 'bar', num: 42 })

      const data = span.toSpanData()
      expect(data.attributes.key).toBe('value')
      expect(data.attributes.foo).toBe('bar')
      expect(data.attributes.num).toBe(42)
    })

    it('should add logs', () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: true,
      })

      span.log('Processing started')
      span.log('Step complete', { step: 1 })

      const data = span.toSpanData()
      expect(data.logs).toHaveLength(2)
      expect(data.logs[0].message).toBe('Processing started')
      expect(data.logs[1].message).toBe('Step complete')
      expect(data.logs[1].fields?.step).toBe(1)
    })

    it('should record errors', () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: true,
      })

      const error = new Error('Something failed')
      span.recordError(error)

      const data = span.toSpanData()
      expect(data.status.code).toBe('error')
      expect(data.status.message).toBe('Something failed')
      expect(data.attributes['error.type']).toBe('Error')
      expect(data.attributes['error.message']).toBe('Something failed')
      expect(data.logs.some((log) => log.message === 'Error')).toBe(true)
    })

    it('should calculate duration on finish', async () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: true,
      })

      await new Promise((resolve) => setTimeout(resolve, 50))
      span.finish()

      const data = span.toSpanData()
      expect(data.duration).toBeGreaterThan(40000) // 40ms in microseconds
      expect(data.duration).toBeLessThan(200000) // 200ms
      expect(data.status.code).toBe('ok')
    })

    it('should use epoch microseconds for span timestamps', () => {
      const before = Date.now() * 1000
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: true,
      })
      span.finish()
      const after = Date.now() * 1000
      const data = span.toSpanData()

      expect(data.startTime).toBeGreaterThanOrEqual(before)
      expect(data.startTime).toBeLessThanOrEqual(after)
      expect(data.endTime).toBeGreaterThanOrEqual(data.startTime)
    })

    it('should not record when isRecording is false', () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        name: 'test',
        kind: 'internal',
        isRecording: false,
      })

      span.setAttribute('key', 'value')
      span.log('message')

      const data = span.toSpanData()
      expect(data.attributes.key).toBeUndefined()
      expect(data.logs).toHaveLength(0)
    })

    it('should support parent span ID', () => {
      const span = createSpan({
        traceId: generateTraceId(),
        spanId: generateSpanId(),
        parentSpanId: 'p'.repeat(16),
        name: 'child',
        kind: 'internal',
        isRecording: true,
      })

      const data = span.toSpanData()
      expect(data.parentSpanId).toBe('p'.repeat(16))
    })
  })

  describe('Samplers', () => {
    it('should always sample with AlwaysOnSampler', () => {
      const sampler = createAlwaysOnSampler()
      const result = sampler.shouldSample('trace', 'span', 'internal')
      expect(result.decision).toBe('record_and_sample')
    })

    it('should never sample with AlwaysOffSampler', () => {
      const sampler = createAlwaysOffSampler()
      const result = sampler.shouldSample('trace', 'span', 'internal')
      expect(result.decision).toBe('drop')
    })

    it('should respect probability in ProbabilitySampler', () => {
      // Test 0%
      const zeroSampler = createProbabilitySampler(0)
      for (let i = 0; i < 10; i++) {
        expect(zeroSampler.shouldSample('t', 's', 'internal').decision).toBe('drop')
      }

      // Test 100%
      const fullSampler = createProbabilitySampler(1)
      for (let i = 0; i < 10; i++) {
        expect(fullSampler.shouldSample('t', 's', 'internal').decision).toBe(
          'record_and_sample'
        )
      }
    })

    it('should rate limit in RateLimitedSampler', async () => {
      const sampler = createRateLimitedSampler(2) // 2 per second

      // First 2 should be sampled
      expect(sampler.shouldSample('t', 's', 'internal').decision).toBe(
        'record_and_sample'
      )
      expect(sampler.shouldSample('t', 's', 'internal').decision).toBe(
        'record_and_sample'
      )

      // Third should be dropped (bucket empty)
      expect(sampler.shouldSample('t', 's', 'internal').decision).toBe('drop')

      // Wait for refill
      await new Promise((resolve) => setTimeout(resolve, 600))

      // Should be able to sample again
      expect(sampler.shouldSample('t', 's', 'internal').decision).toBe(
        'record_and_sample'
      )
    })

    it('should follow parent decision in ParentBasedSampler', () => {
      const rootSampler = createAlwaysOnSampler()
      const sampler = createParentBasedSampler(rootSampler)

      // No parent - use root sampler
      expect(sampler.shouldSample('t', 's', 'internal').decision).toBe(
        'record_and_sample'
      )

      // Parent sampled - follow
      const sampledParent: SpanContext = {
        traceId: 't',
        spanId: 's',
        traceFlags: 1, // sampled
      }
      expect(
        sampler.shouldSample('t', 's', 'internal', sampledParent).decision
      ).toBe('record_and_sample')

      // Parent not sampled - follow
      const notSampledParent: SpanContext = {
        traceId: 't',
        spanId: 's',
        traceFlags: 0, // not sampled
      }
      expect(
        sampler.shouldSample('t', 's', 'internal', notSampledParent).decision
      ).toBe('drop')
    })
  })

  describe('Tracer', () => {
    let tracer: Tracer
    let exportedSpans: SpanData[]
    let mockExporter: SpanExporter

    beforeEach(() => {
      exportedSpans = []
      mockExporter = {
        async export(spans) {
          exportedSpans.push(...spans)
        },
        async shutdown() {},
      }

      tracer = createTracer({
        serviceName: 'test-service',
        sampleRate: 1.0,
        exporters: [mockExporter],
        batchSize: 1, // Export immediately
      })
    })

    it('should create spans with service name', () => {
      const span = tracer.startSpan('operation')
      span.finish()

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].attributes['service.name']).toBe('test-service')
    })

    it('should create child spans', () => {
      const parent = tracer.startSpan('parent')
      const child = tracer.startSpanFromContext('child', parent.context)

      child.finish()
      parent.finish()

      expect(exportedSpans).toHaveLength(2)

      const childData = exportedSpans.find((s) => s.name === 'child')
      expect(childData?.parentSpanId).toBe(parent.context.spanId)
      expect(childData?.traceId).toBe(parent.context.traceId)
    })

    it('should track active span', () => {
      expect(tracer.getActiveSpan()).toBeUndefined()

      const span = tracer.startSpan('active')
      tracer.setActiveSpan(span)

      expect(tracer.getActiveSpan()).toBe(span)

      tracer.setActiveSpan(undefined)
      expect(tracer.getActiveSpan()).toBeUndefined()
    })

    it('should respect sampling rate', () => {
      const lowSampleTracer = createTracer({
        serviceName: 'test',
        sampleRate: 0,
        exporters: [mockExporter],
        batchSize: 1,
      })

      const span = lowSampleTracer.startSpan('dropped')
      span.finish()

      // Span should not be exported (dropped by sampler)
      expect(exportedSpans).toHaveLength(0)
    })

    it('should apply default attributes', () => {
      const tracerWithDefaults = createTracer({
        serviceName: 'test',
        sampleRate: 1.0,
        defaultAttributes: { env: 'test', version: '1.0.0' },
        exporters: [mockExporter],
        batchSize: 1,
      })

      const span = tracerWithDefaults.startSpan('op')
      span.finish()

      expect(exportedSpans[0].attributes.env).toBe('test')
      expect(exportedSpans[0].attributes.version).toBe('1.0.0')
    })
  })

  describe('W3C Trace Context', () => {
    let tracer: Tracer

    beforeEach(() => {
      tracer = createTracer({ serviceName: 'test' })
    })

    it('should parse valid traceparent header', () => {
      const context = tracer.extractContext({
        traceparent:
          '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      })

      expect(context).toBeDefined()
      expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context?.spanId).toBe('b7ad6b7169203331')
      expect(context?.traceFlags).toBe(1)
    })

    it('should return undefined for invalid traceparent', () => {
      expect(tracer.extractContext({ traceparent: 'invalid' })).toBeUndefined()
      expect(tracer.extractContext({ traceparent: '01-abc-def-00' })).toBeUndefined()
      expect(tracer.extractContext({})).toBeUndefined()
    })

    it('should inject trace context headers', () => {
      const span = tracer.startSpan('test')
      const headers = tracer.injectContext(span.context)

      expect(headers.traceparent).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/
      )
      expect(headers.traceparent).toContain(span.context.traceId)
      expect(headers.traceparent).toContain(span.context.spanId)
    })

    it('should round-trip context', () => {
      const originalSpan = tracer.startSpan('original')
      const headers = tracer.injectContext(originalSpan.context)
      const extracted = tracer.extractContext(headers)

      expect(extracted?.traceId).toBe(originalSpan.context.traceId)
      expect(extracted?.spanId).toBe(originalSpan.context.spanId)
    })
  })

  describe('Exporters', () => {
    it('should log spans with ConsoleExporter', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const exporter = createConsoleExporter()
      await exporter.export([
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          name: 'test-span',
          kind: 'server',
          startTime: 0,
          endTime: 100000,
          duration: 100000,
          status: { code: 'ok' },
          attributes: {},
          logs: [],
          context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
        },
      ])

      expect(consoleSpy).toHaveBeenCalled()
      expect(consoleSpy.mock.calls[0][0]).toContain('test-span')
      expect(consoleSpy.mock.calls[0][0]).toContain('100.00ms')

      consoleSpy.mockRestore()
    })

    it('should discard spans with NoopExporter', async () => {
      const exporter = createNoopExporter()
      // Should not throw
      await exporter.export([
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          name: 'test',
          kind: 'internal',
          startTime: 0,
          endTime: 0,
          duration: 0,
          status: { code: 'ok' },
          attributes: {},
          logs: [],
          context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
        },
      ])
    })

    it('should export spans as OTLP HTTP JSON', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
      const exporter = createOtlpHttpExporter({
        serviceName: 'orders-api',
        endpoint: 'http://collector:4318/v1/traces',
      })

      await exporter.export([
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          parentSpanId: 'c'.repeat(16),
          name: 'GET /orders/:id',
          kind: 'server',
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_000_000_100_000,
          duration: 100_000,
          status: { code: 'ok' },
          attributes: {
            'http.request.method': 'GET',
            'http.route': '/orders/:id',
            'http.response.status_code': 200,
          },
          logs: [],
          context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
        },
      ])

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://collector:4318/v1/traces',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      )
      const payload = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
      const span = payload.resourceSpans[0].scopeSpans[0].spans[0]
      expect(payload.resourceSpans[0].resource.attributes).toContainEqual({
        key: 'service.name',
        value: { stringValue: 'orders-api' },
      })
      expect(span.name).toBe('GET /orders/:id')
      expect(span.kind).toBe(2)
      expect(span.startTimeUnixNano).toBe('1700000000000000000')
      expect(span.attributes).toContainEqual({
        key: 'http.route',
        value: { stringValue: '/orders/:id' },
      })

      fetchSpy.mockRestore()
    })
  })

  describe('Tracing Interceptor', () => {
    let tracer: Tracer
    let exportedSpans: SpanData[]

    beforeEach(() => {
      exportedSpans = []
      const mockExporter: SpanExporter = {
        async export(spans) {
          exportedSpans.push(...spans)
        },
        async shutdown() {},
      }

      tracer = createTracer({
        serviceName: 'test',
        sampleRate: 1.0,
        exporters: [mockExporter],
        batchSize: 1,
      })
    })

    function createEnvelope(
      procedure: string,
      payload: unknown = {},
      metadata: Record<string, string> = {}
    ) {
      return {
        id: 'test-id',
        type: 'request' as const,
        procedure,
        payload,
        metadata,
        context: {
          requestId: 'test-req',
          tracing: { correlationId: 'test' },
          signal: new AbortController().signal,
          extensions: {},
        },
      } as any
    }

    it('should create span for request', async () => {
      const interceptor = createTracingInterceptor(tracer)

      const envelope = createEnvelope('users.get')
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].name).toBe('users.get')
      expect(exportedSpans[0].kind).toBe('server')
      expect(exportedSpans[0].attributes['rpc.method']).toBe('users.get')
    })

    it('should record errors', async () => {
      const interceptor = createTracingInterceptor(tracer)

      const envelope = createEnvelope('users.get')
      const ctx = { requestId: 'req-1' } as any
      const error = new Error('Test error')

      await expect(
        interceptor(envelope, ctx, async () => {
          throw error
        })
      ).rejects.toThrow('Test error')

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].status.code).toBe('error')
      expect(exportedSpans[0].status.message).toBe('Test error')
    })

    it('should propagate trace context from metadata', async () => {
      const interceptor = createTracingInterceptor(tracer)

      const envelope = createEnvelope('users.get', {}, {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      })
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(exportedSpans[0].parentSpanId).toBe('b7ad6b7169203331')
    })
  })

  describe('HTTP tracing', () => {
    const parentTraceId = '0af7651916cd43dd8448eb211c80319c'
    const parentSpanId = 'b7ad6b7169203331'
    const traceparent = `00-${parentTraceId}-${parentSpanId}-01`

    function createCapturingTracer() {
      const exportedSpans: SpanData[] = []
      const exporter: SpanExporter = {
        async export(spans) {
          exportedSpans.push(...spans)
        },
        async shutdown() {},
      }
      const tracer = createTracer({
        serviceName: 'http-test',
        sampleRate: 1,
        exporters: [exporter],
        batchSize: 1,
      })
      return { tracer, exportedSpans }
    }

    it('creates route-aware server spans for createServer HTTP namespace routes', async () => {
      const exportedSpans: SpanData[] = []
      const port = await getFreePort()
      const server = createServer({ port, host: '127.0.0.1' })
      server.enableTracing({
        serviceName: 'http-test',
        exporters: [{
          async export(spans) {
            exportedSpans.push(...spans)
          },
          async shutdown() {},
        }],
        batchSize: 1,
      })

      server.http.get('/users/:id', async (_input: unknown, ctx: any) => ({
        id: ctx.params.id,
        traceId: ctx.tracing.traceId,
      }))

      try {
        await server.start()
        const response = await fetch(`http://127.0.0.1:${port}/users/42`, {
          headers: { traceparent },
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('x-trace-id')).toBe(parentTraceId)
        expect(await response.json()).toEqual({
          id: '42',
          traceId: parentTraceId,
        })

        await server.tracer?.flush()
        const httpSpan = exportedSpans.find(
          (span) => span.name === 'GET /users/:id' && span.attributes['http.route'] === '/users/:id'
        )
        expect(httpSpan).toBeDefined()
        expect(httpSpan?.traceId).toBe(parentTraceId)
        expect(httpSpan?.parentSpanId).toBe(parentSpanId)
        expect(httpSpan?.attributes['http.request.method']).toBe('GET')
        expect(httpSpan?.attributes['http.response.status_code']).toBe(200)
        expect(httpSpan?.attributes['raffel.procedure']).toBe('get:/users/:id')
      } finally {
        await server.stop()
      }
    })

    it('provides opt-in route-aware tracing middleware for HttpApp', async () => {
      const { tracer, exportedSpans } = createCapturingTracer()
      const app = new HttpApp()

      app.use(createHttpTracingMiddleware(tracer))
      app.get('/items/:id', (ctx) => ctx.json({ id: ctx.req.param('id') }))

      const response = await app.fetch(new Request('http://localhost/items/abc', {
        headers: { traceparent },
      }))

      expect(response.status).toBe(200)
      expect(response.headers.get('x-trace-id')).toBe(parentTraceId)
      expect(await response.json()).toEqual({ id: 'abc' })

      await tracer.flush()
      const httpSpan = exportedSpans.find((span) => span.name === 'GET /items/:id')
      expect(httpSpan).toBeDefined()
      expect(httpSpan?.traceId).toBe(parentTraceId)
      expect(httpSpan?.parentSpanId).toBe(parentSpanId)
      expect(httpSpan?.attributes['http.route']).toBe('/items/:id')
      expect(httpSpan?.attributes['http.response.status_code']).toBe(200)

      await tracer.shutdown()
    })
  })

  describe('SAMPLING_STRATEGIES constants', () => {
    it('should have expected values', () => {
      expect(SAMPLING_STRATEGIES.ALWAYS_ON).toBe(1.0)
      expect(SAMPLING_STRATEGIES.ALWAYS_OFF).toBe(0.0)
      expect(SAMPLING_STRATEGIES.HALF).toBe(0.5)
      expect(SAMPLING_STRATEGIES.TEN_PERCENT).toBe(0.1)
      expect(SAMPLING_STRATEGIES.ONE_PERCENT).toBe(0.01)
    })
  })
})
