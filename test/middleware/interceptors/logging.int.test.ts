/**
 * Logging Interceptor Tests
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
} from '../../../src/middleware/interceptors/logging.js'
import type { Envelope, Context } from '../../../src/types/index.js'
import { createContext } from '../../../src/types/index.js'
import { RaffelError } from '../../../src/core/router.js'

function createEnvelope(procedure: string, payload: unknown = {}): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload,
    type: 'request',
    metadata: {},
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

function createMockLogger() {
  const logs: Array<{ level: string; message?: string; data?: unknown }> = []
  return {
    logs,
    logger: {
      trace: (data: unknown, msg?: string) => logs.push({ level: 'trace', message: msg, data }),
      info: (data: unknown, msg?: string) => logs.push({ level: 'info', message: msg, data }),
      error: (data: unknown, msg?: string) => logs.push({ level: 'error', message: msg, data }),
      debug: (data: unknown, msg?: string) => logs.push({ level: 'debug', message: msg, data }),
      warn: (data: unknown, msg?: string) => logs.push({ level: 'warn', message: msg, data }),
    }
  }
}

describe('createLoggingInterceptor', () => {
  it('should log requests and responses', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
    })

    await interceptor(createEnvelope('test.procedure'), createTestContext(), async () => 'result')

    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs.some(l => l.message?.includes('test.procedure'))).toBe(true)
  })

  it('should log errors', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
    })

    await expect(
      interceptor(createEnvelope('test.procedure'), createTestContext(), async () => {
        throw new Error('Test error')
      })
    ).rejects.toThrow('Test error')

    expect(logs.some(l => l.level === 'error')).toBe(true)

    // The error payload must carry name, message, AND stack — Datadog Error
    // Tracking drops the log as "Missing error message and stack trace" when
    // the stack is absent.
    const errorLog = logs.find(l => l.level === 'error')
    const errorData = (
      errorLog?.data as { error?: { name?: string; message?: string; stack?: string } }
    )?.error
    expect(errorData?.name).toBe('Error')
    expect(errorData?.message).toBe('Test error')
    expect(errorData?.stack).toContain('Error: Test error')
  })

  it('should skip excluded procedures', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
      excludeProcedures: ['health.check', 'system.ping'],
    })

    await interceptor(createEnvelope('health.check'), createTestContext(), async () => 'ok')

    expect(logs.length).toBe(0)
  })

  it('should include payload when configured', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
      includePayload: true,
    })

    const payload = { name: 'test', email: 'test@example.com' }
    await interceptor(createEnvelope('test', payload), createTestContext(), async () => 'ok')

    expect(logs.some(l => {
      const data = l.data as Record<string, unknown>
      return data?.payload !== undefined
    })).toBe(true)
  })

  it('should include response when configured', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
      includeResponse: true,
    })

    await interceptor(createEnvelope('test'), createTestContext(), async () => ({ result: 'success' }))

    expect(logs.some(l => {
      const data = l.data as Record<string, unknown>
      return data?.response !== undefined
    })).toBe(true)
  })

  it('should apply custom filter', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
      filter: ({ envelope }) => envelope.procedure.startsWith('important'),
    })

    await interceptor(createEnvelope('important.action'), createTestContext(), async () => 'ok')
    expect(logs.length).toBeGreaterThan(0)

    logs.length = 0

    await interceptor(createEnvelope('other.action'), createTestContext(), async () => 'ok')
    expect(logs.length).toBe(0)
  })

  it('should track duration', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createLoggingInterceptor({
      logger,
    })

    await interceptor(createEnvelope('test'), createTestContext(), async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return 'ok'
    })

    expect(logs.some(l => {
      const data = l.data as Record<string, unknown>
      return typeof data?.duration === 'number'
    })).toBe(true)
  })
})

describe('createProductionLoggingInterceptor', () => {
  it('should only log errors and slow requests', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createProductionLoggingInterceptor({
      slowThresholdMs: 50,
      logger,
    })

    // Fast request should not be logged
    await interceptor(createEnvelope('test.fast'), createTestContext(), async () => 'ok')
    expect(logs.length).toBe(0)

    // Error should be logged
    logs.length = 0
    await expect(
      interceptor(createEnvelope('test.error'), createTestContext(), async () => {
        throw new Error('Test error')
      })
    ).rejects.toThrow('Test error')
    expect(logs.some(l => l.level === 'error')).toBe(true)
  })
})

describe('createDebugLoggingInterceptor', () => {
  it('should include full request and response details', async () => {
    const { logs, logger } = createMockLogger()

    const interceptor = createDebugLoggingInterceptor(logger)

    await interceptor(
      createEnvelope('test', { input: 'data' }),
      createTestContext(),
      async () => ({ output: 'result' })
    )

    // Debug logging should include both payload and response
    expect(logs.some(l => {
      const data = l.data as Record<string, unknown>
      return data?.payload !== undefined || data?.response !== undefined
    })).toBe(true)
  })
})

describe('Datadog sidecar log enrichment', () => {
  // Save/restore env vars touched by the tests below.
  const savedEnv: Record<string, string | undefined> = {}
  beforeAll(() => {
    savedEnv.DD_SERVICE = process.env.DD_SERVICE
    savedEnv.DD_ENV = process.env.DD_ENV
    savedEnv.DD_VERSION = process.env.DD_VERSION
    process.env.DD_SERVICE = 'checkout-svc'
    process.env.DD_ENV = 'prod'
    process.env.DD_VERSION = '1.4.2'
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('emits http.method / http.route / http.target when ctx.http is present', async () => {
    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({ logger, format: 'json' })

    const ctx = createTestContext()
    // simulate the HTTP adapter setting route + method on the context
    ;(ctx as any).http = {
      kind: 'http',
      method: 'GET',
      path: '/users/42',
      route: '/users/:id',
      url: 'http://svc/users/42',
      headers: {},
    }
    ;(ctx as any).tracing = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      ddTraceId: '14576827793038113322513871894673895836',
      ddSpanId: '13235353014750950193',
    }

    await interceptor(createEnvelope('users.get'), ctx, async () => ({ ok: true }))

    expect(logs).toHaveLength(1)
    const data = logs[0].data as Record<string, unknown>

    // New HTTP fields (Datadog facets)
    expect(data['http.method']).toBe('GET')
    expect(data['http.route']).toBe('/users/:id')
    expect(data['http.target']).toBe('/users/42')

    // Back-compat: existing fields still there
    expect(data.procedure).toBe('users.get')
    expect(data.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(data.spanId).toBe('b7ad6b7169203331')

    // New Datadog correlation
    expect(data['dd.trace_id']).toBe('14576827793038113322513871894673895836')
    expect(data['dd.span_id']).toBe('13235353014750950193')
    expect(data['dd.service']).toBe('checkout-svc')
    expect(data['dd.env']).toBe('prod')
    expect(data['dd.version']).toBe('1.4.2')
  })

  it('omits http.target when path equals route (no duplication)', async () => {
    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({ logger, format: 'json' })

    const ctx = createTestContext()
    ;(ctx as any).http = {
      kind: 'http',
      method: 'POST',
      path: '/users',
      route: '/users',
      url: 'http://svc/users',
      headers: {},
    }

    await interceptor(createEnvelope('users.create'), ctx, async () => ({ ok: true }))

    const data = logs[0].data as Record<string, unknown>
    expect(data['http.method']).toBe('POST')
    expect(data['http.route']).toBe('/users')
    expect(data['http.target']).toBeUndefined() // identical to route → not duplicated
  })

  it('does not emit dd.* when env vars are unset (operator opt-in)', async () => {
    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({ logger, format: 'json' })

    const originalService = process.env.DD_SERVICE
    const originalEnv = process.env.DD_ENV
    const originalVersion = process.env.DD_VERSION
    delete process.env.DD_SERVICE
    delete process.env.DD_ENV
    delete process.env.DD_VERSION

    try {
      await interceptor(createEnvelope('users.get'), createTestContext(), async () => ({}))

      const data = logs[0].data as Record<string, unknown>
      expect(data['dd.service']).toBeUndefined()
      expect(data['dd.env']).toBeUndefined()
      expect(data['dd.version']).toBeUndefined()
    } finally {
      if (originalService !== undefined) process.env.DD_SERVICE = originalService
      if (originalEnv !== undefined) process.env.DD_ENV = originalEnv
      if (originalVersion !== undefined) process.env.DD_VERSION = originalVersion
    }
  })
})

describe('correlationProfile: explicit selection', () => {
  // Snapshot every DD_* / OTEL_* / HONEYCOMB_* env var so a parallel test
  // doesn't accidentally leak state into this one.
  const envKeys = [
    'DD_SERVICE',
    'DD_ENV',
    'DD_VERSION',
    'DD_AGENT_HOST',
    'OTEL_SERVICE_NAME',
    'OTEL_SERVICE_VERSION',
    'OTEL_DEPLOYMENT_ENVIRONMENT',
    'HONEYCOMB_SERVICE',
  ]
  const savedEnv: Record<string, string | undefined> = {}
  beforeAll(() => {
    for (const k of envKeys) savedEnv[k] = process.env[k]
  })
  beforeEach(() => {
    // Wipe before every test — env vars leak across `it` blocks otherwise,
    // which silently biases the auto-detect in the next assertion.
    for (const k of envKeys) delete process.env[k]
  })
  afterAll(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  it("'otel' emits OTel-canonical snake_case hex IDs + service.* / deployment.*", async () => {
    process.env.OTEL_SERVICE_NAME = 'checkout'
    process.env.OTEL_SERVICE_VERSION = '1.4.2'
    process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'staging'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      correlationProfile: 'otel',
    })

    const ctx = createTestContext()
    ;(ctx as any).http = {
      kind: 'http',
      method: 'GET',
      path: '/users/42',
      route: '/users/:id',
      url: 'http://svc/users/42',
      headers: {},
    }
    ;(ctx as any).tracing = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      parentSpanId: '1111111111111111',
    }

    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>

    // OTel log data model fields
    expect(data['trace_id']).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(data['span_id']).toBe('b7ad6b7169203331')
    expect(data['parent_span_id']).toBe('1111111111111111')

    // OTel resource semantic conventions
    expect(data['service.name']).toBe('checkout')
    expect(data['service.version']).toBe('1.4.2')
    expect(data['deployment.environment.name']).toBe('staging')

    // Datadog-specific fields should NOT leak into the otel profile
    expect(data['dd.trace_id']).toBeUndefined()
    expect(data['dd.span_id']).toBeUndefined()
    expect(data['dd.service']).toBeUndefined()

    // Legacy raffel camelCase is still emitted (back-compat)
    expect(data.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(data.spanId).toBe('b7ad6b7169203331')
  })

  it("'honeycomb' emits trace.trace_id / trace.span_id + service.name", async () => {
    process.env.HONEYCOMB_SERVICE = 'svc-a'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      correlationProfile: 'honeycomb',
    })

    const ctx = createTestContext()
    ;(ctx as any).tracing = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      parentSpanId: '2222222222222222',
    }

    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>

    expect(data['trace.trace_id']).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(data['trace.span_id']).toBe('b7ad6b7169203331')
    expect(data['trace.parent_id']).toBe('2222222222222222')
    expect(data['service.name']).toBe('svc-a')

    // OTel-canonical names should NOT leak
    expect(data['trace_id']).toBeUndefined()
    expect(data['span_id']).toBeUndefined()
    // dd.* should NOT leak
    expect(data['dd.trace_id']).toBeUndefined()
  })

  it("'none' emits only raffel hex camelCase; no backend-specific fields", async () => {
    // Even with DD_* set, 'none' must suppress profile-specific fields.
    process.env.DD_SERVICE = 'should-not-appear'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      correlationProfile: 'none',
    })

    const ctx = createTestContext()
    ;(ctx as any).tracing = {
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      ddTraceId: '14576827793038113322513871894673895836',
      ddSpanId: '13235353014750950193',
    }

    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>

    // Legacy hex camelCase survives
    expect(data.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(data.spanId).toBe('b7ad6b7169203331')

    // None of the profile-specific fields
    expect(data['dd.trace_id']).toBeUndefined()
    expect(data['dd.span_id']).toBeUndefined()
    expect(data['dd.service']).toBeUndefined()
    expect(data['trace_id']).toBeUndefined()
    expect(data['span_id']).toBeUndefined()
    expect(data['trace.trace_id']).toBeUndefined()
    expect(data['service.name']).toBeUndefined()
  })

  it('explicit profile wins over auto-detection', async () => {
    // DD_SERVICE set → would auto-detect to 'datadog' if not pinned.
    process.env.DD_SERVICE = 'checkout'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      correlationProfile: 'otel',
    })
    // OTEL env to verify otel profile emitted service.name, not dd.service
    process.env.OTEL_SERVICE_NAME = 'checkout'

    const ctx = createTestContext()
    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>

    // OTel path won despite DD_SERVICE being set
    expect(data['service.name']).toBe('checkout')
    expect(data['dd.service']).toBeUndefined()
  })

  it('auto-detects datadog when DD_* env var is set and no explicit profile', async () => {
    process.env.DD_SERVICE = 'auto-svc'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      // no correlationProfile → should auto-detect
    })

    const ctx = createTestContext()
    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>
    expect(data['dd.service']).toBe('auto-svc')
  })

  it('auto-detects otel when no DD_* env var and no explicit profile', async () => {
    process.env.OTEL_SERVICE_NAME = 'auto-otel'

    const { logs, logger } = createMockLogger()
    const interceptor = createLoggingInterceptor({
      logger,
      format: 'json',
      // no correlationProfile → should auto-detect to otel
    })

    const ctx = createTestContext()
    await interceptor(createEnvelope('users.get'), ctx, async () => ({}))

    const data = logs[0].data as Record<string, unknown>
    expect(data['service.name']).toBe('auto-otel')
    expect(data['dd.service']).toBeUndefined()
  })
})
