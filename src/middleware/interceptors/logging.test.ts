/**
 * Logging Interceptor Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createLoggingInterceptor,
  createProductionLoggingInterceptor,
  createDebugLoggingInterceptor,
} from './logging.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

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
