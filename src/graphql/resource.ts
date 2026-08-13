import type { GraphQLResolveInfo } from 'graphql'
import type { z } from 'zod'
import type { Context } from '../types/context.js'
import type { Decision, Policy, Resource } from '../middleware/policy/types.js'

export const GRAPHQL_POLICY_BRIDGE_KEY = Symbol.for('raffel.graphql.policyBridge')
export const GRAPHQL_EXECUTION_BRIDGE_KEY = Symbol.for('raffel.graphql.executionBridge')
export const GRAPHQL_AUTHENTICATION_BRIDGE_KEY = Symbol.for('raffel.graphql.authenticationBridge')

export type GraphQLAuthRequirement = 'required' | 'optional' | 'none'

export interface GraphQLAuthenticationBridge {
  readonly mode: 'router' | 'inherit'
  authenticate(
    ctx: Context,
    requirement: GraphQLAuthRequirement | undefined,
    fieldName: string
  ): Promise<void>
}

export interface GraphQLExecutionBridge {
  executeProcedure(name: string, input: unknown, ctx: Context): Promise<unknown>
  executeStream(name: string, input: unknown, ctx: Context): AsyncIterable<unknown>
}

export type GraphQLResourceResolver<
  TParent = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = (
  parent: TParent,
  args: TArgs,
  ctx: Context,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>

export type GraphQLResourcePolicyMode = 'all' | 'any'
export type GraphQLResourcePolicyDenyBehavior = 'throw' | 'null' | 'filter'

export interface GraphQLResourceFieldAuthz<
  TValue = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TParent = unknown,
> {
  action: string
  resource: (
    value: TValue,
    args: TArgs,
    ctx: Context,
    parent?: TParent
  ) => Resource | Resource[] | null | Promise<Resource | Resource[] | null>
  mode?: GraphQLResourcePolicyMode
  onDeny?: GraphQLResourcePolicyDenyBehavior
}

export interface GraphQLPolicyBridge {
  readonly defaultMode?: 'allow' | 'deny'
  evaluate(
    ctx: Context,
    authz: GraphQLResourceFieldAuthz,
    value: unknown,
    args: Record<string, unknown>,
    parent?: unknown
  ): Promise<Decision>
  evaluateOperation?(
    ctx: Context,
    authorization: GraphQLOperationPolicyResolution
  ): Promise<Decision>
}

export interface GraphQLOperationPolicyInput {
  operationName?: string
  operationType: 'query' | 'mutation' | 'subscription'
  variables?: Record<string, unknown>
}

export interface GraphQLOperationPolicyResolution {
  action: string
  resource: Resource | Resource[] | null
  mode?: GraphQLResourcePolicyMode
}

export type GraphQLOperationPolicyResolver = (
  operation: GraphQLOperationPolicyInput,
  ctx: Context
) => GraphQLOperationPolicyResolution | Promise<GraphQLOperationPolicyResolution>

export interface GraphQLResourceRootFieldConfig<
  TParent = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TValue = unknown,
> {
  field?: string
  description?: string
  args?: Record<string, z.ZodTypeAny>
  input?: z.ZodTypeAny
  output?: z.ZodTypeAny
  many?: boolean
  nullable?: boolean
  pagination?: boolean | {
    style?: 'offset' | 'cursor'
    defaultLimit?: number
    maxLimit?: number
    cursorField?: string
  }
  /** Authentication requirement for direct resolvers. Omit to inherit GraphQL security mode. */
  auth?: GraphQLAuthRequirement
  /** Execute an existing Raffel procedure through its complete Router pipeline. */
  procedureRef?: string
  /** Direct resolver escape hatch. Either resolver or procedureRef is required. */
  resolver?: GraphQLResourceResolver<TParent, TArgs, TValue | TValue[] | null>
  /**
   * Pre-resolver authorization for operation-level gates. Use this for
   * mutation guards or list/get access checks that can be decided from args.
   */
  authorize?: GraphQLResourceFieldAuthz<TParent, TArgs, TParent>
  /**
   * Post-resolver authorization for the returned value. Lists can use
   * `onDeny: 'filter'`; nullable fields can use `onDeny: 'null'`.
   */
  authz?: GraphQLResourceFieldAuthz<TValue, TArgs, TParent>
}

export interface GraphQLResourceRelationConfig<
  TParent = unknown,
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TValue = unknown,
> {
  type: string
  description?: string
  args?: Record<string, z.ZodTypeAny>
  many?: boolean
  nullable?: boolean
  /** Authentication requirement for direct resolver/loader relations. */
  auth?: GraphQLAuthRequirement
  resolver?: GraphQLResourceResolver<TParent, TArgs, TValue | TValue[] | null>
  /** Procedure receives `{ parent, args }` through the Raffel Router. */
  procedureRef?: string
  batchKey?: (parent: TParent) => unknown
  loader?: string
  authz?: GraphQLResourceFieldAuthz<TValue, TArgs, TParent>
}

export interface GraphQLResourceSubscriptionFieldConfig<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TValue = unknown,
> {
  field?: string
  description?: string
  args?: Record<string, z.ZodTypeAny>
  input?: z.ZodTypeAny
  output?: z.ZodTypeAny
  nullable?: boolean
  /** Authentication requirement for direct subscriptions. */
  auth?: GraphQLAuthRequirement
  /** Existing Raffel server stream to expose as a subscription. */
  streamRef?: string
  /** Direct AsyncIterable-producing resolver escape hatch. */
  subscribe?: GraphQLResourceResolver<unknown, TArgs, AsyncIterable<TValue>>
  /** Authorization gate evaluated before creating the AsyncIterable. */
  authorize?: GraphQLResourceFieldAuthz<unknown, TArgs, unknown>
  /** Authorization evaluated for each emitted value. */
  authz?: GraphQLResourceFieldAuthz<TValue, TArgs, unknown>
}

export interface GraphQLResourceConfig<TRecord = unknown> {
  name: string
  pluralName?: string
  schema: z.ZodObject<z.ZodRawShape>
  id?: keyof TRecord & string
  description?: string
  queries?: Record<string, GraphQLResourceRootFieldConfig<unknown, Record<string, unknown>, TRecord>>
  mutations?: Record<string, GraphQLResourceRootFieldConfig<unknown, Record<string, unknown>, TRecord>>
  subscriptions?: Record<string, GraphQLResourceSubscriptionFieldConfig<Record<string, unknown>, TRecord>>
  relations?: Record<string, GraphQLResourceRelationConfig<TRecord>>
}

export interface LoadedGraphQLResource<TRecord = unknown> extends GraphQLResourceConfig<TRecord> {
  filePath: string
  namespace?: string
  /**
   * Co-located policies discovered next to the resource file or via folder
   * cascade. Registered into the policy engine before GraphQL authz resolves.
   */
  coLocatedPolicies?: Policy[]
}

export function graphqlResource<TRecord = unknown>(
  config: GraphQLResourceConfig<TRecord>
): GraphQLResourceConfig<TRecord> {
  return config
}
