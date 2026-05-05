import type { MCPToolResult } from '../types.js'

export function text(content: string): MCPToolResult {
  return { content: [{ type: 'text', text: content }] }
}

export function error(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

export function toTitleCase(input: string): string {
  return input
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
