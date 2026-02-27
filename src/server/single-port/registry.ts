import type { SinglePortProtocolKind } from '../types.js'

export type SinglePortProtocolHandler = (socket: unknown) => Promise<void> | void

export interface SinglePortRegistryEntry {
  protocol: SinglePortProtocolKind
  handler: SinglePortProtocolHandler
}

export interface SinglePortRegistrySnapshot {
  protocols: SinglePortProtocolKind[]
}

export class SinglePortRegistry {
  private readonly handlers = new Map<SinglePortProtocolKind, SinglePortProtocolHandler>()

  register(protocol: SinglePortProtocolKind, handler: SinglePortProtocolHandler): void {
    this.handlers.set(protocol, handler)
  }

  unregister(protocol: SinglePortProtocolKind): void {
    this.handlers.delete(protocol)
  }

  get(protocol: SinglePortProtocolKind): SinglePortProtocolHandler | undefined {
    return this.handlers.get(protocol)
  }

  has(protocol: SinglePortProtocolKind): boolean {
    return this.handlers.has(protocol)
  }

  clear(): void {
    this.handlers.clear()
  }

  snapshot(): SinglePortRegistrySnapshot {
    return {
      protocols: Array.from(this.handlers.keys()),
    }
  }
}
