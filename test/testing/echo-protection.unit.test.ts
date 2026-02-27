import { describe, expect, it } from 'vitest'

import {
  normalizeMockEchoOptions,
  resolveMockEchoPayload,
  type MockEchoOptions,
} from '../../src/testing/echo-protection.js'

describe('Echo protection utilities', () => {
  it('normalizes implicit boolean config', () => {
    const enabledConfig = normalizeMockEchoOptions(true)
    const disabledConfig = normalizeMockEchoOptions(false)
    const defaultConfig = normalizeMockEchoOptions()
    const objectConfig = normalizeMockEchoOptions({ parser: 'hex' } as MockEchoOptions)

    expect(enabledConfig.enabled).toBe(true)
    expect(enabledConfig.parser).toBe('text')
    expect(disabledConfig.enabled).toBe(false)
    expect(defaultConfig.enabled).toBe(false)
    expect(objectConfig.parser).toBe('hex')
  })

  it('returns raw payload when echo is disabled', () => {
    const resolved = resolveMockEchoPayload('raw-payload', false)
    expect(resolved.body).toBe('raw-payload')
    expect(resolved.contentType).toBe('text/plain')
  })

  it('strips dangerous control characters in text mode', () => {
    const resolved = resolveMockEchoPayload('ok\u0000\nhello', {
      enabled: true,
      parser: 'text',
      stripControlChars: true,
      stripNullByte: true,
    })

    expect(resolved.body).toBe('ok\nhello')
    expect(resolved.contentType).toBe('text/plain')
  })

  it('parses and sanitizes JSON while blocking prototype keys', () => {
    const resolved = resolveMockEchoPayload('{"good":{"nested":[1,2]},"__proto__":{"evil":"nope"}}', {
      enabled: true,
      parser: 'json',
      maxObjectKeys: 4,
    })

    const parsed = JSON.parse(resolved.body)

    expect(parsed).toEqual({ good: { nested: [1, 2] } })
    expect(resolved.contentType).toBe('application/json')
  })

  it('can allow prototype keys explicitly', () => {
    const resolved = resolveMockEchoPayload('{"constructor":{"version":"allowed"}}', {
      enabled: true,
      parser: 'json',
      allowPrototypeKeys: true,
    })

    const parsed = JSON.parse(resolved.body) as Record<string, unknown>
    expect(parsed).toHaveProperty('constructor')
    expect(parsed.constructor).toEqual({ version: 'allowed' })
  })

  it('rejects invalid JSON payloads', () => {
    expect(() => {
      resolveMockEchoPayload('{bad-json', { enabled: true, parser: 'json' })
    }).toThrowError(/Invalid JSON/)
  })

  it('limits payload size', () => {
    expect(() => {
      resolveMockEchoPayload('toolong-payload', {
        enabled: true,
        parser: 'text',
        maxPayloadBytes: 1,
      })
    }).toThrowError(/exceeds maximum/)
  })

  it('parses URL-encoded payload safely', () => {
    const resolved = resolveMockEchoPayload('name=alice&role=admin', {
      enabled: true,
      parser: 'urlencoded',
    })

    expect(resolved.body).toBe('{"name":"alice","role":"admin"}')
    expect(resolved.contentType).toBe('application/json')
  })

  it('decodes base64 and hex payloads', () => {
    const base64 = resolveMockEchoPayload(Buffer.from('ok').toString('base64'), {
      enabled: true,
      parser: 'base64',
    })
    const hex = resolveMockEchoPayload(Buffer.from('ok').toString('hex'), {
      enabled: true,
      parser: 'hex',
    })

    expect(base64.body).toBe('ok')
    expect(hex.body).toBe('ok')
    expect(base64.contentType).toBe('text/plain')
    expect(hex.contentType).toBe('text/plain')
  })

  it('rejects invalid hex and base64 payloads', () => {
    expect(() => {
      resolveMockEchoPayload('not-hex', { enabled: true, parser: 'hex' })
    }).toThrowError(/Invalid hex/)
    expect(() => {
      resolveMockEchoPayload('bad base64', { enabled: true, parser: 'base64' })
    }).toThrowError(/Invalid base64/)
  })
})
