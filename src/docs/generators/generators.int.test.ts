import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateErrorsSpec,
  registerErrorCode,
  clearCustomErrorCodes,
  getHttpStatus,
  getGrpcCode,
  getWebSocketClose,
  getJsonRpcCode,
  isRetryable,
} from './errors.js'

// =============================================================================
// Error Generator Tests
// =============================================================================

describe('generateErrorsSpec', () => {
  beforeEach(() => {
    clearCustomErrorCodes()
  })

  it('should generate spec with standard error codes', () => {
    const spec = generateErrorsSpec()

    expect(spec.raffelErrors).toBe('1.0.0')
    expect(spec.errors).toBeDefined()
    expect(spec.errors!.VALIDATION_ERROR).toBeDefined()
    expect(spec.errors!.NOT_FOUND).toBeDefined()
    expect(spec.errors!.UNAUTHENTICATED).toBeDefined()
    expect(spec.errors!.RATE_LIMITED).toBeDefined()
  })

  it('should include protocol mappings', () => {
    const spec = generateErrorsSpec()

    const validationError = spec.errors!.VALIDATION_ERROR
    expect(validationError.mappings?.http?.status).toBe(400)
    expect(validationError.mappings?.grpc?.code).toBe(3)
    expect(validationError.mappings?.websocket?.close).toBe(4400)
    expect(validationError.mappings?.jsonrpc?.code).toBe(-32602)
  })

  it('should include examples when enabled', () => {
    const spec = generateErrorsSpec({ includeExamples: true })

    expect(spec.errors!.VALIDATION_ERROR.example).toBeDefined()
    expect(spec.errors!.VALIDATION_ERROR.example?.code).toBe('VALIDATION_ERROR')
    expect(spec.errors!.VALIDATION_ERROR.example?.message).toBe('Invalid email format')
  })

  it('should include Error and StreamError definitions', () => {
    const spec = generateErrorsSpec()

    expect(spec.definitions?.Error).toBeDefined()
    expect(spec.definitions?.StreamError).toBeDefined()
  })

  it('should filter errors with include option', () => {
    const spec = generateErrorsSpec({ include: ['VALIDATION_ERROR', 'NOT_FOUND'] })

    expect(Object.keys(spec.errors!)).toHaveLength(2)
    expect(spec.errors!.VALIDATION_ERROR).toBeDefined()
    expect(spec.errors!.NOT_FOUND).toBeDefined()
    expect(spec.errors!.UNAUTHENTICATED).toBeUndefined()
  })

  it('should filter errors with exclude option', () => {
    const spec = generateErrorsSpec({ exclude: ['DEADLINE_EXCEEDED', 'ALREADY_EXISTS'] })

    expect(spec.errors!.DEADLINE_EXCEEDED).toBeUndefined()
    expect(spec.errors!.ALREADY_EXISTS).toBeUndefined()
    expect(spec.errors!.VALIDATION_ERROR).toBeDefined()
  })
})

describe('registerErrorCode', () => {
  beforeEach(() => {
    clearCustomErrorCodes()
  })

  it('should register custom error codes', () => {
    registerErrorCode('QUOTA_EXCEEDED', {
      summary: 'Quota Exceeded',
      category: 'client',
      mappings: {
        http: { status: 402 },
        grpc: { code: 8, codeName: 'RESOURCE_EXHAUSTED' },
        websocket: { close: 4402 },
        jsonrpc: { code: -32010 },
      },
    })

    const spec = generateErrorsSpec()

    expect(spec.errors!.QUOTA_EXCEEDED).toBeDefined()
    expect(spec.errors!.QUOTA_EXCEEDED.summary).toBe('Quota Exceeded')
    expect(spec.errors!.QUOTA_EXCEEDED.mappings?.http?.status).toBe(402)
  })

  it('should throw when overriding standard error codes', () => {
    expect(() =>
      registerErrorCode('VALIDATION_ERROR', {
        summary: 'Custom',
        category: 'client',
      })
    ).toThrow('Cannot override standard error code')
  })
})

describe('Protocol mappers', () => {
  it('should return correct HTTP status', () => {
    expect(getHttpStatus('VALIDATION_ERROR')).toBe(400)
    expect(getHttpStatus('NOT_FOUND')).toBe(404)
    expect(getHttpStatus('RATE_LIMITED')).toBe(429)
    expect(getHttpStatus('UNKNOWN_CODE')).toBe(500) // default
  })

  it('should return correct gRPC code', () => {
    expect(getGrpcCode('VALIDATION_ERROR')).toBe(3)
    expect(getGrpcCode('NOT_FOUND')).toBe(5)
    expect(getGrpcCode('UNAUTHENTICATED')).toBe(16)
  })

  it('should return correct WebSocket close code', () => {
    expect(getWebSocketClose('VALIDATION_ERROR')).toBe(4400)
    expect(getWebSocketClose('NOT_FOUND')).toBe(4404)
  })

  it('should return correct JSON-RPC code', () => {
    expect(getJsonRpcCode('VALIDATION_ERROR')).toBe(-32602)
    expect(getJsonRpcCode('INTERNAL_ERROR')).toBe(-32603)
  })

  it('should check retryable status', () => {
    expect(isRetryable('VALIDATION_ERROR')).toBe(false)
    expect(isRetryable('RATE_LIMITED')).toBe(true)
    expect(isRetryable('INTERNAL_ERROR')).toBe(true)
  })
})
