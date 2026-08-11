import { dirname, extname, resolve } from 'node:path'
import ts from 'typescript'

export type TypeScriptOutputInferenceResult =
  | { status: 'inferred'; schema: Record<string, unknown>; type: string }
  | { status: 'skipped'; reason: string }

export interface TypeScriptOutputSchemaInferrer {
  infer(filePath: string): TypeScriptOutputInferenceResult
}

type ProgramEntry = { program: ts.Program; checker: ts.TypeChecker }

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const MAX_SCHEMA_DEPTH = 16

export function createTypeScriptOutputSchemaInferrer(): TypeScriptOutputSchemaInferrer {
  const programs = new Map<string, ProgramEntry>()

  return {
    infer(filePath: string): TypeScriptOutputInferenceResult {
      const absolutePath = resolve(filePath)
      if (!isTypeScriptSource(absolutePath) || !ts.sys.fileExists(absolutePath)) {
        return { status: 'skipped', reason: 'route is not an on-disk TypeScript source file' }
      }

      try {
        const { program, checker } = programForFile(absolutePath, programs)
        const sourceFile = program.getSourceFile(absolutePath)
        if (!sourceFile) return { status: 'skipped', reason: 'source file is not part of the TypeScript program' }

        const returnType = resolveDefaultExportReturnType(sourceFile, checker)
        if (!returnType) return { status: 'skipped', reason: 'default export has no callable return type' }

        const awaitedType = checker.getAwaitedType(returnType) ?? returnType
        if (isResponseWrapper(awaitedType, checker)) {
          return { status: 'skipped', reason: `return type ${checker.typeToString(awaitedType)} wraps an HTTP response` }
        }

        const schema = schemaForType(awaitedType, checker, new Set(), 0)
        if (!schema) {
          return { status: 'skipped', reason: `return type ${checker.typeToString(awaitedType)} is not representable as JSON Schema` }
        }

        return {
          status: 'inferred',
          type: checker.typeToString(awaitedType),
          schema: { ...schema, 'x-raffel-inferred-from': 'typescript' },
        }
      } catch (error) {
        return {
          status: 'skipped',
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

function isTypeScriptSource(filePath: string): boolean {
  return TYPESCRIPT_EXTENSIONS.has(extname(filePath)) && !filePath.endsWith('.d.ts')
}

function programForFile(filePath: string, programs: Map<string, ProgramEntry>): ProgramEntry {
  const configPath = ts.findConfigFile(dirname(filePath), ts.sys.fileExists)
  const cacheKey = configPath ?? filePath
  const cached = programs.get(cacheKey)
  if (cached) return cached

  let rootNames = [filePath]
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  }

  if (configPath) {
    const loaded = ts.readConfigFile(configPath, ts.sys.readFile)
    if (!loaded.error) {
      const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath))
      rootNames = parsed.fileNames.includes(filePath) ? parsed.fileNames : [...parsed.fileNames, filePath]
      options = { ...parsed.options, noEmit: true }
    }
  }

  const program = ts.createProgram({ rootNames, options })
  const entry = { program, checker: program.getTypeChecker() }
  programs.set(cacheKey, entry)
  return entry
}

function resolveDefaultExportReturnType(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ts.Type | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return undefined
  const exported = checker.getExportsOfModule(moduleSymbol).find(symbol => symbol.name === 'default')
  if (!exported) return undefined

  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? exported.declarations?.[0]
  if (!declaration) return undefined
  const handlerType = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const signature = handlerType.getCallSignatures()[0]
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined
}

function schemaForType(
  type: ts.Type,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  depth: number,
): Record<string, unknown> | undefined {
  if (depth > MAX_SCHEMA_DEPTH) return { type: 'object', additionalProperties: true }
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void)) return undefined
  if (type.flags & ts.TypeFlags.StringLike) return literalSchema(type, 'string')
  if (type.flags & ts.TypeFlags.NumberLike) return literalSchema(type, 'number')
  if (type.flags & ts.TypeFlags.BooleanLike) return literalSchema(type, 'boolean')
  if (type.flags & ts.TypeFlags.BigIntLike) return { type: 'integer' }
  if (type.flags & ts.TypeFlags.Null) return { type: 'null' }
  if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.ESSymbolLike)) return undefined

  if (type.isUnion()) return unionSchema(type, checker, active, depth)
  if (type.isIntersection()) {
    const primitive = type.types.find(item => item.flags & (
      ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike
    ))
    if (primitive) return schemaForType(primitive, checker, active, depth + 1)
  }

  if (checker.isTupleType(type)) {
    const items = checker.getTypeArguments(type as ts.TypeReference)
      .map(item => schemaForType(item, checker, active, depth + 1) ?? {})
    return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length }
  }

  if (checker.isArrayType(type) || type.symbol?.name === 'ReadonlyArray') {
    const element = checker.getTypeArguments(type as ts.TypeReference)[0]
    return { type: 'array', items: element ? schemaForType(element, checker, active, depth + 1) ?? {} : {} }
  }

  if (!(type.flags & ts.TypeFlags.Object)) return undefined
  if (type.symbol?.name === 'Date') return { type: 'string', format: 'date-time' }
  if (active.has(type)) return { type: 'object', additionalProperties: true }
  active.add(type)
  try {
    return objectSchema(type, checker, active, depth)
  } finally {
    active.delete(type)
  }
}

function literalSchema(type: ts.Type, primitive: 'string' | 'number' | 'boolean'): Record<string, unknown> {
  if (type.isStringLiteral() || type.isNumberLiteral()) return { type: primitive, enum: [type.value] }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return { type: 'boolean', enum: [(type as { intrinsicName?: string }).intrinsicName === 'true'] }
  }
  return { type: primitive }
}

function unionSchema(
  type: ts.UnionType,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  depth: number,
): Record<string, unknown> | undefined {
  const members = type.types.filter(member => !(member.flags & ts.TypeFlags.Undefined))
  if (members.length === 0) return undefined
  if (members.length === 1) return schemaForType(members[0], checker, active, depth + 1)

  const literalValues = members.map(literalValue)
  if (literalValues.every(value => value !== undefined)) {
    const values = literalValues as Array<string | number | boolean>
    const primitive = typeof values[0]
    if (values.every(value => typeof value === primitive)) return { type: primitive, enum: values }
  }

  const schemas = members
    .map(member => schemaForType(member, checker, active, depth + 1))
    .filter((schema): schema is Record<string, unknown> => Boolean(schema))
  if (schemas.length === 0) return undefined
  if (schemas.length === 1) return schemas[0]
  return { anyOf: deduplicateSchemas(schemas) }
}

function literalValue(type: ts.Type): string | number | boolean | undefined {
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return (type as { intrinsicName?: string }).intrinsicName === 'true'
  }
  return undefined
}

function objectSchema(
  type: ts.Type,
  checker: ts.TypeChecker,
  active: Set<ts.Type>,
  depth: number,
): Record<string, unknown> | undefined {
  if (type.getCallSignatures().length > 0 && checker.getPropertiesOfType(type).length === 0) return undefined
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const property of checker.getPropertiesOfType(type)) {
    if (property.name.startsWith('__@')) continue
    const declaration = property.valueDeclaration ?? property.declarations?.[0]
    if (!declaration) continue
    const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration)
    const propertySchema = schemaForType(propertyType, checker, active, depth + 1)
    if (!propertySchema) continue
    const description = ts.displayPartsToString(property.getDocumentationComment(checker))
    properties[property.name] = description ? { ...propertySchema, description } : propertySchema
    if (!(property.flags & ts.SymbolFlags.Optional) && !containsUndefined(propertyType)) required.push(property.name)
  }

  const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  const additionalProperties = stringIndex
    ? schemaForType(stringIndex, checker, active, depth + 1) ?? true
    : undefined
  if (Object.keys(properties).length === 0 && additionalProperties === undefined) {
    return { type: 'object', additionalProperties: true }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(additionalProperties !== undefined ? { additionalProperties } : {}),
  }
}

function containsUndefined(type: ts.Type): boolean {
  return Boolean(type.flags & ts.TypeFlags.Undefined) || (type.isUnion() && type.types.some(containsUndefined))
}

function deduplicateSchemas(schemas: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  return schemas.filter(schema => {
    const key = JSON.stringify(schema)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isResponseWrapper(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) return type.types.some(member => isResponseWrapper(member, checker))
  const name = type.aliasSymbol?.name ?? type.symbol?.name ?? checker.typeToString(type)
  return ['Response', 'HttpResponse', 'TypedResponse'].includes(name)
}
