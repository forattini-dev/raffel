import { describe, it, expect, beforeEach } from 'vitest'
import {
  sid,
  customAlphabet,
  customAlphabetByName,
  sidWithOptions,
  sidEntropyBits,
  urlAlphabet,
  URL_SAFE,
  ALPHANUMERIC,
  BASE58,
  HEX_LOWER,
  NUMERIC,
  alphabets,
  getAlphabet,
  validateAlphabet,
  randomString,
  calculateEntropyBits,
  resetPool,
} from '../../src/utils/id/index.js'

describe('ID Generation', () => {
  beforeEach(() => {
    resetPool()
  })

  describe('sid()', () => {
    it('generates unique IDs of default length 21', () => {
      const id = sid()
      expect(id).toHaveLength(21)
    })

    it('generates IDs that only contain URL-safe characters', () => {
      for (let i = 0; i < 100; i++) {
        const id = sid()
        for (const char of id) {
          expect(URL_SAFE).toContain(char)
        }
      }
    })

    it('generates unique IDs across many calls', () => {
      const ids = new Set<string>()
      for (let i = 0; i < 1000; i++) {
        ids.add(sid())
      }
      expect(ids.size).toBe(1000)
    })

    it('generates ID of specified length', () => {
      expect(sid(10)).toHaveLength(10)
      expect(sid(1)).toHaveLength(1)
      expect(sid(50)).toHaveLength(50)
      expect(sid(100)).toHaveLength(100)
    })

    it('generates ID of length 0 as empty string', () => {
      expect(sid(0)).toBe('')
    })
  })

  describe('customAlphabet()', () => {
    it('generates IDs only from the specified characters', () => {
      const generate = customAlphabet('abc', 5)
      for (let i = 0; i < 100; i++) {
        const id = generate()
        expect(id).toHaveLength(5)
        for (const char of id) {
          expect('abc').toContain(char)
        }
      }
    })

    it('uses default size when none specified on call', () => {
      const generate = customAlphabet('abcdef', 8)
      const id = generate()
      expect(id).toHaveLength(8)
    })

    it('allows overriding size on each call', () => {
      const generate = customAlphabet('abcdef', 8)
      expect(generate(3)).toHaveLength(3)
      expect(generate(15)).toHaveLength(15)
    })

    it('uses default size 21 when no defaultSize given', () => {
      const generate = customAlphabet('abcdefghij')
      expect(generate()).toHaveLength(21)
    })

    it('throws on invalid alphabet (empty)', () => {
      expect(() => customAlphabet('')).toThrow('Invalid alphabet')
    })

    it('throws on invalid alphabet (single char)', () => {
      expect(() => customAlphabet('a')).toThrow('Invalid alphabet')
    })

    it('throws on invalid alphabet (duplicate chars)', () => {
      expect(() => customAlphabet('aab')).toThrow('Invalid alphabet')
    })

    it('generates uniform distribution over many calls', () => {
      const generate = customAlphabet('ab', 1)
      const counts: Record<string, number> = { a: 0, b: 0 }
      const total = 10000
      for (let i = 0; i < total; i++) {
        const id = generate()
        counts[id]!++
      }
      // Each should be roughly 50% with some tolerance
      expect(counts['a']!).toBeGreaterThan(total * 0.4)
      expect(counts['b']!).toBeGreaterThan(total * 0.4)
    })
  })

  describe('customAlphabetByName()', () => {
    it('creates generator for named alphabet', () => {
      const generate = customAlphabetByName('HEX_LOWER', 32)
      const id = generate()
      expect(id).toHaveLength(32)
      for (const char of id) {
        expect(HEX_LOWER).toContain(char)
      }
    })

    it('falls back to treating unknown name as custom alphabet', () => {
      const generate = customAlphabetByName('xy', 5)
      const id = generate()
      expect(id).toHaveLength(5)
      for (const char of id) {
        expect('xy').toContain(char)
      }
    })
  })

  describe('sidWithOptions()', () => {
    it('uses defaults when no options provided', () => {
      const id = sidWithOptions()
      expect(id).toHaveLength(21)
    })

    it('respects custom size', () => {
      const id = sidWithOptions({ size: 16 })
      expect(id).toHaveLength(16)
    })

    it('respects named alphabet', () => {
      const id = sidWithOptions({ alphabet: 'NUMERIC', size: 12 })
      expect(id).toHaveLength(12)
      for (const char of id) {
        expect(NUMERIC).toContain(char)
      }
    })

    it('respects custom alphabet string', () => {
      const id = sidWithOptions({ alphabet: 'XYZ', size: 10 })
      expect(id).toHaveLength(10)
      for (const char of id) {
        expect('XYZ').toContain(char)
      }
    })

    it('throws on invalid custom alphabet', () => {
      expect(() => sidWithOptions({ alphabet: 'a' })).toThrow('Invalid alphabet')
    })
  })

  describe('sidEntropyBits()', () => {
    it('returns reasonable entropy for default config', () => {
      const bits = sidEntropyBits()
      // URL_SAFE has 64 chars, 21 chars => log2(64) * 21 = 6 * 21 = 126
      expect(bits).toBeCloseTo(126, 0)
    })

    it('returns correct entropy for HEX_LOWER 32', () => {
      const bits = sidEntropyBits('HEX_LOWER', 32)
      // 16 chars, 32 length => log2(16) * 32 = 4 * 32 = 128
      expect(bits).toBeCloseTo(128, 0)
    })

    it('returns correct entropy for custom alphabet', () => {
      const bits = sidEntropyBits('ab', 10)
      // 2 chars, 10 length => log2(2) * 10 = 1 * 10 = 10
      expect(bits).toBeCloseTo(10, 0)
    })

    it('returns correct entropy for named BASE58 alphabet', () => {
      const bits = sidEntropyBits('BASE58', 21)
      // 58 chars => log2(58) * 21 ~ 5.858 * 21 ~ 123
      expect(bits).toBeGreaterThan(120)
      expect(bits).toBeLessThan(130)
    })
  })

  describe('urlAlphabet', () => {
    it('is the same as URL_SAFE', () => {
      expect(urlAlphabet).toBe(URL_SAFE)
    })

    it('has 64 characters', () => {
      expect(URL_SAFE).toHaveLength(64)
    })
  })

  describe('getAlphabet()', () => {
    it('returns BASE58 alphabet by name', () => {
      expect(getAlphabet('BASE58')).toBe(BASE58)
    })

    it('returns URL_SAFE alphabet by name', () => {
      expect(getAlphabet('URL_SAFE')).toBe(URL_SAFE)
    })

    it('returns ALPHANUMERIC alphabet by name', () => {
      expect(getAlphabet('ALPHANUMERIC')).toBe(ALPHANUMERIC)
    })

    it('returns HEX_LOWER alphabet by name', () => {
      expect(getAlphabet('HEX_LOWER')).toBe(HEX_LOWER)
    })

    it('returns NUMERIC alphabet by name', () => {
      expect(getAlphabet('NUMERIC')).toBe(NUMERIC)
    })

    it('returns the string itself for unknown names (custom alphabet)', () => {
      expect(getAlphabet('mycustom')).toBe('mycustom')
    })

    it('returns all known alphabets', () => {
      for (const [name, value] of Object.entries(alphabets)) {
        expect(getAlphabet(name)).toBe(value)
      }
    })
  })

  describe('validateAlphabet()', () => {
    it('returns null for valid alphabets', () => {
      expect(validateAlphabet('ab')).toBeNull()
      expect(validateAlphabet('abc')).toBeNull()
      expect(validateAlphabet(URL_SAFE)).toBeNull()
      expect(validateAlphabet(ALPHANUMERIC)).toBeNull()
      expect(validateAlphabet(BASE58)).toBeNull()
    })

    it('returns error for empty alphabet', () => {
      expect(validateAlphabet('')).toBe('Alphabet cannot be empty')
    })

    it('returns error for single-character alphabet', () => {
      expect(validateAlphabet('a')).toBe('Alphabet must have at least 2 characters')
    })

    it('returns error for duplicate characters', () => {
      const result = validateAlphabet('abca')
      expect(result).toContain('Duplicate character')
      expect(result).toContain('"a"')
    })

    it('returns error for alphabet exceeding max size', () => {
      const huge = Array.from({ length: 65537 }, (_, i) => String.fromCodePoint(i)).join('')
      expect(validateAlphabet(huge)).toBe('Alphabet cannot exceed 65536 characters')
    })
  })

  describe('calculateEntropyBits()', () => {
    it('returns expected value for standard configs', () => {
      // 62 chars, 21 length => log2(62) * 21 ~ 5.954 * 21 ~ 125.04
      const bits = calculateEntropyBits(62, 21)
      expect(bits).toBeCloseTo(125.04, 0)
    })

    it('returns 128 for hex 32', () => {
      expect(calculateEntropyBits(16, 32)).toBeCloseTo(128, 5)
    })

    it('returns 0 for length 0', () => {
      expect(calculateEntropyBits(64, 0)).toBe(0)
    })

    it('returns correct value for binary alphabet', () => {
      // 2 chars, 8 length => log2(2) * 8 = 8
      expect(calculateEntropyBits(2, 8)).toBe(8)
    })

    it('returns correct value for base64 alphabet', () => {
      // 64 chars, 1 length => log2(64) = 6
      expect(calculateEntropyBits(64, 1)).toBe(6)
    })
  })

  describe('randomString()', () => {
    it('returns string of specified length', () => {
      expect(randomString('abc', 10)).toHaveLength(10)
      expect(randomString('abc', 0)).toHaveLength(0)
      expect(randomString('abc', 1)).toHaveLength(1)
    })

    it('only uses characters from the given alphabet', () => {
      for (let i = 0; i < 100; i++) {
        const str = randomString('abc', 10)
        for (const char of str) {
          expect('abc').toContain(char)
        }
      }
    })

    it('handles large alphabets', () => {
      const alpha = ALPHANUMERIC
      const str = randomString(alpha, 50)
      expect(str).toHaveLength(50)
      for (const char of str) {
        expect(alpha).toContain(char)
      }
    })

    it('handles two-character alphabet', () => {
      const str = randomString('01', 20)
      expect(str).toHaveLength(20)
      for (const char of str) {
        expect('01').toContain(char)
      }
    })
  })

  describe('resetPool()', () => {
    it('resets the pool without error', () => {
      expect(() => resetPool()).not.toThrow()
    })

    it('pool is re-initialized on next generation after reset', () => {
      resetPool()
      const id = sid()
      expect(id).toHaveLength(21)
    })
  })
})
