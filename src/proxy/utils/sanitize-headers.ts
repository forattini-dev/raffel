/**
 * Apply the trust-boundary header-value sanitiser to a header bag.
 *
 * Used by the HTTP forward proxy and any other proxy/adapter that copies
 * headers into an upstream request. Pairs with `stripHopByHopHeaders`:
 * hop-by-hop stripping happens first, then this scrubs whatever survives.
 *
 * Behaviour:
 *   - Header names are themselves validated as `safeStructuredKey`-shaped.
 *     Names with CRLF / NUL / control bytes raise `SanitisationError`
 *     (header smuggling defence).
 *   - Header values run through `safeHeaderValue` in reject mode by default.
 *   - On any failure, the function throws a `SanitisationError`. Callers
 *     decide the wire-level response (the HTTP forward proxy returns 400).
 */

import { safeHeaderValue, type SanitiseMode } from '../../security/sanitize/index.js'
import { SanitisationError } from '../../security/sanitize/index.js'

export interface SanitiseHeadersOptions {
  /** Mode for header VALUES. Default: 'reject'. */
  mode?: SanitiseMode
  /** Maximum length per value. Default: 4096. */
  maxValueLength?: number
  /** Maximum length per header name. Default: 256. */
  maxNameLength?: number
}

const DEFAULT_NAME_MAX = 256

function hex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

function validateHeaderName(name: string, maxLength: number): void {
  if (name.length === 0) {
    throw new SanitisationError('header name is empty', {
      kind: 'empty',
      sink: 'header-value',
    })
  }
  if (name.length > maxLength) {
    throw new SanitisationError(
      `header name length ${name.length} exceeds limit ${maxLength}`,
      {
        kind: 'too-long',
        sink: 'header-value',
        length: name.length,
        maxLength,
      },
    )
  }
  // RFC 7230 token chars: ALPHA / DIGIT / "!#$%&'*+-.^_`|~"
  // We accept that token set; anything else (CRLF, NUL, space, ":") is rejected.
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (!isTokenByte(code)) {
      throw new SanitisationError(
        `header name contains forbidden byte ${hex(code)} at position ${i + 1}`,
        {
          kind: 'invalid-char',
          sink: 'header-value',
          position: i + 1,
          charCode: hex(code),
        },
      )
    }
  }
}

function isTokenByte(code: number): boolean {
  // Digits 0-9
  if (code >= 0x30 && code <= 0x39) return true
  // A-Z
  if (code >= 0x41 && code <= 0x5a) return true
  // a-z
  if (code >= 0x61 && code <= 0x7a) return true
  // RFC 7230 special tokens
  switch (code) {
    case 0x21: // !
    case 0x23: // #
    case 0x24: // $
    case 0x25: // %
    case 0x26: // &
    case 0x27: // '
    case 0x2a: // *
    case 0x2b: // +
    case 0x2d: // -
    case 0x2e: // .
    case 0x5e: // ^
    case 0x5f: // _
    case 0x60: // `
    case 0x7c: // |
    case 0x7e: // ~
      return true
    default:
      return false
  }
}

/**
 * Sanitise an entire header bag. Returns a new object — never mutates input.
 *
 * Throws `SanitisationError` on the FIRST forbidden name or value.
 */
export function sanitiseOutboundHeaders(
  headers: Record<string, string>,
  options: SanitiseHeadersOptions = {},
): Record<string, string> {
  const {
    mode = 'reject',
    maxValueLength = 4096,
    maxNameLength = DEFAULT_NAME_MAX,
  } = options

  const out: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(headers)) {
    // Header names are case-insensitive; lowercase to keep wire output stable.
    const name = rawName.toLowerCase()
    validateHeaderName(name, maxNameLength)
    const value = safeHeaderValue(rawValue, { mode, maxLength: maxValueLength })
    out[name] = value
  }
  return out
}
