/**
 * SOCKS5 Proxy (RFC 1928 + RFC 1929)
 *
 * Standalone net.Server. Supports:
 *   - No authentication
 *   - Username/password authentication (RFC 1929)
 *   - CONNECT, BIND, and UDP ASSOCIATE
 *   - IPv4 (ATYP 0x01), hostname/SOCKS5h (ATYP 0x03), IPv6 (ATYP 0x04)
 *
 * Usage:
 *   const proxy = createSocks5Proxy({ port: 1080 })
 *   await proxy.start()
 */
import { lookup } from 'node:dns/promises'
import { createSocket, type RemoteInfo } from 'node:dgram'
import { createServer, connect as netConnect, isIP, type Socket, type Server as NetServer } from 'node:net'
import type { MetricRegistry } from '../metrics/types.js'
import {
  createOrReuseProxyTelemetry,
  resolveNodeName,
  type ProxyTelemetryOptionsBase,
} from './telemetry-options.js'
import type { ProxyFlowHandle, ProxyFlowProtocol, ProxyGraphSnapshot } from './telemetry.js'
import type { ProxyAuth, ProxyServer, ProxyStats } from './types.js'
import { verifyProxyAuth, createProxyStats } from './utils/auth.js'
import { pipeBidirectional } from './utils/pipe.js'
import type { ProxyFilter } from './utils/access-control.js'
import { checkProxyFilter } from './utils/access-control.js'
import {
  runProxyMiddleware,
  type ProxyMiddleware,
  type ProxyMiddlewareContext,
} from './middleware.js'
import { gracefulShutdown } from '../utils/graceful-shutdown.js'
import {
  REP_ATYP_NOT_SUPPORTED,
  REP_CMD_NOT_SUPPORTED,
  REP_GENERAL_FAILURE,
  REP_RULESET_DENIED,
  REP_SUCCESS,
  buildSocks5UdpPacket,
  formatRemoteKey,
  isWildcardHost,
  mapUpstreamError,
  normalizeReplyHost,
  parseSocks5Request,
  parseSocks5UdpPacket,
  socks5Reply,
} from './socks5-codec.js'

export type Socks5Command = 'connect' | 'bind' | 'udpAssociate'

export interface Socks5ConnectionInfo {
  host: string
  port: number
  clientAddress: string
  atype: 'ipv4' | 'ipv6' | 'hostname'
  command?: Socks5Command
}

export interface Socks5Options {
  port: number
  host?: string
  auth?: ProxyAuth
  /** Upstream connection timeout in ms. Default: 10_000 */
  connectTimeout?: number
  /** Max concurrent connections. 0 = unlimited. Default: 0 */
  maxConnections?: number
  /** Access control filter — allowlist/blocklist by host, TLD, port, or custom check */
  filter?: ProxyFilter
  /** Unified proxy middleware for CONNECT/BIND/UDP ASSOCIATE flows. */
  middleware?: ProxyMiddleware[]
  onConnect?: (info: Socks5ConnectionInfo) => void
  onDisconnect?: (info: Socks5ConnectionInfo & { reason: string }) => void
  telemetry?: Socks5TelemetryOptions
}

export interface Socks5TelemetryOptions extends ProxyTelemetryOptionsBase {}

export interface Socks5Proxy extends ProxyServer {
  readonly metricsRegistry: MetricRegistry | null
  graphSnapshot(): ProxyGraphSnapshot
}

type Socks5Step = 'auth_selection' | 'userpass' | 'request' | 'done'

interface FlowTracker {
  protocol: ProxyFlowProtocol
  handle: ProxyFlowHandle | null
  startedAt: number
  method: string
  addBytesFromSource(delta: number): void
  addBytesToSource(delta: number): void
  finish(error?: string): void
}

interface UdpFlowState {
  tracker: FlowTracker
  remoteKeys: Set<string>
}

function flowProtocolFor(command: Socks5Command, atype: Socks5ConnectionInfo['atype']): ProxyFlowProtocol {
  const hostname = atype === 'hostname'
  if (command === 'connect') return hostname ? 'socks5h' : 'socks5'
  if (command === 'bind') return hostname ? 'socks5h-bind' : 'socks5-bind'
  return hostname ? 'socks5h-udp' : 'socks5-udp'
}

function handleSocks5Connection(
  socket: Socket,
  options: Socks5Options,
  mutable: ReturnType<typeof createProxyStats>['mutable'],
): void {
  const {
    auth,
    connectTimeout = 10_000,
    filter,
    middleware,
    onConnect,
    onDisconnect,
    telemetry,
    host: proxyHost,
  } = options

  let buf: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let step: Socks5Step = 'auth_selection'
  let suspended = false
  let authenticatedUsername: string | null = null

  function createFlowTracker(
    command: Socks5Command,
    destinationHost: string,
    destinationPort: number,
    destinationAType: Socks5ConnectionInfo['atype'],
  ): FlowTracker {
    const protocol = flowProtocolFor(command, destinationAType)
    const method = command === 'udpAssociate'
      ? 'udp_associate'
      : command
    const startedAt = performance.now()
    const handle = telemetry?.collector?.startFlow({
      source: resolveNodeName(telemetry, {
        role: 'source',
        protocol,
        clientAddress: socket.remoteAddress ?? 'unknown',
        authUsername: authenticatedUsername,
        host: destinationHost,
        port: destinationPort,
        atype: destinationAType,
      }),
      destination: resolveNodeName(telemetry, {
        role: 'destination',
        protocol,
        host: destinationHost,
        port: destinationPort,
        authUsername: authenticatedUsername,
        atype: destinationAType,
      }),
      protocol,
    }) ?? null
    let finished = false

    return {
      protocol,
      method,
      handle,
      startedAt,
      addBytesFromSource(delta: number): void {
        handle?.addBytesFromSource(delta)
      },
      addBytesToSource(delta: number): void {
        handle?.addBytesToSource(delta)
      },
      finish(error?: string): void {
        if (finished) return
        finished = true
        handle?.finish({
          status: error ? 'error' : 'success',
          error,
          method,
          durationSeconds: Math.max(0, (performance.now() - startedAt) / 1000),
        })
      },
    }
  }

  async function runCommandMiddleware(
    kind: 'socks5-connect' | 'socks5-bind' | 'socks5-udp-associate',
    target: { host: string; port: number; atype: Socks5ConnectionInfo['atype'] },
  ): Promise<{ blocked: boolean; target: { host: string; port: number } }> {
    if (!middleware || middleware.length === 0) {
      return { blocked: false, target: { host: target.host, port: target.port } }
    }

    const middlewareContext: ProxyMiddlewareContext = {
      kind,
      proxy: 'socks5' as const,
      clientAddress: socket.remoteAddress ?? 'unknown',
      authUsername: authenticatedUsername,
      target: {
        host: target.host,
        port: target.port,
        protocol: kind,
      },
      metadata: {
        atype: target.atype,
      },
    }
    await runProxyMiddleware(middleware, middlewareContext)
    if (middlewareContext.blocked) {
      socket.write(socks5Reply(middlewareContext.blocked.socks5ReplyCode ?? REP_RULESET_DENIED))
      socket.destroy()
      return { blocked: true, target: { host: target.host, port: target.port } }
    }

    return {
      blocked: false,
      target: {
        host: middlewareContext.target.host,
        port: middlewareContext.target.port,
      },
    }
  }

  function onData(chunk: Buffer): void {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk])
    if (!suspended) process()
  }

  socket.on('data', onData)
  socket.on('error', () => {
    mutable.connectionsErrored++
  })

  function process(): void {
    if (step === 'auth_selection') processAuthSelection()
    else if (step === 'userpass') processUserPass()
    else if (step === 'request') processRequest()
  }

  function processAuthSelection(): void {
    if (buf.length < 2) return
    if (buf[0] !== 0x05) {
      socket.destroy()
      return
    }

    const nmethods = buf[1]
    if (buf.length < 2 + nmethods) return

    const methods = Array.from(buf.subarray(2, 2 + nmethods))
    buf = buf.subarray(2 + nmethods)

    const needAuth = !!(auth?.verify || auth?.credentials)

    if (needAuth) {
      if (methods.includes(0x02)) {
        socket.write(Buffer.from([0x05, 0x02]))
        step = 'userpass'
        process()
      } else {
        socket.write(Buffer.from([0x05, 0xff]))
        socket.end()
      }
      return
    }

    if (methods.includes(0x00)) {
      socket.write(Buffer.from([0x05, 0x00]))
      step = 'request'
      process()
    } else if (methods.includes(0x02)) {
      socket.write(Buffer.from([0x05, 0x02]))
      step = 'userpass'
      process()
    } else {
      socket.write(Buffer.from([0x05, 0xff]))
      socket.end()
    }
  }

  function processUserPass(): void {
    if (buf.length < 3) return
    const ulen = buf[1]
    if (buf.length < 3 + ulen) return
    const plen = buf[2 + ulen]
    if (buf.length < 3 + ulen + plen) return

    const username = buf.subarray(2, 2 + ulen).toString('utf8')
    const password = buf.subarray(3 + ulen, 3 + ulen + plen).toString('utf8')
    buf = buf.subarray(3 + ulen + plen)

    suspended = true
    verifyProxyAuth(auth, { username, password })
      .then((ok) => {
        suspended = false
        if (!ok) {
          mutable.authFailures++
          socket.write(Buffer.from([0x01, 0x01]))
          socket.destroy()
          return
        }

        authenticatedUsername = username
        socket.write(Buffer.from([0x01, 0x00]))
        step = 'request'
        process()
      })
      .catch(() => {
        suspended = false
        socket.destroy()
      })
  }

  function processRequest(): void {
    if (buf.length < 4) return
    if (buf[0] !== 0x05) {
      socket.write(socks5Reply(REP_GENERAL_FAILURE))
      socket.destroy()
      return
    }

    const cmd = buf[1]
    const parsed = parseSocks5Request(buf)
    if (!parsed) {
      if (buf[3] !== 0x01 && buf[3] !== 0x03 && buf[3] !== 0x04) {
        socket.write(socks5Reply(REP_ATYP_NOT_SUPPORTED))
        socket.destroy()
      }
      return
    }

    const { host, port, atype, consumed } = parsed
    const remaining = buf.length > consumed ? buf.subarray(consumed) : Buffer.alloc(0)
    buf = Buffer.alloc(0)
    step = 'done'
    socket.off('data', onData)

    if (cmd === 0x01) {
      handleConnectCommand(host, port, atype, remaining)
      return
    }
    if (cmd === 0x02) {
      handleBindCommand(host, port, atype)
      return
    }
    if (cmd === 0x03) {
      handleUdpAssociateCommand(host, port, atype)
      return
    }

    socket.write(socks5Reply(REP_CMD_NOT_SUPPORTED))
    socket.destroy()
  }

  function handleConnectCommand(
    initialHost: string,
    initialPort: number,
    atype: Socks5ConnectionInfo['atype'],
    remaining: Buffer,
  ): void {
    let host = initialHost
    let port = initialPort

    const prepareConnection = async () => {
      const middlewareResult = await runCommandMiddleware('socks5-connect', { host, port, atype })
      if (middlewareResult.blocked) return false
      host = middlewareResult.target.host
      port = middlewareResult.target.port
      return true
    }

    suspended = true
    void prepareConnection().then((allowed) => {
      suspended = false
      if (!allowed) return
      const tracker = createFlowTracker('connect', host, port, atype)

      if (filter) {
        suspended = true
        checkProxyFilter(filter, host, port)
          .then(({ allowed, reason }) => {
            suspended = false
            if (!allowed) {
              filter.onDenied?.({ host, port, reason: reason! })
              tracker.finish('ruleset_denied')
              socket.write(socks5Reply(REP_RULESET_DENIED))
              socket.destroy()
              return
            }
            doConnect()
          })
          .catch(() => {
            suspended = false
            tracker.finish('filter_error')
            socket.destroy()
          })
        return
      }

      doConnect()

      function doConnect() {
        mutable.connectionsTotal++
        mutable.connectionsActive++
        const info: Socks5ConnectionInfo = {
          host,
          port,
          clientAddress: socket.remoteAddress ?? 'unknown',
          atype,
          command: 'connect',
        }
        onConnect?.(info)
        let closed = false

        function close(reason: string, error?: string): void {
          if (closed) return
          closed = true
          mutable.connectionsActive--
          onDisconnect?.({ ...info, reason })
          tracker.finish(error)
        }

        const upstream = netConnect({ host, port })
        upstream.setTimeout(connectTimeout)

        upstream.on('connect', () => {
          upstream.setTimeout(0)
          socket.write(socks5Reply(REP_SUCCESS, normalizeReplyHost(proxyHost, socket.remoteAddress), 0))

          if (remaining.length > 0) {
            mutable.bytesFromClient += remaining.length
            tracker.addBytesFromSource(remaining.length)
            upstream.write(remaining)
          }

          pipeBidirectional(socket, upstream, {
            onDataFromA: (bytes) => {
              mutable.bytesFromClient += bytes
              tracker.addBytesFromSource(bytes)
            },
            onDataToA: (bytes) => {
              mutable.bytesToClient += bytes
              tracker.addBytesToSource(bytes)
            },
            onEnd: () => {
              close('closed')
            },
            onError: (err) => {
              mutable.connectionsErrored++
              close(err.message, err.message)
            },
          })
        })

        upstream.on('timeout', () => {
          upstream.destroy(new Error('connect timeout'))
        })

        upstream.on('error', (err: NodeJS.ErrnoException) => {
          mutable.connectionsErrored++
          const rep = mapUpstreamError(err)
          if (!socket.destroyed) {
            socket.write(socks5Reply(rep))
            socket.destroy()
          }
          close(err.message, err.code ?? err.message)
        })

        socket.on('close', () => {
          if (!closed) {
            upstream.destroy()
            close('closed')
          }
        })

        socket.on('error', () => {
          upstream.destroy()
        })
      }
    }).catch(() => {
      suspended = false
      socket.destroy()
    })
  }

  function handleBindCommand(
    initialRequestedHost: string,
    initialRequestedPort: number,
    requestedAType: Socks5ConnectionInfo['atype'],
  ): void {
    let requestedHost = initialRequestedHost
    let requestedPort = initialRequestedPort
    const info: Socks5ConnectionInfo = {
      host: requestedHost,
      port: requestedPort,
      clientAddress: socket.remoteAddress ?? 'unknown',
      atype: requestedAType,
      command: 'bind',
    }

    suspended = true
    void runCommandMiddleware('socks5-bind', {
      host: requestedHost,
      port: requestedPort,
      atype: requestedAType,
    }).then((middlewareResult) => {
      suspended = false
      if (middlewareResult.blocked) return
      requestedHost = middlewareResult.target.host
      requestedPort = middlewareResult.target.port
      info.host = requestedHost
      info.port = requestedPort

      const shouldFilterRequestedTarget = !isWildcardHost(requestedHost) && requestedPort > 0

      if (filter && shouldFilterRequestedTarget) {
        suspended = true
        checkProxyFilter(filter, requestedHost, requestedPort)
          .then(({ allowed, reason }) => {
            suspended = false
            if (!allowed) {
              filter.onDenied?.({ host: requestedHost, port: requestedPort, reason: reason! })
              socket.write(socks5Reply(REP_RULESET_DENIED))
              socket.destroy()
              return
            }
            doBind()
          })
          .catch(() => {
            suspended = false
            socket.destroy()
          })
        return
      }

      doBind()

      function doBind() {
      mutable.connectionsTotal++
      mutable.connectionsActive++
      onConnect?.(info)

      const bindServer = createServer()
      let remoteSocket: Socket | null = null
      let tracker: FlowTracker | null = null
      let closed = false

      function close(reason: string, error?: string): void {
        if (closed) return
        closed = true
        mutable.connectionsActive--
        onDisconnect?.({ ...info, reason })
        tracker?.finish(error)
        if (!bindServer.listening) {
          remoteSocket?.destroy()
          if (!socket.destroyed) socket.destroy()
          return
        }
        bindServer.close(() => {
          remoteSocket?.destroy()
          if (!socket.destroyed) socket.destroy()
        })
      }

      bindServer.on('connection', (incoming) => {
        if (remoteSocket) {
          incoming.destroy()
          return
        }

        const remoteAddress = incoming.remoteAddress ?? 'unknown'
        const remotePort = incoming.remotePort ?? 0
        const remoteAType: Socks5ConnectionInfo['atype'] = isIP(remoteAddress) === 6 ? 'ipv6' : 'ipv4'

        if (!isWildcardHost(requestedHost) && requestedAType !== 'hostname' && remoteAddress !== requestedHost) {
          incoming.destroy()
          return
        }
        if (requestedPort > 0 && remotePort !== requestedPort) {
          incoming.destroy()
          return
        }

        const acceptIncoming = async () => {
          if (filter) {
            const { allowed, reason } = await checkProxyFilter(filter, remoteAddress, remotePort)
            if (!allowed) {
              filter.onDenied?.({ host: remoteAddress, port: remotePort, reason: reason! })
              incoming.destroy()
              return false
            }
          }
          return true
        }

        void acceptIncoming().then((allowed) => {
          if (!allowed || closed) return

          remoteSocket = incoming
          tracker = createFlowTracker('bind', remoteAddress, remotePort, requestedAType === 'hostname' ? 'hostname' : remoteAType)
          socket.write(socks5Reply(REP_SUCCESS, remoteAddress, remotePort))

          pipeBidirectional(socket, incoming, {
            onDataFromA: (bytes) => {
              mutable.bytesFromClient += bytes
              tracker?.addBytesFromSource(bytes)
            },
            onDataToA: (bytes) => {
              mutable.bytesToClient += bytes
              tracker?.addBytesToSource(bytes)
            },
            onEnd: () => {
              close('closed')
            },
            onError: (err) => {
              mutable.connectionsErrored++
              close(err.message, err.message)
            },
          })
        }).catch(() => {
          incoming.destroy()
        })
      })

      bindServer.on('error', () => {
        mutable.connectionsErrored++
        if (!socket.destroyed) {
          socket.write(socks5Reply(REP_GENERAL_FAILURE))
          socket.destroy()
        }
        close('bind_error', 'bind_error')
      })

      bindServer.listen(0, proxyHost ?? '0.0.0.0', () => {
        const address = bindServer.address() as { address: string; port: number } | null
        if (!address) {
          if (!socket.destroyed) {
            socket.write(socks5Reply(REP_GENERAL_FAILURE))
            socket.destroy()
          }
          close('bind_error', 'bind_error')
          return
        }

        socket.write(socks5Reply(
          REP_SUCCESS,
          normalizeReplyHost(address.address, socket.remoteAddress),
          address.port,
        ))
      })

      socket.on('close', () => close('closed'))
      socket.on('error', () => close('socket_error', 'socket_error'))
      }
    }).catch(() => {
      suspended = false
      socket.destroy()
    })
  }

  function handleUdpAssociateCommand(
    initialRequestedHost: string,
    initialRequestedPort: number,
    requestedAType: Socks5ConnectionInfo['atype'],
  ): void {
    let requestedHost = initialRequestedHost
    let requestedPort = initialRequestedPort
    suspended = true
    void runCommandMiddleware('socks5-udp-associate', {
      host: requestedHost,
      port: requestedPort,
      atype: requestedAType,
    }).then((middlewareResult) => {
      suspended = false
      if (middlewareResult.blocked) return
      requestedHost = middlewareResult.target.host
      requestedPort = middlewareResult.target.port
      mutable.connectionsTotal++
      mutable.connectionsActive++

      const info: Socks5ConnectionInfo = {
        host: requestedHost,
        port: requestedPort,
        clientAddress: socket.remoteAddress ?? 'unknown',
        atype: requestedAType,
        command: 'udpAssociate',
      }
      onConnect?.(info)

      const udpType = isIP(proxyHost ?? '') === 6 || isIP(socket.remoteAddress ?? '') === 6 ? 'udp6' : 'udp4'
      const relay = createSocket(udpType)
      const activeFlows = new Map<string, UdpFlowState>()
      const remoteKeyToFlowKey = new Map<string, string>()
      let closed = false
      let clientUdpPeer: { address: string; port: number } | null = requestedPort > 0
        ? { address: isWildcardHost(requestedHost) ? (socket.remoteAddress ?? '127.0.0.1') : requestedHost, port: requestedPort }
        : null

      function finishAndDeleteFlow(flowKey: string, error?: string): void {
        const state = activeFlows.get(flowKey)
        if (!state) return
        state.tracker.finish(error)
        for (const remoteKey of state.remoteKeys) {
          remoteKeyToFlowKey.delete(remoteKey)
        }
        activeFlows.delete(flowKey)
      }

      function getOrCreateUdpFlow(
        destinationHost: string,
        destinationPort: number,
        destinationAType: Socks5ConnectionInfo['atype'],
      ): UdpFlowState {
        const protocol = flowProtocolFor('udpAssociate', destinationAType)
        const flowKey = `${destinationHost}\u0000${destinationPort}\u0000${protocol}`
        const existing = activeFlows.get(flowKey)
        if (existing) return existing

        const created: UdpFlowState = {
          tracker: createFlowTracker('udpAssociate', destinationHost, destinationPort, destinationAType),
          remoteKeys: new Set(),
        }
        activeFlows.set(flowKey, created)
        return created
      }

      function close(reason: string, error?: string): void {
        if (closed) return
        closed = true
        mutable.connectionsActive--
        onDisconnect?.({ ...info, reason })
        for (const flowKey of Array.from(activeFlows.keys())) {
          finishAndDeleteFlow(flowKey, error)
        }
        relay.close()
        if (!socket.destroyed) socket.destroy()
      }

      relay.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
      const fromControlClient = rinfo.address === (socket.remoteAddress ?? '')
        && (clientUdpPeer == null || rinfo.port === clientUdpPeer.port || clientUdpPeer.port === 0)

      if (fromControlClient) {
        if (clientUdpPeer == null || clientUdpPeer.port === 0) {
          clientUdpPeer = { address: rinfo.address, port: rinfo.port }
        }

        const packet = parseSocks5UdpPacket(msg)
        if (!packet || packet.frag !== 0) {
          return
        }

        const relayDatagram = async () => {
          if (filter) {
            const { allowed, reason } = await checkProxyFilter(filter, packet.host, packet.port)
            if (!allowed) {
              filter.onDenied?.({ host: packet.host, port: packet.port, reason: reason! })
              createFlowTracker('udpAssociate', packet.host, packet.port, packet.atype).finish('ruleset_denied')
              return
            }
          }

          const resolved = packet.atype === 'hostname'
            ? await lookup(packet.host)
            : { address: packet.host, family: isIP(packet.host) }
          const remoteHost = resolved.address
          const remoteKey = formatRemoteKey(remoteHost, packet.port)
          const flowState = getOrCreateUdpFlow(packet.host, packet.port, packet.atype)
          flowState.remoteKeys.add(remoteKey)
          remoteKeyToFlowKey.set(remoteKey, `${packet.host}\u0000${packet.port}\u0000${flowState.tracker.protocol}`)

          mutable.bytesFromClient += packet.data.length
          flowState.tracker.addBytesFromSource(packet.data.length)

          relay.send(packet.data, packet.port, remoteHost, (error) => {
            if (error) {
              mutable.connectionsErrored++
              finishAndDeleteFlow(`${packet.host}\u0000${packet.port}\u0000${flowState.tracker.protocol}`, error.message)
            }
          })
        }

        void relayDatagram().catch(() => {
          mutable.connectionsErrored++
        })
        return
      }

      if (!clientUdpPeer) {
        return
      }

      const remoteKey = formatRemoteKey(rinfo.address, rinfo.port)
      const flowKey = remoteKeyToFlowKey.get(remoteKey)
      const flowState = flowKey ? activeFlows.get(flowKey) : undefined
      if (!flowState) {
        return
      }

      mutable.bytesToClient += msg.length
      flowState.tracker.addBytesToSource(msg.length)
      const response = buildSocks5UdpPacket(rinfo.address, rinfo.port, msg)
      relay.send(response, clientUdpPeer.port, clientUdpPeer.address)
      })

      relay.on('error', (error) => {
        mutable.connectionsErrored++
        close('udp_error', error.message)
      })

      relay.bind(0, proxyHost ?? '0.0.0.0', () => {
        const address = relay.address() as { address: string; port: number }
        socket.write(socks5Reply(
          REP_SUCCESS,
          normalizeReplyHost(address.address, socket.remoteAddress),
          address.port,
        ))
      })

      socket.on('close', () => close('closed'))
      socket.on('error', () => close('socket_error', 'socket_error'))
    }).catch(() => {
      suspended = false
      socket.destroy()
    })
  }
}

export function createSocks5Proxy(options: Socks5Options): Socks5Proxy {
  const { port, host = '0.0.0.0', maxConnections = 0 } = options
  const { mutable, snapshot } = createProxyStats()
  const telemetry = createOrReuseProxyTelemetry(options.telemetry)
  const proxyOptions: Socks5Options = telemetry
    ? { ...options, host, telemetry: { ...options.telemetry, collector: telemetry } }
    : { ...options, host }

  let server: NetServer | null = null
  let boundPort: number | null = null
  let running = false

  return {
    async start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server = createServer((socket: Socket) => {
          if (maxConnections > 0 && mutable.connectionsActive >= maxConnections) {
            socket.destroy()
            return
          }
          handleSocks5Connection(socket, proxyOptions, mutable)
        })

        server.once('error', reject)

        server.listen(port, host, () => {
          const address = server!.address()
          if (typeof address !== 'object' || address == null) {
            reject(new Error('Failed to resolve SOCKS5 server address'))
            return
          }
          boundPort = address.port
          running = true
          resolve(address.port)
        })
      })
    },

    async stop(drainTimeoutMs = 5000): Promise<void> {
      if (!server || !running) return
      running = false
      boundPort = null
      await gracefulShutdown(server, drainTimeoutMs)
    },

    get stats(): ProxyStats {
      return snapshot()
    },

    get boundPort(): number | null {
      return boundPort
    },

    get isRunning(): boolean {
      return running
    },

    get metricsRegistry(): MetricRegistry | null {
      return telemetry?.registry ?? null
    },

    graphSnapshot(): ProxyGraphSnapshot {
      const now = new Date().toISOString()
      return telemetry?.snapshot() ?? {
        seq: 0,
        generatedAt: now,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: now,
        percentiles: [],
        rateWindowSeconds: 60,
        nodes: [],
        edges: [],
      }
    },
  }
}
