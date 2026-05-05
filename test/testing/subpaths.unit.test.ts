import { describe, expect, it } from 'vitest'
import { createMockHttpServer } from '../../src/testing/http/index.js'
import { createMockTcpServer } from '../../src/testing/tcp/index.js'
import { createMockUdpServer } from '../../src/testing/udp/index.js'
import { createMockWebSocketServer } from '../../src/testing/ws/index.js'
import { createMockSSEServer } from '../../src/testing/sse/index.js'
import { createMockDnsServer } from '../../src/testing/dns/index.js'
import { createMockProxyServer } from '../../src/testing/proxy/index.js'
import { createMockServiceSuite } from '../../src/testing/suite/index.js'

describe('testing subpath modules', () => {
  it('exposes transport factories from protocol-specific modules', () => {
    expect(createMockHttpServer).toBeTypeOf('function')
    expect(createMockTcpServer).toBeTypeOf('function')
    expect(createMockUdpServer).toBeTypeOf('function')
    expect(createMockWebSocketServer).toBeTypeOf('function')
    expect(createMockSSEServer).toBeTypeOf('function')
    expect(createMockDnsServer).toBeTypeOf('function')
    expect(createMockProxyServer).toBeTypeOf('function')
    expect(createMockServiceSuite).toBeTypeOf('function')
  })
})
