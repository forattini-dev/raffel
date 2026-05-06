/**
 * Discovery source abstraction.
 *
 * Owns path walking, extension filtering, dynamic import, text reads, and
 * shared failure/stat reporting for filesystem route discovery.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface DiscoverySourceFile {
  filePath: string
  relativePath: string
}

export interface DiscoverySourceDirectory {
  dirPath: string
  relativePath: string
}

export interface DiscoverySourceWalkOptions {
  extensions?: string[]
  recursive?: boolean
}

export interface DiscoverySourceWalkResult {
  rootDir: string
  files: DiscoverySourceFile[]
  directories: DiscoverySourceDirectory[]
}

export type DiscoverySourceFailureOperation = 'walk' | 'import' | 'read'

export interface DiscoverySourceFailure {
  operation: DiscoverySourceFailureOperation
  path: string
  relativePath?: string
  message: string
  error: unknown
}

export interface DiscoverySourceStats {
  rootsWalked: number
  directoriesVisited: number
  filesVisited: number
  filesMatched: number
  modulesImported: number
  textFilesRead: number
  missingRoots: number
  failures: number
}

export interface DiscoverySourceAdapterWalkOptions {
  recursive: boolean
}

export interface DiscoverySourceAdapterWalkResult {
  files: string[]
  directories: string[]
}

export interface DiscoverySourceAdapter {
  exists(path: string): boolean | Promise<boolean>
  walk(rootDir: string, options: DiscoverySourceAdapterWalkOptions): Promise<DiscoverySourceAdapterWalkResult>
  importModule(path: string): Promise<unknown>
  readText(path: string): Promise<string>
}

export interface DiscoverySource {
  exists(path: string): Promise<boolean>
  walkFiles(rootDir: string, options?: DiscoverySourceWalkOptions): Promise<DiscoverySourceWalkResult>
  importModule<T>(path: string): Promise<T>
  readText(path: string): Promise<string>
  snapshotStats(): DiscoverySourceStats
  snapshotFailures(): DiscoverySourceFailure[]
  reset(): void
}

const emptyStats = (): DiscoverySourceStats => ({
  rootsWalked: 0,
  directoriesVisited: 0,
  filesVisited: 0,
  filesMatched: 0,
  modulesImported: 0,
  textFilesRead: 0,
  missingRoots: 0,
  failures: 0,
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toRelative(rootDir: string, target: string): string {
  return relative(rootDir, target) || '.'
}

export function createDiscoverySource(adapter: DiscoverySourceAdapter): DiscoverySource {
  let stats = emptyStats()
  const failures: DiscoverySourceFailure[] = []

  function recordFailure(failure: Omit<DiscoverySourceFailure, 'message'>): void {
    failures.push({
      ...failure,
      message: errorMessage(failure.error),
    })
    stats.failures = failures.length
  }

  return {
    async exists(path: string): Promise<boolean> {
      return adapter.exists(path)
    },

    async walkFiles(rootDir: string, options: DiscoverySourceWalkOptions = {}): Promise<DiscoverySourceWalkResult> {
      const recursive = options.recursive ?? true
      stats.rootsWalked++

      if (!await adapter.exists(rootDir)) {
        stats.missingRoots++
        return { rootDir, files: [], directories: [] }
      }

      try {
        const walked = await adapter.walk(rootDir, { recursive })
        const directories = walked.directories.map((dirPath) => ({
          dirPath,
          relativePath: toRelative(rootDir, dirPath),
        }))
        const files: DiscoverySourceFile[] = []

        stats.directoriesVisited += directories.length
        stats.filesVisited += walked.files.length

        for (const filePath of walked.files) {
          if (options.extensions && !options.extensions.includes(extname(filePath))) {
            continue
          }

          stats.filesMatched++
          files.push({
            filePath,
            relativePath: toRelative(rootDir, filePath),
          })
        }

        return { rootDir, files, directories }
      } catch (error) {
        recordFailure({ operation: 'walk', path: rootDir, error })
        throw error
      }
    },

    async importModule<T>(path: string): Promise<T> {
      try {
        const result = await adapter.importModule(path) as T
        stats.modulesImported++
        return result
      } catch (error) {
        recordFailure({ operation: 'import', path, error })
        throw error
      }
    },

    async readText(path: string): Promise<string> {
      try {
        const result = await adapter.readText(path)
        stats.textFilesRead++
        return result
      } catch (error) {
        recordFailure({ operation: 'read', path, error })
        throw error
      }
    },

    snapshotStats(): DiscoverySourceStats {
      return { ...stats, failures: failures.length }
    },

    snapshotFailures(): DiscoverySourceFailure[] {
      return failures.map((failure) => ({ ...failure }))
    },

    reset(): void {
      stats = emptyStats()
      failures.length = 0
    },
  }
}

export class FileSystemDiscoverySourceAdapter implements DiscoverySourceAdapter {
  exists(path: string): boolean {
    return existsSync(path)
  }

  async walk(rootDir: string, options: DiscoverySourceAdapterWalkOptions): Promise<DiscoverySourceAdapterWalkResult> {
    const files: string[] = []
    const directories: string[] = []

    const visit = (dir: string): void => {
      directories.push(dir)

      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry)
        const stat = statSync(fullPath)

        if (stat.isDirectory()) {
          if (options.recursive) {
            visit(fullPath)
          }
        } else if (stat.isFile()) {
          files.push(fullPath)
        }
      }
    }

    visit(rootDir)
    return { files, directories }
  }

  async importModule(path: string): Promise<unknown> {
    const fileUrl = pathToFileURL(path).href
    return import(`${fileUrl}?t=${Date.now()}`)
  }

  async readText(path: string): Promise<string> {
    return readFileSync(path, 'utf-8')
  }
}

export function createFileSystemDiscoverySource(): DiscoverySource {
  return createDiscoverySource(new FileSystemDiscoverySourceAdapter())
}

export interface InMemoryDiscoverySourceFile {
  module?: unknown
  text?: string
  importError?: unknown
  readError?: unknown
}

export class InMemoryDiscoverySourceAdapter implements DiscoverySourceAdapter {
  private readonly files = new Map<string, InMemoryDiscoverySourceFile>()
  private readonly directories = new Set<string>()

  constructor(files: Record<string, InMemoryDiscoverySourceFile>) {
    for (const [filePath, file] of Object.entries(files)) {
      const normalizedPath = this.normalize(filePath)
      this.files.set(normalizedPath, file)
      this.addDirectoryChain(dirname(normalizedPath))
    }
  }

  exists(path: string): boolean {
    const normalizedPath = this.normalize(path)
    return this.files.has(normalizedPath) || this.directories.has(normalizedPath)
  }

  async walk(rootDir: string, options: DiscoverySourceAdapterWalkOptions): Promise<DiscoverySourceAdapterWalkResult> {
    const normalizedRoot = this.normalize(rootDir)
    const files: string[] = []
    const directories: string[] = []

    for (const dir of this.directories) {
      if (dir === normalizedRoot || this.isDescendant(normalizedRoot, dir)) {
        if (options.recursive || dir === normalizedRoot) {
          directories.push(dir)
        }
      }
    }

    for (const filePath of this.files.keys()) {
      if (dirname(filePath) === normalizedRoot || (options.recursive && this.isDescendant(normalizedRoot, filePath))) {
        files.push(filePath)
      }
    }

    return {
      files: files.sort(),
      directories: directories.sort(),
    }
  }

  async importModule(path: string): Promise<unknown> {
    const file = this.files.get(this.normalize(path))
    if (!file) {
      throw new Error(`In-memory discovery file not found: ${path}`)
    }
    if (file.importError) {
      throw file.importError
    }
    if (file.module === undefined) {
      throw new Error(`In-memory discovery file has no module: ${path}`)
    }
    return file.module
  }

  async readText(path: string): Promise<string> {
    const file = this.files.get(this.normalize(path))
    if (!file) {
      throw new Error(`In-memory discovery file not found: ${path}`)
    }
    if (file.readError) {
      throw file.readError
    }
    if (file.text === undefined) {
      throw new Error(`In-memory discovery file has no text: ${path}`)
    }
    return file.text
  }

  private normalize(path: string): string {
    return resolve(path)
  }

  private addDirectoryChain(path: string): void {
    let current = path
    while (!this.directories.has(current)) {
      this.directories.add(current)
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }
  }

  private isDescendant(rootDir: string, path: string): boolean {
    const rel = relative(rootDir, path)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }
}

export function createInMemoryDiscoverySource(files: Record<string, InMemoryDiscoverySourceFile>): DiscoverySource {
  return createDiscoverySource(new InMemoryDiscoverySourceAdapter(files))
}
