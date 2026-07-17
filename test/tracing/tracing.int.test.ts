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

    it('should keep tracking active spans across requests after clearing one (no disable() side effect)', async () => {
      // setActiveSpan(undefined) must not retire the storage for the whole
      // tracer — a later request must still be able to track its own active
      // span after an earlier, unrelated request cleared its own.
      const spanA = tracer.startSpan('request-a')
      tracer.setActiveSpan(spanA)
      tracer.setActiveSpan(undefined)

      await new Promise((r) => setImmediate(r))

      const spanB = tracer.startSpan('request-b')
      tracer.setActiveSpan(spanB)
      expect(tracer.getActiveSpan()).toBe(spanB)
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

  describe('W3C Baggage', () => {
    it('parses a simple key=value list', async () => {
      const { parseBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(parseBaggageHeader('tenantId=acme,userId=u_42')).toEqual({
        tenantId: 'acme',
        userId: 'u_42',
      })
    })

    it('returns an empty object for undefined/null/empty input', async () => {
      const { parseBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(parseBaggageHeader(undefined)).toEqual({})
      expect(parseBaggageHeader(null)).toEqual({})
      expect(parseBaggageHeader('')).toEqual({})
    })

    it('percent-decodes values and drops per-member properties', async () => {
      const { parseBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(parseBaggageHeader('key=hello%20world;prop=ignored')).toEqual({
        key: 'hello world',
      })
    })

    it('skips malformed members without throwing', async () => {
      const { parseBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(parseBaggageHeader('no-equals-sign,=novalue,ok=1')).toEqual({ ok: '1' })
    })

    it('serializes a baggage map back into a header value', async () => {
      const { serializeBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(serializeBaggageHeader({ tenantId: 'acme', userId: 'u_42' })).toBe(
        'tenantId=acme,userId=u_42'
      )
    })

    it('returns undefined for empty/undefined baggage (omit the header entirely)', async () => {
      const { serializeBaggageHeader } = await import('../../src/tracing/baggage.js')
      expect(serializeBaggageHeader(undefined)).toBeUndefined()
      expect(serializeBaggageHeader({})).toBeUndefined()
    })

    it('round-trips through parse → serialize → parse', async () => {
      const { parseBaggageHeader, serializeBaggageHeader } = await import(
        '../../src/tracing/baggage.js'
      )
      const original = { tenantId: 'acme corp', userId: 'u/42' }
      const header = serializeBaggageHeader(original)
      expect(parseBaggageHeader(header)).toEqual(original)
    })

    it('mergeBaggage lets an override win on key collisions', async () => {
      const { mergeBaggage } = await import('../../src/tracing/baggage.js')
      expect(mergeBaggage({ a: '1', b: '2' }, { b: '3', c: '4' })).toEqual({
        a: '1',
        b: '3',
        c: '4',
      })
    })

    it('propagates through the tracer active-baggage storage', () => {
      const tracer = createTracer({ serviceName: 'test' })
      expect(tracer.getBaggage()).toBeUndefined()

      tracer.setBaggage({ tenantId: 'acme' })
      expect(tracer.getBaggage()).toEqual({ tenantId: 'acme' })

      tracer.setBaggage(undefined)
      expect(tracer.getBaggage()).toBeUndefined()
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

    it('should name span as `<METHOD> <ROUTE>` and emit http.* attrs when ctx.http is set', async () => {
      const interceptor = createTracingInterceptor(tracer)
      const envelope = createEnvelope('users.get')
      const ctx = {
        requestId: 'req-1',
        http: {
          kind: 'http',
          method: 'GET',
          path: '/users/42',
          route: '/users/:id',
          url: 'http://svc/users/42',
          headers: {},
        },
      } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].name).toBe('GET /users/:id')
      expect(exportedSpans[0].attributes['http.request.method']).toBe('GET')
      expect(exportedSpans[0].attributes['http.route']).toBe('/users/:id')
      expect(exportedSpans[0].attributes['url.path']).toBe('/users/42')
      // legacy attribute kept for back-compat with existing dashboards
      expect(exportedSpans[0].attributes['rpc.method']).toBe('users.get')
    })

    it('should fall back to procedure as span name for non-HTTP transports', async () => {
      const interceptor = createTracingInterceptor(tracer)
      const envelope = createEnvelope('chat.message')
      // No `ctx.http` → keep `${procedure}` so gRPC / WS / TCP / UDP aren't
      // renamed under Datadog's HTTP resource grouping.
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].name).toBe('chat.message')
      expect(exportedSpans[0].attributes['http.request.method']).toBeUndefined()
    })

    it('should stash decimal ddTraceId / ddSpanId on ctx.tracing', async () => {
      const interceptor = createTracingInterceptor(tracer)
      const envelope = createEnvelope('users.get')
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(ctx.tracing).toBeDefined()
      expect(ctx.tracing.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(ctx.tracing.spanId).toMatch(/^[0-9a-f]{16}$/)
      // decimal form: any positive integer (no leading zeros, no `0x`)
      expect(ctx.tracing.ddTraceId).toMatch(/^[1-9][0-9]*$/)
      expect(ctx.tracing.ddSpanId).toMatch(/^[1-9][0-9]*$/)
      // sanity: hex→decimal round-trips for known sample
      const roundTrip = BigInt(ctx.tracing.ddTraceId!).toString(16).padStart(32, '0')
      expect(roundTrip).toBe(ctx.tracing.traceId)
    })

    it('parses incoming baggage from metadata onto ctx.tracing.baggage', async () => {
      const interceptor = createTracingInterceptor(tracer)
      const envelope = createEnvelope('users.get', {}, {
        baggage: 'tenantId=acme,userId=u_42',
      })
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(ctx.tracing.baggage).toEqual({ tenantId: 'acme', userId: 'u_42' })
    })

    it('exposes an empty (not undefined) baggage object when none was sent', async () => {
      const interceptor = createTracingInterceptor(tracer)
      const envelope = createEnvelope('users.get')
      const ctx = { requestId: 'req-1' } as any

      await interceptor(envelope, ctx, async () => ({ success: true }))

      expect(ctx.tracing.baggage).toEqual({})
    })

    it('restores the previous baggage after the request finishes (no leak to sibling requests)', async () => {
      const interceptor = createTracingInterceptor(tracer)

      // Simulate a nested/second call on the same tracer, as would happen
      // if a handler itself uses the tracer for downstream work.
      tracer.setBaggage({ outer: 'value' })

      const envelope = createEnvelope('users.get', {}, { baggage: 'inner=value' })
      const ctx = { requestId: 'req-1' } as any
      await interceptor(envelope, ctx, async () => {
        expect(tracer.getBaggage()).toEqual({ inner: 'value' })
        return { success: true }
      })

      expect(tracer.getBaggage()).toEqual({ outer: 'value' })
    })
  })

  describe('Datadog log correlation (hex → decimal ID)', () => {
    it('converts W3C sample IDs to BigInt decimal form', async () => {
      const { hexTraceIdToDecimal, hexSpanIdToDecimal } = await import(
        '../../src/tracing/decimal-id.js'
      )
      // 32-hex-char trace IDs are 128-bit (W3C Trace Context spec).
      // Datadog Agents ≥7.34 accept 128-bit IDs in `dd.trace_id` / `dd.span_id`.
      const traceHex = '0af7651916cd43dd8448eb211c80319c'
      const spanHex = 'b7ad6b7169203331'
      expect(hexTraceIdToDecimal(traceHex)).toBe(BigInt('0x' + traceHex).toString(10))
      expect(hexSpanIdToDecimal(spanHex)).toBe(BigInt('0x' + spanHex).toString(10))
      // and the value really is the decimal form (no `0x`, no leading zeros)
      expect(hexTraceIdToDecimal(traceHex)).toMatch(/^[1-9][0-9]*$/)
      expect(hexSpanIdToDecimal(spanHex)).toMatch(/^[1-9][0-9]*$/)
    })

    it('returns empty string for invalid input (does not throw)', async () => {
      const { hexTraceIdToDecimal, hexSpanIdToDecimal } = await import(
        '../../src/tracing/decimal-id.js'
      )
      expect(hexTraceIdToDecimal('')).toBe('')
      expect(hexTraceIdToDecimal('not-hex!')).toBe('')
      expect(hexSpanIdToDecimal('xyz')).toBe('')
    })
  })

  describe('tracedFetch (outbound W3C propagation)', () => {
    it('injects traceparent into outbound requests when an active span exists', async () => {
      const { createTracer, createNoopExporter } = await import('../../src/tracing/index.js')
      const { tracedFetch } = await import('../../src/tracing/index.js')
      const t = createTracer({ serviceName: 'svc-a', sampleRate: 1, exporters: [createNoopExporter()], batchSize: 1 })
      const parentSpan = t.startSpan('parent')
      t.setActiveSpan(parentSpan)

      let capturedHeaders: Record<string, string> = {}
      const mockFetch = vi.fn(async (input: any, init?: any) => {
        const h = init?.headers ?? {}
        if (h instanceof Headers) {
          h.forEach((v: string, k: string) => (capturedHeaders[k] = v))
        } else if (Array.isArray(h)) {
          for (const [k, v] of h) capturedHeaders[k] = String(v)
        } else {
          capturedHeaders = { ...h }
        }
        return new Response('ok', { status: 200 })
      })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(t, 'http://svc-b.local/payments.charge', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(capturedHeaders['traceparent']).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/
      )
      expect(capturedHeaders['traceparent']).toContain(parentSpan.context.traceId)
      expect(capturedHeaders['content-type']).toBe('application/json')

      t.setActiveSpan(undefined)
      parentSpan.finish()
    })

    it('starts a root client span (and still injects traceparent) when there is no active span', async () => {
      // Background jobs, cron tasks, and startup calls have no in-request
      // active span, but calling a downstream service from one of those is
      // still worth tracing — tracedFetch starts a root client span instead
      // of silently skipping propagation.
      const { createTracer, createNoopExporter, tracedFetch } = await import(
        '../../src/tracing/index.js'
      )
      const t = createTracer({ serviceName: 'svc-a', sampleRate: 1, exporters: [createNoopExporter()], batchSize: 1 })
      // no active span

      let headersSeen: Record<string, string> = {}
      const mockFetch = vi.fn(async (_input: any, init?: any) => {
        const h = init?.headers ?? {}
        headersSeen = { ...h }
        return new Response('ok')
      })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(t, 'http://svc-b/x')
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(headersSeen['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
      mockFetch.mockRestore()
    })

    it('does not touch headers at all when no tracer is supplied', async () => {
      const { tracedFetch } = await import('../../src/tracing/index.js')

      let headersSeen: Record<string, string> = {}
      const mockFetch = vi.fn(async (_input: any, init?: any) => {
        const h = init?.headers ?? {}
        headersSeen = { ...h }
        return new Response('ok')
      })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(undefined, 'http://svc-b/x', { headers: { 'x-custom': '1' } })
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(headersSeen['traceparent']).toBeUndefined()
      expect(headersSeen['x-custom']).toBe('1')
      mockFetch.mockRestore()
    })

    it('creates a client span with the response status recorded', async () => {
      const { createTracer, createNoopExporter, tracedFetch } = await import(
        '../../src/tracing/index.js'
      )
      const exportedSpans: SpanData[] = []
      const t = createTracer({
        serviceName: 'svc-a',
        sampleRate: 1,
        exporters: [{ async export(spans) { exportedSpans.push(...spans) }, async shutdown() {} }],
        batchSize: 1,
      })

      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }))
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(t, 'http://svc-b.local/orders')
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].kind).toBe('client')
      expect(exportedSpans[0].name).toBe('GET')
      expect(exportedSpans[0].attributes['http.response.status_code']).toBe(200)
      expect(exportedSpans[0].status.code).toBe('ok')
    })

    it('injects the active baggage as a `baggage` header', async () => {
      const { createTracer, createNoopExporter, tracedFetch } = await import(
        '../../src/tracing/index.js'
      )
      const t = createTracer({ serviceName: 'svc-a', sampleRate: 1, exporters: [createNoopExporter()], batchSize: 1 })
      t.setBaggage({ tenantId: 'acme', userId: 'u_42' })

      let headersSeen: Record<string, string> = {}
      const mockFetch = vi.fn(async (_input: any, init?: any) => {
        headersSeen = { ...(init?.headers ?? {}) }
        return new Response('ok', { status: 200 })
      })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(t, 'http://svc-b.local/orders')
      } finally {
        globalThis.fetch = originalFetch
        t.setBaggage(undefined)
      }

      expect(headersSeen['baggage']).toBe('tenantId=acme,userId=u_42')
    })

    it('lets caller-supplied baggage header win over the tracer active baggage', async () => {
      const { createTracer, createNoopExporter, tracedFetch } = await import(
        '../../src/tracing/index.js'
      )
      const t = createTracer({ serviceName: 'svc-a', sampleRate: 1, exporters: [createNoopExporter()], batchSize: 1 })
      t.setBaggage({ tenantId: 'acme' })

      let headersSeen: Record<string, string> = {}
      const mockFetch = vi.fn(async (_input: any, init?: any) => {
        headersSeen = { ...(init?.headers ?? {}) }
        return new Response('ok', { status: 200 })
      })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      try {
        await tracedFetch(t, 'http://svc-b.local/orders', { headers: { baggage: 'override=1' } })
      } finally {
        globalThis.fetch = originalFetch
        t.setBaggage(undefined)
      }

      expect(headersSeen['baggage']).toBe('override=1')
    })

    it('records the network error and rethrows when the downstream call never completes', async () => {
      const { createTracer, createNoopExporter, tracedFetch } = await import(
        '../../src/tracing/index.js'
      )
      const exportedSpans: SpanData[] = []
      const t = createTracer({
        serviceName: 'svc-a',
        sampleRate: 1,
        exporters: [{ async export(spans) { exportedSpans.push(...spans) }, async shutdown() {} }],
        batchSize: 1,
      })

      const networkError = new Error('ECONNREFUSED')
      const mockFetch = vi.fn(async () => { throw networkError })
      const originalFetch = globalThis.fetch
      // @ts-expect-error — stubbing global for the test
      globalThis.fetch = mockFetch

      let thrown: unknown
      try {
        await tracedFetch(t, 'http://svc-b.local/orders')
      } catch (error) {
        thrown = error
      } finally {
        globalThis.fetch = originalFetch
      }

      expect(thrown).toBe(networkError)
      expect(exportedSpans).toHaveLength(1)
      expect(exportedSpans[0].status.code).toBe('error')
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
