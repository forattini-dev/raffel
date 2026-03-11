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
