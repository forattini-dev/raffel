import type { Server } from 'node:net'

/**
 * Gracefully shut down a server.
 * Waits for active connections to drain, then force-closes after timeout.
 */
export function gracefulShutdown(server: Server, drainTimeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
      resolve()
    }, drainTimeoutMs)

    server.close(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
