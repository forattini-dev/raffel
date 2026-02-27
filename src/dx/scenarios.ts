/**
 * Developer-friendly scenario presets for multi-protocol server bootstrapping.
 *
 * These helpers generate `createServer()` configuration objects for
 * common combinations used during development.
 */

import type {
  ProtocolAliasMode,
  SinglePortProtocolKind,
  SinglePortConfig,
  ServerOptions,
  GrpcOptions,
} from '../server/types.js'

export type DevelopmentScenario = 'api' | 'realtime' | 'rpc' | 'dev' | 'full'

export interface DevelopmentScenarioInput {
  port: number
  host?: string
  basePath?: string
  websocketPath?: string
  jsonrpcPath?: string
  graphqlPath?: string
  tcpPort?: number
  grpc?: GrpcOptions | boolean
  protocolAliasMode?: ProtocolAliasMode
  singlePort?: SinglePortConfig | boolean
  singlePortProtocols?: SinglePortProtocolKind[]
}

export type DevelopmentScenarioOutput = ServerOptions & { scenario: DevelopmentScenario }

function buildOptionalTransportPorts(input: DevelopmentScenarioInput): { tcp?: { port: number; host: string } } {
  const host = input.host ?? '0.0.0.0'
  const config: { tcp?: { port: number; host: string } } = {}
  if (input.tcpPort !== undefined) {
    config.tcp = { port: input.tcpPort, host }
  }
  return config
}

function resolveGrpcConfig(input: DevelopmentScenarioInput): GrpcOptions | undefined {
  if (input.grpc === false || input.grpc === undefined) {
    return undefined
  }

  if (typeof input.grpc === 'object') {
    return input.grpc
  }

  return undefined
}

export function createServerScenario(
  scenario: DevelopmentScenario,
  input: DevelopmentScenarioInput
): DevelopmentScenarioOutput {
  const port = input.port
  const host = input.host ?? '0.0.0.0'
  const protocolAliasMode = input.protocolAliasMode ?? 'standard'
  const websocketPath = input.websocketPath ?? '/ws'
  const jsonrpcPath = input.jsonrpcPath ?? '/rpc'
  const graphqlPath = input.graphqlPath ?? '/graphql'

  const base: Omit<ServerOptions, 'websocket' | 'jsonrpc' | 'graphql' | 'tcp' | 'grpc'> = {
    port,
    host,
    basePath: input.basePath ?? '/',
    protocolAliasMode,
  }

  if (typeof input.singlePort === 'boolean') {
    base.singlePort = {
      enabled: input.singlePort,
      protocols: input.singlePortProtocols,
      protocolAliasMode,
    }
  } else if (input.singlePort) {
    base.singlePort = {
      ...input.singlePort,
      protocols: input.singlePort.protocols ?? input.singlePortProtocols,
      protocolAliasMode: input.singlePort.protocolAliasMode ?? protocolAliasMode,
    }
  }

  const transports = buildOptionalTransportPorts(input)

  if (scenario === 'realtime') {
    return {
      ...base,
      websocket: { path: websocketPath },
      ...transports,
      scenario,
    }
  }

  if (scenario === 'rpc') {
    const grpc = resolveGrpcConfig(input)

    return {
      ...base,
      jsonrpc: { path: jsonrpcPath },
      grpc,
      ...transports,
      scenario,
    }
  }

  if (scenario === 'dev') {
    const grpc = resolveGrpcConfig(input)

    return {
      ...base,
      websocket: { path: websocketPath },
      jsonrpc: { path: jsonrpcPath },
      graphql: { path: graphqlPath },
      grpc,
      ...transports,
      scenario,
    }
  }

  if (scenario === 'full') {
    const grpc = resolveGrpcConfig(input)
    const tcp = transports.tcp
      ? transports.tcp
      : input.singlePort
        ? undefined
        : { port: port + 2, host }

    return {
      ...base,
      websocket: { path: websocketPath },
      jsonrpc: { path: jsonrpcPath },
      graphql: { path: graphqlPath },
      grpc,
      tcp,
      scenario,
    }
  }

  // api
  return {
    ...base,
    websocket: { path: websocketPath },
    jsonrpc: { path: jsonrpcPath },
    graphql: { path: graphqlPath },
    ...transports,
    scenario,
  }
}
