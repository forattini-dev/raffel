import { describe, it, expect } from 'vitest'
import { encode as toonEncode, decode as toonDecode } from '@toon-format/toon'
import {
  jsonCodec,
  textCodec,
  csvCodec,
  xmlCodec,
  createToonCodec,
  defaultCodecs,
  selectCodecForContentType,
  selectCodecForAccept,
  resolveCodecs,
} from '../../src/utils/content-codecs.js'
import type { Codec } from '../../src/utils/content-codecs.js'

describe('Content Codecs', () => {
  describe('jsonCodec', () => {
    it('encodes objects to JSON strings', () => {
      expect(jsonCodec.encode({ a: 1, b: 'hello' })).toBe('{"a":1,"b":"hello"}')
    })

    it('encodes arrays to JSON strings', () => {
      expect(jsonCodec.encode([1, 2, 3])).toBe('[1,2,3]')
    })

    it('encodes primitives', () => {
      expect(jsonCodec.encode(42)).toBe('42')
      expect(jsonCodec.encode('text')).toBe('"text"')
      expect(jsonCodec.encode(null)).toBe('null')
      expect(jsonCodec.encode(true)).toBe('true')
    })

    it('decodes JSON strings to objects', () => {
      expect(jsonCodec.decode('{"a":1}')).toEqual({ a: 1 })
    })

    it('decodes JSON arrays', () => {
      expect(jsonCodec.decode('[1,2,3]')).toEqual([1, 2, 3])
    })

    it('decodes JSON primitives', () => {
      expect(jsonCodec.decode('42')).toBe(42)
      expect(jsonCodec.decode('"hello"')).toBe('hello')
      expect(jsonCodec.decode('null')).toBeNull()
    })

    it('roundtrips complex objects', () => {
      const obj = { users: [{ id: 1, name: 'Alice' }], count: 1 }
      expect(jsonCodec.decode(jsonCodec.encode(obj))).toEqual(obj)
    })

    it('has name "json"', () => {
      expect(jsonCodec.name).toBe('json')
    })

    it('has correct content types', () => {
      expect(jsonCodec.contentTypes).toContain('application/json')
      expect(jsonCodec.contentTypes).toContain('application/*+json')
    })
  })

  describe('textCodec', () => {
    it('encodes strings as-is', () => {
      expect(textCodec.encode('hello world')).toBe('hello world')
    })

    it('encodes null as empty string', () => {
      expect(textCodec.encode(null)).toBe('')
    })

    it('encodes undefined as empty string', () => {
      expect(textCodec.encode(undefined)).toBe('')
    })

    it('encodes objects as JSON strings', () => {
      expect(textCodec.encode({ a: 1 })).toBe('{"a":1}')
    })

    it('encodes numbers as JSON', () => {
      expect(textCodec.encode(42)).toBe('42')
    })

    it('decodes text as-is (identity)', () => {
      expect(textCodec.decode('hello world')).toBe('hello world')
    })

    it('decodes empty string', () => {
      expect(textCodec.decode('')).toBe('')
    })

    it('has name "text"', () => {
      expect(textCodec.name).toBe('text')
    })

    it('has correct content types', () => {
      expect(textCodec.contentTypes).toContain('text/plain')
      expect(textCodec.contentTypes).toContain('application/graphql')
    })
  })

  describe('csvCodec', () => {
    it('encodes array of objects to CSV', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]
      const csv = csvCodec.encode(data)
      expect(csv).toContain('name,age')
      expect(csv).toContain('Alice,30')
      expect(csv).toContain('Bob,25')
    })

    it('encodes single object as CSV with header + one row', () => {
      const csv = csvCodec.encode({ name: 'Alice', age: 30 })
      const lines = csv.split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe('name,age')
      expect(lines[1]).toBe('Alice,30')
    })

    it('encodes empty array as empty string', () => {
      expect(csvCodec.encode([])).toBe('')
    })

    it('encodes null as empty string', () => {
      expect(csvCodec.encode(null)).toBe('')
    })

    it('encodes undefined as empty string', () => {
      expect(csvCodec.encode(undefined)).toBe('')
    })

    it('encodes array of primitives with "value" header', () => {
      const csv = csvCodec.encode([1, 2, 3])
      const lines = csv.split('\n')
      expect(lines[0]).toBe('value')
      expect(lines[1]).toBe('1')
      expect(lines[2]).toBe('2')
      expect(lines[3]).toBe('3')
    })

    it('escapes commas in values', () => {
      const csv = csvCodec.encode([{ text: 'hello, world' }])
      expect(csv).toContain('"hello, world"')
    })

    it('escapes double quotes in values', () => {
      const csv = csvCodec.encode([{ text: 'say "hi"' }])
      expect(csv).toContain('"say ""hi"""')
    })

    it('escapes newlines in values', () => {
      const csv = csvCodec.encode([{ text: 'line1\nline2' }])
      expect(csv).toContain('"line1\nline2"')
    })

    it('decodes CSV string to array of objects', () => {
      const csv = 'name,age\nAlice,30\nBob,25'
      const result = csvCodec.decode(csv) as Array<Record<string, string>>
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ name: 'Alice', age: '30' })
      expect(result[1]).toEqual({ name: 'Bob', age: '25' })
    })

    it('decodes CSV with quoted fields', () => {
      const csv = 'text,num\n"hello, world",42'
      const result = csvCodec.decode(csv) as Array<Record<string, string>>
      expect(result[0]!.text).toBe('hello, world')
    })

    it('decodes CSV with escaped double quotes', () => {
      const csv = 'text\n"say ""hi"""'
      const result = csvCodec.decode(csv) as Array<Record<string, string>>
      expect(result[0]!.text).toBe('say "hi"')
    })

    it('decodes empty CSV as empty array', () => {
      expect(csvCodec.decode('')).toEqual([])
    })

    it('roundtrips simple data', () => {
      const data = [
        { name: 'Alice', city: 'NYC' },
        { name: 'Bob', city: 'LA' },
      ]
      const decoded = csvCodec.decode(csvCodec.encode(data)) as Array<Record<string, string>>
      expect(decoded).toEqual(data)
    })

    it('has name "csv"', () => {
      expect(csvCodec.name).toBe('csv')
    })

    it('has correct content types', () => {
      expect(csvCodec.contentTypes).toContain('text/csv')
    })
  })

  describe('selectCodecForContentType()', () => {
    it('returns jsonCodec for application/json', () => {
      const codec = selectCodecForContentType('application/json', defaultCodecs)
      expect(codec).toBe(jsonCodec)
    })

    it('returns jsonCodec for application/json with charset', () => {
      const codec = selectCodecForContentType('application/json; charset=utf-8', defaultCodecs)
      expect(codec).toBe(jsonCodec)
    })

    it('returns textCodec for text/plain', () => {
      const codec = selectCodecForContentType('text/plain', defaultCodecs)
      expect(codec).toBe(textCodec)
    })

    it('returns csvCodec for text/csv', () => {
      const codec = selectCodecForContentType('text/csv', defaultCodecs)
      expect(codec).toBe(csvCodec)
    })

    it('returns null for undefined content type', () => {
      expect(selectCodecForContentType(undefined, defaultCodecs)).toBeNull()
    })

    it('returns null for unrecognized content type', () => {
      expect(selectCodecForContentType('application/pdf', defaultCodecs)).toBeNull()
    })

    it('returns xmlCodec for application/xml', () => {
      const codec = selectCodecForContentType('application/xml', defaultCodecs)
      expect(codec).toBe(xmlCodec)
    })

    it('returns xmlCodec for text/xml', () => {
      const codec = selectCodecForContentType('text/xml', defaultCodecs)
      expect(codec).toBe(xmlCodec)
    })

    it('returns jsonCodec for application/vnd.api+json via wildcard pattern', () => {
      const codec = selectCodecForContentType('application/vnd.api+json', defaultCodecs)
      expect(codec).toBe(jsonCodec)
    })

    it('returns textCodec for application/graphql', () => {
      const codec = selectCodecForContentType('application/graphql', defaultCodecs)
      expect(codec).toBe(textCodec)
    })

    it('is case-insensitive', () => {
      const codec = selectCodecForContentType('Application/JSON', defaultCodecs)
      expect(codec).toBe(jsonCodec)
    })
  })

  describe('selectCodecForAccept()', () => {
    it('returns csvCodec for text/csv', () => {
      const codec = selectCodecForAccept('text/csv', defaultCodecs, jsonCodec)
      expect(codec).toBe(csvCodec)
    })

    it('returns jsonCodec for application/json', () => {
      const codec = selectCodecForAccept('application/json', defaultCodecs, jsonCodec)
      expect(codec).toBe(jsonCodec)
    })

    it('returns fallback when accept is undefined', () => {
      const codec = selectCodecForAccept(undefined, defaultCodecs, jsonCodec)
      expect(codec).toBe(jsonCodec)
    })

    it('returns first matching codec from comma-separated accept', () => {
      const codec = selectCodecForAccept('text/csv, application/json', defaultCodecs, jsonCodec)
      // text/csv matches csvCodec via exact match on csvCodec content types
      // but the loop checks codecs in order (json, text, csv), so depends on implementation
      expect(codec).not.toBeNull()
    })

    it('returns null when no codec matches', () => {
      const codec = selectCodecForAccept('application/pdf', defaultCodecs, jsonCodec)
      expect(codec).toBeNull()
    })

    it('returns xmlCodec for application/xml', () => {
      const codec = selectCodecForAccept('application/xml', defaultCodecs, jsonCodec)
      expect(codec).toBe(xmlCodec)
    })

    it('handles */* wildcard accept', () => {
      const codec = selectCodecForAccept('*/*', defaultCodecs, jsonCodec)
      // */* should match the first codec
      expect(codec).toBe(jsonCodec)
    })

    it('handles text/* wildcard accept', () => {
      const codec = selectCodecForAccept('text/*', defaultCodecs, jsonCodec)
      // text/* should match textCodec (text/plain)
      expect(codec).not.toBeNull()
    })
  })

  describe('resolveCodecs()', () => {
    it('returns fallback when no codecs provided', () => {
      expect(resolveCodecs()).toEqual(defaultCodecs)
      expect(resolveCodecs(undefined)).toEqual(defaultCodecs)
      expect(resolveCodecs([])).toEqual(defaultCodecs)
    })

    it('merges custom codecs with fallback, deduplicating by name', () => {
      const customJson: Codec = {
        name: 'json',
        contentTypes: ['application/json'],
        encode: (v) => JSON.stringify(v, null, 2),
        decode: (b) => JSON.parse(b),
      }
      const result = resolveCodecs([customJson])
      // Custom json should come first, default json is deduplicated
      expect(result[0]).toBe(customJson)
      expect(result.filter((c) => c.name === 'json')).toHaveLength(1)
      // text and csv from defaults should still be present
      expect(result.find((c) => c.name === 'text')).toBe(textCodec)
      expect(result.find((c) => c.name === 'csv')).toBe(csvCodec)
    })

    it('adds novel codecs alongside defaults, deduplicating by name', () => {
      const customXml: Codec = {
        name: 'xml',
        contentTypes: ['application/xml'],
        encode: () => '<root/>',
        decode: (b) => b,
      }
      const result = resolveCodecs([customXml])
      expect(result).toHaveLength(4) // custom xml + json + text + csv (default xml deduplicated)
      expect(result[0]).toBe(customXml)
    })

    it('adds a genuinely novel codec alongside all defaults', () => {
      const yamlCodec: Codec = {
        name: 'yaml',
        contentTypes: ['application/yaml'],
        encode: () => '',
        decode: (b) => b,
      }
      const result = resolveCodecs([yamlCodec])
      expect(result).toHaveLength(5) // yaml + json + text + csv + xml
      expect(result[0]).toBe(yamlCodec)
    })

    it('deduplicates by name case-insensitively', () => {
      const customText: Codec = {
        name: 'Text',
        contentTypes: ['text/plain'],
        encode: (v) => String(v),
        decode: (b) => b,
      }
      const result = resolveCodecs([customText])
      expect(result.filter((c) => c.name.toLowerCase() === 'text')).toHaveLength(1)
      expect(result[0]).toBe(customText)
    })

    it('uses custom fallback when provided', () => {
      const myFallback: Codec[] = [jsonCodec]
      const result = resolveCodecs(undefined, myFallback)
      expect(result).toEqual(myFallback)
    })

    it('preserves order: custom first, then fallback', () => {
      const a: Codec = { name: 'a', contentTypes: [], encode: () => '', decode: (b) => b }
      const b: Codec = { name: 'b', contentTypes: [], encode: () => '', decode: (b) => b }
      const result = resolveCodecs([a, b])
      expect(result[0]).toBe(a)
      expect(result[1]).toBe(b)
      // Then defaults
      expect(result[2]).toBe(jsonCodec)
      expect(result[3]).toBe(textCodec)
      expect(result[4]).toBe(csvCodec)
      expect(result[5]).toBe(xmlCodec)
    })
  })

  describe('defaultCodecs', () => {
    it('has json, text, csv, and xml codecs in order', () => {
      expect(defaultCodecs).toHaveLength(4)
      expect(defaultCodecs[0]).toBe(jsonCodec)
      expect(defaultCodecs[1]).toBe(textCodec)
      expect(defaultCodecs[2]).toBe(csvCodec)
      expect(defaultCodecs[3]).toBe(xmlCodec)
    })
  })

  describe('xmlCodec', () => {
    it('has name "xml"', () => {
      expect(xmlCodec.name).toBe('xml')
    })

    it('has correct content types', () => {
      expect(xmlCodec.contentTypes).toContain('application/xml')
      expect(xmlCodec.contentTypes).toContain('text/xml')
    })

    it('encodes a flat object', () => {
      expect(xmlCodec.encode({ name: 'Alice', age: 30 })).toBe(
        '<root><name>Alice</name><age>30</age></root>'
      )
    })

    it('encodes null as a self-closing root', () => {
      expect(xmlCodec.encode(null)).toBe('<root/>')
    })

    it('encodes undefined as a self-closing root', () => {
      expect(xmlCodec.encode(undefined)).toBe('<root/>')
    })

    it('encodes a primitive', () => {
      expect(xmlCodec.encode(42)).toBe('<root>42</root>')
      expect(xmlCodec.encode('hello')).toBe('<root>hello</root>')
    })

    it('encodes an array of objects using repeated <item> elements', () => {
      const xml = xmlCodec.encode([{ id: 1 }, { id: 2 }])
      expect(xml).toBe('<root><item><id>1</id></item><item><id>2</id></item></root>')
    })

    it('encodes a nested array property', () => {
      const xml = xmlCodec.encode({ tags: ['a', 'b'] })
      expect(xml).toBe('<root><tags><item>a</item><item>b</item></tags></root>')
    })

    it('escapes XML-special characters in text content', () => {
      const xml = xmlCodec.encode({ text: '<a> & "b"' })
      expect(xml).toBe('<root><text>&lt;a&gt; &amp; "b"</text></root>')
    })

    it('decodes a flat object', () => {
      expect(xmlCodec.decode('<root><name>Alice</name><age>30</age></root>')).toEqual({
        name: 'Alice',
        age: '30',
      })
    })

    it('decodes a self-closing root as null', () => {
      expect(xmlCodec.decode('<root/>')).toBeNull()
    })

    it('throws when decoding non-XML content', () => {
      expect(() => xmlCodec.decode('{"not":"xml"}')).toThrow(SyntaxError)
      expect(() => xmlCodec.decode('')).toThrow(SyntaxError)
    })

    it('decodes an array of objects', () => {
      const result = xmlCodec.decode('<root><item><id>1</id></item><item><id>2</id></item></root>')
      expect(result).toEqual([{ id: '1' }, { id: '2' }])
    })

    it('decodes a nested array property', () => {
      const result = xmlCodec.decode('<root><tags><item>a</item><item>b</item></tags></root>')
      expect(result).toEqual({ tags: ['a', 'b'] })
    })

    it('unescapes XML entities', () => {
      const result = xmlCodec.decode('<root><text>&lt;a&gt; &amp; b</text></root>')
      expect(result).toEqual({ text: '<a> & b' })
    })

    it('roundtrips nested objects and arrays', () => {
      const data = { users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }], count: 2 }
      const decoded = xmlCodec.decode(xmlCodec.encode(data))
      expect(decoded).toEqual({
        users: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
        count: '2',
      })
    })

    it('ignores the outer tag name when decoding foreign XML', () => {
      const result = xmlCodec.decode('<response><ok>true</ok></response>')
      expect(result).toEqual({ ok: 'true' })
    })
  })

  describe('createToonCodec()', () => {
    it('has name "toon"', () => {
      const codec = createToonCodec({ encode: toonEncode, decode: toonDecode })
      expect(codec.name).toBe('toon')
    })

    it('has default content types', () => {
      const codec = createToonCodec({ encode: toonEncode, decode: toonDecode })
      expect(codec.contentTypes).toContain('application/toon')
      expect(codec.contentTypes).toContain('text/toon')
    })

    it('allows overriding content types', () => {
      const codec = createToonCodec(
        { encode: toonEncode, decode: toonDecode },
        { contentTypes: ['application/vnd.toon'] }
      )
      expect(codec.contentTypes).toEqual(['application/vnd.toon'])
    })

    it('encodes using the injected toon encoder', () => {
      const codec = createToonCodec({ encode: toonEncode, decode: toonDecode })
      expect(codec.encode({ name: 'Alice', age: 30 })).toBe(toonEncode({ name: 'Alice', age: 30 }))
    })

    it('roundtrips through encode/decode', () => {
      const codec = createToonCodec({ encode: toonEncode, decode: toonDecode })
      const data = { users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] }
      expect(codec.decode(codec.encode(data))).toEqual(data)
    })

    it('registers alongside defaults via resolveCodecs()', () => {
      const toonCodec = createToonCodec({ encode: toonEncode, decode: toonDecode })
      const codecs = resolveCodecs([toonCodec])
      expect(codecs).toHaveLength(5)
      expect(selectCodecForAccept('application/toon', codecs, jsonCodec)).toBe(toonCodec)
    })
  })
})
