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
} from './connect-tunnel.js'

export { createSocks5Proxy } from './socks5.js'
export type { Socks5Options, Socks5ConnectionInfo } from './socks5.js'

export { createTransparentProxy } from './transparent.js'
export type {
  TransparentProxyMode,
  TransparentProxyOptions,
} from './transparent.js'

export type { ProxyAuth, ProxyCredentials, ProxyStats, ProxyServer } from './types.js'

export type { ProxyFilter } from './utils/access-control.js'
