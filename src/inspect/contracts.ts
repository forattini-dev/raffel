import type {
  RuntimeInspectionChannel,
  RuntimeInspectionDiagnostic,
  RuntimeInspectionGraph,
  RuntimeInspectionOperation,
  RuntimeInspectionTransportBinding,
} from './types.js'
import { formatBindingLabel } from './format-utils.js'
import {
  createSchemaExample,
  createSchemaInvalidExample,
  getSchemaObjectExample,
} from './schema-samples.js'
import { buildGraphQLDocument } from './graphql-document.js'
import { extractPathParameters } from './path-params.js'

export type RuntimeContractTestCaseKind =
  | 'authorized'
  | 'unauthorized'
  | 'invalid-input'
  | 'cross-transport'

export interface RuntimeContractRequestTemplate {
  headers?: Record<string, string>
  metadata?: Record<string, string>
  params?: Record<string, string>
  query?: Record<string, unknown>
  body?: unknown
  document?: string
}

export interface RuntimeContractBindingTarget {
  bindingId: string
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimeInspectionTransportBinding['mode']
  label: string
}

export interface RuntimeContractTestCase {
  id: string
  kind: RuntimeContractTestCaseKind
  title: string
  operationId?: string
  channelId?: string
  targets: RuntimeContractBindingTarget[]
  request?: RuntimeContractRequestTemplate
  expectations: {
    authRequired?: boolean
    rejectsUnauthorized?: boolean
    rejectsInvalidInput?: boolean
    alignedAcrossTransports?: boolean
    requestIdPropagation?: boolean
  }
}

export interface RuntimeContractTestSuite {
  generatedAt: string
  summary: {
    total: number
    authorized: number
    unauthorized: number
    invalidInput: number
    crossTransport: number
  }
  checks: RuntimeContractTestCase[]
  diagnostics: RuntimeInspectionDiagnostic[]
}

function createTarget(binding: RuntimeInspectionTransportBinding): RuntimeContractBindingTarget {
  return {
    bindingId: binding.id,
    protocol: binding.protocol,
    mode: binding.mode,
    label: formatBindingLabel(binding),
  }
}

function supportsInteractiveChecks(binding: RuntimeInspectionTransportBinding): boolean {
  return (
    binding.protocol === 'http'
    || binding.protocol === 'jsonrpc'
    || binding.protocol === 'graphql'
    || binding.protocol === 'grpc'
    || binding.protocol === 'websocket'
  )
}

function buildRequestTemplate(
  operation: RuntimeInspectionOperation,
  binding: RuntimeInspectionTransportBinding
): RuntimeContractRequestTemplate {
  const bodyExample = createSchemaExample(operation.schema.input)
  const inputObject = getSchemaObjectExample(operation.schema.input)
  const headers: Record<string, string> = {}

  if (binding.protocol === 'http') {
    if (binding.method && binding.method !== 'GET') {
      headers['content-type'] = 'application/json'
    }

    const params = Object.fromEntries(
      extractPathParameters(binding.path).map((name) => [name, `example-${name}`])
    )
    const query = binding.method === 'GET'
      ? Object.fromEntries(
          Object.entries(inputObject).filter(([key]) => !(key in params))
        )
      : {}

    return {
      headers,
      params,
      query,
      body: binding.method === 'GET' ? undefined : bodyExample,
    }
  }

  if (binding.protocol === 'jsonrpc') {
    return {
      headers: { 'content-type': 'application/json' },
      metadata: {},
      body: bodyExample,
    }
  }

  if (binding.protocol === 'graphql') {
    return {
      headers: { 'content-type': 'application/json' },
      document: buildGraphQLDocument(
        operation,
        binding.field ?? operation.name,
        binding.mode === 'query' ? 'query' : 'mutation'
      ),
      body: inputObject,
    }
  }

  if (binding.protocol === 'grpc') {
    return {
      metadata: {},
      body: bodyExample,
    }
  }

  if (binding.protocol === 'websocket') {
    return {
      metadata: {},
      body: bodyExample,
    }
  }

  return {
    body: bodyExample,
  }
}

function buildInvalidRequestTemplate(
  operation: RuntimeInspectionOperation,
  binding: RuntimeInspectionTransportBinding
): RuntimeContractRequestTemplate {
  const invalid = createSchemaInvalidExample(operation.schema.input)
  const template = buildRequestTemplate(operation, binding)

  return {
    ...template,
    body: invalid,
    query: binding.protocol === 'http' && binding.method === 'GET'
      ? { invalid }
      : template.query,
  }
}

function addOperationChecks(
  checks: RuntimeContractTestCase[],
  operation: RuntimeInspectionOperation
): void {
  const supportedBindings = operation.transports.filter(supportsInteractiveChecks)
  if (supportedBindings.length === 0) {
    return
  }

  const requiresAuth = !!operation.policies.effective?.auth

  for (const binding of supportedBindings) {
    if (requiresAuth) {
      checks.push({
        id: `${operation.id}:${binding.id}:unauthorized`,
        kind: 'unauthorized',
        title: `${operation.name} rejects unauthorized ${binding.protocol.toUpperCase()} access`,
        operationId: operation.id,
        targets: [createTarget(binding)],
        request: buildRequestTemplate(operation, binding),
        expectations: {
          authRequired: true,
          rejectsUnauthorized: true,
          requestIdPropagation: true,
        },
      })

      checks.push({
        id: `${operation.id}:${binding.id}:authorized`,
        kind: 'authorized',
        title: `${operation.name} accepts authorized ${binding.protocol.toUpperCase()} access`,
        operationId: operation.id,
        targets: [createTarget(binding)],
        request: {
          ...buildRequestTemplate(operation, binding),
          headers: {
            authorization: 'Bearer devx-test-token',
            ...(buildRequestTemplate(operation, binding).headers ?? {}),
          },
          metadata: {
            authorization: 'Bearer devx-test-token',
            ...(buildRequestTemplate(operation, binding).metadata ?? {}),
          },
        },
        expectations: {
          authRequired: true,
          requestIdPropagation: true,
        },
      })
    }

    if (operation.schema.input.present) {
      checks.push({
        id: `${operation.id}:${binding.id}:invalid-input`,
        kind: 'invalid-input',
        title: `${operation.name} rejects invalid input over ${binding.protocol.toUpperCase()}`,
        operationId: operation.id,
        targets: [createTarget(binding)],
        request: buildInvalidRequestTemplate(operation, binding),
        expectations: {
          rejectsInvalidInput: true,
          requestIdPropagation: true,
        },
      })
    }
  }

  if (supportedBindings.length > 1) {
    checks.push({
      id: `${operation.id}:cross-transport`,
      kind: 'cross-transport',
      title: `${operation.name} stays aligned across transports`,
      operationId: operation.id,
      targets: supportedBindings.map(createTarget),
      request: buildRequestTemplate(operation, supportedBindings[0]),
      expectations: {
        alignedAcrossTransports: true,
        requestIdPropagation: true,
        authRequired: requiresAuth || undefined,
      },
    })
  }
}

function addChannelChecks(
  checks: RuntimeContractTestCase[],
  channel: RuntimeInspectionChannel
): void {
  if (channel.auth === 'required') {
    checks.push({
      id: `${channel.id}:unauthorized`,
      kind: 'unauthorized',
      title: `${channel.name} rejects unauthorized channel access`,
      channelId: channel.id,
      targets: [createTarget(channel.transport)],
      request: {
        metadata: {},
        body: {
          id: 'channel-subscribe',
          type: 'subscribe',
          channel: channel.name,
        },
      },
      expectations: {
        authRequired: true,
        rejectsUnauthorized: true,
      },
    })

    checks.push({
      id: `${channel.id}:authorized`,
      kind: 'authorized',
      title: `${channel.name} accepts authorized channel access`,
      channelId: channel.id,
      targets: [createTarget(channel.transport)],
      request: {
        metadata: {
          authorization: 'Bearer devx-test-token',
        },
        body: {
          id: 'channel-subscribe',
          type: 'subscribe',
          channel: channel.name,
          metadata: {
            authorization: 'Bearer devx-test-token',
          },
        },
      },
      expectations: {
        authRequired: true,
      },
    })
  }
}

export function buildRuntimeContractTestSuite(
  graph: RuntimeInspectionGraph
): RuntimeContractTestSuite {
  const checks: RuntimeContractTestCase[] = []

  for (const operation of graph.operations) {
    addOperationChecks(checks, operation)
  }

  for (const channel of graph.channels) {
    addChannelChecks(checks, channel)
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: checks.length,
      authorized: checks.filter((check) => check.kind === 'authorized').length,
      unauthorized: checks.filter((check) => check.kind === 'unauthorized').length,
      invalidInput: checks.filter((check) => check.kind === 'invalid-input').length,
      crossTransport: checks.filter((check) => check.kind === 'cross-transport').length,
    },
    checks,
    diagnostics: [...graph.diagnostics],
  }
}

export function formatRuntimeContractTestSuite(suite: RuntimeContractTestSuite): string {
  const lines = [
    'Raffel Contract Tests',
    `Summary: ${suite.summary.authorized} authorized, ${suite.summary.unauthorized} unauthorized, ${suite.summary.invalidInput} invalid-input, ${suite.summary.crossTransport} cross-transport (${suite.summary.total} total)`,
    '',
    'Checks',
  ]

  if (suite.checks.length === 0) {
    lines.push('- none')
    return lines.join('\n')
  }

  for (const check of suite.checks) {
    lines.push(`- [${check.kind}] ${check.title}`)
    lines.push(`  targets: ${check.targets.map((target) => `${target.protocol}:${target.label}`).join(' | ')}`)
  }

  return lines.join('\n')
}
