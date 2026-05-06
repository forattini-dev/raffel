/**
 * `safeRouteSegment` — sanitises a single route/path segment that flows
 * across a trust boundary (e.g. a procedure name segment, a router prefix
 * segment).
 *
 * Same character class as `safeChannelName` but a smaller default length
 * and the same reject-only semantics.
 *
 * Pure: zero I/O, zero protocol coupling.
 */

import { SanitisationError } from './errors.js'

export interface SafeRouteSegmentOptions {
  /** Maximum length. Default: 128. */
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 128

function hex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

function isAllowedSegmentByte(code: number): boolean {
  // 0-9
  if (code >= 0x30 && code <= 0x39) return true
  // A-Z
  if (code >= 0x41 && code <= 0x5a) return true
  // a-z
  if (code >= 0x61 && code <= 0x7a) return true
  // : _ - . /
  switch (code) {
    case 0x3a:
    case 0x5f:
    case 0x2d:
    case 0x2e:
    case 0x2f:
      return true
    default:
      return false
  }
}

export function safeRouteSegment(
  input: unknown,
  options: SafeRouteSegmentOptions = {},
): string {
  const { maxLength = DEFAULT_MAX_LENGTH } = options

  if (typeof input !== 'string') {
    throw new SanitisationError('route segment must be a string', {
      kind: 'invalid-char',
      sink: 'route-segment',
    })
  }

  const value = input.normalize('NFKC')

  if (value.length === 0) {
    throw new SanitisationError('route segment is empty', {
      kind: 'empty',
      sink: 'route-segment',
    })
  }

  if (value.length > maxLength) {
    throw new SanitisationError(
      `route segment length ${value.length} exceeds limit ${maxLength}`,
      {
        kind: 'too-long',
        sink: 'route-segment',
        length: value.length,
        maxLength,
      },
    )
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!isAllowedSegmentByte(code)) {
      throw new SanitisationError(
        `route segment contains forbidden byte ${hex(code)} at position ${i + 1}`,
        {
          kind: 'invalid-char',
          sink: 'route-segment',
          position: i + 1,
          charCode: hex(code),
        },
      )
    }
  }

  return value
}
