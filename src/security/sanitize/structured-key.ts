/**
 * `safeStructuredKey` — sanitises identifier-shaped keys (e.g. metric labels,
 * structured-log fields, JSON object keys serialised into trusted contexts).
 *
 * Rules:
 *   - First char: ASCII letter or underscore.
 *   - Subsequent chars: letter, digit, underscore, dot, hyphen.
 *   - Default max length: 64.
 *   - Reject mode only — keys are dictionary lookups; silent stripping
 *     would change semantics.
 *
 * Equivalent regex (linear, no backtracking): /^[A-Za-z_][A-Za-z0-9_.-]*$/
 *
 * Pure: zero I/O, zero protocol coupling.
 */

import { SanitisationError } from './errors.js'

export interface SafeStructuredKeyOptions {
  /** Maximum length. Default: 64. */
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 64

function hex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

function isLetter(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) // a-z
  )
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

function isAllowedFirst(code: number): boolean {
  return isLetter(code) || code === 0x5f // _
}

function isAllowedTail(code: number): boolean {
  return (
    isLetter(code) ||
    isDigit(code) ||
    code === 0x5f || // _
    code === 0x2e || // .
    code === 0x2d // -
  )
}

export function safeStructuredKey(
  input: unknown,
  options: SafeStructuredKeyOptions = {},
): string {
  const { maxLength = DEFAULT_MAX_LENGTH } = options

  if (typeof input !== 'string') {
    throw new SanitisationError('structured key must be a string', {
      kind: 'invalid-char',
      sink: 'structured-key',
    })
  }

  const value = input.normalize('NFKC')

  if (value.length === 0) {
    throw new SanitisationError('structured key is empty', {
      kind: 'empty',
      sink: 'structured-key',
    })
  }

  if (value.length > maxLength) {
    throw new SanitisationError(
      `structured key length ${value.length} exceeds limit ${maxLength}`,
      {
        kind: 'too-long',
        sink: 'structured-key',
        length: value.length,
        maxLength,
      },
    )
  }

  const firstCode = value.charCodeAt(0)
  if (!isAllowedFirst(firstCode)) {
    throw new SanitisationError(
      `structured key must start with a letter or underscore (got ${hex(firstCode)})`,
      {
        kind: 'invalid-char',
        sink: 'structured-key',
        position: 1,
        charCode: hex(firstCode),
      },
    )
  }

  for (let i = 1; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!isAllowedTail(code)) {
      throw new SanitisationError(
        `structured key contains forbidden byte ${hex(code)} at position ${i + 1}`,
        {
          kind: 'invalid-char',
          sink: 'structured-key',
          position: i + 1,
          charCode: hex(code),
        },
      )
    }
  }

  return value
}
