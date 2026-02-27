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
} from './service-types.js'

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

interface MockServiceSuiteFactories {
  http: (options: MockHttpServerOptions) => Promise<MockHttpServer>
  ws: (options: MockWebSocketServerOptions) => Promise<MockWebSocketServer>
  tcp: (options: MockTcpServerOptions) => Promise<MockTcpServer>
  udp: (options: MockUdpServerOptions) => Promise<MockUdpServer>
  telnet: (options: MockTelnetServerOptions) => Promise<MockTelnetServer>
  whois: (options: MockWhoisOptions) => Promise<MockWhoisServer>
  ftp: (options: MockFtpServerOptions) => Promise<MockFtpServer>
  ping: (options: MockPingServerOptions) => Promise<MockPingServer>
  icmp: (options: MockIcmpServerOptions) => Promise<MockIcmpServer>
}

function normalizeHost(host?: string): string {
  return host && host.length > 0 ? host : '127.0.0.1'
}

export async function createMockServiceSuiteInternal(
  options: MockServiceSuiteOptions = {},
  factories: MockServiceSuiteFactories
): Promise<MockServiceSuite> {
  const host = normalizeHost(options.host)
  const created: Array<{ stop: () => Promise<void> }> = []
  const started: Partial<MockServiceSuite> = {}
  const creators: Array<{
    key: keyof MockServiceSuite
    run: () => Promise<MockServiceSuite[keyof MockServiceSuite]>
  }> = [
    {
      key: 'http',
      run: () => factories.http({ host, port: options.http?.port ?? 0, ...(options.http ?? {}) }),
    },
    {
      key: 'ws',
      run: () => factories.ws({ host, port: options.ws?.port ?? 0, ...(options.ws ?? {}) }),
    },
    {
      key: 'tcp',
      run: () => factories.tcp({ host, port: options.tcp?.port ?? 0, ...(options.tcp ?? {}) }),
    },
    {
      key: 'udp',
      run: () => factories.udp({ host, port: options.udp?.port ?? 0, ...(options.udp ?? {}) }),
    },
    {
      key: 'telnet',
      run: () => factories.telnet({ host, port: options.telnet?.port ?? 0, ...(options.telnet ?? {}) }),
    },
    {
      key: 'whois',
      run: () => factories.whois({ host, port: options.whois?.port ?? 0, ...(options.whois ?? {}) }),
    },
    {
      key: 'ftp',
      run: () => factories.ftp({ host, port: options.ftp?.port ?? 0, ...(options.ftp ?? {}) }),
    },
    {
      key: 'ping',
      run: () => factories.ping({ host, port: options.ping?.port ?? 0, ...(options.ping ?? {}) }),
    },
    {
      key: 'icmp',
      run: () => factories.icmp({ host, port: options.icmp?.port ?? 0, ...(options.icmp ?? {}) }),
    },
  ]

  try {
    for (const { key, run } of creators) {
      const server = await run()
      created.push(server)
      ;(started as Record<string, unknown>)[key] = server
    }
  } catch (error) {
    await Promise.all(created.map((server) => server.stop()))
    throw error
  }

  return started as MockServiceSuite
}

export async function stopMockServiceSuiteInternal(suite: MockServiceSuite): Promise<void> {
  await Promise.all([
    suite.http.stop(),
    suite.ws.stop(),
    suite.tcp.stop(),
    suite.udp.stop(),
    suite.telnet.stop(),
    suite.whois.stop(),
    suite.ftp.stop(),
    suite.ping.stop(),
    suite.icmp.stop(),
  ])
}
