/**
 * Front-door protocol bootstrap utilities.
 *
 * Extracted from server builder to isolate protocol dispatch decisions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  FrontDoorTransport,
  FrontDoorStrategy,
  ProtocolConfig,
  ProtocolAliasMode,
} from './types.js'
import { joinBasePath } from './channel-utils.js'
import { getFrontDoorProtocolAliases } from './protocol-aliases.js'

const FRONT_DOOR_DETECTOR_DEFAULTS = ['websocket', 'jsonrpc', 'graphql', 'http'] as const
const FRONT_DOOR_KNOWN_PROTOCOLS = new Set<FrontDoorTransport>(['http', 'websocket', 'jsonrpc', 'tcp', 'udp', 'grpc', 'graphql'])

export type FrontDoorProtocolDecision = {
  protocol: FrontDoorTransport
  result: 'route' | 'unsupported'
  reason: string
  strategy?: FrontDoorStrategy
}

export function normalizeFrontDoorProtocol(
  protocol: string,
  protocolAliasMode: ProtocolAliasMode = 'standard'
): FrontDoorTransport {
  const aliases = getFrontDoorProtocolAliases(protocolAliasMode)
  const normalized = aliases[protocol.toLowerCase() as keyof typeof aliases]
    ?? protocol.toLowerCase()

  if (!FRONT_DOOR_KNOWN_PROTOCOLS.has(normalized as FrontDoorTransport)) {
    return normalized
  }

  return normalized as FrontDoorTransport
}

export interface FrontDoorLogger {
  info: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

export interface FrontDoorBootstrapOptions {
  frontDoorEnabled: boolean
  frontDoorProtocols: FrontDoorTransport[] | null
  protocols: ProtocolConfig
  basePath: string
  effectiveHost: string
  effectivePort: number
}

export function createFrontDoorBootstrap(options: FrontDoorBootstrapOptions) {
  const {
    frontDoorEnabled,
    frontDoorProtocols,
    protocols,
    basePath,
    effectiveHost,
    effectivePort,
  } = options

  function getFrontDoorDetectorOrder(): FrontDoorTransport[] {
    if (!frontDoorEnabled) return []
    if (!frontDoorProtocols || frontDoorProtocols.length === 0) return [...FRONT_DOOR_DETECTOR_DEFAULTS]
    const dedup: FrontDoorTransport[] = []
    for (const protocol of frontDoorProtocols) {
      if (!dedup.includes(protocol)) {
        dedup.push(protocol)
      }
    }
    return dedup
  }

  function isHttpFrontDoorAllowed(): boolean {
    return !frontDoorProtocols || frontDoorProtocols.length === 0 || frontDoorProtocols.includes('http')
  }

  function resolveProtocolPath(pathValue: string | undefined): string {
    return pathValue ? (pathValue.startsWith('/') ? pathValue : `/${pathValue}`) : '/'
  }

  function sendUnsupportedProtocolResponse(
    res: ServerResponse,
    decision: FrontDoorProtocolDecision
  ): void {
    const payload = {
      error: {
        code: 'UNSUPPORTED_PROTOCOL',
        message: 'Connection rejected by front-door protocol policy',
        details: {
          reason: decision.reason,
          protocol: decision.protocol,
          strategy: decision.strategy,
          timestamp: new Date().toISOString(),
        },
      },
    }
    const body = JSON.stringify(payload)
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.setHeader('content-length', Buffer.byteLength(body))
    res.end(body)
  }

  function evaluateFrontDoorDecision(req: IncomingMessage): FrontDoorProtocolDecision {
    if (!frontDoorEnabled) {
      return {
        protocol: 'http',
        result: 'route',
        reason: 'front-door disabled',
      }
    }

    const detectorOrder = getFrontDoorDetectorOrder()
    const upgrade = typeof req.headers.upgrade === 'string' ? req.headers.upgrade.toLowerCase() : undefined
    const method = req.method?.toUpperCase() ?? 'GET'
    let path = '/'
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      path = url.pathname
    } catch {
      // invalid URL should still continue to explicit protocol rejection path
      // keep empty warning for parity
    }

    for (const protocol of detectorOrder) {
      if (!FRONT_DOOR_KNOWN_PROTOCOLS.has(protocol)) {
        continue
      }

      if (protocol === 'websocket') {
        if (!protocols.websocket?.enabled || !protocols.websocket.frontDoor || !protocols.websocket.shared) {
          continue
        }
        const wsPath = joinBasePath(basePath, resolveProtocolPath(protocols.websocket.options.path ?? '/'))
        if (upgrade === 'websocket' && path === wsPath) {
          return {
            protocol: 'websocket',
            result: 'route',
            reason: `Matched websocket upgrade for path ${wsPath}`,
            strategy: protocols.websocket.strategy,
          }
        }
        if (upgrade === 'websocket') {
          return {
            protocol: 'websocket',
            result: 'unsupported',
            reason: `WebSocket path mismatch. Expected ${wsPath}, received ${path}`,
            strategy: protocols.websocket.strategy,
          }
        }
        continue
      }

      if (protocol === 'jsonrpc') {
        if (!protocols.jsonrpc?.enabled || !protocols.jsonrpc.frontDoor || !protocols.jsonrpc.shared) {
          continue
        }
        const rpcPath = joinBasePath(basePath, resolveProtocolPath(protocols.jsonrpc.options.path ?? '/rpc'))
        if (path === rpcPath && method === 'POST') {
          return {
            protocol: 'jsonrpc',
            result: 'route',
            reason: `Matched JSON-RPC request for ${rpcPath}`,
            strategy: protocols.jsonrpc.strategy,
          }
        }
        continue
      }

      if (protocol === 'graphql') {
        if (!protocols.graphql?.enabled || !protocols.graphql.frontDoor || !protocols.graphql.shared) {
          continue
        }
        const gqlPath = joinBasePath(basePath, resolveProtocolPath(protocols.graphql.options.path ?? '/graphql'))
        if (path === gqlPath) {
          return {
            protocol: 'graphql',
            result: 'route',
            reason: `Matched GraphQL request for ${gqlPath}`,
            strategy: protocols.graphql.strategy,
          }
        }
        continue
      }

      if (protocol === 'http') {
        if (!isHttpFrontDoorAllowed()) {
          return {
            protocol: 'http',
            result: 'unsupported',
            reason: 'HTTP not in front-door protocol list',
            strategy: 'shared',
          }
        }
        return {
          protocol: 'http',
          result: 'route',
          reason: 'HTTP/default protocol fallback',
          strategy: 'shared',
        }
      }

      if (protocol === 'tcp' || protocol === 'udp' || protocol === 'grpc') {
        if (protocol === 'tcp') {
          if (!protocols.tcp?.enabled) {
            return {
              protocol,
              result: 'unsupported',
              reason: 'TCP was included in front-door protocol order but is not configured',
              strategy: protocols.tcp?.strategy,
            }
          }
          return {
            protocol,
            result: 'unsupported',
            reason: 'TCP is front-door eligible only via dedicated offload routing',
            strategy: protocols.tcp?.strategy,
          }
        }
        if (protocol === 'udp') {
          return {
            protocol,
            result: 'unsupported',
            reason: 'UDP is currently not supported by the single-socket front-door listener',
          }
        }
        if (!protocols.grpc?.enabled) {
          return {
            protocol,
            result: 'unsupported',
            reason: 'gRPC was included in front-door protocol order but is not configured',
            strategy: protocols.grpc?.strategy,
          }
        }
        return {
          protocol,
          result: 'unsupported',
          reason: 'gRPC is front-door eligible only via dedicated offload routing',
          strategy: protocols.grpc?.strategy,
        }
      }
    }

    if (isHttpFrontDoorAllowed()) {
      return {
        protocol: 'http',
        result: 'route',
        reason: 'HTTP default fallback after detector walk',
        strategy: 'shared',
      }
    }

    return {
      protocol: 'http',
      result: 'unsupported',
      reason: 'No front-door detector matched incoming request',
      strategy: 'shared',
    }
  }

  function createDecisionMiddleware(logger: FrontDoorLogger) {
    if (!frontDoorEnabled) {
      return null
    }

    const plan = getFrontDoorDetectorOrder()
    logger.info({ plan, host: effectiveHost, port: effectivePort }, 'Front-door detection order configured')

    return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
      const decision = evaluateFrontDoorDecision(req)
      const source = req.socket ? `${req.socket.remoteAddress}:${req.socket.remotePort}` : 'unknown'
      logger.debug(
        {
          protocol: decision.protocol,
          result: decision.result,
          reason: decision.reason,
          strategy: decision.strategy,
          source,
          target: `${effectiveHost}:${effectivePort}`,
        },
        'Front-door protocol decision'
      )
      if (decision.result === 'unsupported') {
        sendUnsupportedProtocolResponse(res, decision)
        return true
      }
      return false
    }
  }

  return {
    getFrontDoorDetectorOrder,
    isHttpFrontDoorAllowed,
    evaluateFrontDoorDecision,
    createDecisionMiddleware,
  }
}
