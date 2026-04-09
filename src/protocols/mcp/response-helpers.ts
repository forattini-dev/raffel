/**
 * MCP Response Helpers
 *
 * Ergonomic builders for McpToolResult. Zero dependencies.
 */

import type { McpToolResult, McpContent, McpTextContent, McpImageContent, McpResourceContent } from './types.js'

/**
 * Plain text response.
 */
export function mcpText(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * Pretty-printed JSON response.
 */
export function mcpJson(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

/**
 * Markdown table response.
 *
 * @example
 * mcpTable(['Name', 'Age'], [['Alice', 30], ['Bob', 25]])
 */
export function mcpTable(headers: string[], rows: unknown[][]): McpToolResult {
  const headerRow = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  const dataRows = rows.map((row) => `| ${row.map(String).join(' | ')} |`).join('\n')
  return { content: [{ type: 'text', text: `${headerRow}\n${separator}\n${dataRows}` }] }
}

/**
 * Base64-encoded image response.
 *
 * @param data - Base64 string or Buffer
 * @param mimeType - e.g. 'image/png', 'image/jpeg'
 */
export function mcpImage(data: Buffer | string, mimeType: string): McpToolResult {
  const base64 = typeof data === 'string' ? data : data.toString('base64')
  return { content: [{ type: 'image', data: base64, mimeType } as McpImageContent] }
}

/**
 * Embedded resource response.
 */
export function mcpResource(uri: string, text: string, mimeType = 'text/plain'): McpToolResult {
  return {
    content: [{
      type: 'resource',
      resource: { uri, mimeType, text },
    } as McpResourceContent],
  }
}

/**
 * Error response (sets isError flag).
 */
export function mcpError(message: string, details?: unknown): McpToolResult {
  const text = details
    ? `${message}\n\n${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`
    : message
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * Combine multiple content blocks into a single response.
 *
 * @example
 * mcpMulti(
 *   { type: 'text', text: 'Summary:' },
 *   { type: 'image', data: base64, mimeType: 'image/png' },
 * )
 */
export function mcpMulti(...contents: McpContent[]): McpToolResult {
  return { content: contents }
}
