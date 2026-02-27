import type {
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
} from './index.js'

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
}
