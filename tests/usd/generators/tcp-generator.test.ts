/**
 * TCP Generator Tests
 *
 * Tests for converting TCP handlers to USD TCP specification (x-usd.tcp).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import {
  generateTcp,
  generateTcpSchemas,
  createTcpServerConfig,
  type LoadedTcpHandler,
  type TcpHandlerDocs,
  type TcpGeneratorContext,
  type TcpGeneratorOptions,
} from '../../../src/docs/generators/tcp-generator.js'
import {
  createZodAdapter,
  registerValidator,
  resetValidation,
} from '../../../src/validation/index.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createTcpHandler(
  name: string,
  port: number,
  overrides: Partial<LoadedTcpHandler['config']> = {}
): LoadedTcpHandler {
  return {
    name,
    filePath: `/tcp/${name}.ts`,
    config: {
      port,
      host: 'localhost',
      ...overrides,
    },
  }
}

function createTcpHandlerWithDocs(
  name: string,
  port: number,
  docs: TcpHandlerDocs
): LoadedTcpHandler {
  return {
    name,
    filePath: `/tcp/${name}.ts`,
    config: {
      port,
      host: 'localhost',
      docs,
    },
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('TCP Generator', () => {
  describe('generateTcp()', () => {
    describe('basic functionality', () => {
      it('should generate empty TCP spec for empty handlers', () => {
        const result = generateTcp({ handlers: [] })

        assert.equal(result.tcp.servers, undefined)
        assert.equal(result.tcp.contentTypes?.default, 'application/octet-stream')
        assert.deepEqual(result.schemas, {})
      })

      it('should generate TCP server from simple handler', () => {
        const handler = createTcpHandler('command-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers)
        assert.ok(result.tcp.servers['CommandServer'])
        assert.equal(result.tcp.servers['CommandServer'].port, 9000)
        assert.equal(result.tcp.servers['CommandServer'].host, 'localhost')
      })

      it('should include default protocol content types', () => {
        const handler = createTcpHandler('command-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.contentTypes?.default, 'application/octet-stream')
      })

      it('should generate multiple TCP servers', () => {
        const handlers = [
          createTcpHandler('command-server', 9000),
          createTcpHandler('data-server', 9001),
          createTcpHandler('admin-server', 9002),
        ]
        const result = generateTcp({ handlers })

        assert.ok(result.tcp.servers)
        assert.equal(Object.keys(result.tcp.servers).length, 3)
        assert.ok(result.tcp.servers['CommandServer'])
        assert.ok(result.tcp.servers['DataServer'])
        assert.ok(result.tcp.servers['AdminServer'])
      })

      it('should use default host if not specified', () => {
        const handler: LoadedTcpHandler = {
          name: 'test-server',
          filePath: '/tcp/test.ts',
          config: { port: 8000 },
        }
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['TestServer'].host, 'localhost')
      })

      it('should use custom default host from options', () => {
        const handler: LoadedTcpHandler = {
          name: 'test-server',
          filePath: '/tcp/test.ts',
          config: { port: 8000 },
        }
        const result = generateTcp(
          { handlers: [handler] },
          { defaultHost: '0.0.0.0' }
        )

        assert.equal(result.tcp.servers!['TestServer'].host, '0.0.0.0')
      })
    })

    describe('docs field support', () => {
      it('should use description from docs', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          description: 'Main command interface for system control',
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(
          result.tcp.servers!['CommandServer'].description,
          'Main command interface for system control'
        )
      })

      it('should use summary as description when description is missing', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          summary: 'Command server',
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(
          result.tcp.servers!['CommandServer'].description,
          'Command server'
        )
      })

      it('should generate default description when docs is missing', () => {
        const handler = createTcpHandler('command-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.equal(
          result.tcp.servers!['CommandServer'].description,
          'TCP server: command-server'
        )
      })

      it('should use tags from docs', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          tags: ['infrastructure', 'internal'],
        })
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['CommandServer'].tags, [
          'infrastructure',
          'internal',
        ])
      })

      it('should extract tags from handler name when docs tags missing', () => {
        const handler = createTcpHandler('infra-command-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['InfraCommandServer'].tags, ['infra'])
      })
    })

    describe('framing configuration', () => {
      it('should use framing from docs', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          framing: {
            type: 'length-prefixed',
            lengthBytes: 4,
            byteOrder: 'big-endian',
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['CommandServer'].framing, {
          type: 'length-prefixed',
          lengthBytes: 4,
          byteOrder: 'big-endian',
        })
      })

      it('should use default framing when not specified', () => {
        const handler = createTcpHandler('command-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['CommandServer'].framing, {
          type: 'length-prefixed',
          lengthBytes: 4,
          byteOrder: 'big-endian',
        })
      })

      it('should use custom default framing from options', () => {
        const handler = createTcpHandler('command-server', 9000)
        const result = generateTcp(
          { handlers: [handler] },
          {
            defaultFraming: {
              type: 'delimiter',
              delimiter: '\n',
            },
          }
        )

        assert.deepEqual(result.tcp.servers!['CommandServer'].framing, {
          type: 'delimiter',
          delimiter: '\n',
        })
      })

      it('should support delimiter framing type', () => {
        const handler = createTcpHandlerWithDocs('line-server', 9000, {
          framing: {
            type: 'delimiter',
            delimiter: '\n',
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['LineServer'].framing!.type, 'delimiter')
        assert.equal(result.tcp.servers!['LineServer'].framing!.delimiter, '\n')
      })

      it('should support fixed framing type', () => {
        const handler = createTcpHandlerWithDocs('fixed-server', 9000, {
          framing: {
            type: 'fixed',
            fixedSize: 1024,
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['FixedServer'].framing!.type, 'fixed')
        assert.equal(result.tcp.servers!['FixedServer'].framing!.fixedSize, 1024)
      })

      it('should support no framing', () => {
        const handler = createTcpHandlerWithDocs('raw-server', 9000, {
          framing: {
            type: 'none',
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['RawServer'].framing!.type, 'none')
      })
    })

    describe('TLS configuration', () => {
      it('should use TLS from docs', () => {
        const handler = createTcpHandlerWithDocs('secure-server', 9000, {
          tls: {
            enabled: true,
            cert: '/certs/server.crt',
            key: '/certs/server.key',
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['SecureServer'].tls, {
          enabled: true,
          cert: '/certs/server.crt',
          key: '/certs/server.key',
        })
      })

      it('should use TLS enabled flag from config', () => {
        const handler = createTcpHandler('secure-server', 9000, { tls: true })
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['SecureServer'].tls, {
          enabled: true,
        })
      })

      it('should support client auth in TLS', () => {
        const handler = createTcpHandlerWithDocs('mtls-server', 9000, {
          tls: {
            enabled: true,
            clientAuth: true,
            ca: '/certs/ca.crt',
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['MtlsServer'].tls!.clientAuth, true)
        assert.equal(result.tcp.servers!['MtlsServer'].tls!.ca, '/certs/ca.crt')
      })
    })

    describe('message schemas', () => {
      beforeEach(() => {
        registerValidator(createZodAdapter(z))
      })

      afterEach(() => {
        resetValidation()
      })

      it('should convert request schema to JSON Schema', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          requestSchema: z.object({
            cmd: z.string(),
            args: z.array(z.string()).optional(),
          }),
        })
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['CommandServer'].messages)
        assert.ok(result.tcp.servers!['CommandServer'].messages!.inbound)
        assert.deepEqual(result.tcp.servers!['CommandServer'].messages!.inbound, {
          contentType: 'application/octet-stream',
          payload: { $ref: '#/components/schemas/CommandServerRequest' },
        })
        assert.ok(result.schemas['CommandServerRequest'])
      })

      it('should convert response schema to JSON Schema', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          responseSchema: z.object({
            success: z.boolean(),
            result: z.any().optional(),
          }),
        })
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['CommandServer'].messages!.outbound)
        assert.deepEqual(result.tcp.servers!['CommandServer'].messages!.outbound, {
          contentType: 'application/octet-stream',
          payload: { $ref: '#/components/schemas/CommandServerResponse' },
        })
        assert.ok(result.schemas['CommandServerResponse'])
      })

      it('should handle both request and response schemas', () => {
        const handler = createTcpHandlerWithDocs('echo-server', 9000, {
          requestSchema: z.string(),
          responseSchema: z.string(),
        })
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['EchoServer'].messages!.inbound)
        assert.ok(result.tcp.servers!['EchoServer'].messages!.outbound)
      })

      it('should apply content type docs to messages', () => {
        const handler = createTcpHandlerWithDocs('csv-server', 9000, {
          contentType: 'text/csv',
          requestSchema: z.object({ row: z.string() }),
          responseSchema: z.object({ ok: z.boolean() }),
        })
        const result = generateTcp({ handlers: [handler] })
        const server = result.tcp.servers!['CsvServer']

        assert.equal(server.contentTypes?.default, 'text/csv')
        assert.equal(server.messages?.inbound?.contentType, 'text/csv')
        assert.equal(server.messages?.outbound?.contentType, 'text/csv')
      })

      it('should not include messages when no schemas provided', () => {
        const handler = createTcpHandler('simple-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['SimpleServer'].messages, undefined)
      })
    })

    describe('lifecycle configuration', () => {
      it('should include lifecycle from docs', () => {
        const handler = createTcpHandlerWithDocs('command-server', 9000, {
          lifecycle: {
            onConnect: 'Client sends auth handshake within 5s',
            onDisconnect: 'Server sends goodbye frame',
            keepAlive: {
              enabled: true,
              intervalMs: 30000,
            },
          },
        })
        const result = generateTcp({ handlers: [handler] })

        assert.deepEqual(result.tcp.servers!['CommandServer'].lifecycle, {
          onConnect: 'Client sends auth handshake within 5s',
          onDisconnect: 'Server sends goodbye frame',
          keepAlive: {
            enabled: true,
            intervalMs: 30000,
          },
        })
      })
    })

    describe('security configuration', () => {
      it('should apply default security from options', () => {
        const handler = createTcpHandler('secure-server', 9000)
        const result = generateTcp(
          { handlers: [handler] },
          { defaultSecurity: [{ bearerAuth: [] }] }
        )

        assert.deepEqual(result.tcp.servers!['SecureServer'].security, [
          { bearerAuth: [] },
        ])
      })

      it('should not include security when not specified', () => {
        const handler = createTcpHandler('public-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.equal(result.tcp.servers!['PublicServer'].security, undefined)
      })
    })

    describe('name sanitization', () => {
      it('should convert kebab-case to PascalCase', () => {
        const handler = createTcpHandler('my-tcp-server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['MyTcpServer'])
      })

      it('should convert snake_case to PascalCase', () => {
        const handler = createTcpHandler('my_tcp_server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['MyTcpServer'])
      })

      it('should convert dot.notation to PascalCase', () => {
        const handler = createTcpHandler('my.tcp.server', 9000)
        const result = generateTcp({ handlers: [handler] })

        assert.ok(result.tcp.servers!['MyTcpServer'])
      })
    })
  })

  describe('generateTcpSchemas()', () => {
    it('should return standard TCP schemas', () => {
      const schemas = generateTcpSchemas()

      assert.ok(schemas.TcpLengthPrefixedFrame)
      assert.ok(schemas.TcpDelimitedFrame)
      assert.ok(schemas.TcpHandshake)
      assert.ok(schemas.TcpHeartbeat)
    })

    it('should have correct TcpLengthPrefixedFrame structure', () => {
      const schemas = generateTcpSchemas()
      const frame = schemas.TcpLengthPrefixedFrame

      assert.equal(frame.type, 'object')
      assert.ok(frame.properties!['length'])
      assert.ok(frame.properties!['payload'])
      assert.deepEqual(frame.required, ['length', 'payload'])
    })

    it('should have correct TcpHandshake structure', () => {
      const schemas = generateTcpSchemas()
      const handshake = schemas.TcpHandshake

      assert.equal(handshake.type, 'object')
      assert.ok(handshake.properties!['version'])
      assert.ok(handshake.properties!['clientId'])
      assert.ok(handshake.properties!['auth'])
      assert.deepEqual(handshake.required, ['version'])
    })
  })

  describe('createTcpServerConfig()', () => {
    it('should create valid LoadedTcpHandler', () => {
      const handler = createTcpServerConfig({
        name: 'command-server',
        port: 9000,
        host: 'localhost',
        description: 'Command interface',
      })

      assert.equal(handler.name, 'command-server')
      assert.equal(handler.config.port, 9000)
      assert.equal(handler.config.host, 'localhost')
      assert.equal(handler.config.docs!.description, 'Command interface')
    })

    it('should include all provided options', () => {
      const handler = createTcpServerConfig({
        name: 'full-server',
        port: 9000,
        description: 'Full featured server',
        framing: {
          type: 'length-prefixed',
          lengthBytes: 4,
          byteOrder: 'big-endian',
        },
        requestSchema: { type: 'object' },
        responseSchema: { type: 'object' },
        tls: true,
        tags: ['production'],
      })

      assert.ok(handler.config.docs!.framing)
      assert.ok(handler.config.docs!.requestSchema)
      assert.ok(handler.config.docs!.responseSchema)
      assert.ok(handler.config.tls)
      assert.deepEqual(handler.config.docs!.tags, ['production'])
    })
  })
})
