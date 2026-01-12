/**
 * UDP Generator Tests
 *
 * Tests for converting UDP handlers to USD UDP specification (x-usd.udp).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import {
  generateUdp,
  generateUdpSchemas,
  createUdpEndpointConfig,
  type LoadedUdpHandler,
  type UdpHandlerDocs,
  type UdpGeneratorContext,
  type UdpGeneratorOptions,
} from '../../../src/docs/generators/udp-generator.js'
import {
  createZodAdapter,
  registerValidator,
  resetValidation,
} from '../../../src/validation/index.js'

// =============================================================================
// Test Helpers
// =============================================================================

function createUdpHandler(
  name: string,
  port: number,
  overrides: Partial<LoadedUdpHandler['config']> = {}
): LoadedUdpHandler {
  return {
    name,
    filePath: `/udp/${name}.ts`,
    config: {
      port,
      host: '0.0.0.0',
      ...overrides,
    },
  }
}

function createUdpHandlerWithDocs(
  name: string,
  port: number,
  docs: UdpHandlerDocs
): LoadedUdpHandler {
  return {
    name,
    filePath: `/udp/${name}.ts`,
    config: {
      port,
      host: '0.0.0.0',
      docs,
    },
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('UDP Generator', () => {
  describe('generateUdp()', () => {
    describe('basic functionality', () => {
      it('should generate empty UDP spec for empty handlers', () => {
        const result = generateUdp({ handlers: [] })

        assert.equal(result.udp.endpoints, undefined)
        assert.equal(result.udp.contentTypes?.default, 'application/octet-stream')
        assert.deepEqual(result.schemas, {})
      })

      it('should generate UDP endpoint from simple handler', () => {
        const handler = createUdpHandler('metrics-collector', 8125)
        const result = generateUdp({ handlers: [handler] })

        assert.ok(result.udp.endpoints)
        assert.ok(result.udp.endpoints['MetricsCollector'])
        assert.equal(result.udp.endpoints['MetricsCollector'].port, 8125)
        assert.equal(result.udp.endpoints['MetricsCollector'].host, '0.0.0.0')
      })

      it('should include default protocol content types', () => {
        const handler = createUdpHandler('metrics-collector', 8125)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.contentTypes?.default, 'application/octet-stream')
      })

      it('should generate multiple UDP endpoints', () => {
        const handlers = [
          createUdpHandler('metrics-collector', 8125),
          createUdpHandler('syslog-receiver', 514),
          createUdpHandler('discovery-beacon', 5353),
        ]
        const result = generateUdp({ handlers })

        assert.ok(result.udp.endpoints)
        assert.equal(Object.keys(result.udp.endpoints).length, 3)
        assert.ok(result.udp.endpoints['MetricsCollector'])
        assert.ok(result.udp.endpoints['SyslogReceiver'])
        assert.ok(result.udp.endpoints['DiscoveryBeacon'])
      })

      it('should use default host if not specified', () => {
        const handler: LoadedUdpHandler = {
          name: 'test-endpoint',
          filePath: '/udp/test.ts',
          config: { port: 8000 },
        }
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['TestEndpoint'].host, '0.0.0.0')
      })

      it('should use custom default host from options', () => {
        const handler: LoadedUdpHandler = {
          name: 'test-endpoint',
          filePath: '/udp/test.ts',
          config: { port: 8000 },
        }
        const result = generateUdp(
          { handlers: [handler] },
          { defaultHost: 'localhost' }
        )

        assert.equal(result.udp.endpoints!['TestEndpoint'].host, 'localhost')
      })
    })

    describe('docs field support', () => {
      it('should use description from docs', () => {
        const handler = createUdpHandlerWithDocs('metrics-collector', 8125, {
          description: 'StatsD-compatible metrics receiver',
        })
        const result = generateUdp({ handlers: [handler] })

        assert.equal(
          result.udp.endpoints!['MetricsCollector'].description,
          'StatsD-compatible metrics receiver'
        )
      })

      it('should use summary as description when description is missing', () => {
        const handler = createUdpHandlerWithDocs('metrics-collector', 8125, {
          summary: 'Metrics receiver',
        })
        const result = generateUdp({ handlers: [handler] })

        assert.equal(
          result.udp.endpoints!['MetricsCollector'].description,
          'Metrics receiver'
        )
      })

      it('should generate default description when docs is missing', () => {
        const handler = createUdpHandler('metrics-collector', 8125)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(
          result.udp.endpoints!['MetricsCollector'].description,
          'UDP endpoint: metrics-collector'
        )
      })

      it('should use tags from docs', () => {
        const handler = createUdpHandlerWithDocs('metrics-collector', 8125, {
          tags: ['monitoring', 'metrics'],
        })
        const result = generateUdp({ handlers: [handler] })

        assert.deepEqual(result.udp.endpoints!['MetricsCollector'].tags, [
          'monitoring',
          'metrics',
        ])
      })

      it('should extract tags from handler name when docs tags missing', () => {
        const handler = createUdpHandler('monitoring-metrics-collector', 8125)
        const result = generateUdp({ handlers: [handler] })

        assert.deepEqual(result.udp.endpoints!['MonitoringMetricsCollector'].tags, [
          'monitoring',
        ])
      })
    })

    describe('max packet size', () => {
      it('should use maxPacketSize from docs', () => {
        const handler = createUdpHandlerWithDocs('large-packet', 9000, {
          maxPacketSize: 32768,
        })
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['LargePacket'].maxPacketSize, 32768)
      })

      it('should use default maxPacketSize when not specified', () => {
        const handler = createUdpHandler('default-packet', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['DefaultPacket'].maxPacketSize, 65507)
      })

      it('should use custom default maxPacketSize from options', () => {
        const handler = createUdpHandler('custom-packet', 9000)
        const result = generateUdp(
          { handlers: [handler] },
          { defaultMaxPacketSize: 4096 }
        )

        assert.equal(result.udp.endpoints!['CustomPacket'].maxPacketSize, 4096)
      })
    })

    describe('multicast configuration', () => {
      it('should include multicast config from docs', () => {
        const handler = createUdpHandlerWithDocs('discovery-beacon', 5353, {
          multicast: {
            enabled: true,
            group: '224.0.0.251',
            ttl: 255,
          },
        })
        const result = generateUdp({ handlers: [handler] })

        assert.deepEqual(result.udp.endpoints!['DiscoveryBeacon'].multicast, {
          enabled: true,
          group: '224.0.0.251',
          ttl: 255,
        })
      })

      it('should support disabled multicast', () => {
        const handler = createUdpHandlerWithDocs('unicast-endpoint', 9000, {
          multicast: {
            enabled: false,
          },
        })
        const result = generateUdp({ handlers: [handler] })

        assert.deepEqual(result.udp.endpoints!['UnicastEndpoint'].multicast, {
          enabled: false,
        })
      })

      it('should not include multicast when not specified', () => {
        const handler = createUdpHandler('simple-endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['SimpleEndpoint'].multicast, undefined)
      })
    })

    describe('reliability configuration', () => {
      it('should include reliability config from docs', () => {
        const handler = createUdpHandlerWithDocs('reliable-endpoint', 9000, {
          reliability: {
            checksumValidation: true,
            duplicateDetection: true,
          },
        })
        const result = generateUdp({ handlers: [handler] })

        assert.deepEqual(result.udp.endpoints!['ReliableEndpoint'].reliability, {
          checksumValidation: true,
          duplicateDetection: true,
        })
      })

      it('should support partial reliability config', () => {
        const handler = createUdpHandlerWithDocs('checksum-only', 9000, {
          reliability: {
            checksumValidation: true,
          },
        })
        const result = generateUdp({ handlers: [handler] })

        assert.equal(
          result.udp.endpoints!['ChecksumOnly'].reliability!.checksumValidation,
          true
        )
        assert.equal(
          result.udp.endpoints!['ChecksumOnly'].reliability!.duplicateDetection,
          undefined
        )
      })
    })

    describe('message schemas', () => {
      beforeEach(() => {
        registerValidator(createZodAdapter(z))
      })

      afterEach(() => {
        resetValidation()
      })

      it('should convert message schema to JSON Schema', () => {
        const handler = createUdpHandlerWithDocs('metrics-collector', 8125, {
          messageSchema: z.object({
            metric: z.string(),
            value: z.number(),
            type: z.enum(['counter', 'gauge', 'timer']),
          }),
        })
        const result = generateUdp({ handlers: [handler] })

        assert.ok(result.udp.endpoints!['MetricsCollector'].message)
        assert.deepEqual(result.udp.endpoints!['MetricsCollector'].message, {
          contentType: 'application/octet-stream',
          payload: { $ref: '#/components/schemas/MetricsCollectorMessage' },
        })
        assert.ok(result.schemas['MetricsCollectorMessage'])
      })

      it('should apply content type docs to messages', () => {
        const handler = createUdpHandlerWithDocs('csv-metrics', 8125, {
          contentType: 'text/csv',
          messageSchema: z.object({ row: z.string() }),
        })
        const result = generateUdp({ handlers: [handler] })
        const endpoint = result.udp.endpoints!['CsvMetrics']

        assert.equal(endpoint.contentTypes?.default, 'text/csv')
        assert.equal(endpoint.message?.contentType, 'text/csv')
      })

      it('should not include message when no schema provided', () => {
        const handler = createUdpHandler('simple-endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['SimpleEndpoint'].message, undefined)
      })

      it('should include inbound and outbound messages when provided', () => {
        const handler = createUdpHandlerWithDocs('metrics-collector', 8125, {
          inboundSchema: z.object({ metric: z.string() }),
          outboundSchema: z.object({ status: z.string() }),
        })
        const result = generateUdp({ handlers: [handler] })

        const endpoint = result.udp.endpoints!['MetricsCollector']
        assert.ok(endpoint.messages?.inbound)
        assert.ok(endpoint.messages?.outbound)
        assert.ok(result.schemas.MetricsCollectorInbound)
        assert.ok(result.schemas.MetricsCollectorOutbound)
      })
    })

    describe('security configuration', () => {
      it('should apply default security from options', () => {
        const handler = createUdpHandler('secure-endpoint', 9000)
        const result = generateUdp(
          { handlers: [handler] },
          { defaultSecurity: [{ apiKey: [] }] }
        )

        assert.deepEqual(result.udp.endpoints!['SecureEndpoint'].security, [
          { apiKey: [] },
        ])
      })

      it('should not include security when not specified', () => {
        const handler = createUdpHandler('public-endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.equal(result.udp.endpoints!['PublicEndpoint'].security, undefined)
      })
    })

    describe('name sanitization', () => {
      it('should convert kebab-case to PascalCase', () => {
        const handler = createUdpHandler('my-udp-endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.ok(result.udp.endpoints!['MyUdpEndpoint'])
      })

      it('should convert snake_case to PascalCase', () => {
        const handler = createUdpHandler('my_udp_endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.ok(result.udp.endpoints!['MyUdpEndpoint'])
      })

      it('should convert dot.notation to PascalCase', () => {
        const handler = createUdpHandler('my.udp.endpoint', 9000)
        const result = generateUdp({ handlers: [handler] })

        assert.ok(result.udp.endpoints!['MyUdpEndpoint'])
      })
    })
  })

  describe('generateUdpSchemas()', () => {
    it('should return standard UDP schemas', () => {
      const schemas = generateUdpSchemas()

      assert.ok(schemas.UdpDatagram)
      assert.ok(schemas.StatsDMetric)
      assert.ok(schemas.SyslogMessage)
      assert.ok(schemas.DnsQuery)
      assert.ok(schemas.DiscoveryBeacon)
    })

    it('should have correct StatsDMetric structure', () => {
      const schemas = generateUdpSchemas()
      const metric = schemas.StatsDMetric

      assert.equal(metric.type, 'object')
      assert.ok(metric.properties!['metric'])
      assert.ok(metric.properties!['value'])
      assert.ok(metric.properties!['type'])
      assert.deepEqual(metric.required, ['metric', 'value', 'type'])
    })

    it('should have correct SyslogMessage structure', () => {
      const schemas = generateUdpSchemas()
      const syslog = schemas.SyslogMessage

      assert.equal(syslog.type, 'object')
      assert.ok(syslog.properties!['facility'])
      assert.ok(syslog.properties!['severity'])
      assert.ok(syslog.properties!['message'])
      assert.deepEqual(syslog.required, ['facility', 'severity', 'message'])
    })

    it('should have correct DiscoveryBeacon structure', () => {
      const schemas = generateUdpSchemas()
      const beacon = schemas.DiscoveryBeacon

      assert.equal(beacon.type, 'object')
      assert.ok(beacon.properties!['serviceId'])
      assert.ok(beacon.properties!['serviceName'])
      assert.ok(beacon.properties!['address'])
      assert.ok(beacon.properties!['port'])
      assert.deepEqual(beacon.required, ['serviceId', 'serviceName', 'address', 'port'])
    })
  })

  describe('createUdpEndpointConfig()', () => {
    it('should create valid LoadedUdpHandler', () => {
      const handler = createUdpEndpointConfig({
        name: 'metrics-collector',
        port: 8125,
        host: '0.0.0.0',
        description: 'StatsD metrics receiver',
      })

      assert.equal(handler.name, 'metrics-collector')
      assert.equal(handler.config.port, 8125)
      assert.equal(handler.config.host, '0.0.0.0')
      assert.equal(handler.config.docs!.description, 'StatsD metrics receiver')
    })

    it('should include all provided options', () => {
      const handler = createUdpEndpointConfig({
        name: 'full-endpoint',
        port: 9000,
        description: 'Full featured endpoint',
        messageSchema: { type: 'object' },
        maxPacketSize: 32768,
        multicast: {
          enabled: true,
          group: '224.0.0.1',
          ttl: 64,
        },
        reliability: {
          checksumValidation: true,
          duplicateDetection: false,
        },
        tags: ['production'],
      })

      assert.ok(handler.config.docs!.messageSchema)
      assert.equal(handler.config.docs!.maxPacketSize, 32768)
      assert.ok(handler.config.docs!.multicast)
      assert.ok(handler.config.docs!.reliability)
      assert.deepEqual(handler.config.docs!.tags, ['production'])
    })
  })
})
