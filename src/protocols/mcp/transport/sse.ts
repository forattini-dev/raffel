/**
 * SSE Transport (Legacy)
 *
 * Deprecated MCP transport for backward compatibility.
 * Use Streamable HTTP for new implementations.
 *
 * - GET  /sse      → opens SSE stream
 * - POST /message  → sends JSON-RPC request
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import type { JsonRpcRequest, JsonRpcResponse } from '../types.js'
import { JsonRpcErrorCode } from '../types.js'
import type { McpTransport, McpMessageHandler, JsonRpcMessage } from './types.js'
import { applyMcpCors, type McpCorsOptions } from './cors.js'

export interface SseTransportOptions {
  port: number
  host?: string
  maxBodySize?: number
  maxClients?: number
  cors?: McpCorsOptions
}

export function createSseTransport(options: SseTransportOptions): McpTransport {
  const {
    port,
    host = '127.0.0.1',
    maxBodySize = 1_048_576,
    maxClients = 100,
    cors,
  } = options

  let server: Server | null = null
  let handler: McpMessageHandler | null = null
  const clients = new Set<ServerResponse>()

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let totalSize = 0
      let settled = false
      const onData = (chunk: Buffer) => {
        if (settled) return
        totalSize += chunk.length
        if (totalSize > maxBodySize) {
          settled = true
          req.off('data', onData)
          req.resume()
          reject(new Error('Request body too large'))
          return
        }
        chunks.push(chunk)
      }
      req.on('data', onData)
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  return {
    async start(messageHandler: McpMessageHandler): Promise<void> {
      handler = messageHandler

      server = createHttpServer(async (req, res) => {
        applyMcpCors(req, res, cors)

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        // SSE endpoint
        if (req.method === 'GET' && req.url === '/sse') {
          if (clients.size >= maxClients) {
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1' })
            res.end(JSON.stringify({ error: 'Too many SSE clients' }))
            return
          }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          })

          res.write(`event: endpoint\ndata: /message\n\n`)
          clients.add(res)

          req.on('close', () => {
            clients.delete(res)
          })
          return
        }

        // Message endpoint
        if (req.method === 'POST' && req.url === '/message') {
          let body: string
          try {
            body = await readBody(req)
          } catch (error) {
            const tooLarge = (error as Error).message === 'Request body too large'
            res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: tooLarge ? 'Request body too large' : 'Failed to read body' }))
            return
          }

          let request: JsonRpcRequest
          try {
            request = JSON.parse(body) as JsonRpcRequest
          } catch {
            const error: JsonRpcResponse = {
              jsonrpc: '2.0',
              id: null,
              error: { code: JsonRpcErrorCode.ParseError, message: 'Invalid JSON' },
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(error))
            return
          }

          const response = await handler!(request)
          if (response) {
            // Send response via SSE to all connected clients
            const data = JSON.stringify(response)
            for (const client of clients) {
              client.write(`event: message\ndata: ${data}\n\n`)
            }
          }

          res.writeHead(202)
          res.end()
          return
        }

        // Health
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok', clients: clients.size }))
          return
        }

        res.writeHead(404)
        res.end('Not found')
      })

      await new Promise<void>((resolve) => {
        server!.listen(port, host, resolve)
      })
    },

    async stop(): Promise<void> {
      for (const client of clients) {
        client.end()
      }
      clients.clear()

      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => (err ? reject(err) : resolve()))
        })
        server = null
      }

      handler = null
    },

    async send(message: JsonRpcMessage): Promise<void> {
      const data = JSON.stringify(message)
      for (const client of clients) {
        client.write(`event: message\ndata: ${data}\n\n`)
      }
    },
  }
}
