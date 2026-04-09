/**
 * stdio Transport
 *
 * Reads JSON-RPC messages from stdin (one per line), writes responses to stdout.
 * The standard transport for MCP servers used by Claude Code, Cursor, etc.
 */

import { createInterface, type Interface } from 'readline'
import type { JsonRpcRequest, JsonRpcResponse } from '../types.js'
import { JsonRpcErrorCode } from '../types.js'
import type { McpTransport, McpMessageHandler, JsonRpcMessage } from './types.js'

export interface StdioTransportOptions {
  /** Input stream (default: process.stdin) */
  input?: NodeJS.ReadableStream
  /** Output stream (default: process.stdout) */
  output?: NodeJS.WritableStream
}

export function createStdioTransport(options: StdioTransportOptions = {}): McpTransport {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout

  let rl: Interface | null = null
  let handler: McpMessageHandler | null = null

  return {
    async start(messageHandler: McpMessageHandler): Promise<void> {
      handler = messageHandler

      rl = createInterface({
        input: input as NodeJS.ReadableStream,
        terminal: false,
      })

      rl.on('line', async (line) => {
        if (!line.trim()) return

        try {
          const request = JSON.parse(line) as JsonRpcRequest
          const response = await handler!(request)

          if (response) {
            output.write(JSON.stringify(response) + '\n')
          }
        } catch {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: {
              code: JsonRpcErrorCode.ParseError,
              message: 'Parse error',
            },
          }
          output.write(JSON.stringify(errorResponse) + '\n')
        }
      })

      rl.on('close', () => {
        // Client disconnected — clean exit
        process.exit(0)
      })
    },

    async stop(): Promise<void> {
      if (rl) {
        rl.close()
        rl = null
      }
      handler = null
    },

    async send(message: JsonRpcMessage): Promise<void> {
      output.write(JSON.stringify(message) + '\n')
    },
  }
}
