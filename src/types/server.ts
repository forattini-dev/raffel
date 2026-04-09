import type { Server } from 'node:http'

/** HTTP server with optional connection management methods (Node 18.2+) */
export type ClosableHttpServer = Server & {
  closeIdleConnections?: () => void
  closeAllConnections?: () => void
}
