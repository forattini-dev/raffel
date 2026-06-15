import type { GraphQLResolveInfo } from 'graphql'
import type { z } from 'zod'
import type { Context } from '../types/context.js'
import type { Decision, Resource } from '../middleware/policy/types.js'

export const GRAPHQL_POLICY_BRIDGE_KEY = Symbol.for('raffel.graphql.policyBridge')

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
  evaluate(
    ctx: Context,
    authz: GraphQLResourceFieldAuthz,
    value: unknown,
    args: Record<string, unknown>,
    parent?: unknown
  ): Promise<Decision>
}

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
  resolver: GraphQLResourceResolver<TParent, TArgs, TValue | TValue[] | null>
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
  resolver?: GraphQLResourceResolver<TParent, TArgs, TValue | TValue[] | null>
  batchKey?: (parent: TParent) => unknown
  loader?: string
  authz?: GraphQLResourceFieldAuthz<TValue, TArgs, TParent>
}

export interface GraphQLResourceConfig<TRecord = unknown> {
  name: string
  pluralName?: string
  schema: z.ZodObject<z.ZodRawShape>
  id?: keyof TRecord & string
  description?: string
  queries?: Record<string, GraphQLResourceRootFieldConfig<unknown, Record<string, unknown>, TRecord>>
  mutations?: Record<string, GraphQLResourceRootFieldConfig<unknown, Record<string, unknown>, TRecord>>
  relations?: Record<string, GraphQLResourceRelationConfig<TRecord>>
}

export interface LoadedGraphQLResource<TRecord = unknown> extends GraphQLResourceConfig<TRecord> {
  filePath: string
  namespace?: string
}

export function graphqlResource<TRecord = unknown>(
  config: GraphQLResourceConfig<TRecord>
): GraphQLResourceConfig<TRecord> {
  return config
}
