export interface WriteBehindQueueOptions {
  concurrency?: number
  maxPending?: number
  shutdownTimeoutMs?: number
  onError?: (error: unknown) => void
  onDrop?: (key: string) => void
}

export interface WriteBehindQueueStats {
  active: number
  pending: number
  dropped: number
}

type WriteTask = () => void | Promise<void>

interface QueueEntry {
  key: string
  task: WriteTask
  barrier: boolean
  resolve?: () => void
  reject?: (error: unknown) => void
}

export class WriteBehindQueue {
  private readonly pending = new Map<string, QueueEntry>()
  private readonly order: QueueEntry[] = []
  private readonly waiters = new Set<() => void>()
  private readonly activeKeys = new Set<string>()
  private active = 0
  private dropped = 0

  constructor(private readonly options: WriteBehindQueueOptions = {}) {}

  enqueue(key: string, task: WriteTask): void {
    const existing = this.pending.get(key)
    if (existing) {
      existing.task = task
      return
    }

    const maxPending = this.options.maxPending ?? 1_024
    if (this.pending.size >= maxPending) {
      const dropped = this.order.find((entry) => !entry.barrier)
      if (dropped) {
        this.removePending(dropped)
        this.dropped++
        this.options.onDrop?.(dropped.key)
      }
    }

    const entry: QueueEntry = { key, task, barrier: false }
    this.pending.set(key, entry)
    this.order.push(entry)
    this.pump()
  }

  enqueueBarrier(key: string, task: WriteTask): Promise<void> {
    const pending = this.pending.get(key)
    if (pending) this.removePending(pending)
    return new Promise<void>((resolve, reject) => {
      this.order.push({ key, task, barrier: true, resolve, reject })
      this.pump()
    })
  }

  async drain(): Promise<void> {
    if (this.isIdle()) return
    await new Promise<void>((resolve) => this.waiters.add(resolve))
  }

  stats(): WriteBehindQueueStats {
    return { active: this.active, pending: this.order.length, dropped: this.dropped }
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
      const entry = this.order.shift()!
      if (this.activeKeys.has(entry.key)) {
        this.order.push(entry)
        continue
      }
      if (!entry.barrier) {
        if (this.pending.get(entry.key) !== entry) continue
        this.pending.delete(entry.key)
      }
      this.active++
      this.activeKeys.add(entry.key)
      Promise.resolve()
        .then(entry.task)
        .then(() => entry.resolve?.())
        .catch((error) => {
          this.options.onError?.(error)
          entry.reject?.(error)
        })
        .finally(() => {
          this.active--
          this.activeKeys.delete(entry.key)
          this.pump()
          this.resolveWaitersIfIdle()
        })
    }
  }

  private isIdle(): boolean {
    return this.active === 0 && this.order.length === 0
  }

  private removePending(entry: QueueEntry): void {
    if (this.pending.get(entry.key) === entry) this.pending.delete(entry.key)
    const index = this.order.indexOf(entry)
    if (index >= 0) this.order.splice(index, 1)
  }

  private resolveWaitersIfIdle(): void {
    if (!this.isIdle()) return
    for (const resolve of this.waiters) resolve()
    this.waiters.clear()
  }
}
