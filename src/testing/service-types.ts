import type {
  MockHttpServer,
  MockHttpServerOptions,
} from './http/index.js'
import type {
  MockFtpServer,
  MockFtpServerOptions,
  MockIcmpServer,
  MockIcmpServerOptions,
  MockPingServer,
  MockPingServerOptions,
  MockTcpServer,
  MockTcpServerOptions,
  MockTelnetServer,
  MockTelnetServerOptions,
  MockWhoisOptions,
  MockWhoisServer,
} from './tcp/index.js'
import type {
  MockUdpServer,
  MockUdpServerOptions,
} from './udp/index.js'
import type {
  MockWebSocketServer,
  MockWebSocketServerOptions,
} from './ws/index.js'

import type { MockDnsServer, MockDnsServerOptions } from './mock-dns-server.js'
import type { MockSSEServer, MockSSEServerOptions } from './mock-sse-server.js'

export type {
  MockHttpServer,
  MockHttpServerOptions,
  MockTcpServer,
  MockTcpServerOptions,
  MockWebSocketServer,
  MockWebSocketServerOptions,
  MockWhoisOptions,
  MockWhoisServer,
  MockFtpServer,
  MockFtpServerOptions,
  MockTelnetServer,
  MockTelnetServerOptions,
  MockUdpServer,
  MockUdpServerOptions,
  MockPingServer,
  MockPingServerOptions,
  MockIcmpServer,
  MockIcmpServerOptions,
  MockDnsServer,
  MockDnsServerOptions,
  MockSSEServer,
  MockSSEServerOptions,
}

export interface MockServiceSuite {
  http: MockHttpServer
  ws: MockWebSocketServer
  tcp: MockTcpServer
  udp: MockUdpServer
  telnet: MockTelnetServer
  whois: MockWhoisServer
  ftp: MockFtpServer
  ping: MockPingServer
  icmp: MockIcmpServer
  dns: MockDnsServer
  sse: MockSSEServer
}

export interface MockServiceSuiteOptions {
  host?: string
  http?: MockHttpServerOptions
  ws?: MockWebSocketServerOptions
  tcp?: MockTcpServerOptions
  udp?: MockUdpServerOptions
  telnet?: MockTelnetServerOptions
  whois?: MockWhoisOptions
  ftp?: MockFtpServerOptions
  ping?: MockPingServerOptions
  icmp?: MockIcmpServerOptions
  dns?: MockDnsServerOptions
  sse?: MockSSEServerOptions
}
