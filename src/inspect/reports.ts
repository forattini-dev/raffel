import type {
  RuntimeInspectionChannel,
  RuntimeInspectionDiagnostic,
  RuntimeInspectionGraph,
  RuntimeInspectionOperation,
  RuntimeInspectionSchema,
  RuntimeInspectionService,
  RuntimeInspectionTransportHandler,
  RuntimeInspectionTransport,
  RuntimeInspectionTransportBinding,
} from './types.js'
import { formatBindingFull } from './format-utils.js'

export interface RuntimeInspectionDoctorReport {
  summary: {
    total: number
    errors: number
    warnings: number
    infos: number
  }
  diagnostics: RuntimeInspectionDiagnostic[]
}

export type RuntimeInspectionExplanation =
  | {
      kind: 'operation'
      query: string
      operation: RuntimeInspectionOperation
      diagnostics: RuntimeInspectionDiagnostic[]
    }
  | {
      kind: 'channel'
      query: string
      channel: RuntimeInspectionChannel
      diagnostics: RuntimeInspectionDiagnostic[]
    }
  | {
      kind: 'service'
      query: string
      service: RuntimeInspectionService
      operations: RuntimeInspectionOperation[]
      diagnostics: RuntimeInspectionDiagnostic[]
    }
  | {
      kind: 'transport'
      query: string
      transport: RuntimeInspectionTransport
      diagnostics: RuntimeInspectionDiagnostic[]
    }
  | {
      kind: 'transport-handler'
      query: string
      handler: RuntimeInspectionTransportHandler
      diagnostics: RuntimeInspectionDiagnostic[]
    }
  | {
      kind: 'binding'
      query: string
      bindingId: string
      bindings: RuntimeInspectionTransportBinding[]
      operations: RuntimeInspectionOperation[]
      channels: RuntimeInspectionChannel[]
      diagnostics: RuntimeInspectionDiagnostic[]
    }

function compareSeverity(
  left: RuntimeInspectionDiagnostic['severity'],
  right: RuntimeInspectionDiagnostic['severity']
): number {
  const order = { error: 0, warning: 1, info: 2 } as const
  return order[left] - order[right]
}

function getBindingSubjectId(binding: RuntimeInspectionTransportBinding): string {
  if (binding.protocol === 'http' && binding.method && binding.path) {
    return `${binding.method}:${binding.path}`
  }

  if (binding.protocol === 'grpc' && binding.service && binding.operation) {
    return `${binding.service}.${binding.operation}`
  }

  return binding.id
}

function formatAddress(transport: RuntimeInspectionTransport): string {
  const host = transport.host ?? '127.0.0.1'
  const port = transport.port ?? 'n/a'
  return `${host}:${port}`
}

function formatTransportHandlerTarget(handler: RuntimeInspectionTransportHandler): string {
  const target = `${handler.target.host}:${handler.target.port}${handler.target.socketType ? ` (${handler.target.socketType})` : ''}`
  const framing = handler.details?.framing
  if (!framing) {
    return target
  }

  if (framing.type === 'delimiter') {
    return `${target} [framing=delimiter${framing.delimiter ? `:${JSON.stringify(framing.delimiter)}` : ''}]`
  }

  if (framing.type === 'length-prefixed') {
    return `${target} [framing=length-prefixed:${framing.lengthBytes ?? 4}${framing.lengthEncoding ?? 'BE'}]`
  }

  return `${target} [framing=none]`
}

function summarizeSchema(schema: RuntimeInspectionSchema): string {
  if (!schema.present || !schema.descriptor) {
    return 'missing'
  }

  const source = schema.descriptor.source
  const validator = schema.descriptor.validator ? ` via ${schema.descriptor.validator}` : ''
  const diagnostics = schema.descriptor.diagnostics.length > 0
    ? ` (${schema.descriptor.diagnostics.length} diagnostic${schema.descriptor.diagnostics.length === 1 ? '' : 's'})`
    : ''
  return `${source}${validator}${diagnostics}`
}

function summarizePolicies(operation: RuntimeInspectionOperation): string {
  const policies = operation.policies.effective
  if (!policies) {
    return 'none'
  }

  const parts: string[] = []

  if (policies.auth) {
    const authBits: string[] = [policies.auth.mode ?? 'required']
    if (policies.auth.scheme) authBits.push(`scheme=${policies.auth.scheme}`)
    if (policies.auth.roles?.length) authBits.push(`roles=${policies.auth.roles.join('|')}`)
    if (policies.auth.scopes?.length) authBits.push(`scopes=${policies.auth.scopes.join('|')}`)
    parts.push(`auth(${authBits.join(', ')})`)
  }

  if (policies.timeout) {
    parts.push(`timeout(${policies.timeout.timeoutMs}ms)`)
  }

  if (policies.rateLimit) {
    parts.push(`rateLimit(${policies.rateLimit.maxRequests}/${policies.rateLimit.windowMs}ms)`)
  }

  if (policies.custom && Object.keys(policies.custom).length > 0) {
    parts.push(`custom(${Object.keys(policies.custom).join(', ')})`)
  }

  return parts.length > 0 ? parts.join(', ') : 'none'
}

function formatSource(kind: { kind: string; location?: string }): string {
  return kind.location ? `${kind.kind} @ ${kind.location}` : kind.kind
}

function formatDiagnostic(diagnostic: RuntimeInspectionDiagnostic): string {
  const subject = `${diagnostic.subject.kind}:${diagnostic.subject.id}`
  const remediation = diagnostic.remediation ? `\n    remediation: ${diagnostic.remediation}` : ''
  return `- [${diagnostic.severity}] ${diagnostic.code} ${subject}\n    ${diagnostic.message}${remediation}`
}

function getRelatedDiagnostics(
  graph: RuntimeInspectionGraph,
  subject: RuntimeInspectionDiagnostic['subject']
): RuntimeInspectionDiagnostic[] {
  return graph.diagnostics
    .filter((diagnostic) => diagnostic.subject.kind === subject.kind && diagnostic.subject.id === subject.id)
    .sort((left, right) => {
      const severity = compareSeverity(left.severity, right.severity)
      if (severity !== 0) return severity
      return left.code.localeCompare(right.code)
    })
}

function getBindingDiagnostics(
  graph: RuntimeInspectionGraph,
  bindings: RuntimeInspectionTransportBinding[]
): RuntimeInspectionDiagnostic[] {
  const ids = new Set(bindings.map((binding) => getBindingSubjectId(binding)))
  return graph.diagnostics
    .filter((diagnostic) => diagnostic.subject.kind === 'binding' && ids.has(diagnostic.subject.id))
    .sort((left, right) => {
      const severity = compareSeverity(left.severity, right.severity)
      if (severity !== 0) return severity
      return left.code.localeCompare(right.code)
    })
}

function parseHttpQuery(query: string): { method: string; path: string } | null {
  const match = query.trim().match(/^([A-Z]+)\s+(\S+)$/)
  if (!match) return null
  return {
    method: match[1].toUpperCase(),
    path: match[2],
  }
}

function parseGrpcQuery(query: string): { service: string; operation: string } | null {
  const normalized = query.trim().replace(/\//g, '.')
  const segments = normalized.split('.').filter(Boolean)
  if (segments.length < 2) return null
  return {
    service: segments.slice(0, -1).join('.'),
    operation: segments[segments.length - 1],
  }
}

export function explainRuntimeInspectionSubject(
  graph: RuntimeInspectionGraph,
  query: string
): RuntimeInspectionExplanation | null {
  const normalized = query.trim()

  const operation = graph.operations.find((candidate) =>
    candidate.id === normalized || candidate.name === normalized
  )
  if (operation) {
    return {
      kind: 'operation',
      query,
      operation,
      diagnostics: getRelatedDiagnostics(graph, { kind: 'operation', id: operation.id }),
    }
  }

  const channel = graph.channels.find((candidate) => candidate.id === normalized || candidate.name === normalized)
  if (channel) {
    return {
      kind: 'channel',
      query,
      channel,
      diagnostics: getRelatedDiagnostics(graph, { kind: 'channel', id: channel.id }),
    }
  }

  const service = graph.services.find((candidate) => candidate.id === normalized || candidate.name === normalized)
  if (service) {
    const operationIds = new Set(service.operationIds)
    const operations = graph.operations.filter((candidate) => operationIds.has(candidate.id))
    return {
      kind: 'service',
      query,
      service,
      operations,
      diagnostics: getRelatedDiagnostics(graph, { kind: 'service', id: service.id }),
    }
  }

  const transport = graph.transports.find((candidate) => candidate.id === normalized || candidate.protocol === normalized)
  if (transport) {
    return {
      kind: 'transport',
      query,
      transport,
      diagnostics: getRelatedDiagnostics(graph, { kind: 'transport', id: transport.id }),
    }
  }

  const transportHandler = graph.transportHandlers.find((candidate) =>
    candidate.id === normalized || candidate.name === normalized
  )
  if (transportHandler) {
    return {
      kind: 'transport-handler',
      query,
      handler: transportHandler,
      diagnostics: getRelatedDiagnostics(graph, { kind: 'transport', id: transportHandler.transportId }),
    }
  }

  const allBindings = graph.operations.flatMap((candidate) =>
    candidate.transports.map((binding) => ({ binding, operation: candidate }))
  )
  const channelBindings = graph.channels.map((candidate) => ({ binding: candidate.transport, channel: candidate }))

  const httpQuery = parseHttpQuery(normalized)
  if (httpQuery) {
    const matchingBindings = allBindings.filter(({ binding }) =>
      binding.protocol === 'http'
      && binding.method === httpQuery.method
      && binding.path === httpQuery.path
    )
    const matchingChannels = channelBindings.filter(({ binding }) =>
      binding.protocol === 'http'
      && binding.method === httpQuery.method
      && binding.path === httpQuery.path
    )

    if (matchingBindings.length > 0 || matchingChannels.length > 0) {
      const bindings = [
        ...matchingBindings.map(({ binding }) => binding),
        ...matchingChannels.map(({ binding }) => binding),
      ]
      return {
        kind: 'binding',
        query,
        bindingId: `${httpQuery.method}:${httpQuery.path}`,
        bindings,
        operations: matchingBindings.map(({ operation: candidate }) => candidate),
        channels: matchingChannels.map(({ channel: candidate }) => candidate),
        diagnostics: getBindingDiagnostics(graph, bindings),
      }
    }
  }

  const grpcQuery = parseGrpcQuery(normalized)
  if (grpcQuery) {
    const matchingBindings = allBindings.filter(({ binding }) =>
      binding.protocol === 'grpc'
      && binding.service === grpcQuery.service
      && binding.operation === grpcQuery.operation
    )

    if (matchingBindings.length > 0) {
      const bindings = matchingBindings.map(({ binding }) => binding)
      return {
        kind: 'binding',
        query,
        bindingId: `${grpcQuery.service}.${grpcQuery.operation}`,
        bindings,
        operations: matchingBindings.map(({ operation: candidate }) => candidate),
        channels: [],
        diagnostics: getBindingDiagnostics(graph, bindings),
      }
    }
  }

  const exactBindingMatches = allBindings.filter(({ binding }) =>
    binding.id === normalized || getBindingSubjectId(binding) === normalized
  )
  const exactChannelBindingMatches = channelBindings.filter(({ binding }) =>
    binding.id === normalized || getBindingSubjectId(binding) === normalized
  )

  if (exactBindingMatches.length > 0 || exactChannelBindingMatches.length > 0) {
    const bindings = [
      ...exactBindingMatches.map(({ binding }) => binding),
      ...exactChannelBindingMatches.map(({ binding }) => binding),
    ]
    return {
      kind: 'binding',
      query,
      bindingId: normalized,
      bindings,
      operations: exactBindingMatches.map(({ operation: candidate }) => candidate),
      channels: exactChannelBindingMatches.map(({ channel: candidate }) => candidate),
      diagnostics: getBindingDiagnostics(graph, bindings),
    }
  }

  return null
}

export function buildRuntimeInspectionDoctorReport(
  graph: RuntimeInspectionGraph
): RuntimeInspectionDoctorReport {
  const diagnostics = [...graph.diagnostics].sort((left, right) => {
    const severity = compareSeverity(left.severity, right.severity)
    if (severity !== 0) return severity
    if (left.subject.kind !== right.subject.kind) {
      return left.subject.kind.localeCompare(right.subject.kind)
    }
    if (left.subject.id !== right.subject.id) {
      return left.subject.id.localeCompare(right.subject.id)
    }
    return left.code.localeCompare(right.code)
  })

  const summary = {
    total: diagnostics.length,
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
    infos: diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
  }

  return { summary, diagnostics }
}

export function shouldFailDoctorReport(
  report: RuntimeInspectionDoctorReport,
  threshold: 'none' | 'info' | 'warning' | 'error' = 'error'
): boolean {
  if (threshold === 'none') return false
  if (threshold === 'info') return report.summary.total > 0
  if (threshold === 'warning') return report.summary.errors > 0 || report.summary.warnings > 0
  return report.summary.errors > 0
}

export function formatRuntimeInspectionGraph(graph: RuntimeInspectionGraph): string {
  const lines: string[] = []

  lines.push('Raffel Runtime Preview')
  lines.push(`Generated: ${graph.generatedAt}`)
  lines.push(
    `Entrypoint: ${graph.config.protocolFusion.entrypoint.toUpperCase()} ${graph.config.entrypoint.host}:${graph.config.entrypoint.port} `
    + `[fusion=${graph.config.protocolFusion.mode}]`
  )
  lines.push('')
  lines.push('Transports')
  for (const transport of graph.transports) {
    const traits = [
      transport.path ? `path=${transport.path}` : null,
      transport.shared ? 'shared' : 'dedicated',
      transport.frontDoor ? 'front-door' : null,
      transport.source ? `source=${transport.source}` : null,
    ].filter(Boolean)
    lines.push(`- ${transport.protocol.padEnd(9, ' ')} ${formatAddress(transport)}${traits.length > 0 ? ` (${traits.join(', ')})` : ''}`)
  }

  lines.push('')
  lines.push('Services')
  const operationMap = new Map(graph.operations.map((operation) => [operation.id, operation]))
  for (const service of graph.services) {
    lines.push(`- ${service.name} (${service.operationIds.length} operation${service.operationIds.length === 1 ? '' : 's'})`)
    for (const operationId of service.operationIds) {
      const operation = operationMap.get(operationId)
      if (!operation) continue
      lines.push(`  ${operation.name} [${operation.kind}]`)
      lines.push(`    source: ${formatSource(operation.source)}`)
      lines.push(`    bindings: ${operation.transports.map(formatBindingFull).join(' | ') || 'none'}`)
      lines.push(`    policies: ${summarizePolicies(operation)}`)
      lines.push(`    schemas: input=${summarizeSchema(operation.schema.input)}, output=${summarizeSchema(operation.schema.output)}`)
    }
  }

  if (graph.channels.length > 0) {
    lines.push('')
    lines.push('Channels')
    for (const channel of graph.channels) {
      lines.push(`- ${channel.name} [${channel.type}] auth=${channel.auth}`)
      lines.push(`  source: ${formatSource(channel.source)}`)
      lines.push(`  transport: ${formatBindingFull(channel.transport)}`)
      lines.push(`  events: ${channel.events.map((event) => `${event.name} (${summarizeSchema(event.input)})`).join(', ') || 'none'}`)
    }
  }

  if (graph.transportHandlers.length > 0) {
    lines.push('')
    lines.push('Transport Handlers')
    for (const handler of graph.transportHandlers) {
      lines.push(`- ${handler.name} [${handler.protocol}:${handler.mode}]`)
      lines.push(`  source: ${formatSource(handler.source)}`)
      lines.push(`  target: ${formatTransportHandlerTarget(handler)}`)
    }
  }

  const report = buildRuntimeInspectionDoctorReport(graph)
  lines.push('')
  lines.push(`Diagnostics (${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos)`)
  if (report.diagnostics.length === 0) {
    lines.push('- clean')
  } else {
    for (const diagnostic of report.diagnostics) {
      lines.push(formatDiagnostic(diagnostic))
    }
  }

  return lines.join('\n')
}

export function formatRuntimeInspectionExplanation(
  explanation: RuntimeInspectionExplanation
): string {
  const lines: string[] = []

  lines.push(`Raffel Explain: ${explanation.query}`)

  if (explanation.kind === 'operation') {
    const operation = explanation.operation
    lines.push(`Kind: operation (${operation.kind})`)
    lines.push(`Service: ${operation.service}`)
    lines.push(`Source: ${formatSource(operation.source)}`)
    lines.push(`Bindings: ${operation.transports.map(formatBindingFull).join(' | ') || 'none'}`)
    lines.push(`Policies: ${summarizePolicies(operation)}`)
    lines.push(`Schemas: input=${summarizeSchema(operation.schema.input)}, output=${summarizeSchema(operation.schema.output)}`)
  } else if (explanation.kind === 'channel') {
    const channel = explanation.channel
    lines.push(`Kind: channel (${channel.type})`)
    lines.push(`Source: ${formatSource(channel.source)}`)
    lines.push(`Auth: ${channel.auth}`)
    lines.push(`Transport: ${formatBindingFull(channel.transport)}`)
    lines.push(`Events: ${channel.events.map((event) => `${event.name} (${summarizeSchema(event.input)})`).join(', ') || 'none'}`)
  } else if (explanation.kind === 'service') {
    lines.push('Kind: service')
    lines.push(`Operations: ${explanation.operations.map((operation) => operation.name).join(', ') || 'none'}`)
  } else if (explanation.kind === 'transport') {
    const transport = explanation.transport
    lines.push(`Kind: transport (${transport.protocol})`)
    lines.push(`Address: ${formatAddress(transport)}`)
    lines.push(`Path: ${transport.path ?? 'n/a'}`)
    lines.push(`Shared: ${transport.shared ? 'yes' : 'no'}`)
    lines.push(`Source: ${transport.source ?? 'unknown'}`)
  } else if (explanation.kind === 'transport-handler') {
    const handler = explanation.handler
    lines.push(`Kind: transport-handler (${handler.protocol}:${handler.mode})`)
    lines.push(`Source: ${formatSource(handler.source)}`)
    lines.push(`Target: ${formatTransportHandlerTarget(handler)}`)
  } else {
    lines.push(`Kind: binding (${explanation.bindingId})`)
    lines.push(`Bindings: ${explanation.bindings.map(formatBindingFull).join(' | ') || 'none'}`)
    lines.push(`Operations: ${explanation.operations.map((operation) => operation.name).join(', ') || 'none'}`)
    lines.push(`Channels: ${explanation.channels.map((channel) => channel.name).join(', ') || 'none'}`)
  }

  lines.push('')
  lines.push('Diagnostics')
  if (explanation.diagnostics.length === 0) {
    lines.push('- none')
  } else {
    for (const diagnostic of explanation.diagnostics) {
      lines.push(formatDiagnostic(diagnostic))
    }
  }

  return lines.join('\n')
}

export function formatRuntimeInspectionDoctorReport(
  report: RuntimeInspectionDoctorReport
): string {
  const lines: string[] = []

  lines.push('Raffel Doctor')
  lines.push(
    `Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} infos `
    + `(${report.summary.total} total)`
  )
  lines.push('')
  lines.push('Diagnostics')

  if (report.diagnostics.length === 0) {
    lines.push('- clean')
    return lines.join('\n')
  }

  for (const diagnostic of report.diagnostics) {
    lines.push(formatDiagnostic(diagnostic))
  }

  return lines.join('\n')
}
