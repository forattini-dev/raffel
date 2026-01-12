/**
 * USD Parser Module
 *
 * Provides parsing and serialization for USD documents in JSON and YAML formats.
 */

import { readFile } from 'node:fs/promises'
import type { USDDocument } from '../spec/types.js'
import { parseJson, serializeJson, USDJsonParseError } from './json.js'
import { parseYaml, serializeYaml, USDYamlParseError } from './yaml.js'
import { normalize, cloneDocument, mergeDocuments } from './normalize.js'

// Re-export
export { parseJson, serializeJson, USDJsonParseError } from './json.js'
export { parseYaml, serializeYaml, USDYamlParseError } from './yaml.js'
export { normalize, cloneDocument, mergeDocuments } from './normalize.js'

/**
 * Parse error class
 */
export class USDParseError extends Error {
  constructor(
    message: string,
    public readonly format?: 'json' | 'yaml',
    public readonly position?: { line: number; column: number }
  ) {
    super(message)
    this.name = 'USDParseError'
  }
}

/**
 * Detect format from content
 */
export function detectFormat(content: string): 'json' | 'yaml' {
  const trimmed = content.trim()

  // JSON starts with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json'
  }

  // Everything else is YAML
  return 'yaml'
}

/**
 * Detect format from file extension
 */
export function detectFormatFromPath(path: string): 'json' | 'yaml' {
  const ext = path.toLowerCase().split('.').pop()

  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'

  // Default to YAML for unknown extensions
  return 'yaml'
}

/**
 * Parse a string into a USD document (auto-detect format)
 *
 * @param content - JSON or YAML string
 * @param options - Parse options
 * @returns Parsed and normalized USD document
 */
export function parse(
  content: string,
  options: {
    /** Skip normalization */
    raw?: boolean
    /** Force a specific format */
    format?: 'json' | 'yaml'
  } = {}
): USDDocument {
  const format = options.format ?? detectFormat(content)

  try {
    let doc: USDDocument

    if (format === 'json') {
      doc = parseJson(content)
    } else {
      doc = parseYaml(content)
    }

    if (options.raw) {
      return doc
    }

    return normalize(doc)
  } catch (err) {
    if (err instanceof USDJsonParseError) {
      throw new USDParseError(err.message, 'json', err.position)
    }
    if (err instanceof USDYamlParseError) {
      throw new USDParseError(err.message, 'yaml', err.position)
    }
    throw new USDParseError(`Failed to parse USD document: ${String(err)}`, format)
  }
}

/**
 * Parse a USD document from a file
 *
 * @param path - File path
 * @param options - Parse options
 * @returns Parsed and normalized USD document
 */
export async function parseFile(
  path: string,
  options: {
    /** Skip normalization */
    raw?: boolean
    /** Force a specific format (auto-detect from extension if not specified) */
    format?: 'json' | 'yaml'
  } = {}
): Promise<USDDocument> {
  const content = await readFile(path, 'utf-8')
  const format = options.format ?? detectFormatFromPath(path)

  return parse(content, { ...options, format })
}

/**
 * Serialize a USD document to a string
 *
 * @param doc - USD document
 * @param format - Output format
 * @param options - Serialization options
 * @returns Serialized string
 */
export function serialize(
  doc: USDDocument,
  format: 'json' | 'yaml' = 'yaml',
  options: {
    /** Pretty print JSON (default: true) */
    pretty?: boolean
    /** YAML line width (default: 80) */
    lineWidth?: number
    /** YAML indent (default: 2) */
    indent?: number
  } = {}
): string {
  if (format === 'json') {
    return serializeJson(doc, options.pretty ?? true)
  }

  return serializeYaml(doc, {
    lineWidth: options.lineWidth,
    indent: options.indent,
  })
}

/**
 * Create a wrapper object with serialization methods
 */
export function createDocumentWrapper(doc: USDDocument) {
  return {
    /** The raw document */
    document: doc,

    /** Serialize to JSON */
    toJson(pretty = true): string {
      return serializeJson(doc, pretty)
    },

    /** Serialize to YAML */
    toYaml(options?: { lineWidth?: number; indent?: number }): string {
      return serializeYaml(doc, options)
    },

    /** Clone the document */
    clone(): USDDocument {
      return cloneDocument(doc)
    },

    /** Merge with another document */
    merge(other: Partial<USDDocument>): USDDocument {
      return mergeDocuments(doc, other)
    },
  }
}

export type USDDocumentWrapper = ReturnType<typeof createDocumentWrapper>
