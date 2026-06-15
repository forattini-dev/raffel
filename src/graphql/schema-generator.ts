/**
 * GraphQL Schema Generator
 *
 * Auto-generates GraphQL schema from Raffel handlers and normalized schemas.
 *
 * Mapping:
 * - Procedures → Query (read operations) or Mutation (write operations)
 * - Streams → Subscription
 * - Events → Mutation (fire-and-forget, if enabled)
 */

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLScalarType,
  GraphQLFieldConfig,
  GraphQLInputFieldConfig,
  GraphQLOutputType,
  GraphQLInputType,
  GraphQLError,
  type GraphQLResolveInfo,
  Kind,
} from 'graphql'
import type { Registry } from '../core/registry.js'
import {
  normalizeSchemaDescriptor,
  type SchemaRegistry,
  type HandlerSchema,
  type SchemaDescriptor,
  type SchemaDescriptorDiagnostic,
} from '../validation/index.js'
import type { HandlerMeta } from '../types/index.js'
import type {
  SchemaGenerationOptions,
  GeneratedSchemaInfo,
} from './types.js'
import {
  GRAPHQL_POLICY_BRIDGE_KEY,
  type GraphQLPolicyBridge,
  type GraphQLResourceFieldAuthz,
  type GraphQLResourceRelationConfig,
  type GraphQLResourceRootFieldConfig,
  type LoadedGraphQLResource,
} from './resource.js'
import { createLogger } from '../utils/logger.js'

const logger = createLogger('graphql-schema')

// === Custom Scalars ===

export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) {
      try {
        return JSON.parse(ast.value)
      } catch {
        return ast.value
      }
    }
    if (ast.kind === Kind.INT) return parseInt(ast.value, 10)
    if (ast.kind === Kind.FLOAT) return parseFloat(ast.value)
    if (ast.kind === Kind.BOOLEAN) return ast.value
    if (ast.kind === Kind.NULL) return null
    return undefined
  },
})

export const GraphQLDateTime = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string',
  serialize: (value) => {
    if (value instanceof Date) return value.toISOString()
    return value
  },
  parseValue: (value) => {
    if (typeof value === 'string') return new Date(value)
    return value
  },
  parseLiteral: (ast) => {
    if (ast.kind === Kind.STRING) return new Date(ast.value)
    return undefined
  },
})

// === Default Options ===

const DEFAULT_OPTIONS: Required<SchemaGenerationOptions> = {
  procedureMapping: 'prefix',
  queryPrefixes: ['get', 'list', 'find', 'search', 'fetch', 'load', 'read', 'check', 'is', 'has', 'count'],
  includeEvents: false,
  typeNameGenerator: defaultTypeNameGenerator,
  fieldNameGenerator: defaultFieldNameGenerator,
  queryDescription: 'Root query type - read operations',
  mutationDescription: 'Root mutation type - write operations',
  subscriptionDescription: 'Root subscription type - real-time streams',
}

// === Name Generators ===

function defaultTypeNameGenerator(handlerName: string): string {
  // 'users.get' → 'UsersGet'
  // 'users.getById' → 'UsersGetById'
  return handlerName
    .split(/[.\-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function defaultFieldNameGenerator(handlerName: string): string {
  // 'users.get' → 'usersGet'
  // 'users.get-by-id' → 'usersGetById'
  const parts = handlerName.split(/[.\-_]/)
  return parts
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('')
}

// === Schema Descriptor to GraphQL Type Conversion ===

interface TypeCache {
  output: Map<string, GraphQLOutputType>
  input: Map<string, GraphQLInputType>
}

type JsonSchemaObject = Record<string, unknown>

function asJsonSchemaObject(value: unknown): JsonSchemaObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchemaObject
    : null
}

function getJsonSchemaType(schema: JsonSchemaObject): string | string[] | undefined {
  return typeof schema.type === 'string' || Array.isArray(schema.type)
    ? schema.type as string | string[]
    : undefined
}

function unwrapNullableSchema(schema: JsonSchemaObject): { schema: JsonSchemaObject; nullable: boolean } {
  const type = getJsonSchemaType(schema)

  if (Array.isArray(type) && type.includes('null')) {
    const nextTypes = type.filter((entry) => entry !== 'null')
    return {
      nullable: true,
      schema: {
        ...schema,
        ...(nextTypes.length === 1 ? { type: nextTypes[0] } : { type: nextTypes }),
      },
    }
  }

  if (schema.nullable === true) {
    return {
      nullable: true,
      schema: { ...schema, nullable: undefined },
    }
  }

  return { schema, nullable: false }
}

function getSchemaDescription(schema: JsonSchemaObject): string | undefined {
  return typeof schema.description === 'string' ? schema.description : undefined
}

function getRequiredFields(schema: JsonSchemaObject): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : [])
}

function getObjectProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> | null {
  const properties = asJsonSchemaObject(schema.properties)
  if (!properties) {
    return null
  }

  return Object.fromEntries(
    Object.entries(properties)
      .map(([key, value]) => [key, asJsonSchemaObject(value)])
      .filter((entry): entry is [string, JsonSchemaObject] => entry[1] !== null)
  )
}

function enumValuesToGraphQLEnum(name: string, values: unknown[]): GraphQLEnumType | null {
  if (!values.every((value) => typeof value === 'string')) {
    return null
  }

  const enumValues: Record<string, { value: string }> = {}
  for (const value of values as string[]) {
    const enumKey = value.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    enumValues[enumKey] = { value }
  }

  return new GraphQLEnumType({
    name: `${name}Enum`,
    values: enumValues,
  })
}

function warnDescriptorDiagnostics(
  handlerName: string,
  direction: 'input' | 'output',
  diagnostics: SchemaDescriptorDiagnostic[]
): void {
  if (diagnostics.length === 0) {
    return
  }

  logger.warn(
    {
      handlerName,
      direction,
      diagnostics,
    },
    'GraphQL schema generation used Raffel opaque schema fallback'
  )
}

function descriptorToGraphQLOutput(
  descriptor: SchemaDescriptor,
  name: string,
  cache: TypeCache,
  isRequired = true
): GraphQLOutputType {
  const { schema, nullable } = unwrapNullableSchema(descriptor.jsonSchema)
  const type = getJsonSchemaType(schema)
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined

  let baseType: GraphQLOutputType

  if (schema['x-raffel-opaque'] === true || schema.oneOf || schema.anyOf || schema.allOf) {
    baseType = GraphQLJSON
  } else if (enumValues && enumValues.length > 0) {
    baseType = enumValuesToGraphQLEnum(name, enumValues) ?? GraphQLJSON
  } else if (schema.const !== undefined) {
    if (typeof schema.const === 'string') {
      baseType = GraphQLString
    } else if (typeof schema.const === 'number') {
      baseType = Number.isInteger(schema.const) ? GraphQLInt : GraphQLFloat
    } else if (typeof schema.const === 'boolean') {
      baseType = GraphQLBoolean
    } else {
      baseType = GraphQLJSON
    }
  } else {
    switch (typeof type === 'string' ? type : undefined) {
      case 'string':
        baseType = schema.format === 'date-time' ? GraphQLDateTime : GraphQLString
        break
      case 'integer':
        baseType = GraphQLInt
        break
      case 'number':
        baseType = GraphQLFloat
        break
      case 'boolean':
        baseType = GraphQLBoolean
        break
      case 'array': {
        const itemSchema = asJsonSchemaObject(schema.items)
        const itemType = itemSchema
          ? descriptorToGraphQLOutput(
              {
                ...descriptor,
                jsonSchema: itemSchema,
                diagnostics: [],
              },
              `${name}Item`,
              cache,
              true
            )
          : GraphQLJSON
        baseType = new GraphQLList(itemType)
        break
      }
      case 'object':
      default: {
        const properties = getObjectProperties(schema)
        if (!properties || Object.keys(properties).length === 0) {
          baseType = GraphQLJSON
          break
        }

        if (cache.output.has(name)) {
          baseType = cache.output.get(name)!
          break
        }

        const required = getRequiredFields(schema)
        const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}

        for (const [key, propertySchema] of Object.entries(properties)) {
          const fieldType = descriptorToGraphQLOutput(
            {
              ...descriptor,
              jsonSchema: propertySchema,
              diagnostics: [],
            },
            `${name}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            required.has(key)
          )
          fields[key] = {
            type: fieldType,
            description: getSchemaDescription(propertySchema),
          }
        }

        baseType = new GraphQLObjectType({
          name,
          fields: () => fields,
          description: getSchemaDescription(schema),
        })
        cache.output.set(name, baseType)
      }
    }
  }

  return isRequired && !nullable ? new GraphQLNonNull(baseType) : baseType
}

function descriptorToGraphQLInput(
  descriptor: SchemaDescriptor,
  name: string,
  cache: TypeCache,
  isRequired = true
): GraphQLInputType {
  const { schema, nullable } = unwrapNullableSchema(descriptor.jsonSchema)
  const type = getJsonSchemaType(schema)
  const enumValues = Array.isArray(schema.enum) ? schema.enum : undefined

  let baseType: GraphQLInputType

  if (schema['x-raffel-opaque'] === true || schema.oneOf || schema.anyOf || schema.allOf) {
    baseType = GraphQLJSON
  } else if (enumValues && enumValues.length > 0) {
    baseType = enumValuesToGraphQLEnum(name, enumValues) ?? GraphQLJSON
  } else if (schema.const !== undefined) {
    if (typeof schema.const === 'string') {
      baseType = GraphQLString
    } else if (typeof schema.const === 'number') {
      baseType = Number.isInteger(schema.const) ? GraphQLInt : GraphQLFloat
    } else if (typeof schema.const === 'boolean') {
      baseType = GraphQLBoolean
    } else {
      baseType = GraphQLJSON
    }
  } else {
    switch (typeof type === 'string' ? type : undefined) {
      case 'string':
        baseType = schema.format === 'date-time' ? GraphQLDateTime : GraphQLString
        break
      case 'integer':
        baseType = GraphQLInt
        break
      case 'number':
        baseType = GraphQLFloat
        break
      case 'boolean':
        baseType = GraphQLBoolean
        break
      case 'array': {
        const itemSchema = asJsonSchemaObject(schema.items)
        const itemType = itemSchema
          ? descriptorToGraphQLInput(
              {
                ...descriptor,
                jsonSchema: itemSchema,
                diagnostics: [],
              },
              `${name}Item`,
              cache,
              true
            )
          : GraphQLJSON
        baseType = new GraphQLList(itemType)
        break
      }
      case 'object':
      default: {
        const properties = getObjectProperties(schema)
        if (!properties || Object.keys(properties).length === 0) {
          baseType = GraphQLJSON
          break
        }

        const cacheKey = `${name}Input`
        if (cache.input.has(cacheKey)) {
          baseType = cache.input.get(cacheKey)!
          break
        }

        const required = getRequiredFields(schema)
        const fields: Record<string, GraphQLInputFieldConfig> = {}

        for (const [key, propertySchema] of Object.entries(properties)) {
          const fieldType = descriptorToGraphQLInput(
            {
              ...descriptor,
              jsonSchema: propertySchema,
              diagnostics: [],
            },
            `${name}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            required.has(key)
          )
          fields[key] = {
            type: fieldType,
            description: getSchemaDescription(propertySchema),
          }
        }

        baseType = new GraphQLInputObjectType({
          name: cacheKey,
          fields: () => fields,
          description: getSchemaDescription(schema),
        })
        cache.input.set(cacheKey, baseType)
      }
    }
  }

  return isRequired && !nullable ? new GraphQLNonNull(baseType) : baseType
}

function getDescriptorForSchema(schema: unknown, validator?: string): SchemaDescriptor {
  return normalizeSchemaDescriptor(schema, {
    validator,
    target: 'openApi3',
  })
}

function capitalizeName(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toGraphQLName(value: string, fallback: string): string {
  const cleaned = value.replace(/[^_0-9A-Za-z]/g, '_')
  const safe = cleaned && /^[_A-Za-z]/.test(cleaned) ? cleaned : `${fallback}${cleaned}`
  return safe || fallback
}

function resourceTypeName(resource: LoadedGraphQLResource): string {
  return toGraphQLName(capitalizeName(resource.name), 'Resource')
}

function buildArgsFromConfig(
  ownerName: string,
  fieldName: string,
  argsConfig: Record<string, unknown> | undefined,
  inputConfig: unknown,
  cache: TypeCache
): Record<string, { type: GraphQLInputType; description?: string }> | undefined {
  const args: Record<string, { type: GraphQLInputType; description?: string }> = {}

  if (argsConfig) {
    for (const [name, schema] of Object.entries(argsConfig)) {
      const descriptor = getDescriptorForSchema(schema)
      const { schema: jsonSchema } = unwrapNullableSchema(descriptor.jsonSchema)
      args[name] = {
        type: descriptorToGraphQLInput(
          descriptor,
          `${ownerName}${capitalizeName(fieldName)}${capitalizeName(name)}`,
          cache,
          false
        ),
        description: getSchemaDescription(jsonSchema),
      }
    }
  }

  if (inputConfig) {
    const descriptor = getDescriptorForSchema(inputConfig)
    const { schema: jsonSchema } = unwrapNullableSchema(descriptor.jsonSchema)
    args.input = {
      type: descriptorToGraphQLInput(
        descriptor,
        `${ownerName}${capitalizeName(fieldName)}Input`,
        cache,
        true
      ),
      description: getSchemaDescription(jsonSchema),
    }
  }

  return Object.keys(args).length > 0 ? args : undefined
}

type GraphQLResourcePaginationConfig = NonNullable<GraphQLResourceRootFieldConfig['pagination']>

interface ResolvedGraphQLResourcePaginationConfig {
  style: 'offset' | 'cursor'
  defaultLimit: number
  maxLimit: number
  cursorField?: string
}

function resolveGraphQLResourcePagination(
  config: GraphQLResourceRootFieldConfig['pagination']
): ResolvedGraphQLResourcePaginationConfig | null {
  if (!config) return null
  const options: GraphQLResourcePaginationConfig = config === true ? {} : config
  return {
    style: options.style ?? 'offset',
    defaultLimit: options.defaultLimit ?? 20,
    maxLimit: options.maxLimit ?? 100,
    ...(options.cursorField ? { cursorField: options.cursorField } : {}),
  }
}

function addPaginationArg(
  args: Record<string, { type: GraphQLInputType; description?: string }>,
  fieldName: string,
  argName: string,
  type: GraphQLInputType,
  description: string
): void {
  if (args[argName]) {
    throw new Error(`GraphQL field "${fieldName}" declares pagination but already has an "${argName}" argument`)
  }
  args[argName] = { type, description }
}

function buildRootArgsFromConfig(
  ownerName: string,
  fieldName: string,
  field: GraphQLResourceRootFieldConfig,
  cache: TypeCache
): Record<string, { type: GraphQLInputType; description?: string }> | undefined {
  const args = buildArgsFromConfig(ownerName, fieldName, field.args, field.input, cache) ?? {}
  const pagination = resolveGraphQLResourcePagination(field.pagination)

  if (pagination) {
    if (pagination.style === 'cursor') {
      addPaginationArg(args, fieldName, 'first', GraphQLInt, 'Maximum number of records to return')
      addPaginationArg(args, fieldName, 'after', GraphQLString, 'Opaque cursor to continue after')
    } else {
      addPaginationArg(args, fieldName, 'limit', GraphQLInt, 'Maximum number of records to return')
      addPaginationArg(args, fieldName, 'offset', GraphQLInt, 'Number of records to skip')
    }
  }

  return Object.keys(args).length > 0 ? args : undefined
}

function clampPaginationLimit(value: unknown, fallback: number, max: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.max(0, Math.min(candidate, max))
}

function applyPaginationDefaults(
  rawArgs: Record<string, unknown>,
  config: GraphQLResourceRootFieldConfig['pagination']
): Record<string, unknown> {
  const pagination = resolveGraphQLResourcePagination(config)
  if (!pagination) return rawArgs

  const args = { ...rawArgs }
  if (pagination.style === 'cursor') {
    args.first = clampPaginationLimit(args.first, pagination.defaultLimit, pagination.maxLimit)
    if (args.after !== undefined && args.after !== null && typeof args.after !== 'string') {
      args.after = String(args.after)
    }
    return args
  }

  args.limit = clampPaginationLimit(args.limit, pagination.defaultLimit, pagination.maxLimit)
  args.offset = typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : 0
  return args
}

function getGraphQLPolicyBridge(ctx: unknown): GraphQLPolicyBridge | undefined {
  const context = ctx as ContextLike
  return context?.extensions instanceof Map
    ? context.extensions.get(GRAPHQL_POLICY_BRIDGE_KEY) as GraphQLPolicyBridge | undefined
    : undefined
}

interface ContextLike {
  extensions?: Map<unknown, unknown>
}

interface ServicesContextLike {
  services?: Record<string, unknown>
}

function resolveServiceByKey(ctx: unknown, key: string): unknown {
  const services = (ctx as ServicesContextLike | null | undefined)?.services
  if (!services) return undefined
  if (Object.prototype.hasOwnProperty.call(services, key)) return services[key]

  let current: unknown = services
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

async function resolveRelationLoader(
  relationName: string,
  relation: GraphQLResourceRelationConfig,
  parent: unknown,
  args: Record<string, unknown>,
  ctx: unknown,
  info: GraphQLResolveInfo
): Promise<unknown> {
  if (!relation.loader) return undefined
  if (!relation.batchKey) {
    throw new GraphQLError(`GraphQL relation "${relationName}" declares loader without batchKey`, {
      extensions: { code: 'INVALID_ARGUMENT' },
    })
  }

  const loader = resolveServiceByKey(ctx, relation.loader)
  if (!loader) {
    throw new GraphQLError(`GraphQL relation loader "${relation.loader}" was not found in ctx.services`, {
      extensions: { code: 'FAILED_PRECONDITION' },
    })
  }

  const key = relation.batchKey(parent)
  if (typeof loader === 'function') {
    return loader(key, args, ctx, info)
  }

  if (loader && typeof loader === 'object') {
    const loadMany = (loader as { loadMany?: unknown }).loadMany
    if (relation.many && Array.isArray(key) && typeof loadMany === 'function') {
      return loadMany.call(loader, key)
    }

    const load = (loader as { load?: unknown }).load
    if (typeof load === 'function') {
      return load.call(loader, key)
    }
  }

  throw new GraphQLError(`GraphQL relation loader "${relation.loader}" must be a function or DataLoader-like object`, {
    extensions: { code: 'FAILED_PRECONDITION' },
  })
}

async function evaluateFieldAuthz(
  ctx: unknown,
  authz: GraphQLResourceFieldAuthz,
  value: unknown,
  args: Record<string, unknown>,
  parent?: unknown
): Promise<boolean> {
  const bridge = getGraphQLPolicyBridge(ctx)
  if (!bridge) {
    throw new GraphQLError('GraphQL field authorization requires Raffel policy configuration', {
      extensions: { code: 'PERMISSION_DENIED' },
    })
  }
  const decision = await bridge.evaluate(ctx as never, authz, value, args, parent)
  return decision.allowed
}

async function applyAuthzToResolvedValue(
  value: unknown,
  authz: GraphQLResourceFieldAuthz | undefined,
  args: Record<string, unknown>,
  ctx: unknown,
  parent: unknown,
  nullable: boolean | undefined
): Promise<unknown> {
  if (!authz) return value
  if (value == null) return value
  const onDeny = authz.onDeny ?? 'throw'

  if (Array.isArray(value)) {
    if (onDeny === 'filter') {
      const allowed: unknown[] = []
      for (const item of value) {
        if (item == null) {
          allowed.push(item)
          continue
        }
        if (await evaluateFieldAuthz(ctx, authz, item, args, parent)) {
          allowed.push(item)
        }
      }
      return allowed
    }

    for (const item of value) {
      if (item == null) continue
      if (!await evaluateFieldAuthz(ctx, authz, item, args, parent)) {
        if (onDeny === 'null' && nullable !== false) return null
        throw new GraphQLError('Policy denied', { extensions: { code: 'PERMISSION_DENIED' } })
      }
    }
    return value
  }

  if (!await evaluateFieldAuthz(ctx, authz, value, args, parent)) {
    if (onDeny === 'null' && nullable !== false) return null
    throw new GraphQLError('Policy denied', { extensions: { code: 'PERMISSION_DENIED' } })
  }
  return value
}

interface ResourceSchemaContext {
  resourcesByName: Map<string, LoadedGraphQLResource>
  cache: TypeCache
}

function createResourceObjectType(
  resource: LoadedGraphQLResource,
  resourceCtx: ResourceSchemaContext
): GraphQLObjectType {
  const typeName = resourceTypeName(resource)
  const cached = resourceCtx.cache.output.get(typeName)
  if (cached instanceof GraphQLObjectType) return cached

  const objectType = new GraphQLObjectType({
    name: typeName,
    description: resource.description,
    fields: () => createResourceObjectFields(resource, resourceCtx),
  })
  resourceCtx.cache.output.set(typeName, objectType)
  return objectType
}

function createResourceObjectFields(
  resource: LoadedGraphQLResource,
  resourceCtx: ResourceSchemaContext
): Record<string, GraphQLFieldConfig<unknown, unknown>> {
  const typeName = resourceTypeName(resource)
  const descriptor = getDescriptorForSchema(resource.schema)
  const { schema } = unwrapNullableSchema(descriptor.jsonSchema)
  const properties = getObjectProperties(schema) ?? {}
  const required = getRequiredFields(schema)
  const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}

  for (const [key, propertySchema] of Object.entries(properties)) {
    fields[key] = {
      type: descriptorToGraphQLOutput(
        { ...descriptor, jsonSchema: propertySchema, diagnostics: [] },
        `${typeName}${capitalizeName(key)}`,
        resourceCtx.cache,
        required.has(key)
      ),
      description: getSchemaDescription(propertySchema),
    }
  }

  for (const [name, relation] of Object.entries(resource.relations ?? {})) {
    fields[name] = createRelationField(typeName, name, relation, resourceCtx)
  }

  return fields
}

function createRelationField(
  ownerName: string,
  relationName: string,
  relation: GraphQLResourceRelationConfig,
  resourceCtx: ResourceSchemaContext
): GraphQLFieldConfig<unknown, unknown> {
  const target = resourceCtx.resourcesByName.get(relation.type)
  const targetType = target ? createResourceObjectType(target, resourceCtx) : GraphQLJSON
  const baseType = relation.many ? new GraphQLList(targetType) : targetType
  const type = relation.nullable === false ? new GraphQLNonNull(baseType) : baseType
  const args = buildArgsFromConfig(ownerName, relationName, relation.args, undefined, resourceCtx.cache)

  return {
    type,
    args,
    description: relation.description,
    resolve: async (parent, rawArgs, ctx, info) => {
      const args = rawArgs as Record<string, unknown>
      const value = relation.resolver
        ? await relation.resolver(parent, args, ctx as never, info as GraphQLResolveInfo)
        : relation.loader
          ? await resolveRelationLoader(relationName, relation, parent, args, ctx, info as GraphQLResolveInfo)
        : (parent as Record<string, unknown> | null | undefined)?.[relationName]
      return applyAuthzToResolvedValue(value, relation.authz, args, ctx, parent, relation.nullable)
    },
  }
}

function createRootResourceField(
  resource: LoadedGraphQLResource,
  fieldKey: string,
  field: GraphQLResourceRootFieldConfig,
  resourceCtx: ResourceSchemaContext
): GraphQLFieldConfig<unknown, unknown> {
  const typeName = resourceTypeName(resource)
  const resourceType = createResourceObjectType(resource, resourceCtx)
  const outputType = field.output
    ? descriptorToGraphQLOutput(
        getDescriptorForSchema(field.output),
        `${typeName}${capitalizeName(fieldKey)}Output`,
        resourceCtx.cache,
        field.nullable !== true
      )
    : (field.many ?? (fieldKey === 'list' || Boolean(field.pagination)))
      ? new GraphQLList(resourceType)
      : resourceType
  const type = field.nullable === false && !(outputType instanceof GraphQLNonNull)
    ? new GraphQLNonNull(outputType)
    : outputType
  const fieldName = field.field ?? fieldKey
  const args = buildRootArgsFromConfig(typeName, fieldName, field, resourceCtx.cache)

  return {
    type,
    args,
    description: field.description ?? `${resource.name}.${fieldKey}`,
    resolve: async (parent, rawArgs, ctx, info) => {
      const args = applyPaginationDefaults(rawArgs as Record<string, unknown>, field.pagination)
      if (field.authorize && !await evaluateFieldAuthz(ctx, field.authorize, parent, args, parent)) {
        throw new GraphQLError('Policy denied', { extensions: { code: 'PERMISSION_DENIED' } })
      }
      const value = await field.resolver(parent, args, ctx as never, info as GraphQLResolveInfo)
      return applyAuthzToResolvedValue(value, field.authz, args, ctx, parent, field.nullable)
    },
  }
}

function addGraphQLResourceFields(
  graphqlResources: LoadedGraphQLResource[],
  queries: Record<string, GraphQLFieldConfig<unknown, unknown>>,
  mutations: Record<string, GraphQLFieldConfig<unknown, unknown>>,
  queryNames: string[],
  mutationNames: string[],
  cache: TypeCache
): void {
  if (graphqlResources.length === 0) return

  const resourcesByName = new Map<string, LoadedGraphQLResource>()
  for (const resource of graphqlResources) {
    const existing = resourcesByName.get(resource.name)
    if (existing) {
      throw new Error(`Duplicate GraphQL resource name "${resource.name}" from ${resource.filePath}`)
    }
    resourcesByName.set(resource.name, resource)
  }

  const resourceCtx: ResourceSchemaContext = { resourcesByName, cache }
  for (const resource of graphqlResources) {
    createResourceObjectType(resource, resourceCtx)

    for (const [key, field] of Object.entries(resource.queries ?? {})) {
      const name = toGraphQLName(field.field ?? key, 'field')
      if (queries[name]) throw new Error(`Duplicate GraphQL query field "${name}" from ${resource.filePath}`)
      queries[name] = createRootResourceField(resource, key, field, resourceCtx)
      queryNames.push(name)
    }

    for (const [key, field] of Object.entries(resource.mutations ?? {})) {
      const name = toGraphQLName(field.field ?? key, 'field')
      if (mutations[name]) throw new Error(`Duplicate GraphQL mutation field "${name}" from ${resource.filePath}`)
      mutations[name] = createRootResourceField(resource, key, field, resourceCtx)
      mutationNames.push(name)
    }
  }
}

// === Schema Generation ===

export interface GenerateSchemaParams {
  registry: Registry
  schemaRegistry: SchemaRegistry
  graphqlResources?: LoadedGraphQLResource[]
  options?: SchemaGenerationOptions
}

export function generateGraphQLSchema(params: GenerateSchemaParams): GeneratedSchemaInfo {
  const { registry, schemaRegistry, graphqlResources = [], options: userOptions } = params
  const options = { ...DEFAULT_OPTIONS, ...userOptions }

  const typeCache: TypeCache = {
    output: new Map(),
    input: new Map(),
  }

  const queries: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}
  const mutations: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}
  const subscriptions: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}

  const queryNames: string[] = []
  const mutationNames: string[] = []
  const subscriptionNames: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  // Process procedures → Query or Mutation
  for (const meta of registry.listProcedures()) {
    const schema = schemaRegistry.get(meta.name)
    const isQuery = isProcedureQuery(meta, options)

    const field = createFieldFromHandler(
      meta.name,
      schema,
      options,
      typeCache,
      'procedure'
    )

    if (!field) {
      skipped.push({ name: meta.name, reason: 'No schema defined' })
      continue
    }

    const fieldName = options.fieldNameGenerator(meta.name)

    if (isQuery) {
      queries[fieldName] = field
      queryNames.push(meta.name)
    } else {
      mutations[fieldName] = field
      mutationNames.push(meta.name)
    }
  }

  // Process streams → Subscription
  for (const meta of registry.listStreams()) {
    const schema = schemaRegistry.get(meta.name)

    const field = createFieldFromHandler(
      meta.name,
      schema,
      options,
      typeCache,
      'stream'
    )

    if (!field) {
      skipped.push({ name: meta.name, reason: 'No schema defined' })
      continue
    }

    const fieldName = options.fieldNameGenerator(meta.name)
    subscriptions[fieldName] = field
    subscriptionNames.push(meta.name)
  }

  // Process events → Mutation (if enabled)
  if (options.includeEvents) {
    for (const meta of registry.listEvents()) {
      const schema = schemaRegistry.get(meta.name)

      const field = createFieldFromHandler(
        meta.name,
        schema,
        options,
        typeCache,
        'event'
      )

      if (!field) {
        skipped.push({ name: meta.name, reason: 'No schema defined' })
        continue
      }

      const fieldName = options.fieldNameGenerator(meta.name)
      mutations[fieldName] = field
      mutationNames.push(meta.name)
    }
  }

  addGraphQLResourceFields(
    graphqlResources,
    queries,
    mutations,
    queryNames,
    mutationNames,
    typeCache
  )

  // Build schema
  const queryType = Object.keys(queries).length > 0
    ? new GraphQLObjectType({
        name: 'Query',
        description: options.queryDescription,
        fields: () => queries,
      })
    : undefined

  const mutationType = Object.keys(mutations).length > 0
    ? new GraphQLObjectType({
        name: 'Mutation',
        description: options.mutationDescription,
        fields: () => mutations,
      })
    : undefined

  const subscriptionType = Object.keys(subscriptions).length > 0
    ? new GraphQLObjectType({
        name: 'Subscription',
        description: options.subscriptionDescription,
        fields: () => subscriptions,
      })
    : undefined

  // At least Query is required
  if (!queryType) {
    // Create a dummy query if none exists
    const dummyQuery = new GraphQLObjectType({
      name: 'Query',
      fields: {
        _health: {
          type: GraphQLBoolean,
          description: 'Health check',
          resolve: () => true,
        },
      },
    })

    return {
      schema: new GraphQLSchema({
        query: dummyQuery,
        mutation: mutationType,
        subscription: subscriptionType,
      }),
      queries: ['_health'],
      mutations: mutationNames,
      subscriptions: subscriptionNames,
      skipped,
    }
  }

  const schema = new GraphQLSchema({
    query: queryType,
    mutation: mutationType,
    subscription: subscriptionType,
  })

  logger.info(
    {
      queries: queryNames.length,
      mutations: mutationNames.length,
      subscriptions: subscriptionNames.length,
      skipped: skipped.length,
    },
    'Generated GraphQL schema'
  )

  return {
    schema,
    queries: queryNames,
    mutations: mutationNames,
    subscriptions: subscriptionNames,
    skipped,
  }
}

function isProcedureQuery(meta: HandlerMeta, options: Required<SchemaGenerationOptions>): boolean {
  switch (options.procedureMapping) {
    case 'all-queries':
      return true
    case 'all-mutations':
      return false
    case 'meta':
      return meta.graphql?.type === 'query'
    case 'prefix':
    default: {
      // Check if name starts with a query prefix
      const nameLower = meta.name.toLowerCase()
      const lastSegment = meta.name.split('.').pop()?.toLowerCase() ?? nameLower

      return options.queryPrefixes.some(
        (prefix) => lastSegment.startsWith(prefix)
      )
    }
  }
}

function createFieldFromHandler(
  handlerName: string,
  schema: HandlerSchema | undefined,
  options: Required<SchemaGenerationOptions>,
  cache: TypeCache,
  kind: 'procedure' | 'stream' | 'event'
): GraphQLFieldConfig<unknown, unknown> | null {
  const typeName = options.typeNameGenerator(handlerName)

  // For output type
  let outputType: GraphQLOutputType

  if (schema?.output) {
    const outputDescriptor = getDescriptorForSchema(schema.output, schema.validator)
    warnDescriptorDiagnostics(handlerName, 'output', outputDescriptor.diagnostics)
    outputType = descriptorToGraphQLOutput(outputDescriptor, `${typeName}Output`, cache, true)
  } else if (kind === 'event') {
    // Events return success boolean
    outputType = new GraphQLNonNull(GraphQLBoolean)
  } else {
    // Default to JSON for handlers without output schema
    outputType = GraphQLJSON
  }

  // For input args
  const args: Record<string, { type: GraphQLInputType; description?: string }> = {}

  if (schema?.input) {
    const inputDescriptor = getDescriptorForSchema(schema.input, schema.validator)
    warnDescriptorDiagnostics(handlerName, 'input', inputDescriptor.diagnostics)
    const { schema: inputJsonSchema } = unwrapNullableSchema(inputDescriptor.jsonSchema)
    const properties = getObjectProperties(inputJsonSchema)

    if (properties) {
      const required = getRequiredFields(inputJsonSchema)

      for (const [key, propertySchema] of Object.entries(properties)) {
        args[key] = {
          type: descriptorToGraphQLInput(
            {
              ...inputDescriptor,
              jsonSchema: propertySchema,
              diagnostics: [],
            },
            `${typeName}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            required.has(key)
          ),
          description: getSchemaDescription(propertySchema),
        }
      }
    } else {
      args['input'] = {
        type: descriptorToGraphQLInput(inputDescriptor, `${typeName}Input`, cache, true),
        description: getSchemaDescription(inputJsonSchema),
      }
    }
  }

  return {
    type: outputType,
    args: Object.keys(args).length > 0 ? args : undefined,
    description: `Handler: ${handlerName}`,
  }
}
