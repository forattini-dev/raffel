/**
 * `safeChannelName` — sanitises pub/sub channel names that flow across
 * trust boundaries (e.g. into Redis pub/sub keyspace, broker topics).
 *
 * Allowlist:  a-z A-Z 0-9 plus `:` `_` `-` `.` `/`
 * Default max length: 256
 * Mode: reject only — channel names are routing keys; silent stripping
 *       would change the destination.
 *
 * Pure: zero I/O, zero protocol coupling.
 */

import { SanitisationError } from './errors.js'

export interface SafeChannelNameOptions {
  /** Maximum length. Default: 256. */
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 256

function hex(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

function isAllowedChannelByte(code: number): boolean {
  // 0-9
  if (code >= 0x30 && code <= 0x39) return true
  // A-Z
  if (code >= 0x41 && code <= 0x5a) return true
  // a-z
  if (code >= 0x61 && code <= 0x7a) return true
  // : (0x3A)  _ (0x5F)  - (0x2D)  . (0x2E)  / (0x2F)
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

export function safeChannelName(
  input: unknown,
  options: SafeChannelNameOptions = {},
): string {
  const { maxLength = DEFAULT_MAX_LENGTH } = options

  if (typeof input !== 'string') {
    throw new SanitisationError('channel name must be a string', {
      kind: 'invalid-char',
      sink: 'channel-name',
    })
  }

  const value = input.normalize('NFKC')

  if (value.length === 0) {
    throw new SanitisationError('channel name is empty', {
      kind: 'empty',
      sink: 'channel-name',
    })
  }

  if (value.length > maxLength) {
    throw new SanitisationError(
      `channel name length ${value.length} exceeds limit ${maxLength}`,
      {
        kind: 'too-long',
        sink: 'channel-name',
        length: value.length,
        maxLength,
      },
    )
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (!isAllowedChannelByte(code)) {
      throw new SanitisationError(
        `channel name contains forbidden byte ${hex(code)} at position ${i + 1}`,
        {
          kind: 'invalid-char',
          sink: 'channel-name',
          position: i + 1,
          charCode: hex(code),
        },
      )
    }
  }

  return value
}
