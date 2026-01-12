/**
 * YAML Parser for USD documents
 */

import yaml from 'js-yaml'
import type { USDDocument } from '../spec/types.js'

/**
 * Parse error for YAML parsing
 */
export class USDYamlParseError extends Error {
  constructor(
    message: string,
    public readonly position?: { line: number; column: number }
  ) {
    super(message)
    this.name = 'USDYamlParseError'
  }
}

/**
 * Parse a YAML string into a USD document
 *
 * @param content - YAML string to parse
 * @returns Parsed USD document (unvalidated)
 * @throws USDYamlParseError if parsing fails
 */
export function parseYaml(content: string): USDDocument {
  try {
    const parsed = yaml.load(content, {
      schema: yaml.JSON_SCHEMA,
      json: true,
    })

    if (typeof parsed !== 'object' || parsed === null) {
      throw new USDYamlParseError('YAML document must be an object')
    }

    return parsed as USDDocument
  } catch (err) {
    if (err instanceof yaml.YAMLException) {
      const mark = err.mark
      if (mark) {
        throw new USDYamlParseError(
          `Invalid YAML at line ${mark.line + 1}, column ${mark.column + 1}: ${err.reason || err.message}`,
          { line: mark.line + 1, column: mark.column + 1 }
        )
      }
      throw new USDYamlParseError(`Invalid YAML: ${err.message}`)
    }
    if (err instanceof USDYamlParseError) {
      throw err
    }
    throw new USDYamlParseError(`Failed to parse YAML: ${String(err)}`)
  }
}

/**
 * Serialize a USD document to YAML
 *
 * @param doc - USD document to serialize
 * @param options - Serialization options
 * @returns YAML string
 */
export function serializeYaml(
  doc: USDDocument,
  options: {
    /** Line width (default: 80) */
    lineWidth?: number
    /** Indent size (default: 2) */
    indent?: number
    /** Don't quote strings that don't need quotes */
    noCompatMode?: boolean
  } = {}
): string {
  const { lineWidth = 80, indent = 2, noCompatMode = true } = options

  return yaml.dump(doc, {
    lineWidth,
    indent,
    noCompatMode,
    quotingType: '"',
    forceQuotes: false,
    schema: yaml.JSON_SCHEMA,
  })
}
