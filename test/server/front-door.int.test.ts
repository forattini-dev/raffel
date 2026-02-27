/**
 * Front-door bootstrap behavior tests
 */

import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createFrontDoorBootstrap, normalizeFrontDoorProtocol } from '../../src/server/front-door.js'

function createLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }
}

function createRequest(input: { url: string; upgrade?: string; host?: string; method?: string }): IncomingMessage {
  return {
    url: input.url,
    method: input.method,
    headers: {
      host: input.host ?? '127.0.0.1:3000',
      ...(input.upgrade ? { upgrade: input.upgrade } : {}),
    },
  } as unknown as IncomingMessage
}

function createResponse() {
  let body: string | undefined
  const headers: Record<string, string> = {}
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    setHeader: vi.fn((key: string, value: unknown) => {
      headers[key] = String(value)
    }),
    end: vi.fn((chunk?: unknown) => {
      if (typeof chunk === 'string') {
        body = chunk
      } else if (chunk instanceof Uint8Array) {
        body = new TextDecoder().decode(chunk)
      }
    }),
  } as unknown as ServerResponse

  return { response, headers, getBody: () => body }
}

function createProtocols() {
  return {
    websocket: {
      enabled: true,
      options: { path: '/ws' },
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    jsonrpc: {
      enabled: true,
      options: { path: '/rpc' },
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
    graphql: {
      enabled: true,
      options: { path: '/graphql' },
      shared: true,
      frontDoor: true,
      strategy: 'shared' as const,
    },
  } as const
}

describe('front-door bootstrap', () => {
  it('normalizes standard alias mode by default', () => {
    expect(normalizeFrontDoorProtocol('rpc')).toBe('jsonrpc')
    expect(normalizeFrontDoorProtocol('jrpc')).toBe('jsonrpc')
    expect(normalizeFrontDoorProtocol('grpc')).toBe('grpc')
    expect(normalizeFrontDoorProtocol('https')).toBe('http')
    expect(normalizeFrontDoorProtocol('icmp')).toBe('icmp')
    expect(normalizeFrontDoorProtocol('ping')).toBe('ping')
    expect(normalizeFrontDoorProtocol('ftp')).toBe('ftp')
    expect(normalizeFrontDoorProtocol('whois')).toBe('whois')
    expect(normalizeFrontDoorProtocol('telnet')).toBe('telnet')
    expect(normalizeFrontDoorProtocol('invalid-protocol')).toBe('invalid-protocol')
  })

  it('normalizes extended alias mode on demand', () => {
    expect(normalizeFrontDoorProtocol('icmp', 'extended')).toBe('http')
    expect(normalizeFrontDoorProtocol('ping', 'extended')).toBe('http')
    expect(normalizeFrontDoorProtocol('ftp', 'extended')).toBe('tcp')
    expect(normalizeFrontDoorProtocol('whois', 'extended')).toBe('tcp')
    expect(normalizeFrontDoorProtocol('telnet', 'extended')).toBe('tcp')
  })

  it('returns null middleware when front-door is disabled', () => {
    const bootstrap = createFrontDoorBootstrap({
      frontDoorEnabled: false,
      frontDoorProtocols: ['http'],
      protocols: createProtocols() as any,
      basePath: '/',
      effectiveHost: '127.0.0.1',
      effectivePort: 3000,
    })

    expect(bootstrap.createDecisionMiddleware(createLogger())).toBeNull()
  })

  it('routes websocket upgrade to shared websocket when path matches', async () => {
    const bootstrap = createFrontDoorBootstrap({
      frontDoorEnabled: true,
      frontDoorProtocols: ['websocket'],
      protocols: createProtocols() as any,
      basePath: '/',
      effectiveHost: '127.0.0.1',
      effectivePort: 3000,
    })

    const middleware = bootstrap.createDecisionMiddleware(createLogger())
    expect(middleware).toBeInstanceOf(Function)

    const req = createRequest({ url: '/ws', method: 'GET', upgrade: 'websocket', host: '127.0.0.1:3000' })
    const { response, getBody } = createResponse()
    const blocked = await middleware!(req, response)

    expect(blocked).toBe(false)
    expect(response.statusCode).toBeUndefined()
    expect(getBody()).toBeUndefined()
  })

  it('rejects websocket upgrade when upgrade path mismatches policy', async () => {
    const bootstrap = createFrontDoorBootstrap({
      frontDoorEnabled: true,
      frontDoorProtocols: ['websocket'],
      protocols: createProtocols() as any,
      basePath: '/',
      effectiveHost: '127.0.0.1',
      effectivePort: 3000,
    })

    const middleware = bootstrap.createDecisionMiddleware(createLogger())
    expect(middleware).toBeInstanceOf(Function)

    const req = createRequest({ url: '/wrong', method: 'GET', upgrade: 'websocket', host: '127.0.0.1:3000' })
    const { response, getBody } = createResponse()
    const blocked = await middleware!(req, response)

    expect(blocked).toBe(true)
    expect(response.statusCode).toBe(400)
    const body = getBody() ?? ''
    expect(body).toContain('UNSUPPORTED_PROTOCOL')
    expect(body).toContain('WebSocket path mismatch')
  })

  it('routes websocket upgrade to shared websocket when basePath is configured', async () => {
    const bootstrap = createFrontDoorBootstrap({
      frontDoorEnabled: true,
      frontDoorProtocols: ['websocket'],
      protocols: {
        ...createProtocols(),
        websocket: {
          enabled: true,
          frontDoor: true,
          shared: true,
          strategy: 'shared',
          options: { path: '/ws' },
        },
      } as any,
      basePath: '/docs',
      effectiveHost: '127.0.0.1',
      effectivePort: 3000,
    })

    const middleware = bootstrap.createDecisionMiddleware(createLogger())
    expect(middleware).toBeInstanceOf(Function)

    const req = createRequest({ url: '/docs/ws', method: 'GET', upgrade: 'websocket', host: '127.0.0.1:3000' })
    const { response, getBody } = createResponse()
    const blocked = await middleware!(req, response)

    expect(blocked).toBe(false)
    expect(response.statusCode).toBeUndefined()
    expect(getBody()).toBeUndefined()
  })
})
