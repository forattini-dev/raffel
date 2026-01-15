/**
 * GraphQL Schema Generator
 *
 * Auto-generates GraphQL schema from Raffel handlers and Zod schemas.
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
  GraphQLUnionType,
  GraphQLFieldConfig,
  GraphQLInputFieldConfig,
  GraphQLOutputType,
  GraphQLInputType,
  Kind,
} from 'graphql'
import type { z } from 'zod'
import type { Registry } from '../core/registry.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import type { HandlerMeta } from '../types/index.js'
import type {
  SchemaGenerationOptions,
  GeneratedSchemaInfo,
} from './types.js'
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

// === Zod to GraphQL Type Conversion ===

interface TypeCache {
  output: Map<string, GraphQLOutputType>
  input: Map<string, GraphQLInputType>
}

function getZodTypeName(schema: z.ZodTypeAny): string {
  // Access internal Zod type name (support both old and new Zod APIs)
  const def = (schema as any)._def
  // Newer Zod uses _def.type (lowercase), older uses _def.typeName (ZodXxx)
  const typeName = def?.typeName ?? def?.type
  if (!typeName) return 'unknown'
  // Normalize to ZodXxx format
  if (typeName.startsWith('Zod')) return typeName
  return `Zod${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`
}

function getZodShape(def: any): Record<string, z.ZodTypeAny> {
  // Support both old Zod (shape is a function) and new Zod (shape is a getter)
  return typeof def.shape === 'function' ? def.shape() : def.shape
}

function zodToGraphQLOutput(
  schema: z.ZodTypeAny,
  name: string,
  cache: TypeCache,
  isRequired = true
): GraphQLOutputType {
  const typeName = getZodTypeName(schema)
  const def = (schema as any)._def

  let baseType: GraphQLOutputType

  switch (typeName) {
    case 'ZodString':
      baseType = GraphQLString
      break

    case 'ZodNumber':
      // Check if integer
      if (def.checks?.some((c: any) => c.kind === 'int')) {
        baseType = GraphQLInt
      } else {
        baseType = GraphQLFloat
      }
      break

    case 'ZodBoolean':
      baseType = GraphQLBoolean
      break

    case 'ZodDate':
      baseType = GraphQLDateTime
      break

    case 'ZodArray': {
      const itemType = zodToGraphQLOutput(def.type, `${name}Item`, cache, true)
      baseType = new GraphQLList(itemType)
      break
    }

    case 'ZodObject': {
      const cacheKey = name
      if (cache.output.has(cacheKey)) {
        baseType = cache.output.get(cacheKey)!
      } else {
        const shape = getZodShape(def)
        const fields: Record<string, GraphQLFieldConfig<unknown, unknown>> = {}

        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = value as z.ZodTypeAny
          const fieldType = zodToGraphQLOutput(
            fieldSchema,
            `${name}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            !isZodOptional(fieldSchema)
          )
          fields[key] = {
            type: fieldType,
            description: (fieldSchema as any)._def?.description,
          }
        }

        baseType = new GraphQLObjectType({
          name,
          fields: () => fields,
          description: def.description,
        })
        cache.output.set(cacheKey, baseType)
      }
      break
    }

    case 'ZodEnum': {
      // Support both old Zod (values is array) and new Zod (entries is object)
      const values: string[] = def.values ?? Object.values(def.entries ?? {})
      const enumValues: Record<string, { value: string }> = {}
      for (const val of values) {
        const enumKey = val.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        enumValues[enumKey] = { value: val }
      }
      baseType = new GraphQLEnumType({
        name: `${name}Enum`,
        values: enumValues,
      })
      break
    }

    case 'ZodLiteral': {
      const literalValue = def.value
      if (typeof literalValue === 'string') {
        baseType = GraphQLString
      } else if (typeof literalValue === 'number') {
        baseType = Number.isInteger(literalValue) ? GraphQLInt : GraphQLFloat
      } else if (typeof literalValue === 'boolean') {
        baseType = GraphQLBoolean
      } else {
        baseType = GraphQLJSON
      }
      break
    }

    case 'ZodOptional':
    case 'ZodNullable':
      return zodToGraphQLOutput(def.innerType, name, cache, false)

    case 'ZodDefault':
      return zodToGraphQLOutput(def.innerType, name, cache, false)

    case 'ZodUnion': {
      // For simple unions, try to use a GraphQL union
      const options = def.options as z.ZodTypeAny[]
      const allObjects = options.every((opt) => getZodTypeName(opt) === 'ZodObject')

      if (allObjects && options.length > 1) {
        const types = options.map((opt, i) =>
          zodToGraphQLOutput(opt, `${name}Option${i}`, cache, true) as GraphQLObjectType
        )
        baseType = new GraphQLUnionType({
          name: `${name}Union`,
          types,
        })
      } else {
        // Fall back to JSON for complex unions
        baseType = GraphQLJSON
      }
      break
    }

    case 'ZodRecord':
    case 'ZodMap':
    case 'ZodAny':
    case 'ZodUnknown':
      baseType = GraphQLJSON
      break

    case 'ZodVoid':
    case 'ZodUndefined':
    case 'ZodNull':
      baseType = GraphQLBoolean // Represents success
      break

    default:
      logger.warn({ typeName, name }, 'Unknown Zod type, falling back to JSON')
      baseType = GraphQLJSON
  }

  return isRequired ? new GraphQLNonNull(baseType) : baseType
}

function zodToGraphQLInput(
  schema: z.ZodTypeAny,
  name: string,
  cache: TypeCache,
  isRequired = true
): GraphQLInputType {
  const typeName = getZodTypeName(schema)
  const def = (schema as any)._def

  let baseType: GraphQLInputType

  switch (typeName) {
    case 'ZodString':
      baseType = GraphQLString
      break

    case 'ZodNumber':
      if (def.checks?.some((c: any) => c.kind === 'int')) {
        baseType = GraphQLInt
      } else {
        baseType = GraphQLFloat
      }
      break

    case 'ZodBoolean':
      baseType = GraphQLBoolean
      break

    case 'ZodDate':
      baseType = GraphQLDateTime
      break

    case 'ZodArray': {
      const itemType = zodToGraphQLInput(def.type, `${name}Item`, cache, true)
      baseType = new GraphQLList(itemType)
      break
    }

    case 'ZodObject': {
      const cacheKey = `${name}Input`
      if (cache.input.has(cacheKey)) {
        baseType = cache.input.get(cacheKey)!
      } else {
        const shape = getZodShape(def)
        const fields: Record<string, GraphQLInputFieldConfig> = {}

        for (const [key, value] of Object.entries(shape)) {
          const fieldSchema = value as z.ZodTypeAny
          const fieldType = zodToGraphQLInput(
            fieldSchema,
            `${name}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            !isZodOptional(fieldSchema)
          )
          fields[key] = {
            type: fieldType,
            description: (fieldSchema as any)._def?.description,
          }
        }

        baseType = new GraphQLInputObjectType({
          name: cacheKey,
          fields: () => fields,
          description: def.description,
        })
        cache.input.set(cacheKey, baseType)
      }
      break
    }

    case 'ZodEnum': {
      // Support both old Zod (values is array) and new Zod (entries is object)
      const values: string[] = def.values ?? Object.values(def.entries ?? {})
      const enumValues: Record<string, { value: string }> = {}
      for (const val of values) {
        const enumKey = val.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        enumValues[enumKey] = { value: val }
      }
      baseType = new GraphQLEnumType({
        name: `${name}Enum`,
        values: enumValues,
      })
      break
    }

    case 'ZodLiteral': {
      const literalValue = def.value
      if (typeof literalValue === 'string') {
        baseType = GraphQLString
      } else if (typeof literalValue === 'number') {
        baseType = Number.isInteger(literalValue) ? GraphQLInt : GraphQLFloat
      } else if (typeof literalValue === 'boolean') {
        baseType = GraphQLBoolean
      } else {
        baseType = GraphQLJSON
      }
      break
    }

    case 'ZodOptional':
    case 'ZodNullable':
      return zodToGraphQLInput(def.innerType, name, cache, false)

    case 'ZodDefault':
      return zodToGraphQLInput(def.innerType, name, cache, false)

    case 'ZodUnion':
    case 'ZodRecord':
    case 'ZodMap':
    case 'ZodAny':
    case 'ZodUnknown':
      baseType = GraphQLJSON
      break

    default:
      baseType = GraphQLJSON
  }

  return isRequired ? new GraphQLNonNull(baseType) : baseType
}

function isZodOptional(schema: z.ZodTypeAny): boolean {
  const typeName = getZodTypeName(schema)
  return typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault'
}

// === Schema Generation ===

export interface GenerateSchemaParams {
  registry: Registry
  schemaRegistry: SchemaRegistry
  options?: SchemaGenerationOptions
}

export function generateGraphQLSchema(params: GenerateSchemaParams): GeneratedSchemaInfo {
  const { registry, schemaRegistry, options: userOptions } = params
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
    // Cast to ZodTypeAny - the function handles the internal details
    outputType = zodToGraphQLOutput(schema.output as z.ZodTypeAny, `${typeName}Output`, cache, true)
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
    const inputTypeName = getZodTypeName(schema.input as z.ZodTypeAny)

    if (inputTypeName === 'ZodObject') {
      // Flatten object fields as args
      const def = (schema.input as any)._def
      const shape = getZodShape(def)

      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = value as z.ZodTypeAny
        args[key] = {
          type: zodToGraphQLInput(
            fieldSchema,
            `${typeName}${key.charAt(0).toUpperCase() + key.slice(1)}`,
            cache,
            !isZodOptional(fieldSchema)
          ),
          description: (fieldSchema as any)._def?.description,
        }
      }
    } else {
      // Single input arg
      args['input'] = {
        type: zodToGraphQLInput(schema.input as z.ZodTypeAny, `${typeName}Input`, cache, true),
      }
    }
  }

  return {
    type: outputType,
    args: Object.keys(args).length > 0 ? args : undefined,
    description: `Handler: ${handlerName}`,
  }
}
