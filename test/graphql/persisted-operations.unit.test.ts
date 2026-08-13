import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildSchema } from 'graphql'
import {
  InMemoryPersistedOperationStore,
  exportGraphQLArtifacts,
  hashGraphQLDocument,
} from '../../src/graphql/index.js'

describe('GraphQL persisted operations and artifacts', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('uses SHA-256 and evicts the least recently used document', async () => {
    const store = new InMemoryPersistedOperationStore(2, 60_000)
    await store.set('a', 'query A { a }')
    await store.set('b', 'query B { b }')
    await store.get('a')
    await store.set('c', 'query C { c }')

    expect(await store.get('a')).toBe('query A { a }')
    expect(await store.get('b')).toBeUndefined()
    expect(hashGraphQLDocument('{ ok }')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('expires documents', async () => {
    const store = new InMemoryPersistedOperationStore(10, 1)
    await store.set('expired', '{ ok }', 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await store.get('expired')).toBeUndefined()
  })

  it('exports SDL, introspection, manifest, and codegen config', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'raffel-graphql-'))
    tempDirs.push(outDir)
    const result = await exportGraphQLArtifacts({
      schema: buildSchema('type Query { hello: String! }'),
      outDir,
      documents: { Hello: 'query Hello { hello }' },
    })

    expect(await readFile(result.schemaPath, 'utf8')).toContain('type Query')
    expect(JSON.parse(await readFile(result.introspectionPath, 'utf8')).__schema).toBeDefined()
    expect(JSON.parse(await readFile(result.manifestPath!, 'utf8')).version).toBe(1)
    expect(await readFile(result.codegenConfigPath!, 'utf8')).toContain("preset: 'client'")
  })
})
