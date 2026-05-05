/**
 * Raffel Testing Utilities
 *
 * Universal mock servers for local integration and protocol-level tests.
 *
 * Includes quick-start fixtures for:
 * - HTTP (with CORS, global delay, streaming, drop, statistics, waitForRequests)
 * - WebSocket (with pattern-based responses, connection management, statistics)
 * - TCP
 * - UDP
 * - Telnet
 * - WHOIS
 * - FTP
 * - Legacy TCP ping responder
 * - DNS (RFC 1035 over UDP)
 * - SSE (Server-Sent Events over HTTP)
 * - Proxy (forward + MITM intercept)
 *
 * All mocks are lightweight, in-process, and intended for test environments.
 */

import { createMockHttpServer } from './http/index.js'
import {
  createMockFtpServer,
  createMockIcmpServer,
  createMockPingServer,
  createMockTcpServer,
  createMockTelnetServer,
  createMockWhoisServer,
} from './tcp/index.js'
import { createMockUdpServer } from './udp/index.js'
import { createMockWebSocketServer } from './ws/index.js'
import {
  createMockServiceSuiteInternal,
  stopMockServiceSuiteInternal,
} from './service-suite.js'
import type { MockServiceSuite, MockServiceSuiteOptions } from './service-types.js'
import { createMockDnsServer } from './mock-dns-server.js'
import { createMockSSEServer } from './mock-sse-server.js'

/**
 * Shared utilities
 */
function normalizeHost(host?: string): string {
  return host && host.length > 0 ? host : '127.0.0.1'
}

/**
 * Re-exports from new modules
 */
export {
  MockHttpServer,
  createMockHttpServer,
  type MockHttpHandler,
  type MockHttpInterceptor,
  type MockHttpRequest,
  type MockHttpResponse,
  type MockHttpServerOptions,
  type ServerResponse,
} from './http/index.js'

export {
  MockFtpServer,
  MockIcmpServer,
  MockPingServer,
  MockTcpServer,
  MockTelnetServer,
  MockWhoisServer,
  createMockFtpServer,
  createMockIcmpServer,
  createMockPingServer,
  createMockTcpServer,
  createMockTelnetServer,
  createMockWhoisServer,
  type MockFtpServerOptions,
  type MockIcmpServerOptions,
  type MockPingServerOptions,
  type MockTcpLineContext,
  type MockTcpLineHandler,
  type MockTcpServerOptions,
  type MockTelnetServerOptions,
  type MockWhoisOptions,
} from './tcp/index.js'

export {
  MockUdpServer,
  createMockUdpServer,
  type MockUdpHandler,
  type MockUdpMessage,
  type MockUdpServerOptions,
} from './udp/index.js'

export {
  MockWebSocketServer,
  createMockWebSocketServer,
  type MockWebSocketServerOptions,
  type MockWsMessageHandler,
  type MockWsProcedureHandler,
} from './ws/index.js'

export {
  MockDnsServer,
  createMockDnsServer,
  type DnsRecordType,
  type MockDnsServerOptions,
} from './mock-dns-server.js'

export {
  MockSSEServer,
  createMockSSEServer,
  type SSEEvent,
  type MockSSEServerOptions,
} from './mock-sse-server.js'

export {
  MockProxyServer,
  createMockProxyServer,
  createForwardProxy,
  createInterceptProxy,
  type ProxyMode,
  type ProxyRequest,
  type ProxyResponse,
  type MockProxyServerOptions,
} from './mock-proxy-server.js'

export {
  generateCA,
  generateCertificate,
  getDefaultCA,
  type CertificateInfo,
  type CertificateOptions,
} from './proxy-certs.js'

/**
 * Universal testing helpers
 */
export const createMockServiceSuite = (options: MockServiceSuiteOptions = {}): Promise<MockServiceSuite> => {
  return createMockServiceSuiteInternal(options, {
    http: (mockOptions) => createMockHttpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ws: (mockOptions) => createMockWebSocketServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    tcp: (mockOptions) => createMockTcpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    udp: (mockOptions) => createMockUdpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    telnet: (mockOptions) => createMockTelnetServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    whois: (mockOptions) => createMockWhoisServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ftp: (mockOptions) => createMockFtpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    ping: (mockOptions) => createMockPingServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    icmp: (mockOptions) => createMockIcmpServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    dns: (mockOptions) => createMockDnsServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
    sse: (mockOptions) => createMockSSEServer({ host: normalizeHost(mockOptions.host), ...mockOptions }),
  })
}

export const stopMockServiceSuite = stopMockServiceSuiteInternal

export type { MockServiceSuite, MockServiceSuiteOptions } from './service-types.js'

export {
  MockHlsServer,
  createMockHlsServer,
  createMockHlsVod,
  createMockHlsLive,
} from './mock-hls-server.js'
export type { MockHlsServerOptions, MockHlsVariant } from './mock-hls-server.js'

// === Cache Store Contract (slice 5 of architecture-deepening initiative) ===
export { runCacheStoreContract } from './cache-store-contract.js'
export type { CacheStoreFactory } from './cache-store-contract.js'
