/**
 * Request ID Interceptor Tests
 */

import { describe, it, expect } from 'vitest'
import {
  createRequestIdInterceptor,
  createPrefixedRequestIdInterceptor,
  createCorrelatedRequestIdInterceptor,
} from './request-id.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'

function createEnvelope(procedure: string, metadata: Record<string, string> = {}): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: { ...metadata },
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

describe('createRequestIdInterceptor', () => {
  it('should generate a request ID if none exists', async () => {
    const interceptor = createRequestIdInterceptor()
    const ctx = createTestContext()

    // Override with empty requestId
    ;(ctx as any).requestId = ''

    await interceptor(createEnvelope('test'), ctx, async () => 'done')

    expect(ctx.requestId).toBeDefined()
    expect(ctx.requestId.length).toBeGreaterThan(0)
  })

  it('should add request ID to envelope metadata', async () => {
    const interceptor = createRequestIdInterceptor()
    const envelope = createEnvelope('test')
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(envelope.metadata['x-request-id']).toBe(ctx.requestId)
  })

  it('should use custom metadataKey', async () => {
    const interceptor = createRequestIdInterceptor({
      metadataKey: 'x-trace-id',
    })
    const envelope = createEnvelope('test')
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(envelope.metadata['x-trace-id']).toBe(ctx.requestId)
  })

  it('should use custom generator function', async () => {
    const interceptor = createRequestIdInterceptor({
      generator: () => 'custom-generated-id',
    })
    const envelope = createEnvelope('test')
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.requestId).toBe('custom-generated-id')
  })

  it('should propagate existing ID from envelope metadata', async () => {
    const interceptor = createRequestIdInterceptor({
      propagate: true,
    })
    const envelope = createEnvelope('test', { 'x-request-id': 'from-metadata' })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.requestId).toBe('from-metadata')
  })

  it('should not propagate when propagate is false', async () => {
    const interceptor = createRequestIdInterceptor({
      propagate: false,
    })
    const envelope = createEnvelope('test', { 'x-request-id': 'from-metadata' })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.requestId).not.toBe('from-metadata')
  })
})

describe('createPrefixedRequestIdInterceptor', () => {
  it('should generate ID with prefix', async () => {
    const interceptor = createPrefixedRequestIdInterceptor('api')
    const envelope = createEnvelope('test')
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.requestId).toMatch(/^api_/)
  })

  it('should propagate from metadata with prefix handling', async () => {
    const interceptor = createPrefixedRequestIdInterceptor('svc', {
      propagate: true,
    })
    const envelope = createEnvelope('test', { 'x-request-id': 'existing-id' })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    // When propagating, should use existing ID
    expect(ctx.requestId).toBe('existing-id')
  })
})

describe('createCorrelatedRequestIdInterceptor', () => {
  it('should track correlation ID in tracing context', async () => {
    const interceptor = createCorrelatedRequestIdInterceptor()
    const envelope = createEnvelope('test', {
      'x-correlation-id': 'correlation-123',
    })
    const ctx = createTestContext()
    // Initialize tracing context
    ;(ctx as any).tracing = { traceId: '', spanId: '' }

    await interceptor(envelope, ctx, async () => 'done')

    // Correlation ID is stored as traceId
    expect(ctx.tracing?.traceId).toBe('correlation-123')
  })

  it('should generate correlation ID if not present', async () => {
    const interceptor = createCorrelatedRequestIdInterceptor()
    const envelope = createEnvelope('test')
    const ctx = createTestContext()
    ;(ctx as any).tracing = { traceId: '', spanId: '' }

    await interceptor(envelope, ctx, async () => 'done')

    // When no correlation ID, request ID becomes both
    expect(ctx.requestId).toBeDefined()
    expect(ctx.requestId.length).toBeGreaterThan(0)
  })

  it('should set correlation ID in metadata for propagation', async () => {
    const interceptor = createCorrelatedRequestIdInterceptor()
    const envelope = createEnvelope('test')
    const ctx = createTestContext()
    ;(ctx as any).tracing = { traceId: '', spanId: '' }

    await interceptor(envelope, ctx, async () => 'done')

    expect(envelope.metadata['x-correlation-id']).toBeDefined()
    expect(envelope.metadata['x-request-id']).toBe(ctx.requestId)
  })

  it('should use custom correlation key', async () => {
    const interceptor = createCorrelatedRequestIdInterceptor({
      correlationKey: 'x-trace-correlation',
    })
    const envelope = createEnvelope('test', {
      'x-trace-correlation': 'my-correlation',
    })
    const ctx = createTestContext()
    ;(ctx as any).tracing = { traceId: '', spanId: '' }

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.tracing?.traceId).toBe('my-correlation')
  })
})
