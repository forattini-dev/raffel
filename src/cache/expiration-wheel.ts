interface ScheduledExpiry {
  dueTick: number
  slot: number
  version: number
}

export class ExpirationWheel {
  private readonly slots: Array<Set<string>>
  private readonly scheduled = new Map<string, ScheduledExpiry>()
  private readonly timer: ReturnType<typeof setInterval>
  private currentTick: number

  constructor(
    private readonly resolutionMs: number,
    private readonly onExpire: (key: string, version: number) => void,
    wheelSize = 256
  ) {
    this.slots = Array.from({ length: wheelSize }, () => new Set<string>())
    this.currentTick = Math.floor(Date.now() / resolutionMs)
    this.timer = setInterval(() => this.advance(), resolutionMs)
    this.timer.unref()
  }

  schedule(key: string, expiresAt: number, version: number): void {
    this.cancel(key)
    const dueTick = Math.ceil(expiresAt / this.resolutionMs)
    const slot = dueTick % this.slots.length
    this.slots[slot]!.add(key)
    this.scheduled.set(key, { dueTick, slot, version })
  }

  cancel(key: string): void {
    const expiry = this.scheduled.get(key)
    if (!expiry) return
    this.slots[expiry.slot]!.delete(key)
    this.scheduled.delete(key)
  }

  shutdown(): void {
    clearInterval(this.timer)
    this.scheduled.clear()
    for (const slot of this.slots) slot.clear()
  }

  private advance(): void {
    const targetTick = Math.floor(Date.now() / this.resolutionMs)
    const elapsed = targetTick - this.currentTick
    if (elapsed <= 0) return

    if (elapsed > this.slots.length) {
      this.currentTick = targetTick
      for (const [key, expiry] of this.scheduled) {
        if (expiry.dueTick <= targetTick) this.expire(key, expiry)
      }
      return
    }

    while (this.currentTick < targetTick) {
      this.currentTick++
      const slotIndex = this.currentTick % this.slots.length
      for (const key of [...this.slots[slotIndex]!]) {
        const expiry = this.scheduled.get(key)
        if (expiry && expiry.dueTick <= this.currentTick) this.expire(key, expiry)
      }
    }
  }

  private expire(key: string, expiry: ScheduledExpiry): void {
    this.slots[expiry.slot]!.delete(key)
    this.scheduled.delete(key)
    this.onExpire(key, expiry.version)
  }
}
