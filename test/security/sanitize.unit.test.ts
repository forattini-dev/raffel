/**
 * Trust-boundary sanitiser — unit tests (PRD #103, issue #104).
 *
 * Table-driven vectors per sink:
 *   - CRLF / NUL / control chars
 *   - Oversize inputs
 *   - Malformed UTF-8 (replacement char + lone surrogate halves)
 *   - Unicode confusables (NFKC normalisation)
 *   - HTTP header continuation tricks (folded lines)
 */

import { describe, it, expect } from 'vitest'
import {
  safeHeaderValue,
  safeChannelName,
  safeRouteSegment,
  safeStructuredKey,
  SanitisationError,
  isSanitisationError,
} from '../../src/security/sanitize/index.js'

// ---------------------------------------------------------------------------
// safeHeaderValue
// ---------------------------------------------------------------------------

describe('safeHeaderValue', () => {
  describe('happy path', () => {
    const accepted: Array<[string, string, string]> = [
      ['plain ASCII', 'application/json', 'application/json'],
      ['empty string', '', ''],
      ['allows internal HTAB', 'a\tb', 'a\tb'],
      ['allows internal spaces', 'multi word value', 'multi word value'],
      ['trims trailing spaces', 'value   ', 'value'],
      ['trims trailing tabs', 'value\t\t', 'value'],
      ['trims mixed trailing whitespace', 'value \t \t', 'value'],
      ['preserves leading whitespace', '  leading', '  leading'],
      ['preserves UTF-8 letters', 'café', 'café'],
      ['allows DEL-adjacent printable 0x7E (~)', 'name~v1', 'name~v1'],
    ]

    it.each(accepted)('%s', (_label, input, expected) => {
      expect(safeHeaderValue(input)).toBe(expected)
    })
  })

  describe('reject mode (default)', () => {
    const rejected: Array<[string, string]> = [
      ['CR (0x0D)', 'foo\rbar'],
      ['LF (0x0A)', 'foo\nbar'],
      ['CRLF', 'foo\r\nbar'],
      ['NUL (0x00)', 'foo\x00bar'],
      ['BEL (0x07)', 'foo\x07bar'],
      ['VT (0x0B)', 'foo\x0bbar'],
      ['FF (0x0C)', 'foo\x0cbar'],
      ['DEL (0x7F)', 'foo\x7fbar'],
      // Header smuggling — folded continuation
      ['header continuation CRLF+SP', 'value\r\n  X-Injected: 1'],
      ['header continuation CRLF+TAB', 'value\r\n\tX-Injected: 1'],
      ['CRLF before injected', 'normal\r\nX-Injected: yes'],
      // Bare ESC and other C0 control bytes
      ['ESC (0x1B)', 'foo\x1bbar'],
      // Unicode confusable that NFKC collapses to LF — fullwidth no-break:
      // ﻿ is BOM-like, kept as-is by NFKC; included to assert non-collapse:
      ['BOM survives NFKC and is allowed (>= 0x20)', 'foo﻿bar'],
    ]

    it.each(rejected)('rejects %s', (_label, input) => {
      // BOM case is the only one in the table that should NOT throw — guard it.
      if (input.includes('﻿') && !/[\x00-\x1f\x7f]/.test(input)) {
        expect(safeHeaderValue(input)).toBe(input.normalize('NFKC'))
        return
      }
      let caught: unknown
      try {
        safeHeaderValue(input)
      } catch (err) {
        caught = err
      }
      expect(isSanitisationError(caught)).toBe(true)
      const e = caught as SanitisationError
      expect(e.kind).toBe('invalid-char')
      expect(e.sink).toBe('header-value')
    })

    it('rejects non-string input', () => {
      expect(() => safeHeaderValue(undefined)).toThrow(SanitisationError)
      expect(() => safeHeaderValue(123 as unknown)).toThrow(SanitisationError)
      expect(() => safeHeaderValue(Buffer.from('abc') as unknown)).toThrow(SanitisationError)
    })

    it('rejects oversize values', () => {
      const big = 'a'.repeat(5000)
      let caught: unknown
      try {
        safeHeaderValue(big)
      } catch (err) {
        caught = err
      }
      expect(isSanitisationError(caught)).toBe(true)
      expect((caught as SanitisationError).kind).toBe('too-long')
    })

    it('respects custom maxLength', () => {
      expect(() => safeHeaderValue('abcdef', { maxLength: 3 })).toThrow(SanitisationError)
      expect(safeHeaderValue('abc', { maxLength: 3 })).toBe('abc')
    })

    it('allowTab: false rejects HTAB', () => {
      expect(() => safeHeaderValue('a\tb', { allowTab: false })).toThrow(SanitisationError)
    })
  })

  describe('strip mode', () => {
    it('strips CRLF instead of throwing', () => {
      expect(safeHeaderValue('foo\r\nbar', { mode: 'strip' })).toBe('foobar')
    })

    it('strips NUL', () => {
      expect(safeHeaderValue('foo\x00bar', { mode: 'strip' })).toBe('foobar')
    })

    it('strips header continuation injection attempt', () => {
      expect(
        safeHeaderValue('value\r\n  X-Injected: 1', { mode: 'strip' }),
      ).toBe('value  X-Injected: 1')
    })

    it('truncates oversize values without throwing', () => {
      const big = 'a'.repeat(5000)
      const result = safeHeaderValue(big, { mode: 'strip' })
      expect(result.length).toBe(4096)
    })
  })

  describe('NFKC normalisation', () => {
    it('normalises fullwidth digits before validation', () => {
      // U+FF11 FULLWIDTH DIGIT ONE → "1" via NFKC
      const fullwidth = '１２３'
      expect(safeHeaderValue(fullwidth)).toBe('123')
    })

    it('normalises ligature confusables', () => {
      // U+FB01 LATIN SMALL LIGATURE FI → "fi" via NFKC
      expect(safeHeaderValue('ﬁrst')).toBe('first')
    })
  })

  describe('malformed UTF-8 surrogates', () => {
    it('passes lone surrogates through (string-level — bytes cannot smuggle)', () => {
      // Lone high surrogate; not a forbidden byte (>= 0x20), so the value
      // is accepted at the string layer. Wire-level encoders will replace
      // it with U+FFFD if they encode to UTF-8 bytes.
      const lone = 'foo\ud800bar'
      expect(safeHeaderValue(lone)).toBe(lone.normalize('NFKC'))
    })
  })
})

// ---------------------------------------------------------------------------
// safeChannelName
// ---------------------------------------------------------------------------

describe('safeChannelName', () => {
  describe('happy path', () => {
    const accepted = [
      'orders',
      'orders.created',
      'orders/v1',
      'tenant:42:orders',
      'snake_case',
      'kebab-case',
      'A1B2C3',
      'a',
      'x'.repeat(256),
    ]
    it.each(accepted)('accepts %s', (input) => {
      expect(safeChannelName(input)).toBe(input)
    })
  })

  describe('rejects', () => {
    const rejected: Array<[string, string]> = [
      ['empty string', ''],
      ['space', 'orders new'],
      ['CR', 'orders\rcreated'],
      ['LF', 'orders\ncreated'],
      ['NUL', 'orders\x00'],
      ['hash', 'orders#1'],
      ['question mark', 'orders?id=1'],
      ['ampersand', 'orders&new'],
      ['emoji', 'orders🎉'],
      ['parenthesis', 'orders(1)'],
      ['quote', "orders'new"],
      ['backslash', 'orders\\new'],
      ['tab', 'orders\tnew'],
    ]

    it.each(rejected)('rejects %s', (_label, input) => {
      expect(() => safeChannelName(input)).toThrow(SanitisationError)
    })

    it('throws too-long for oversize names', () => {
      const big = 'a'.repeat(257)
      let caught: unknown
      try {
        safeChannelName(big)
      } catch (err) {
        caught = err
      }
      expect(isSanitisationError(caught)).toBe(true)
      expect((caught as SanitisationError).kind).toBe('too-long')
    })

    it('throws empty for empty input', () => {
      let caught: unknown
      try {
        safeChannelName('')
      } catch (err) {
        caught = err
      }
      expect((caught as SanitisationError).kind).toBe('empty')
    })

    it('rejects non-string', () => {
      expect(() => safeChannelName(undefined)).toThrow(SanitisationError)
      expect(() => safeChannelName(42 as unknown)).toThrow(SanitisationError)
    })
  })

  it('normalises NFKC then validates (fullwidth digits OK)', () => {
    expect(safeChannelName('orders.１')).toBe('orders.1')
  })

  it('rejects after NFKC (fullwidth space stays a space)', () => {
    // U+3000 IDEOGRAPHIC SPACE → NFKC → U+0020 SPACE → forbidden
    expect(() => safeChannelName('orders　new')).toThrow(SanitisationError)
  })
})

// ---------------------------------------------------------------------------
// safeRouteSegment
// ---------------------------------------------------------------------------

describe('safeRouteSegment', () => {
  describe('happy path', () => {
    const accepted = ['users', 'v1', 'list-all', 'a.b.c', 'segment_with_underscore']
    it.each(accepted)('accepts %s', (input) => {
      expect(safeRouteSegment(input)).toBe(input)
    })
  })

  describe('rejects', () => {
    const rejected: Array<[string, string]> = [
      ['empty', ''],
      ['CRLF', 'users\r\n'],
      ['NUL', 'users\x00'],
      ['percent (URL escape attempt)', 'users%20list'],
      ['question mark', 'users?'],
      ['hash', 'users#1'],
      ['space', 'users list'],
      ['emoji', '🚀'],
    ]
    it.each(rejected)('rejects %s', (_label, input) => {
      expect(() => safeRouteSegment(input)).toThrow(SanitisationError)
    })
  })

  it('default maxLength is 128', () => {
    expect(() => safeRouteSegment('a'.repeat(129))).toThrow(SanitisationError)
    expect(safeRouteSegment('a'.repeat(128))).toHaveLength(128)
  })
})

// ---------------------------------------------------------------------------
// safeStructuredKey
// ---------------------------------------------------------------------------

describe('safeStructuredKey', () => {
  describe('happy path', () => {
    const accepted = ['userId', '_private', 'service.name', 'foo-bar', 'a', 'A.B-C_1']
    it.each(accepted)('accepts %s', (input) => {
      expect(safeStructuredKey(input)).toBe(input)
    })
  })

  describe('rejects', () => {
    const rejected: Array<[string, string]> = [
      ['empty', ''],
      ['starts with digit', '1foo'],
      ['starts with dot', '.foo'],
      ['starts with hyphen', '-foo'],
      ['contains space', 'foo bar'],
      ['contains slash', 'foo/bar'],
      ['contains colon', 'foo:bar'],
      ['contains CRLF', 'foo\r\n'],
      ['contains NUL', 'foo\x00'],
      ['contains emoji', 'foo🎉'],
      ['contains question mark', 'foo?'],
    ]
    it.each(rejected)('rejects %s', (_label, input) => {
      expect(() => safeStructuredKey(input)).toThrow(SanitisationError)
    })
  })

  it('default maxLength is 64', () => {
    expect(() => safeStructuredKey('a'.repeat(65))).toThrow(SanitisationError)
    expect(safeStructuredKey('a'.repeat(64))).toHaveLength(64)
  })

  it('first-char position is 1 in the error', () => {
    let caught: unknown
    try {
      safeStructuredKey('1abc')
    } catch (err) {
      caught = err
    }
    const e = caught as SanitisationError
    expect(e.position).toBe(1)
    expect(e.charCode).toBe('0x31')
  })
})

// ---------------------------------------------------------------------------
// SanitisationError shape
// ---------------------------------------------------------------------------

describe('SanitisationError', () => {
  it('exposes kind, sink, position, charCode', () => {
    let caught: unknown
    try {
      safeHeaderValue('foo\rbar')
    } catch (err) {
      caught = err
    }
    const e = caught as SanitisationError
    expect(e.name).toBe('SanitisationError')
    expect(e.kind).toBe('invalid-char')
    expect(e.sink).toBe('header-value')
    expect(e.position).toBe(4)
    expect(e.charCode).toBe('0x0D')
  })

  it('isSanitisationError narrows correctly', () => {
    expect(isSanitisationError(new Error('nope'))).toBe(false)
    let err: unknown
    try {
      safeChannelName('')
    } catch (e) {
      err = e
    }
    expect(isSanitisationError(err)).toBe(true)
  })
})
