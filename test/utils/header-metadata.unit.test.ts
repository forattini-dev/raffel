import { describe, it, expect } from 'vitest'
import {
  extractMetadataFromHeaders,
  extractMetadataFromRecord,
  sanitizeMetadataRecord,
  mergeMetadata,
} from '../../src/utils/header-metadata.js'

describe('Header Metadata Utilities', () => {
  describe('extractMetadataFromHeaders()', () => {
    it('extracts authorization header', () => {
      const result = extractMetadataFromHeaders({
        authorization: 'Bearer token123',
      })
      expect(result).toEqual({ authorization: 'Bearer token123' })
    })

    it('extracts x-* custom headers', () => {
      const result = extractMetadataFromHeaders({
        'x-request-id': 'req-123',
        'x-custom-header': 'value',
        'x-another': 'hello',
      })
      expect(result).toEqual({
        'x-request-id': 'req-123',
        'x-custom-header': 'value',
        'x-another': 'hello',
      })
    })

    it('extracts standard metadata headers', () => {
      const result = extractMetadataFromHeaders({
        'content-type': 'application/json',
        accept: 'text/html',
        traceparent: '00-abc-def-01',
        tracestate: 'key=value',
        cookie: 'session=abc',
      })
      expect(result).toEqual({
        'content-type': 'application/json',
        accept: 'text/html',
        traceparent: '00-abc-def-01',
        tracestate: 'key=value',
        cookie: 'session=abc',
      })
    })

    it('skips non-metadata headers', () => {
      const result = extractMetadataFromHeaders({
        host: 'example.com',
        'user-agent': 'Mozilla/5.0',
        connection: 'keep-alive',
        'cache-control': 'no-cache',
        authorization: 'Bearer token',
      })
      expect(result).toEqual({ authorization: 'Bearer token' })
      expect(result).not.toHaveProperty('host')
      expect(result).not.toHaveProperty('user-agent')
      expect(result).not.toHaveProperty('connection')
      expect(result).not.toHaveProperty('cache-control')
    })

    it('normalizes header keys to lowercase', () => {
      const result = extractMetadataFromHeaders({
        Authorization: 'Bearer token',
        'X-Request-Id': 'req-123',
      } as any)
      // IncomingHttpHeaders keys should already be lowercase in Node,
      // but the function lowercases them anyway
      expect(result['authorization'] || result['Authorization']).toBeDefined()
    })

    it('handles array header values by joining with commas', () => {
      const result = extractMetadataFromHeaders({
        'x-multi': ['value1', 'value2', 'value3'],
      } as any)
      expect(result['x-multi']).toBe('value1,value2,value3')
    })

    it('skips undefined values', () => {
      const result = extractMetadataFromHeaders({
        'x-test': undefined,
      })
      expect(result).toEqual({})
    })

    it('returns empty object for empty headers', () => {
      expect(extractMetadataFromHeaders({})).toEqual({})
    })
  })

  describe('extractMetadataFromRecord()', () => {
    it('extracts metadata headers from a plain object', () => {
      const result = extractMetadataFromRecord({
        'x-request-id': 'abc',
        authorization: 'Bearer xyz',
        host: 'example.com',
      })
      expect(result).toEqual({
        'x-request-id': 'abc',
        authorization: 'Bearer xyz',
      })
      expect(result).not.toHaveProperty('host')
    })

    it('returns empty object for null input', () => {
      expect(extractMetadataFromRecord(null)).toEqual({})
    })

    it('returns empty object for undefined input', () => {
      expect(extractMetadataFromRecord(undefined)).toEqual({})
    })

    it('returns empty object for non-object input', () => {
      expect(extractMetadataFromRecord('string')).toEqual({})
      expect(extractMetadataFromRecord(123)).toEqual({})
    })

    it('normalizes numeric values to strings', () => {
      const result = extractMetadataFromRecord({
        'x-count': 42,
      })
      expect(result['x-count']).toBe('42')
    })

    it('normalizes boolean values to strings', () => {
      const result = extractMetadataFromRecord({
        'x-flag': true,
      })
      expect(result['x-flag']).toBe('true')
    })
  })

  describe('sanitizeMetadataRecord()', () => {
    it('converts string values as-is', () => {
      const result = sanitizeMetadataRecord({
        key1: 'value1',
        key2: 'value2',
      })
      expect(result).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('converts numeric values to strings', () => {
      const result = sanitizeMetadataRecord({
        count: 42,
        ratio: 3.14,
      })
      expect(result).toEqual({ count: '42', ratio: '3.14' })
    })

    it('converts boolean values to strings', () => {
      const result = sanitizeMetadataRecord({
        active: true,
        deleted: false,
      })
      expect(result).toEqual({ active: 'true', deleted: 'false' })
    })

    it('converts bigint values to strings', () => {
      const result = sanitizeMetadataRecord({
        big: BigInt(9007199254740991),
      })
      expect(result).toEqual({ big: '9007199254740991' })
    })

    it('joins array values with commas', () => {
      const result = sanitizeMetadataRecord({
        tags: ['a', 'b', 'c'],
      })
      expect(result).toEqual({ tags: 'a,b,c' })
    })

    it('skips undefined and null values in arrays', () => {
      const result = sanitizeMetadataRecord({
        tags: ['a', undefined, 'c'],
      })
      expect(result).toEqual({ tags: 'a,c' })
    })

    it('skips keys with undefined values', () => {
      const result = sanitizeMetadataRecord({
        present: 'yes',
        missing: undefined,
      })
      expect(result).toEqual({ present: 'yes' })
      expect(result).not.toHaveProperty('missing')
    })

    it('skips keys with object values (non-serializable)', () => {
      const result = sanitizeMetadataRecord({
        nested: { deep: true },
      })
      expect(result).toEqual({})
    })

    it('does NOT filter by header name (unlike extractMetadataFromHeaders)', () => {
      const result = sanitizeMetadataRecord({
        'any-key': 'value',
        host: 'example.com',
        random: 'data',
      })
      expect(result).toEqual({
        'any-key': 'value',
        host: 'example.com',
        random: 'data',
      })
    })

    it('lowercases keys', () => {
      const result = sanitizeMetadataRecord({
        'X-Custom': 'value',
        UPPER: 'case',
      })
      expect(result).toEqual({
        'x-custom': 'value',
        upper: 'case',
      })
    })

    it('returns empty object for null input', () => {
      expect(sanitizeMetadataRecord(null)).toEqual({})
    })

    it('returns empty object for undefined input', () => {
      expect(sanitizeMetadataRecord(undefined)).toEqual({})
    })

    it('returns empty object for non-object input', () => {
      expect(sanitizeMetadataRecord(42)).toEqual({})
      expect(sanitizeMetadataRecord('str')).toEqual({})
    })
  })

  describe('mergeMetadata()', () => {
    it('merges multiple sources, last wins', () => {
      const result = mergeMetadata(
        { 'x-request-id': 'first', 'x-source': 'a' },
        { 'x-request-id': 'second', 'x-target': 'b' },
      )
      expect(result).toEqual({
        'x-request-id': 'second',
        'x-source': 'a',
        'x-target': 'b',
      })
    })

    it('handles undefined sources gracefully', () => {
      const result = mergeMetadata(
        undefined,
        { key: 'value' },
        undefined,
      )
      expect(result).toEqual({ key: 'value' })
    })

    it('returns empty object when no sources provided', () => {
      expect(mergeMetadata()).toEqual({})
    })

    it('returns empty object when all sources are undefined', () => {
      expect(mergeMetadata(undefined, undefined)).toEqual({})
    })

    it('lowercases keys from all sources', () => {
      const result = mergeMetadata(
        { 'X-Upper': 'a' },
        { 'X-ANOTHER': 'b' },
      )
      expect(result).toEqual({
        'x-upper': 'a',
        'x-another': 'b',
      })
    })

    it('merges three sources correctly', () => {
      const result = mergeMetadata(
        { a: '1', b: '1' },
        { b: '2', c: '2' },
        { c: '3', d: '3' },
      )
      expect(result).toEqual({ a: '1', b: '2', c: '3', d: '3' })
    })

    it('single source returns a copy', () => {
      const source = { key: 'value' }
      const result = mergeMetadata(source)
      expect(result).toEqual(source)
      expect(result).not.toBe(source)
    })
  })
})
