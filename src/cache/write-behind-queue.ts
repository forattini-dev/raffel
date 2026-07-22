export interface WriteBehindQueueOptions {
  concurrency?: number
  maxPending?: number
  shutdownTimeoutMs?: number
  onError?: (error: unknown) => void
  onDrop?: (key: string) => void
}

type WriteTask = () => void | Promise<void>

export class WriteBehindQueue {
  private readonly pending = new Map<string, WriteTask>()
  private readonly order: string[] = []
  private readonly waiters = new Set<() => void>()
  private readonly activeKeys = new Set<string>()
  private active = 0

  constructor(private readonly options: WriteBehindQueueOptions = {}) {}

  enqueue(key: string, task: WriteTask): void {
    if (this.pending.has(key)) {
      this.pending.set(key, task)
      return
    }

    const maxPending = this.options.maxPending ?? 1_024
    if (this.pending.size >= maxPending) {
      const dropped = this.order.shift()
      if (dropped !== undefined) {
        this.pending.delete(dropped)
        this.options.onDrop?.(dropped)
      }
    }

    this.pending.set(key, task)
    this.order.push(key)
    this.pump()
  }

  async flush(timeoutMs = this.options.shutdownTimeoutMs ?? 2_000): Promise<void> {
    if (this.isIdle()) return
    await Promise.race([
      new Promise<void>((resolve) => this.waiters.add(resolve)),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs)
        timer.unref()
      }),
    ])
  }

  private pump(): void {
    const concurrency = this.options.concurrency ?? 4
    let scanBudget = this.order.length
    while (this.active < concurrency && this.order.length > 0 && scanBudget-- > 0) {
      const key = this.order.shift()!
      if (this.activeKeys.has(key)) {
        this.order.push(key)
        continue
      }
      const task = this.pending.get(key)
      this.pending.delete(key)
      if (!task) continue
      this.active++
      this.activeKeys.add(key)
      Promise.resolve()
        .then(task)
        .catch((error) => this.options.onError?.(error))
        .finally(() => {
          this.active--
          this.activeKeys.delete(key)
          this.pump()
          this.resolveWaitersIfIdle()
        })
    }
  }

  private isIdle(): boolean {
    return this.active === 0 && this.pending.size === 0
  }

  private resolveWaitersIfIdle(): void {
    if (!this.isIdle()) return
    for (const resolve of this.waiters) resolve()
    this.waiters.clear()
  }
}
