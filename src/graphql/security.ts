import { GraphQLError } from 'graphql'
import { isRaffelLikeError } from '../core/error.js'
import type { AuthenticationRuntime } from '../middleware/auth.js'
import type { Context, Envelope } from '../types/index.js'
import type { GraphQLDiagnostic, GraphQLOptions } from './types.js'
import {
  GRAPHQL_AUTHENTICATION_BRIDGE_KEY,
  GRAPHQL_POLICY_BRIDGE_KEY,
  type GraphQLAuthenticationBridge,
  type GraphQLAuthRequirement,
  type GraphQLPolicyBridge,
} from './resource.js'

export class GraphQLAdapterError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function createGraphQLAuthenticationBridge(
  authenticationRuntime: AuthenticationRuntime | undefined,
  securityMode: 'router' | 'inherit',
  metadata: Record<string, string>,
): GraphQLAuthenticationBridge {
  return {
    mode: securityMode,
    async authenticate(ctx, requirement, fieldName) {
      const effective = requirement ?? (securityMode === 'inherit' ? 'required' : undefined)
      if (!effective || effective === 'none') return
      if (!authenticationRuntime) {
        throw new GraphQLError('GraphQL authentication is not configured', {
          extensions: { code: 'FAILED_PRECONDITION' },
        })
      }
      try {
        await authenticationRuntime.authenticate(
          createAuthEnvelope(ctx, metadata, fieldName),
          ctx,
          effective,
        )
      } catch (error) {
        const code = isRaffelLikeError(error) ? error.code : 'UNAUTHENTICATED'
        throw new GraphQLError(error instanceof Error ? error.message : 'Authentication failed', {
          extensions: { code },
        })
      }
    },
  }
}

function createAuthEnvelope(
  ctx: Context,
  metadata: Record<string, string>,
  operationName: string,
): Envelope {
  return {
    id: ctx.requestId,
    procedure: `graphql.${operationName}`,
    type: 'request',
    payload: ctx.input.body,
    metadata,
    context: ctx,
  }
}

export async function authenticateGraphQLResolver(
  ctx: unknown,
  requirement: GraphQLAuthRequirement | undefined,
  fieldName: string,
): Promise<void> {
  if (requirement === 'none') return
  const context = ctx as { extensions?: Map<unknown, unknown> }
  const bridge = context?.extensions instanceof Map
    ? context.extensions.get(GRAPHQL_AUTHENTICATION_BRIDGE_KEY) as GraphQLAuthenticationBridge | undefined
    : undefined
  if (!bridge && requirement === undefined) return
  if (!bridge) {
    throw new GraphQLError('GraphQL authentication bridge is unavailable', {
      extensions: { code: 'FAILED_PRECONDITION' },
    })
  }
  await bridge.authenticate(ctx as never, requirement, fieldName)
}

export function validateCustomSchemaSecurity(
  config: GraphQLOptions,
  authenticationRuntime: AuthenticationRuntime | undefined,
  policyBridge: GraphQLPolicyBridge | undefined,
): string | undefined {
  const mode = config.security?.mode ?? 'router'
  const security = config.security?.customSchema
  const auth = security?.auth ?? (mode === 'inherit' ? 'required' : undefined)
  if (auth && auth !== 'none' && !authenticationRuntime) {
    throw new Error('Custom GraphQL schema requires authentication but no auth middleware is configured')
  }
  if (security?.authorize && !policyBridge?.evaluateOperation) {
    throw new Error('Custom GraphQL schema authorization requires Raffel policy configuration')
  }
  if (policyBridge?.defaultMode === 'deny' && auth !== undefined && auth !== 'none' && !security?.authorize) {
    throw new Error('Custom GraphQL schema requires an operation policy under default-deny')
  }
  return mode === 'router' && !security
    ? 'Custom GraphQL schema uses legacy router-mode security; configure security.customSchema'
    : undefined
}

export async function enforceCustomSchemaSecurity(
  config: GraphQLOptions,
  ctx: Context,
  operation: {
    name?: { value: string } | null
    operation: 'query' | 'mutation' | 'subscription'
  },
  variables: Record<string, unknown> | undefined,
): Promise<void> {
  const mode = config.security?.mode ?? 'router'
  const security = config.security?.customSchema
  const auth = security?.auth ?? (mode === 'inherit' ? 'required' : undefined)
  const authenticationBridge = ctx.extensions.get(
    GRAPHQL_AUTHENTICATION_BRIDGE_KEY,
  ) as GraphQLAuthenticationBridge | undefined

  if (auth && auth !== 'none') {
    try {
      await authenticationBridge?.authenticate(ctx, auth, operation.name?.value ?? 'anonymous')
    } catch (error) {
      const code = error instanceof GraphQLError
        ? String(error.extensions.code ?? 'UNAUTHENTICATED')
        : 'UNAUTHENTICATED'
      throw new GraphQLAdapterError(
        code,
        code === 'PERMISSION_DENIED' ? 403 : 401,
        error instanceof Error ? error.message : 'Authentication failed',
      )
    }
  }

  if (!security?.authorize) return
  const policyBridge = ctx.extensions.get(GRAPHQL_POLICY_BRIDGE_KEY) as GraphQLPolicyBridge | undefined
  if (!policyBridge?.evaluateOperation) {
    throw new GraphQLAdapterError(
      'FAILED_PRECONDITION',
      500,
      'GraphQL operation policy bridge is unavailable',
    )
  }
  const authorization = await security.authorize({
    operationName: operation.name?.value,
    operationType: operation.operation,
    variables,
  }, ctx)
  const decision = await policyBridge.evaluateOperation(ctx, authorization)
  if (!decision.allowed) {
    throw new GraphQLAdapterError('PERMISSION_DENIED', 403, 'Policy denied')
  }
}

export function getDirectSecurityDiagnostics(input: {
  name: string
  routerRef?: string
  auth?: GraphQLAuthRequirement
  hasRequiredPolicyGate: boolean
  requiresPreAuthorization: boolean
  source: string
  securityMode: 'router' | 'inherit'
  authenticationAvailable: boolean
  policyDefaultMode?: 'allow' | 'deny'
}): GraphQLDiagnostic[] {
  if (input.routerRef) {
    return input.auth === undefined ? [] : [{
      severity: 'error',
      code: 'CONFLICTING_AUTH_CONFIG',
      message: `GraphQL field "${input.name}" uses a Router reference and cannot declare auth`,
      source: input.source,
      fatal: true,
    }]
  }

  const diagnostics: GraphQLDiagnostic[] = []
  if (input.securityMode === 'router' && input.auth === undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'DIRECT_RESOLVER_AUTH_LEGACY',
      message: `Direct GraphQL field "${input.name}" has legacy router-mode security; declare auth or enable security.mode: 'inherit'`,
      source: input.source,
    })
  }

  const effective = input.auth ?? (input.securityMode === 'inherit' ? 'required' : undefined)
  if (effective && effective !== 'none' && !input.authenticationAvailable) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_AUTHENTICATOR',
      message: `GraphQL field "${input.name}" requires authentication but no auth middleware is configured`,
      source: input.source,
      fatal: true,
    })
  }
  if (
    input.policyDefaultMode === 'deny'
    && effective !== undefined
    && effective !== 'none'
    && !input.hasRequiredPolicyGate
  ) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_FIELD_POLICY',
      message: input.requiresPreAuthorization
        ? `GraphQL field "${input.name}" requires a pre-resolver authorize policy under default-deny`
        : `GraphQL field "${input.name}" requires authorize or authz policy coverage under default-deny`,
      source: input.source,
      fatal: true,
    })
  }
  return diagnostics
}

export function validateDirectSecurity(
  name: string,
  routerRef: string | undefined,
  auth: GraphQLAuthRequirement | undefined,
  hasRequiredPolicyGate: boolean,
  requiresPreAuthorization: boolean,
  source: string,
  ctx: {
    diagnostics: GraphQLDiagnostic[]
    securityMode: 'router' | 'inherit'
    authenticationAvailable: boolean
    policyDefaultMode?: 'allow' | 'deny'
  },
): void {
  ctx.diagnostics.push(...getDirectSecurityDiagnostics({
    name,
    routerRef,
    auth,
    hasRequiredPolicyGate,
    requiresPreAuthorization,
    source,
    securityMode: ctx.securityMode,
    authenticationAvailable: ctx.authenticationAvailable,
    policyDefaultMode: ctx.policyDefaultMode,
  }))
}
