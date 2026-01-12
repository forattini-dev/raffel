/**
 * Node.js Serve Helper
 *
 * Provides a serve() function to run HttpApp with Node.js http server.
 * Includes graceful shutdown support.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { BodyInit } from './web-types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch handler function */
export type FetchHandler = (request: Request) => Response | Promise<Response>

/** Serve options */
export interface ServeOptions {
  /** Fetch handler (e.g., app.fetch) */
  fetch: FetchHandler

  /** Port to listen on */
  port?: number

  /** Hostname to bind to */
  hostname?: string

  /** Callback when server starts listening */
  onListen?: (info: { port: number; hostname: string }) => void

  /** Callback when server encounters an error */
  onError?: (err: Error) => void
}

/** Extended server interface with graceful shutdown */
export interface RaffelServer extends Server {
  /**
   * Stop accepting new connections
   * Existing requests continue processing
   */
  stopAcceptingRequests(): void

  /**
   * Wait for all in-flight requests to complete
   * @param timeoutMs - Maximum time to wait (default: 30000)
   * @returns Promise that resolves when all requests complete or timeout
   */
  waitForRequestsToFinish(timeoutMs?: number): Promise<void>

  /**
   * Get the current count of in-flight requests
   */
  getInFlightCount(): number

  /**
   * Graceful shutdown - stop accepting + wait for completion
   * @param timeoutMs - Maximum time to wait for requests
   */
  shutdown(timeoutMs?: number): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Node.js IncomingMessage to Web Request
 */
async function nodeRequestToWebRequest(req: IncomingMessage): Promise<Request> {
  const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const host = req.headers.host || 'localhost'
  const url = `${protocol}://${host}${req.url || '/'}`

  // Read body for methods that typically have one
  let body: BodyInit | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    if (chunks.length > 0) {
      body = Buffer.concat(chunks)
    }
  }

  // Convert headers
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
    body,
    duplex: body ? 'half' : undefined,
  } as RequestInit)
}

/**
 * Send Web Response to Node.js ServerResponse
 */
async function sendWebResponse(webResponse: Response, nodeRes: ServerResponse): Promise<void> {
  // Set status
  nodeRes.statusCode = webResponse.status
  nodeRes.statusMessage = webResponse.statusText || ''

  // Set headers
  webResponse.headers.forEach((value, key) => {
    // Handle Set-Cookie specially (can have multiple values)
    if (key.toLowerCase() === 'set-cookie') {
      const existing = nodeRes.getHeader('set-cookie')
      if (existing) {
        const values = Array.isArray(existing) ? existing : [String(existing)]
        nodeRes.setHeader('set-cookie', [...values, value])
      } else {
        nodeRes.setHeader('set-cookie', value)
      }
    } else {
      nodeRes.setHeader(key, value)
    }
  })

  // Send body
  if (webResponse.body) {
    const reader = webResponse.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        nodeRes.write(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  nodeRes.end()
}

// ─────────────────────────────────────────────────────────────────────────────
// Serve Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and start an HTTP server for the given fetch handler
 *
 * @example
 * const app = new HttpApp()
 * app.get('/', (c) => c.text('Hello!'))
 *
 * const server = serve({
 *   fetch: app.fetch,
 *   port: 3000,
 *   hostname: '0.0.0.0',
 *   onListen: ({ port, hostname }) => {
 *     console.log(`Listening on http://${hostname}:${port}`)
 *   }
 * })
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await server.shutdown()
 * })
 */
export function serve(options: ServeOptions): RaffelServer {
  const {
    fetch,
    port = 3000,
    hostname = '0.0.0.0',
    onListen,
    onError,
  } = options

  let inFlightCount = 0
  let isAcceptingRequests = true
  const waitingResolvers: (() => void)[] = []

  /**
   * Handle incoming request
   */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Reject if not accepting
    if (!isAcceptingRequests) {
      res.statusCode = 503
      res.setHeader('Connection', 'close')
      res.end('Service Unavailable')
      return
    }

    inFlightCount++

    try {
      const webRequest = await nodeRequestToWebRequest(req)
      const webResponse = await fetch(webRequest)
      await sendWebResponse(webResponse, res)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      onError?.(error)

      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    } finally {
      inFlightCount--

      // Notify waiters if no more requests
      if (inFlightCount === 0 && waitingResolvers.length > 0) {
        for (const resolve of waitingResolvers) {
          resolve()
        }
        waitingResolvers.length = 0
      }
    }
  }

  // Create server
  const server = createServer(handleRequest) as RaffelServer

  // Add graceful shutdown methods
  server.stopAcceptingRequests = function () {
    isAcceptingRequests = false
  }

  server.getInFlightCount = function () {
    return inFlightCount
  }

  server.waitForRequestsToFinish = function (timeoutMs = 30000): Promise<void> {
    return new Promise((resolve) => {
      if (inFlightCount === 0) {
        resolve()
        return
      }

      const timer = setTimeout(() => {
        // Remove from waiters
        const index = waitingResolvers.indexOf(resolveWrap)
        if (index !== -1) {
          waitingResolvers.splice(index, 1)
        }
        resolve()
      }, timeoutMs)

      const resolveWrap = () => {
        clearTimeout(timer)
        resolve()
      }

      waitingResolvers.push(resolveWrap)
    })
  }

  server.shutdown = async function (timeoutMs = 30000): Promise<void> {
    this.stopAcceptingRequests()
    await this.waitForRequestsToFinish(timeoutMs)
    return new Promise((resolve) => {
      this.close(() => resolve())
    })
  }

  // Error handling
  server.on('error', (err) => {
    onError?.(err)
  })

  // Start listening
  server.listen(port, hostname, () => {
    onListen?.({ port, hostname })
  })

  return server
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default serve
