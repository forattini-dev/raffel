/**
 * SID - Short Unique ID Generator
 *
 * A replacement for nanoid with:
 * - Zero external dependencies
 * - True uniform distribution via rejection sampling
 * - Pre-allocated entropy pool for performance
 * - Multiple alphabet support
 *
 * Default: 21 characters using URL-safe alphabet (126 bits of entropy).
 */

import { randomString, calculateEntropyBits } from './entropy.js'
import { URL_SAFE, getAlphabet, validateAlphabet } from './alphabets.js'

const DEFAULT_SIZE = 21

export interface SidOptions {
  alphabet?: string
  size?: number
}

/**
 * Generate a short unique ID.
 * Default: 21 characters using URL-safe alphabet (126 bits of entropy).
 *
 * Uses rejection sampling for true uniform distribution (zero modulo bias).
 *
 * @example
 * ```typescript
 * import { sid } from 'raffel'
 *
 * const id = sid()        // 'V1StGXR8_Z5jdHi6B-myT'
 * const short = sid(10)   // 'IRFa-VaY2b'
 * ```
 */
export function sid(size: number = DEFAULT_SIZE): string {
  return randomString(URL_SAFE, size)
}

/**
 * Create a custom sid generator with specified alphabet.
 * Returns a function that generates IDs with that alphabet.
 *
 * @example
 * ```typescript
 * import { customAlphabet } from 'raffel'
 *
 * const numericId = customAlphabet('0123456789', 12)
 * const id = numericId() // '839146257301'
 * ```
 */
export function customAlphabet(
  alphabet: string,
  defaultSize: number = DEFAULT_SIZE
): (size?: number) => string {
  const error = validateAlphabet(alphabet)
  if (error) {
    throw new Error(`Invalid alphabet: ${error}`)
  }

  return (size: number = defaultSize): string => {
    return randomString(alphabet, size)
  }
}

/**
 * Create a custom sid generator with alphabet name.
 * Supports: URL_SAFE, ALPHANUMERIC, BASE58, HEX_LOWER, etc.
 *
 * @example
 * ```typescript
 * import { customAlphabetByName } from 'raffel'
 *
 * const hexId = customAlphabetByName('HEX_LOWER', 32)
 * const id = hexId() // 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'
 * ```
 */
export function customAlphabetByName(
  name: string,
  defaultSize: number = DEFAULT_SIZE
): (size?: number) => string {
  const alphabet = getAlphabet(name)
  return customAlphabet(alphabet, defaultSize)
}

/**
 * Generate a sid with options object.
 *
 * @example
 * ```typescript
 * import { sidWithOptions } from 'raffel'
 *
 * const id = sidWithOptions({ size: 16 })
 * const hex = sidWithOptions({ alphabet: 'HEX_LOWER', size: 32 })
 * ```
 */
export function sidWithOptions(options: SidOptions = {}): string {
  const { alphabet = URL_SAFE, size = DEFAULT_SIZE } = options
  const resolvedAlphabet = getAlphabet(alphabet)

  const error = validateAlphabet(resolvedAlphabet)
  if (error) {
    throw new Error(`Invalid alphabet: ${error}`)
  }

  return randomString(resolvedAlphabet, size)
}

/**
 * Calculate entropy bits for a sid configuration.
 *
 * @example
 * ```typescript
 * import { sidEntropyBits } from 'raffel'
 *
 * const bits = sidEntropyBits()  // 126 (default: 21 chars * 6 bits)
 * const hexBits = sidEntropyBits('HEX_LOWER', 32)  // 128
 * ```
 */
export function sidEntropyBits(
  alphabet: string = URL_SAFE,
  size: number = DEFAULT_SIZE
): number {
  const resolvedAlphabet = getAlphabet(alphabet)
  return calculateEntropyBits(resolvedAlphabet.length, size)
}

/**
 * URL-safe alphabet constant.
 */
export const urlAlphabet = URL_SAFE

export default sid
