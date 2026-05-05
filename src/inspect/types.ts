import type { HandlerKind, GrpcMeta } from '../types/handlers.js'
import type { ContractPolicies } from '../types/policies.js'
import type { SchemaDescriptor } from '../validation/descriptor.js'
import type { ServerConfigPreview, ProtocolPreviewConfig } from '../server/types.js'

export const RUNTIME_INSPECTION_GRAPH_VERSION = 1

export type RuntimeInspectionSourceKind =
  | 'programmatic'
  | 'discovery'
  | 'http-namespace'
  | 'rpc-namespace'
  | 'grpc-namespace'
  | 'rest-resource'
  | 'resource'
  | 'channel'
  | 'tcp-handler'
  | 'udp-handler'
  | 'unknown'

export interface RuntimeInspectionSource {
  kind: RuntimeInspectionSourceKind
  location?: string
}

export interface RuntimeInspectionGrpcHint {
  serviceName: string
  methodName: string
  type: NonNullable<GrpcMeta['type']>
}

export interface RuntimeInspectionOperationRegistration {
  source: RuntimeInspectionSource
  grpc?: RuntimeInspectionGrpcHint
}

export interface RuntimeInspectionSchema {
  present: boolean
  descriptor?: SchemaDescriptor
}

export interface RuntimeInspectionPolicySummary {
  direct?: ContractPolicies
  effective?: ContractPolicies
}

export interface RuntimeInspectionGrpcTransportDetails {
  protoPath: string[]
  packageName?: string
  serviceNames?: string[]
}

export interface RuntimeInspectionTransport {
  id: string
  protocol: 'http' | 'websocket' | 'jsonrpc' | 'graphql' | 'grpc' | 'tcp' | 'udp'
  enabled: boolean
  host?: string
  port?: number
  path?: string
  shared?: boolean
  frontDoor?: boolean
  strategy?: string
  source?: ProtocolPreviewConfig['source']
  grpc?: RuntimeInspectionGrpcTransportDetails
}

export interface RuntimeInspectionTransportBinding {
  id: string
  protocol: RuntimeInspectionTransport['protocol']
  mode:
    | 'rest'
    | 'rpc'
    | 'request'
    | 'notification'
    | 'query'
    | 'mutation'
    | 'stream'
    | 'event'
    | 'channel'
    | 'unary'
    | 'server-streaming'
    | 'client-streaming'
    | 'bidirectional'
    | 'datagram'
  method?: string
  path?: string
  procedure?: string
  shared?: boolean
  frontDoor?: boolean
  strategy?: string
  source?: ProtocolPreviewConfig['source']
  service?: string
  operation?: string
  field?: string
}

/**
 * Authorization metadata for runtime preview / MCP discovery.
 * Only the lightweight shape — no condition functions or full DSL trees.
 */
export interface RuntimeInspectionAuthz {
  /** The action string the engine receives (defaults to procedure name). */
  action: string
  /** enforce | any */
  mode: 'enforce' | 'any'
  /** Procedure intentionally bypasses policy (defaultMode: 'deny' escape). */
  public: boolean
  /** Whether the procedure declared a resource resolver. */
  hasResolver: boolean
}

export interface RuntimeInspectionOperation {
  id: string
  name: string
  service: string
  kind: HandlerKind
  summary?: string
  description?: string
  tags: string[]
  source: RuntimeInspectionSource
  schema: {
    input: RuntimeInspectionSchema
    output: RuntimeInspectionSchema
  }
  policies: RuntimeInspectionPolicySummary
  authz?: RuntimeInspectionAuthz
  transports: RuntimeInspectionTransportBinding[]
}

export interface RuntimeInspectionChannelEvent {
  name: string
  input: RuntimeInspectionSchema
}

export interface RuntimeInspectionChannel {
  id: string
  name: string
  type: 'public' | 'private' | 'presence'
  description?: string
  tags: string[]
  source: RuntimeInspectionSource
  auth: 'required' | 'optional' | 'none'
  transport: RuntimeInspectionTransportBinding
  events: RuntimeInspectionChannelEvent[]
}

export interface RuntimeInspectionTransportFraming {
  type: 'none' | 'length-prefixed' | 'delimiter'
  lengthBytes?: 1 | 2 | 4
  lengthEncoding?: 'BE' | 'LE'
  delimiter?: string
}

export interface RuntimeInspectionTransportHandler {
  id: string
  name: string
  protocol: 'udp' | 'tcp'
  mode: 'datagram' | 'session'
  source: RuntimeInspectionSource
  transportId: string
  target: {
    host: string
    port: number
    socketType?: 'udp4' | 'udp6'
  }
  details?: {
    framing?: RuntimeInspectionTransportFraming
    multicast?: {
      group: string
      interface?: string
    }
  }
}

export interface RuntimeInspectionService {
  id: string
  name: string
  operationIds: string[]
}

export type RuntimeInspectionDiagnosticSeverity = 'info' | 'warning' | 'error'

export interface RuntimeInspectionDiagnostic {
  code: string
  severity: RuntimeInspectionDiagnosticSeverity
  message: string
  subject: {
    kind: 'server' | 'service' | 'operation' | 'channel' | 'transport' | 'binding'
    id: string
  }
  remediation?: string
  data?: Record<string, unknown>
}

export interface RuntimeInspectionExtensionNode {
  id: string
  kind: string
  label: string
  summary?: string
  description?: string
  tags?: string[]
  href?: string
  data?: Record<string, unknown>
  children?: RuntimeInspectionExtensionNode[]
}

export interface RuntimeInspectionContribution {
  namespace: string
  title?: string
  summary?: string
  data?: Record<string, unknown>
  nodes: RuntimeInspectionExtensionNode[]
}

export interface RuntimeInspectionGraph {
  version: typeof RUNTIME_INSPECTION_GRAPH_VERSION
  generatedAt: string
  config: ServerConfigPreview
  services: RuntimeInspectionService[]
  operations: RuntimeInspectionOperation[]
  channels: RuntimeInspectionChannel[]
  transportHandlers: RuntimeInspectionTransportHandler[]
  transports: RuntimeInspectionTransport[]
  diagnostics: RuntimeInspectionDiagnostic[]
  extensions?: RuntimeInspectionContribution[]
}
