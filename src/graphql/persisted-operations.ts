import { createHash } from 'node:crypto'

export interface PersistedOperationStore {
  get(hash: string): Promise<string | undefined>
  set(hash: string, document: string, ttlMs?: number): Promise<void>
  delete?(hash: string): Promise<void>
}

interface StoredOperation {
  document: string
  expiresAt: number
}

export class InMemoryPersistedOperationStore implements PersistedOperationStore {
  readonly #entries = new Map<string, StoredOperation>()

  constructor(
    private readonly maxEntries = 1000,
    private readonly defaultTtlMs = 60 * 60 * 1000
  ) {}

  async get(hash: string): Promise<string | undefined> {
    const entry = this.#entries.get(hash)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(hash)
      return undefined
    }
    this.#entries.delete(hash)
    this.#entries.set(hash, entry)
    return entry.document
  }

  async set(hash: string, document: string, ttlMs = this.defaultTtlMs): Promise<void> {
    this.#entries.delete(hash)
    this.#entries.set(hash, { document, expiresAt: Date.now() + Math.max(1, ttlMs) })
    while (this.#entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.#entries.keys().next().value as string | undefined
      if (!oldest) break
      this.#entries.delete(oldest)
    }
  }

  async delete(hash: string): Promise<void> {
    this.#entries.delete(hash)
  }
}

export function hashGraphQLDocument(document: string): string {
  return createHash('sha256').update(document).digest('hex')
}
