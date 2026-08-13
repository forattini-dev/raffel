import type { IncomingMessage, ServerResponse } from 'node:http'

export type McpCorsOptions = boolean | string | string[]

export function applyMcpCors(
  req: IncomingMessage,
  res: ServerResponse,
  cors: McpCorsOptions | undefined,
): void {
  if (!cors) return

  const requestOrigin = req.headers.origin
  let allowedOrigin: string | undefined
  if (cors === true) {
    allowedOrigin = '*'
  } else if (typeof cors === 'string') {
    allowedOrigin = cors
  } else if (requestOrigin && cors.includes(requestOrigin)) {
    allowedOrigin = requestOrigin
  }

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    if (allowedOrigin !== '*') res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Authorization, X-Api-Key')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
}
