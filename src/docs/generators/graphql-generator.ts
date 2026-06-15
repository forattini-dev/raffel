/**
 * GraphQL Generator for USD
 *
 * Converts operation-first registry fields and resource-first GraphQL
 * discovery resources into `x-usd.graphql`.
 */

import type { Registry } from '../../core/registry.js'
import type {
  USDContentTypes,
  USDGraphQL,
  USDGraphQLAuthz,
  USDGraphQLOperation,
  USDGraphQLRelation,
  USDGraphQLResource,
  USDSchema,
} from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import type { HandlerSchema, SchemaRegistry } from '../../validation/index.js'
import type {
  GraphQLResourceFieldAuthz,
  GraphQLResourceRelationConfig,
  GraphQLResourceRootFieldConfig,
  LoadedGraphQLResource,
} from '../../graphql/index.js'
import { convertSchema, createDocSchemaRegistry, type ConvertedSchemaRegistry } from './schema-converter.js'

export interface GraphQLGeneratorOptions {
  /** GraphQL endpoint path */
  endpoint?: string
  /** Protocol content types */
  contentTypes?: USDContentTypes
}

export interface GraphQLGeneratorContext {
  registry: Registry
  schemaRegistry?: SchemaRegistry
  graphqlResources?: LoadedGraphQLResource[]
}

export interface GraphQLGeneratorResult {
  graphql: USDGraphQL
  schemas: Record<string, USDSchema>
  tags: string[]
}

const QUERY_PREFIXES = ['get', 'list', 'find', 'search', 'fetch', 'load', 'read', 'check', 'is', 'has', 'count']

export function generateGraphQL(
  ctx: GraphQLGeneratorContext,
  options: GraphQLGeneratorOptions = {},
): GraphQLGeneratorResult {
  const {
    endpoint = '/graphql',
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.graphql,
  } = options

  const schemaRegistry = createDocSchemaRegistry()
  const resources: Record<string, USDGraphQLResource> = {}
  const queries: Record<string, USDGraphQLOperation> = {}
  const mutations: Record<string, USDGraphQLOperation> = {}
  const subscriptions: Record<string, USDGraphQLOperation> = {}
  const tags = new Set<string>()

  for (const meta of ctx.registry.listProcedures()) {
    const schema = ctx.schemaRegistry?.get(meta.name)
    if (!schema) continue
    const field = defaultFieldNameGenerator(meta.name)
    const kind = isQueryProcedure(meta.name, meta.graphql?.type) ? 'query' : 'mutation'
    const operation = convertHandlerOperation(field, kind, 'procedure', meta.name, schema, schemaRegistry, meta.description, meta.tags)
    if (kind === 'query') queries[field] = operation
    else mutations[field] = operation
    for (const tag of operation.tags ?? []) tags.add(tag)
  }

  for (const meta of ctx.registry.listStreams()) {
    const schema = ctx.schemaRegistry?.get(meta.name)
    if (!schema) continue
    const field = defaultFieldNameGenerator(meta.name)
    const operation = convertHandlerOperation(field, 'subscription', 'stream', meta.name, schema, schemaRegistry, meta.description)
    subscriptions[field] = operation
    for (const tag of operation.tags ?? []) tags.add(tag)
  }

  for (const resource of ctx.graphqlResources ?? []) {
    const resourceSchemaName = `${sanitizeName(resource.name)}GraphQLResource`
    const resourceSchema = schemaRegistry.add(resourceSchemaName, resource.schema)
    resources[resource.name] = convertResource(resource, resourceSchema, schemaRegistry)
    tags.add(resource.namespace ?? resource.name)

    for (const [key, field] of Object.entries(resource.queries ?? {})) {
      const fieldName = field.field ?? key
      queries[fieldName] = convertResourceOperation(resource, key, fieldName, 'query', field, schemaRegistry)
    }

    for (const [key, field] of Object.entries(resource.mutations ?? {})) {
      const fieldName = field.field ?? key
      mutations[fieldName] = convertResourceOperation(resource, key, fieldName, 'mutation', field, schemaRegistry)
    }
  }

  const graphql: USDGraphQL = {
    endpoint,
    contentTypes,
  }
  if (Object.keys(resources).length > 0) graphql.resources = resources
  if (Object.keys(queries).length > 0) graphql.queries = queries
  if (Object.keys(mutations).length > 0) graphql.mutations = mutations
  if (Object.keys(subscriptions).length > 0) graphql.subscriptions = subscriptions

  return {
    graphql,
    schemas: schemaRegistry.toObject(),
    tags: [...tags],
  }
}

function convertResource(
  resource: LoadedGraphQLResource,
  schema: USDSchema,
  schemaRegistry: ConvertedSchemaRegistry,
): USDGraphQLResource {
  const out: USDGraphQLResource = {
    name: resource.name,
    schema,
    ...(resource.pluralName ? { pluralName: resource.pluralName } : {}),
    ...(resource.namespace ? { namespace: resource.namespace } : {}),
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.id ? { idField: resource.id } : {}),
    ...(resource.filePath ? { source: resource.filePath } : {}),
    ...(resource.coLocatedPolicies?.length ? { policies: resource.coLocatedPolicies.map((policy) => policy.id) } : {}),
  }

  const relations = convertRelations(resource.name, resource.relations, schemaRegistry)
  if (Object.keys(relations).length > 0) out.relations = relations
  return out
}

function convertRelations(
  resourceName: string,
  relations: Record<string, GraphQLResourceRelationConfig<unknown>> | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
): Record<string, USDGraphQLRelation> {
  const out: Record<string, USDGraphQLRelation> = {}
  for (const [name, relation] of Object.entries(relations ?? {})) {
    out[name] = {
      type: relation.type,
      ...(relation.description ? { description: relation.description } : {}),
      ...(relation.many !== undefined ? { many: relation.many } : {}),
      ...(relation.nullable !== undefined ? { nullable: relation.nullable } : {}),
      ...(relation.args ? { args: convertArgsSchema(`${resourceName}${sanitizeName(name)}RelationArgs`, relation.args, schemaRegistry) } : {}),
      ...(relation.loader ? { loader: relation.loader } : {}),
      ...(relation.batchKey ? { batchKey: true } : {}),
      ...(relation.authz ? { authz: convertAuthz(relation.authz) } : {}),
    }
  }
  return out
}

function convertResourceOperation(
  resource: LoadedGraphQLResource,
  key: string,
  fieldName: string,
  kind: 'query' | 'mutation',
  field: GraphQLResourceRootFieldConfig,
  schemaRegistry: ConvertedSchemaRegistry,
): USDGraphQLOperation {
  const schemaPrefix = `${sanitizeName(resource.name)}${sanitizeName(key)}`
  const many = field.many ?? (key === 'list' || Boolean(field.pagination))
  const resourceSchemaRef = schemaRegistry.ref(`${sanitizeName(resource.name)}GraphQLResource`)
  const output = field.output
    ? schemaRegistry.add(`${schemaPrefix}Output`, field.output)
    : many
      ? { type: 'array', items: resourceSchemaRef } as USDSchema
      : resourceSchemaRef

  return {
    field: fieldName,
    kind,
    source: 'resource',
    resource: resource.name,
    ...(field.description ? { description: field.description } : {}),
    ...(field.args ? { args: convertArgsSchema(`${schemaPrefix}Args`, field.args, schemaRegistry) } : {}),
    ...(field.input ? { input: schemaRegistry.add(`${schemaPrefix}Input`, field.input) } : {}),
    output,
    ...(many !== undefined ? { many } : {}),
    ...(field.nullable !== undefined ? { nullable: field.nullable } : {}),
    ...(field.pagination ? { pagination: normalizePagination(field.pagination) } : {}),
    ...(field.authorize ? { authorize: convertAuthz(field.authorize) } : {}),
    ...(field.authz ? { authz: convertAuthz(field.authz) } : {}),
    tags: [resource.namespace ?? resource.name],
  }
}

function convertHandlerOperation(
  field: string,
  kind: 'query' | 'mutation' | 'subscription',
  source: 'procedure' | 'stream' | 'event',
  name: string,
  schema: HandlerSchema,
  schemaRegistry: ConvertedSchemaRegistry,
  description?: string,
  tags?: string[],
): USDGraphQLOperation {
  const schemaPrefix = `${sanitizeName(name)}GraphQL`
  return {
    field,
    kind,
    source,
    description: description ?? name,
    ...(schema.input ? { input: schemaRegistry.add(`${schemaPrefix}Input`, schema.input) } : {}),
    ...(schema.output ? { output: schemaRegistry.add(`${schemaPrefix}Output`, schema.output) } : {}),
    tags: tags ?? extractTags(name),
  }
}

function convertArgsSchema(
  name: string,
  args: Record<string, unknown>,
  schemaRegistry: ConvertedSchemaRegistry,
): USDSchema {
  const schema: USDSchema = {
    type: 'object',
    properties: {},
  }
  const properties = schema.properties as Record<string, USDSchema>
  for (const [argName, argSchema] of Object.entries(args)) {
    properties[argName] = convertSchema(argSchema)
  }
  schemaRegistry.schemas.set(name, schema)
  return schema
}

function convertAuthz(authz: GraphQLResourceFieldAuthz): USDGraphQLAuthz {
  return {
    action: authz.action,
    mode: authz.mode ?? 'all',
    ...(authz.onDeny ? { onDeny: authz.onDeny } : {}),
    'has-resource-resolver': typeof authz.resource === 'function',
  }
}

function normalizePagination(
  pagination: Exclude<GraphQLResourceRootFieldConfig['pagination'], undefined | false>,
): NonNullable<USDGraphQLOperation['pagination']> {
  if (pagination === true) return { style: 'offset' }
  return {
    style: pagination.style ?? 'offset',
    ...(pagination.defaultLimit !== undefined ? { defaultLimit: pagination.defaultLimit } : {}),
    ...(pagination.maxLimit !== undefined ? { maxLimit: pagination.maxLimit } : {}),
    ...(pagination.cursorField !== undefined ? { cursorField: pagination.cursorField } : {}),
  }
}

function isQueryProcedure(name: string, type: 'query' | 'mutation' | undefined): boolean {
  if (type) return type === 'query'
  const nameLower = name.toLowerCase()
  const lastSegment = name.split('.').pop()?.toLowerCase() ?? nameLower
  return QUERY_PREFIXES.some((prefix) => lastSegment.startsWith(prefix))
}

function defaultFieldNameGenerator(handlerName: string): string {
  const parts = handlerName.split(/[.\-_]/)
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

function sanitizeName(name: string): string {
  const value = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return value || 'GraphQL'
}

function extractTags(name: string): string[] {
  const parts = name.split(/[.\-_]/).filter(Boolean)
  return parts.length > 1 ? [parts[0]] : []
}
