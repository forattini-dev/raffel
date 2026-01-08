/**
 * UDP Custom Handler Types
 *
 * Type definitions for custom UDP handlers with full control.
 */

import type { Socket as UdpSocket, RemoteInfo, SocketType } from 'node:dgram'
import type { Context } from '../../../types/index.js'

// === UDP Configuration ===

export interface UdpConfig {
  /** Port to listen on */
  port: number

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Socket type (default: 'udp4') */
  type?: SocketType

  /** Reuse address (default: true) */
  reuseAddr?: boolean

  /** Reuse port (default: false) */
  reusePort?: boolean

  /** Receive buffer size */
  recvBufferSize?: number

  /** Send buffer size */
  sendBufferSize?: number

  /** Enable IPv6 only (for udp6) */
  ipv6Only?: boolean

  /** Enable multicast */
  multicast?: UdpMulticastConfig
}

export interface UdpMulticastConfig {
  /** Multicast group to join */
  group: string

  /** Interface to use for multicast */
  interface?: string

  /** Multicast TTL (default: 1) */
  ttl?: number

  /** Enable multicast loopback (default: false) */
  loopback?: boolean
}

// === UDP Context ===

/**
 * Context available in UDP handlers.
 */
export interface UdpContext extends Omit<Context, 'deadline' | 'signal'> {
  /** The UDP socket */
  socket: UdpSocket

  /** Server address */
  address: { host: string; port: number }

  /** Send data to an address */
  send(data: Buffer | string, port: number, address: string): Promise<void>

  /** Send to multiple addresses */
  broadcast(data: Buffer | string, targets: Array<{ port: number; address: string }>): Promise<void>

  /** Reply to the sender (shortcut) */
  reply(data: Buffer | string): Promise<void>

  /** Current message sender info (only in onMessage) */
  sender?: RemoteInfo
}

// === UDP Handler Exports ===

/**
 * UDP handler file exports.
 *
 * @example
 * ```typescript
 * // src/udp/metrics-collector.ts
 * import type { RemoteInfo } from 'node:dgram'
 * import type { UdpContext } from 'raffel'
 *
 * export const config = {
 *   port: 9001,
 * }
 *
 * export function onMessage(data: Buffer, rinfo: RemoteInfo, ctx: UdpContext) {
 *   const metrics = parseMetrics(data)
 *   storeMetrics(metrics)
 *   // No response (fire-and-forget)
 * }
 *
 * // Or with response
 * export async function onMessage(data: Buffer, rinfo: RemoteInfo, ctx: UdpContext) {
 *   const result = await processRequest(data)
 *   return Buffer.from(JSON.stringify(result))
 *   // Automatically sent back to sender
 * }
 * ```
 */
export interface UdpHandlerExports {
  /** UDP configuration */
  config?: UdpConfig

  /**
   * Called when a message is received.
   * Return a Buffer to automatically send a response.
   */
  onMessage: UdpMessageHandler

  /**
   * Called when socket is ready to receive.
   */
  onListening?: UdpListeningHandler

  /**
   * Called on socket error.
   */
  onError?: UdpErrorHandler

  /**
   * Called when socket closes.
   */
  onClose?: UdpCloseHandler
}

// === Handler Types ===

export type UdpMessageHandler = (
  data: Buffer,
  rinfo: RemoteInfo,
  ctx: UdpContext
) => void | Buffer | Promise<void | Buffer>

export type UdpListeningHandler = (
  ctx: UdpContext
) => void | Promise<void>

export type UdpErrorHandler = (
  error: Error,
  ctx: UdpContext
) => void | Promise<void>

export type UdpCloseHandler = (
  ctx: UdpContext
) => void | Promise<void>

// === Loaded UDP Handler ===

export interface LoadedUdpHandler {
  /** Handler name (from filename) */
  name: string

  /** File path */
  filePath: string

  /** Resolved configuration */
  config: ResolvedUdpConfig

  /** Handler exports */
  handlers: UdpHandlerExports
}

export interface ResolvedUdpConfig extends Required<Omit<UdpConfig, 'multicast'>> {
  multicast: UdpMulticastConfig | null
}

// === UDP Loader Options ===

export interface UdpLoaderOptions {
  /** Base directory */
  baseDir: string

  /** UDP directory path */
  udpDir: string

  /** File extensions to load */
  extensions?: string[]

  /** Default port if not specified in handler */
  defaultPort?: number
}

export interface UdpLoaderResult {
  handlers: LoadedUdpHandler[]
  stats: {
    handlers: number
    duration: number
  }
}

// === UDP Server Instance ===

export interface UdpServerInstance {
  /** Handler name */
  name: string

  /** UDP socket */
  socket: UdpSocket

  /** Port */
  port: number

  /** Host */
  host: string

  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Send data to address */
  send(data: Buffer | string, port: number, address: string): Promise<void>

  /** Broadcast to multiple addresses */
  broadcast(data: Buffer | string, targets: Array<{ port: number; address: string }>): Promise<void>
}
