/**
 * JSON Parser for USD documents
 */

import type { USDDocument } from '../spec/types.js'

/**
 * Parse error for JSON parsing
 */
export class USDJsonParseError extends Error {
  constructor(
    message: string,
    public readonly position?: { line: number; column: number }
  ) {
    super(message)
    this.name = 'USDJsonParseError'
  }
}

/**
 * Parse a JSON string into a USD document
 *
 * @param content - JSON string to parse
 * @returns Parsed USD document (unvalidated)
 * @throws USDJsonParseError if parsing fails
 */
export function parseJson(content: string): USDDocument {
  try {
    const parsed = JSON.parse(content)
    return parsed as USDDocument
  } catch (err) {
    if (err instanceof SyntaxError) {
      // Try to extract position from error message
      const match = err.message.match(/position (\d+)/)
      if (match) {
        const position = parseInt(match[1], 10)
        const { line, column } = getLineColumn(content, position)
        throw new USDJsonParseError(
          `Invalid JSON at line ${line}, column ${column}: ${err.message}`,
          { line, column }
        )
      }
      throw new USDJsonParseError(`Invalid JSON: ${err.message}`)
    }
    throw new USDJsonParseError(`Failed to parse JSON: ${String(err)}`)
  }
}

/**
 * Convert a character position to line and column
 */
function getLineColumn(content: string, position: number): { line: number; column: number } {
  let line = 1
  let column = 1

  for (let i = 0; i < position && i < content.length; i++) {
    if (content[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }

  return { line, column }
}

/**
 * Serialize a USD document to JSON
 *
 * @param doc - USD document to serialize
 * @param pretty - Whether to format with indentation (default: true)
 * @returns JSON string
 */
export function serializeJson(doc: USDDocument, pretty = true): string {
  return JSON.stringify(doc, null, pretty ? 2 : undefined)
}
