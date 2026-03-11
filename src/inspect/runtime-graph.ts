import type { LoadedChannel } from '../server/fs-routes/index.js'
import type { ProtocolConfig, ServerConfigPreview } from '../server/types.js'
import type { Registry } from '../core/registry.js'
import type { HandlerMeta } from '../types/handlers.js'
import { normalizeContractPolicies } from '../types/policies.js'
import { normalizeSchemaDescriptor, type SchemaRegistry } from '../validation/index.js'
import type { HandlerSchema } from '../validation/index.js'
import type {
  RuntimeInspectionChannel,
  RuntimeInspectionDiagnostic,
  RuntimeInspectionGraph,
  RuntimeInspectionOperation,
  RuntimeInspectionOperationRegistration,
  RuntimeInspectionSchema,
  RuntimeInspectionService,
  RuntimeInspectionTransportHandler,
  RuntimeInspectionTransport,
  RuntimeInspectionTransportBinding,
} from './types.js'
import {
  RUNTIME_INSPECTION_GRAPH_VERSION,
} from './types.js'

export interface BuildRuntimeInspectionGraphInput {
  registry: Registry
  schemaRegistry: SchemaRegistry
  config: ServerConfigPreview
  protocols: ProtocolConfig
  basePath: string
  channels?: Iterable<LoadedChannel>
  tcpHandlers?: Iterable<{
    name: string
    filePath: string
    config: {
      host: string
      port: number
      framing?: {
        type: 'none' | 'length-prefixed' | 'delimiter'
        lengthBytes?: 1 | 2 | 4
        lengthEncoding?: 'BE' | 'LE'
        delimiter?: Buffer
      } | null
    }
  }>
  udpHandlers?: Iterable<{
    name: string
    filePath: string
    config: {
      host: string
      port: number
      type?: 'udp4' | 'udp6'
      multicast?: {
        group: string
        interface?: string
      } | null
    }
  }>
  operationRegistrations?: ReadonlyMap<string, RuntimeInspectionOperationRegistration>
}

function joinBasePath(basePath: string, path: string): string {
  const normalizedBase = basePath && basePath !== '/' ? (basePath.startsWith('/') ? basePath : `/${basePath}`) : ''
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!normalizedBase) {
    return normalizedPath
  }

  if (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath
  }

  return `${normalizedBase}${normalizedPath}`
}

function toFieldName(name: string): string {
  const last = name.split('.').pop() ?? name
  return last.replace(/[-_:]+([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase())
}

function deriveServiceName(
  meta: HandlerMeta,
  registration: RuntimeInspectionOperationRegistration | undefined
): string {
  if (registration?.grpc?.serviceName) {
    return registration.grpc.serviceName
  }

  if (meta.name.startsWith('stream:')) return 'streams'
  if (/^[a-z]+:\//.test(meta.name)) return 'http'

  const parts = meta.name.split('.')
  if (parts.length > 1) {
    return parts.slice(0, -1).join('.')
  }

  return 'default'
}

function buildSchema(schema: unknown, validator?: string): RuntimeInspectionSchema {
  if (!schema) {
    return { present: false }
  }

  return {
    present: true,
    descriptor: normalizeSchemaDescriptor(schema, { validator: validator as any }),
  }
}

function buildTransportCatalog(
  config: ServerConfigPreview,
  protocols: ProtocolConfig,
  basePath: string,
  tcpHandlers?: Iterable<{
    name: string
    config: {
      host: string
      port: number
    }
  }>,
  udpHandlers?: Iterable<{
    name: string
    config: {
      host: string
      port: number
    }
  }>
): RuntimeInspectionTransport[] {
  const transports: RuntimeInspectionTransport[] = [{
    id: 'http',
    protocol: 'http',
    enabled: true,
    host: config.entrypoint.host,
    port: config.entrypoint.port,
    path: basePath,
    shared: true,
    source: config.protocols.http.source,
  }]

  if (config.protocols.websocket?.enabled) {
    transports.push({
      id: 'websocket',
      protocol: 'websocket',
      enabled: true,
      host: config.protocols.websocket.host,
      port: config.protocols.websocket.port,
      path: joinBasePath(basePath, config.protocols.websocket.path ?? '/'),
      shared: config.protocols.websocket.shared,
      frontDoor: config.protocols.websocket.frontDoor,
      strategy: config.protocols.websocket.strategy,
      source: config.protocols.websocket.source,
    })
  }

  if (config.protocols.jsonrpc?.enabled) {
    transports.push({
      id: 'jsonrpc',
      protocol: 'jsonrpc',
      enabled: true,
      host: config.protocols.jsonrpc.host,
      port: config.protocols.jsonrpc.port,
      path: joinBasePath(basePath, config.protocols.jsonrpc.path ?? '/rpc'),
      shared: config.protocols.jsonrpc.shared,
      frontDoor: config.protocols.jsonrpc.frontDoor,
      strategy: config.protocols.jsonrpc.strategy,
      source: config.protocols.jsonrpc.source,
    })
  }

  if (config.protocols.graphql?.enabled) {
    transports.push({
      id: 'graphql',
      protocol: 'graphql',
      enabled: true,
      host: config.protocols.graphql.host,
      port: config.protocols.graphql.port,
      path: joinBasePath(basePath, config.protocols.graphql.path ?? '/graphql'),
      shared: config.protocols.graphql.shared,
      frontDoor: config.protocols.graphql.frontDoor,
      strategy: config.protocols.graphql.strategy,
      source: config.protocols.graphql.source,
    })
  }

  if (config.protocols.grpc?.enabled) {
    const grpcOptions = protocols.grpc?.options
    transports.push({
      id: 'grpc',
      protocol: 'grpc',
      enabled: true,
      host: config.protocols.grpc.host,
      port: config.protocols.grpc.port,
      shared: config.protocols.grpc.shared,
      frontDoor: config.protocols.grpc.frontDoor,
      strategy: config.protocols.grpc.strategy,
      source: config.protocols.grpc.source,
      grpc: grpcOptions ? {
        protoPath: Array.isArray(grpcOptions.protoPath) ? [...grpcOptions.protoPath] : [grpcOptions.protoPath],
        packageName: grpcOptions.packageName,
        serviceNames: grpcOptions.serviceNames ? [...grpcOptions.serviceNames] : undefined,
      } : undefined,
    })
  }

  if (config.protocols.tcp?.enabled) {
    transports.push({
      id: 'tcp',
      protocol: 'tcp',
      enabled: true,
      host: config.protocols.tcp.host,
      port: config.protocols.tcp.port,
      frontDoor: config.protocols.tcp.frontDoor,
      strategy: config.protocols.tcp.strategy,
      source: config.protocols.tcp.source,
    })
  }

  if (tcpHandlers) {
    const tcpTargets = new Set<string>()
    for (const handler of tcpHandlers) {
      const host = handler.config.host
      const port = handler.config.port
      const key = `${host}:${port}`
      if (tcpTargets.has(key)) continue
      tcpTargets.add(key)

      const existing = transports.find((transport) =>
        transport.protocol === 'tcp'
        && transport.host === host
        && transport.port === port
      )
      if (existing) continue

      transports.push({
        id: `tcp:${host}:${port}`,
        protocol: 'tcp',
        enabled: true,
        host,
        port,
        frontDoor: config.frontDoor.protocols?.includes('tcp') ?? false,
        source: config.sharedPort.enabled && port === config.entrypoint.port ? 'singlePort' : (
          config.frontDoor.protocols?.includes('tcp') ? 'offload' : 'native'
        ),
      })
    }
  }

  if (udpHandlers) {
    const udpTargets = new Set<string>()
    for (const handler of udpHandlers) {
      const host = handler.config.host
      const port = handler.config.port
      const key = `${host}:${port}`
      if (udpTargets.has(key)) continue
      udpTargets.add(key)

      transports.push({
        id: `udp:${host}:${port}`,
        protocol: 'udp',
        enabled: true,
        host,
        port,
        frontDoor: config.frontDoor.protocols?.includes('udp') ?? false,
        source: config.sharedPort.enabled && port === config.entrypoint.port ? 'singlePort' : (
          config.frontDoor.protocols?.includes('udp') ? 'offload' : 'native'
        ),
      })
    }
  }

  return transports
}

function buildOperationBindings(
  meta: HandlerMeta,
  config: ServerConfigPreview,
  protocols: ProtocolConfig,
  basePath: string,
  registration: RuntimeInspectionOperationRegistration | undefined
): RuntimeInspectionTransportBinding[] {
  const bindings: RuntimeInspectionTransportBinding[] = []

  if (meta.kind === 'procedure') {
    if (meta.httpPath && meta.httpMethod) {
      bindings.push({
        id: `http:${meta.httpMethod}:${meta.httpPath}`,
        protocol: 'http',
        mode: 'rest',
        method: meta.httpMethod,
        path: joinBasePath(basePath, meta.httpPath),
        procedure: meta.name,
        shared: true,
        source: config.protocols.http.source,
      })
    } else {
      bindings.push({
        id: `http:POST:${meta.name}`,
        protocol: 'http',
        mode: 'rpc',
        method: 'POST',
        path: joinBasePath(basePath, `/${meta.name}`),
        procedure: meta.name,
        shared: true,
        source: config.protocols.http.source,
      })
    }

    if (config.protocols.jsonrpc?.enabled) {
      bindings.push({
        id: `jsonrpc:${meta.name}`,
        protocol: 'jsonrpc',
        mode: meta.jsonrpc?.notification ? 'notification' : 'request',
        path: joinBasePath(basePath, protocols.jsonrpc?.options.path ?? '/rpc'),
        procedure: meta.name,
        shared: config.protocols.jsonrpc.shared,
        frontDoor: config.protocols.jsonrpc.frontDoor,
        strategy: config.protocols.jsonrpc.strategy,
        source: config.protocols.jsonrpc.source,
      })
    }

    if (config.protocols.graphql?.enabled && meta.graphql?.type) {
      bindings.push({
        id: `graphql:${meta.graphql.type}:${meta.name}`,
        protocol: 'graphql',
        mode: meta.graphql.type === 'query' ? 'query' : 'mutation',
        path: joinBasePath(basePath, protocols.graphql?.options.path ?? '/graphql'),
        field: toFieldName(meta.name),
        procedure: meta.name,
        shared: config.protocols.graphql.shared,
        frontDoor: config.protocols.graphql.frontDoor,
        strategy: config.protocols.graphql.strategy,
        source: config.protocols.graphql.source,
      })
    }
  }

  if (meta.kind === 'stream') {
    bindings.push({
      id: `http:GET:streams/${meta.name}`,
      protocol: 'http',
      mode: 'stream',
      method: 'GET',
      path: joinBasePath(basePath, `/streams/${meta.name}`),
      procedure: meta.name,
      shared: true,
      source: config.protocols.http.source,
    })
  }

  if (meta.kind === 'event') {
    bindings.push({
      id: `http:POST:events/${meta.name}`,
      protocol: 'http',
      mode: 'event',
      method: 'POST',
      path: joinBasePath(basePath, `/events/${meta.name}`),
      procedure: meta.name,
      shared: true,
      source: config.protocols.http.source,
    })
  }

  if (config.protocols.websocket?.enabled) {
    bindings.push({
      id: `websocket:${meta.kind}:${meta.name}`,
      protocol: 'websocket',
      mode: meta.kind === 'procedure' ? 'request' : meta.kind,
      path: joinBasePath(basePath, protocols.websocket?.options.path ?? '/'),
      procedure: meta.name,
      shared: config.protocols.websocket.shared,
      frontDoor: config.protocols.websocket.frontDoor,
      strategy: config.protocols.websocket.strategy,
      source: config.protocols.websocket.source,
    })
  }

  if (config.protocols.tcp?.enabled) {
    bindings.push({
      id: `tcp:${meta.kind}:${meta.name}`,
      protocol: 'tcp',
      mode: meta.kind === 'procedure' ? 'request' : meta.kind,
      procedure: meta.name,
      frontDoor: config.protocols.tcp.frontDoor,
      strategy: config.protocols.tcp.strategy,
      source: config.protocols.tcp.source,
    })
  }

  const grpcMeta = meta.grpc
  const grpcHint = registration?.grpc
  if (config.protocols.grpc?.enabled && (grpcMeta || grpcHint)) {
    const type = grpcHint?.type
      ?? grpcMeta?.type
      ?? (grpcMeta?.clientStreaming && grpcMeta?.serverStreaming
        ? 'bidirectional'
        : grpcMeta?.clientStreaming
          ? 'client-streaming'
          : grpcMeta?.serverStreaming
            ? 'server-streaming'
            : 'unary')

    bindings.push({
      id: `grpc:${grpcHint?.serviceName ?? grpcMeta?.serviceName ?? deriveServiceName(meta, registration)}:${grpcHint?.methodName ?? grpcMeta?.methodName ?? meta.name}`,
      protocol: 'grpc',
      mode: type,
      service: grpcHint?.serviceName ?? grpcMeta?.serviceName ?? deriveServiceName(meta, registration),
      operation: grpcHint?.methodName ?? grpcMeta?.methodName ?? meta.name.split('.').pop() ?? meta.name,
      procedure: meta.name,
      frontDoor: config.protocols.grpc.frontDoor,
      strategy: config.protocols.grpc.strategy,
      source: config.protocols.grpc.source,
    })
  }

  return bindings
}

function buildOperations(
  input: BuildRuntimeInspectionGraphInput
): RuntimeInspectionOperation[] {
  const schemaMap = new Map<string, HandlerSchema>(
    input.schemaRegistry.list().map(({ name, schema }) => [name, schema])
  )

  return input.registry.list().map((meta) => {
    const schema = schemaMap.get(meta.name)
    const registration = input.operationRegistrations?.get(meta.name)
    const inputSchema = buildSchema(schema?.input, schema?.validator)
    const outputSchema = buildSchema(schema?.output, schema?.validator)

    return {
      id: meta.name,
      name: meta.name,
      service: deriveServiceName(meta, registration),
      kind: meta.kind,
      summary: meta.summary,
      description: meta.description,
      tags: [...(meta.tags ?? [])],
      source: registration?.source ?? { kind: 'programmatic', location: '<programmatic>' },
      schema: {
        input: inputSchema,
        output: outputSchema,
      },
      policies: {
        direct: normalizeContractPolicies(meta.policies),
        effective: normalizeContractPolicies(meta.policies),
      },
      transports: buildOperationBindings(meta, input.config, input.protocols, input.basePath, registration),
    }
  })
}

function buildChannels(
  input: BuildRuntimeInspectionGraphInput
): RuntimeInspectionChannel[] {
  const wsTransport = input.config.protocols.websocket
  if (!wsTransport?.enabled || !input.channels) {
    return []
  }

  return Array.from(input.channels).map((channel) => ({
    id: channel.name,
    name: channel.name,
    type: channel.type ?? 'public',
    description: channel.description,
    tags: [...(channel.tags ?? [])],
    source: channel.filePath === '<programmatic>'
      ? { kind: 'programmatic', location: channel.filePath }
      : { kind: 'channel', location: channel.filePath },
    auth: channel.config.auth ?? 'none',
    transport: {
      id: `websocket:channel:${channel.name}`,
      protocol: 'websocket',
      mode: 'channel',
      path: joinBasePath(input.basePath, input.protocols.websocket?.options.path ?? '/'),
      procedure: channel.name,
      shared: wsTransport.shared,
      frontDoor: wsTransport.frontDoor,
      strategy: wsTransport.strategy,
      source: input.config.protocols.websocket?.source,
    },
    events: Object.entries(channel.config.events ?? {}).map(([name, config]) => ({
      name,
      input: buildSchema(config.input),
    })),
  }))
}

function buildServices(operations: RuntimeInspectionOperation[]): RuntimeInspectionService[] {
  const services = new Map<string, string[]>()

  for (const operation of operations) {
    const existing = services.get(operation.service)
    if (existing) {
      existing.push(operation.id)
    } else {
      services.set(operation.service, [operation.id])
    }
  }

  return Array.from(services.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, operationIds]) => ({
      id: name,
      name,
      operationIds: operationIds.sort((left, right) => left.localeCompare(right)),
    }))
}

function buildTransportHandlers(
  input: BuildRuntimeInspectionGraphInput,
  transports: RuntimeInspectionTransport[]
): RuntimeInspectionTransportHandler[] {
  const handlers: RuntimeInspectionTransportHandler[] = []

  if (input.tcpHandlers) {
    for (const handler of input.tcpHandlers) {
      const transport = transports.find((candidate) =>
        candidate.protocol === 'tcp'
        && candidate.host === handler.config.host
        && candidate.port === handler.config.port
      )

      handlers.push({
        id: `tcp:${handler.name}`,
        name: handler.name,
        protocol: 'tcp',
        mode: 'session',
        source: handler.filePath === '<programmatic>'
          ? { kind: 'programmatic', location: handler.filePath }
          : { kind: 'tcp-handler', location: handler.filePath },
        transportId: transport?.id ?? `tcp:${handler.config.host}:${handler.config.port}`,
        target: {
          host: handler.config.host,
          port: handler.config.port,
        },
        details: handler.config.framing
          ? {
              framing: {
                type: handler.config.framing.type,
                lengthBytes: handler.config.framing.lengthBytes,
                lengthEncoding: handler.config.framing.lengthEncoding,
                delimiter: handler.config.framing.delimiter?.toString('utf8'),
              },
            }
          : undefined,
      })
    }
  }

  if (!input.udpHandlers) {
    return handlers
  }

  for (const handler of input.udpHandlers) {
    const transportId = `udp:${handler.config.host}:${handler.config.port}`
    handlers.push({
      id: `udp:${handler.name}`,
      name: handler.name,
      protocol: 'udp',
      mode: 'datagram',
      source: handler.filePath === '<programmatic>'
        ? { kind: 'programmatic', location: handler.filePath }
        : { kind: 'udp-handler', location: handler.filePath },
      transportId,
      target: {
        host: handler.config.host,
        port: handler.config.port,
        socketType: handler.config.type,
      },
      details: handler.config.multicast
        ? {
            multicast: {
              group: handler.config.multicast.group,
              interface: handler.config.multicast.interface,
            },
          }
        : undefined,
    })
  }

  return handlers
}

function pushSchemaDiagnostics(
  diagnostics: RuntimeInspectionDiagnostic[],
  operation: RuntimeInspectionOperation
): void {
  for (const [target, schema] of Object.entries(operation.schema)) {
    for (const diagnostic of schema.descriptor?.diagnostics ?? []) {
      diagnostics.push({
        code: diagnostic.code,
        severity: diagnostic.level,
        message: `${operation.name} ${target} schema: ${diagnostic.message}`,
        subject: {
          kind: 'operation',
          id: operation.id,
        },
      })
    }
  }
}

function pushOperationalWarnings(
  diagnostics: RuntimeInspectionDiagnostic[],
  operation: RuntimeInspectionOperation
): void {
  const externallyExposed = operation.transports.some((binding) =>
    binding.protocol === 'http' || binding.protocol === 'grpc'
  )

  if (externallyExposed && !operation.policies.effective?.auth) {
    diagnostics.push({
      code: 'MISSING_AUTH_POLICY',
      severity: 'warning',
      message: `${operation.name} is externally exposed without an auth policy`,
      subject: {
        kind: 'operation',
        id: operation.id,
      },
      remediation: 'Attach a contract auth policy or explicitly mark the route as intentionally public.',
    })
  }

  if (externallyExposed && !operation.schema.output.present) {
    diagnostics.push({
      code: 'MISSING_OUTPUT_SCHEMA',
      severity: 'warning',
      message: `${operation.name} is externally exposed without an output schema`,
      subject: {
        kind: 'operation',
        id: operation.id,
      },
      remediation: 'Attach an output schema so docs, tooling, and contract tests can reason about responses.',
    })
  }

  if (
    operation.source.kind === 'http-namespace'
    || operation.source.kind === 'rpc-namespace'
    || operation.source.kind === 'grpc-namespace'
  ) {
    diagnostics.push({
      code: 'LEGACY_TRANSPORT_SURFACE',
      severity: 'warning',
      message: `${operation.name} is registered through the ${operation.source.kind} compatibility surface`,
      subject: {
        kind: 'operation',
        id: operation.id,
      },
      remediation: 'Prefer contract-first procedures/resources plus transport exposure so inspect, explain, docs, and contract tooling stay aligned.',
      data: {
        sourceKind: operation.source.kind,
      },
    })
  }
}

function pushConflictDiagnostics(
  diagnostics: RuntimeInspectionDiagnostic[],
  operations: RuntimeInspectionOperation[]
): void {
  const httpBindings = new Map<string, RuntimeInspectionOperation[]>()
  const grpcBindings = new Map<string, RuntimeInspectionOperation[]>()

  for (const operation of operations) {
    for (const binding of operation.transports) {
      if (binding.protocol === 'http' && binding.method && binding.path) {
        const key = `${binding.method}:${binding.path}`
        const existing = httpBindings.get(key)
        if (existing) {
          existing.push(operation)
        } else {
          httpBindings.set(key, [operation])
        }
      }

      if (binding.protocol === 'grpc' && binding.service && binding.operation) {
        const key = `${binding.service}.${binding.operation}`
        const existing = grpcBindings.get(key)
        if (existing) {
          existing.push(operation)
        } else {
          grpcBindings.set(key, [operation])
        }
      }
    }
  }

  for (const [binding, boundOperations] of httpBindings.entries()) {
    if (boundOperations.length < 2) continue
    diagnostics.push({
      code: 'CONFLICTING_HTTP_EXPOSURE',
      severity: 'error',
      message: `Multiple operations resolve to the same HTTP binding (${binding})`,
      subject: {
        kind: 'binding',
        id: binding,
      },
      remediation: 'Change the HTTP path or method so every exposed route is unique.',
      data: {
        operations: boundOperations.map((operation) => operation.id),
      },
    })
  }

  for (const [binding, boundOperations] of grpcBindings.entries()) {
    if (boundOperations.length < 2) continue
    diagnostics.push({
      code: 'CONFLICTING_GRPC_EXPOSURE',
      severity: 'error',
      message: `Multiple operations resolve to the same gRPC binding (${binding})`,
      subject: {
        kind: 'binding',
        id: binding,
      },
      remediation: 'Ensure each gRPC service/method pair is backed by exactly one operation.',
      data: {
        operations: boundOperations.map((operation) => operation.id),
      },
    })
  }
}

function pushProtocolFusionDiagnostics(
  diagnostics: RuntimeInspectionDiagnostic[],
  config: ServerConfigPreview
): void {
  if (config.protocolFusion.enabled) {
    diagnostics.push({
      code: 'PROTOCOL_FUSION_MODE',
      severity: 'info',
      message: `Protocol fusion is active in ${config.protocolFusion.mode} mode on the ${config.protocolFusion.entrypoint.toUpperCase()} entrypoint`,
      subject: {
        kind: 'server',
        id: 'protocol-fusion',
      },
      remediation: 'Use `raffel inspect`, `raffel explain`, or `server.getProtocolFusionState()` to inspect routing decisions and recent protocol rejections.',
      data: {
        mode: config.protocolFusion.mode,
        entrypoint: config.protocolFusion.entrypoint,
      },
    })
  }

  if (config.sharedPort.enabled && (config.sharedPort.sniffers?.length ?? 0) > 0) {
    diagnostics.push({
      code: 'CUSTOM_PROTOCOL_SNIFFERS',
      severity: 'info',
      message: `Shared-port protocol fusion runs ${config.sharedPort.sniffers!.length} custom sniffer(s): ${config.sharedPort.sniffers!.join(', ')}`,
      subject: {
        kind: 'server',
        id: 'shared-port-sniffers',
      },
      remediation: 'Keep custom sniffers deterministic and document their transport mapping so inspect, doctor, and playground workflows stay predictable.',
      data: {
        sniffers: [...config.sharedPort.sniffers!],
      },
    })
  }

  const frontDoorOffloadProtocols = (config.frontDoor.protocols ?? []).filter((protocol) =>
    protocol === 'grpc' || protocol === 'tcp' || protocol === 'udp'
  )
  if (frontDoorOffloadProtocols.length > 0) {
    diagnostics.push({
      code: 'FRONT_DOOR_OFFLOAD_PROTOCOLS',
      severity: 'info',
      message: `Front-door exposure includes offloaded protocols: ${frontDoorOffloadProtocols.join(', ')}`,
      subject: {
        kind: 'server',
        id: 'front-door-offload',
      },
      remediation: 'Remember that front-door only parses HTTP-family traffic directly; offloaded protocols still rely on their dedicated adapter/runtime path.',
      data: {
        protocols: frontDoorOffloadProtocols,
      },
    })
  }

  const sharedPortProtocols = new Set(config.sharedPort.protocols ?? [])
  if (
    config.sharedPort.enabled
    && sharedPortProtocols.size > 0
    && !sharedPortProtocols.has('http')
    && (
      config.protocols.http.enabled
      || config.protocols.websocket?.enabled
      || config.protocols.jsonrpc?.enabled
      || config.protocols.graphql?.enabled
    )
  ) {
    diagnostics.push({
      code: 'HTTP_FAMILY_BLOCKED_BY_SHARED_PORT',
      severity: 'warning',
      message: 'sharedPort.protocols excludes http, so HTTP, WebSocket, JSON-RPC, and GraphQL traffic will be rejected at the transport entrypoint',
      subject: {
        kind: 'server',
        id: 'shared-port-http-family',
      },
      remediation: 'Add `http` to `sharedPort.protocols`, or move HTTP-family transports to another listener before relying on inspect/playground workflows.',
      data: {
        allowedProtocols: [...sharedPortProtocols],
      },
    })
  }
}

function buildDiagnostics(
  config: ServerConfigPreview,
  operations: RuntimeInspectionOperation[]
): RuntimeInspectionDiagnostic[] {
  const diagnostics: RuntimeInspectionDiagnostic[] = config.warnings.map((warning, index) => ({
    code: 'CONFIG_WARNING',
    severity: 'warning',
    message: warning,
    subject: {
      kind: 'server',
      id: `config-warning:${index}`,
    },
  }))

  pushProtocolFusionDiagnostics(diagnostics, config)

  for (const operation of operations) {
    pushSchemaDiagnostics(diagnostics, operation)
    pushOperationalWarnings(diagnostics, operation)
  }

  pushConflictDiagnostics(diagnostics, operations)
  return diagnostics
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry)) as T
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue
    result[key] = stripUndefined(entry)
  }
  return result as T
}

export function serializeRuntimeInspectionTransport(transport: RuntimeInspectionTransport): RuntimeInspectionTransport {
  return stripUndefined(transport)
}

export function serializeRuntimeInspectionSchema(schema: RuntimeInspectionSchema): RuntimeInspectionSchema {
  return stripUndefined(schema)
}

export function serializeRuntimeInspectionPolicies(
  policies: RuntimeInspectionOperation['policies']
): RuntimeInspectionOperation['policies'] {
  return stripUndefined(policies)
}

export function serializeRuntimeInspectionOperation(
  operation: RuntimeInspectionOperation
): RuntimeInspectionOperation {
  return stripUndefined({
    ...operation,
    schema: {
      input: serializeRuntimeInspectionSchema(operation.schema.input),
      output: serializeRuntimeInspectionSchema(operation.schema.output),
    },
    policies: serializeRuntimeInspectionPolicies(operation.policies),
    transports: operation.transports.map((binding) => stripUndefined(binding)),
  })
}

export function serializeRuntimeInspectionService(
  service: RuntimeInspectionService
): RuntimeInspectionService {
  return stripUndefined(service)
}

export function serializeRuntimeInspectionChannel(
  channel: RuntimeInspectionChannel
): RuntimeInspectionChannel {
  return stripUndefined({
    ...channel,
    transport: stripUndefined(channel.transport),
    events: channel.events.map((event) => ({
      ...event,
      input: serializeRuntimeInspectionSchema(event.input),
    })),
  })
}

export function serializeRuntimeInspectionTransportHandler(
  handler: RuntimeInspectionTransportHandler
): RuntimeInspectionTransportHandler {
  return stripUndefined(handler)
}

export function serializeRuntimeInspectionDiagnostic(
  diagnostic: RuntimeInspectionDiagnostic
): RuntimeInspectionDiagnostic {
  return stripUndefined(diagnostic)
}

export function serializeRuntimeInspectionGraph(
  graph: RuntimeInspectionGraph
): RuntimeInspectionGraph {
  return stripUndefined({
    ...graph,
    services: graph.services.map(serializeRuntimeInspectionService),
    operations: graph.operations.map(serializeRuntimeInspectionOperation),
    channels: graph.channels.map(serializeRuntimeInspectionChannel),
    transportHandlers: graph.transportHandlers.map(serializeRuntimeInspectionTransportHandler),
    transports: graph.transports.map(serializeRuntimeInspectionTransport),
    diagnostics: graph.diagnostics.map(serializeRuntimeInspectionDiagnostic),
  })
}

export function buildRuntimeInspectionGraph(
  input: BuildRuntimeInspectionGraphInput
): RuntimeInspectionGraph {
  const transports = buildTransportCatalog(input.config, input.protocols, input.basePath, input.tcpHandlers, input.udpHandlers)
  const operations = buildOperations(input)
  const channels = buildChannels(input)
  const transportHandlers = buildTransportHandlers(input, transports)
  const services = buildServices(operations)
  const diagnostics = buildDiagnostics(input.config, operations)

  return serializeRuntimeInspectionGraph({
    version: RUNTIME_INSPECTION_GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    config: input.config,
    services,
    operations,
    channels,
    transportHandlers,
    transports,
    diagnostics,
  })
}
