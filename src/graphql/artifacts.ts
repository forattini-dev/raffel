import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getIntrospectionQuery, graphql, printSchema, type GraphQLSchema } from 'graphql'
import { hashGraphQLDocument } from './persisted-operations.js'

export interface GraphQLArtifactExportOptions {
  schema: GraphQLSchema
  outDir: string
  documents?: Record<string, string>
  includeCodegenConfig?: boolean
}

export interface GraphQLArtifactExportResult {
  schemaPath: string
  introspectionPath: string
  manifestPath?: string
  codegenConfigPath?: string
}

/** Export portable artifacts without starting an HTTP listener. */
export async function exportGraphQLArtifacts(
  options: GraphQLArtifactExportOptions
): Promise<GraphQLArtifactExportResult> {
  const outDir = path.resolve(options.outDir)
  await mkdir(outDir, { recursive: true })
  const schemaPath = path.join(outDir, 'schema.graphql')
  const introspectionPath = path.join(outDir, 'schema.json')
  await writeFile(schemaPath, `${printSchema(options.schema)}\n`, 'utf8')

  const introspection = await graphql({ schema: options.schema, source: getIntrospectionQuery() })
  if (introspection.errors?.length) {
    throw new Error(`GraphQL introspection export failed: ${introspection.errors.map((error) => error.message).join('; ')}`)
  }
  await writeFile(introspectionPath, `${JSON.stringify(introspection.data, null, 2)}\n`, 'utf8')

  let manifestPath: string | undefined
  if (options.documents) {
    manifestPath = path.join(outDir, 'persisted-operations.json')
    const operations = Object.fromEntries(Object.entries(options.documents).map(([name, document]) => [
      hashGraphQLDocument(document),
      { name, document },
    ]))
    await writeFile(manifestPath, `${JSON.stringify({ version: 1, operations }, null, 2)}\n`, 'utf8')
  }

  let codegenConfigPath: string | undefined
  if (options.includeCodegenConfig !== false) {
    codegenConfigPath = path.join(outDir, 'codegen.ts')
    await writeFile(codegenConfigPath, `import type { CodegenConfig } from '@graphql-codegen/cli'\n\nconst config: CodegenConfig = {\n  schema: './schema.graphql',\n  documents: '../src/**/*.{graphql,graphql.ts,tsx}',\n  generates: { './client/': { preset: 'client' } },\n}\n\nexport default config\n`, 'utf8')
  }

  return { schemaPath, introspectionPath, manifestPath, codegenConfigPath }
}
