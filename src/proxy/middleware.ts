/**
 * Unified proxy middleware surface.
 *
 * Middleware runs in protocol-specific phases and can mutate the request,
 * response, or target destination before the proxy continues.
 */

export interface ProxyMiddlewareBlock {
  statusCode?: number
  headers?: Record<string, string>
  body?: string | Buffer
  reason?: string
  socks5ReplyCode?: number
}

export interface ProxyMiddlewareTarget {
  host: string
  port: number
  protocol?: string
  path?: string
}

export interface ProxyMiddlewareRequest {
  method: string
  url?: string
  path?: string
  headers: Record<string, string>
  body?: Buffer
  head?: Buffer
}

export interface ProxyMiddlewareResponse {
  statusCode: number
  statusMessage?: string
  headers: Record<string, string>
  body?: Buffer
}

export type ProxyMiddlewareKind =
  | 'http-request'
  | 'http-response'
  | 'mitm-request'
  | 'mitm-response'
  | 'upgrade-request'
  | 'connect'
  | 'socks5-connect'
  | 'socks5-bind'
  | 'socks5-udp-associate'
  | 'transparent'

export interface ProxyMiddlewareContextBase {
  kind: ProxyMiddlewareKind
  proxy:
    | 'http-forward'
    | 'connect-tunnel'
    | 'explicit'
    | 'reverse'
    | 'socks5'
    | 'transparent'
  clientAddress: string
  authUsername?: string | null
  target: ProxyMiddlewareTarget
  blocked?: ProxyMiddlewareBlock
  metadata?: Record<string, unknown>
}

export interface ProxyRequestMiddlewareContext extends ProxyMiddlewareContextBase {
  request: ProxyMiddlewareRequest
  response?: ProxyMiddlewareResponse
}

export interface ProxyConnectionMiddlewareContext extends ProxyMiddlewareContextBase {
  request?: ProxyMiddlewareRequest
  response?: ProxyMiddlewareResponse
}

export type ProxyMiddlewareContext =
  | ProxyRequestMiddlewareContext
  | ProxyConnectionMiddlewareContext

export type ProxyMiddlewareNext = () => Promise<void>
export type ProxyMiddleware = (
  ctx: ProxyMiddlewareContext,
  next: ProxyMiddlewareNext,
) => Promise<void> | void

export async function runProxyMiddleware(
  middleware: readonly ProxyMiddleware[] | undefined,
  ctx: ProxyMiddlewareContext,
): Promise<void> {
  if (!middleware || middleware.length === 0) return
  const stack = middleware

  let index = -1
  async function dispatch(nextIndex: number): Promise<void> {
    if (nextIndex <= index) {
      throw new Error('Proxy middleware called next() multiple times')
    }

    index = nextIndex
    const layer = stack[nextIndex]
    if (!layer) return
    await layer(ctx, () => dispatch(nextIndex + 1))
  }

  await dispatch(0)
}
