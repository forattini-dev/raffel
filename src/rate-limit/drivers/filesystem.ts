import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  RateLimitDriver,
  RateLimitRecord,
  FilesystemRateLimitDriverOptions,
} from '../types.js'

export class FilesystemRateLimitDriver implements RateLimitDriver {
  readonly name = 'filesystem'

  private readonly directory: string
  private readonly cleanupInterval: number
  private cleanupHandle: ReturnType<typeof setInterval> | null = null

  constructor(options: FilesystemRateLimitDriverOptions = {}) {
    this.directory = options.directory ?? '.rate-limit'
    this.cleanupInterval = options.cleanupInterval ?? 300000

    this.ensureDirectory()

    if (this.cleanupInterval > 0) {
      this.cleanupHandle = setInterval(() => this.cleanupExpired(), this.cleanupInterval)
      this.cleanupHandle.unref?.()
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitRecord> {
    this.ensureDirectory()
    const now = Date.now()
    const filePath = this.getFilePath(key)

    let record = await this.readRecord(filePath)
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs }
    }

    record.count += 1
    await fs.promises.writeFile(filePath, JSON.stringify(record), 'utf8')
    return { ...record }
  }

  async decrement(key: string): Promise<void> {
    const filePath = this.getFilePath(key)
    const record = await this.readRecord(filePath)
    if (!record) return
    record.count = Math.max(0, record.count - 1)
    await fs.promises.writeFile(filePath, JSON.stringify(record), 'utf8')
  }

  async reset(key: string): Promise<void> {
    const filePath = this.getFilePath(key)
    await fs.promises.rm(filePath, { force: true })
  }

  async shutdown(): Promise<void> {
    if (this.cleanupHandle) {
      clearInterval(this.cleanupHandle)
      this.cleanupHandle = null
    }
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true })
    }
  }

  private getFilePath(key: string): string {
    const hash = crypto.createHash('sha256').update(key).digest('hex')
    return path.join(this.directory, `${hash}.json`)
  }

  private async readRecord(filePath: string): Promise<RateLimitRecord | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      return JSON.parse(content) as RateLimitRecord
    } catch {
      return null
    }
  }

  private async cleanupExpired(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.directory)
      const now = Date.now()

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const filePath = path.join(this.directory, file)
        const record = await this.readRecord(filePath)
        if (!record || now > record.resetAt) {
          await fs.promises.rm(filePath, { force: true })
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
