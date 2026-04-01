/**
 * Raffel Proxy Module
 *
 * Four proxy types:
 *   - HTTP Forward Proxy (attaches to existing http.Server)
 *   - HTTPS CONNECT Tunnel (forward + MITM modes, attaches to existing http.Server)
 *   - SOCKS5 Proxy (standalone, RFC 1928 + 1929)
 *   - Transparent Proxy (standalone, Linux TPROXY/REDIRECT)
 */

export { createHttpForwardProxy } from './http-forward.js'
export type {
  HttpForwardProxyOptions,
  HttpForwardProxy,
  ForwardProxyRequest,
  ForwardProxyResponse,
  ProxyValidateOptions,
} from './http-forward.js'

export { createConnectTunnel } from './connect-tunnel.js'
export type {
  ConnectMode,
  ConnectTunnelOptions,
  ConnectTunnel,
  TunnelInfo,
  MitmRequest,
  MitmResponse,
  MitmCaptureConfig,
  MitmCaptureState,
  StartMitmCaptureOptions,
  ReplayMitmCaptureOptions,
  ReplayMitmRequest,
  ReplayMitmCaptureResult,
  ReplayMitmCaptureEntryResult,
} from './connect-tunnel.js'

export { createSocks5Proxy } from './socks5.js'
export type { Socks5Options, Socks5ConnectionInfo, Socks5TelemetryOptions, Socks5Proxy } from './socks5.js'

export { createTransparentProxy } from './transparent.js'
export type {
  TransparentProxyMode,
  TransparentOriginalDestination,
  TransparentOriginalDestinationResolverContext,
  TransparentConnectionInfo,
  TransparentProxyOptions,
  TransparentTelemetryOptions,
  TransparentProxy,
} from './transparent.js'

export { createExplicitProxy } from './explicit.js'
export type {
  ExplicitProxyOptions,
  ExplicitProxy,
  ExplicitProxyUpgradeOptions,
  ExplicitProxyTelemetryOptions,
  UpgradeProxyRequest,
  UpgradeConnectionInfo,
} from './explicit.js'

export { createProxySuite } from './suite.js'
export type {
  ProxySuite,
  ProxySuiteOptions,
  ProxySuiteTelemetryOptions,
} from './suite.js'

export { DEFAULT_PROXY_PERCENTILES } from './telemetry.js'
export type {
  ProxyFlowProtocol,
  ProxyGraphNode,
  ProxyGraphEdge,
  ProxyGraphLatency,
  ProxyGraphSnapshot,
} from './telemetry.js'

export type {
  ProxyTelemetryPercentile,
  ProxyNodeResolutionContext,
} from './telemetry-options.js'

export type { ProxyAuth, ProxyCredentials, ProxyStats, ProxyServer } from './types.js'

export type { ProxyFilter } from './utils/access-control.js'

export { createReverseProxy, loadReverseProxyConfig, parseReverseProxyConfig } from './reverse.js'
export type {
  ReverseProxy,
  ReverseProxyConfig,
  ReverseProxyServerConfig,
  ReverseProxyServerTlsConfig,
  ReverseProxyNoMatchConfig,
  ReverseProxyProxyOptions,
  ReverseProxyMatchCriteria,
  ReverseProxyRouteConfig,
} from './reverse.js'
