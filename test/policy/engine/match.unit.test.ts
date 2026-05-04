import { describe, it, expect } from 'vitest'
import { compileGlob, matchAnyCompiled } from '../../../src/middleware/policy/engine/match.js'

describe('match — glob compilation (full set: *, **, ?, {a,b}, [abc])', () => {
  describe('* — single segment, no dot crossing', () => {
    it('matches a single segment', () => {
      const re = compileGlob('*.read')
      expect(re.test('lead.read')).toBe(true)
      expect(re.test('channel.read')).toBe(true)
    })

    it('does NOT cross dots', () => {
      const re = compileGlob('*.read')
      expect(re.test('lead.move.read')).toBe(false)
    })

    it('does NOT cross colons', () => {
      const re = compileGlob('lead:*')
      expect(re.test('lead:l1')).toBe(true)
      expect(re.test('lead:l1:nested')).toBe(false)
    })
  })

  describe('** — globstar, crosses dots', () => {
    it('matches across nested namespaces', () => {
      const re = compileGlob('lead.**')
      expect(re.test('lead.read')).toBe(true)
      expect(re.test('lead.move.funnel')).toBe(true)
    })

    it('does NOT match an unrelated namespace', () => {
      const re = compileGlob('lead.**')
      expect(re.test('channel.read')).toBe(false)
    })

    it('** alone matches anything including dots', () => {
      const re = compileGlob('**')
      expect(re.test('a')).toBe(true)
      expect(re.test('a.b.c.d')).toBe(true)
    })
  })

  describe('literal patterns', () => {
    it('matches exact string', () => {
      const re = compileGlob('lead.read')
      expect(re.test('lead.read')).toBe(true)
      expect(re.test('lead.write')).toBe(false)
    })

    it('regex specials in pattern are escaped', () => {
      const re = compileGlob('lead.r+e?ad')
      expect(re.test('lead.r+e?ad')).toBe(true)
      expect(re.test('lead.read')).toBe(false)
    })
  })

  describe('? — single character (Phase 2)', () => {
    it('matches exactly one char', () => {
      const re = compileGlob('lead:l?')
      expect(re.test('lead:l1')).toBe(true)
      expect(re.test('lead:la')).toBe(true)
      expect(re.test('lead:l12')).toBe(false)
      expect(re.test('lead:l')).toBe(false)
    })

    it('does NOT cross dots/colons', () => {
      const re = compileGlob('lead:l?')
      expect(re.test('lead:l.')).toBe(false)
      expect(re.test('lead:l:')).toBe(false)
    })

    it('multiple ? for fixed-length match', () => {
      const re = compileGlob('lead:l??')
      expect(re.test('lead:l12')).toBe(true)
      expect(re.test('lead:l1')).toBe(false)
    })
  })

  describe('{a,b} — alternation (Phase 2)', () => {
    it('matches each alternative', () => {
      const re = compileGlob('lead.{create,update}')
      expect(re.test('lead.create')).toBe(true)
      expect(re.test('lead.update')).toBe(true)
      expect(re.test('lead.delete')).toBe(false)
    })

    it('combines with prefix', () => {
      const re = compileGlob('scope:lead.{read,claim}')
      expect(re.test('scope:lead.read')).toBe(true)
      expect(re.test('scope:lead.claim')).toBe(true)
      expect(re.test('scope:lead.write')).toBe(false)
    })

    it('inner regex specials are escaped', () => {
      const re = compileGlob('{a.b,c+d}')
      expect(re.test('a.b')).toBe(true)
      expect(re.test('c+d')).toBe(true)
      expect(re.test('aXb')).toBe(false)
    })
  })

  describe('[abc] — character class (Phase 2)', () => {
    it('matches enumerated chars', () => {
      const re = compileGlob('lead:l[12]')
      expect(re.test('lead:l1')).toBe(true)
      expect(re.test('lead:l2')).toBe(true)
      expect(re.test('lead:l3')).toBe(false)
    })

    it('range class [a-c]', () => {
      const re = compileGlob('lead:l[a-c]')
      expect(re.test('lead:la')).toBe(true)
      expect(re.test('lead:lc')).toBe(true)
      expect(re.test('lead:ld')).toBe(false)
    })
  })

  describe('combined wildcards', () => {
    it('** + {} together', () => {
      const re = compileGlob('lead.{read,write}.**')
      expect(re.test('lead.read.x.y')).toBe(true)
      expect(re.test('lead.write.x')).toBe(true)
      expect(re.test('lead.delete.x')).toBe(false)
    })

    it('? + [abc] together', () => {
      const re = compileGlob('user:?[12]')
      expect(re.test('user:a1')).toBe(true)
      expect(re.test('user:b2')).toBe(true)
      expect(re.test('user:c3')).toBe(false)
    })
  })

  describe('matchAnyCompiled', () => {
    it('returns true if any compiled pattern matches', () => {
      const patterns = [compileGlob('*.read'), compileGlob('lead.write')]
      expect(matchAnyCompiled('lead.read', patterns)).toBe(true)
      expect(matchAnyCompiled('lead.write', patterns)).toBe(true)
      expect(matchAnyCompiled('lead.delete', patterns)).toBe(false)
    })

    it('returns false on empty pattern list', () => {
      expect(matchAnyCompiled('anything', [])).toBe(false)
    })
  })
})
