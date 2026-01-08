/**
 * ID Alphabets
 *
 * Pre-defined character sets for ID generation.
 * Each alphabet offers different trade-offs between
 * density (characters per bit) and usability.
 */

/**
 * URL-safe alphabet (64 chars).
 * Entropy: 6 bits per character
 * 21 chars = 126 bits of entropy
 */
export const URL_SAFE = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'

/**
 * URL-safe alphabet without special chars (62 chars).
 * Alphanumeric only: a-z, A-Z, 0-9
 * Entropy: ~5.95 bits per character
 * 22 chars = ~131 bits of entropy
 */
export const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Lowercase alphanumeric (36 chars).
 * Entropy: ~5.17 bits per character
 * 25 chars = ~129 bits of entropy
 */
export const ALPHANUMERIC_LOWER = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Hexadecimal lowercase (16 chars).
 * Entropy: 4 bits per character
 * 32 chars = 128 bits of entropy
 */
export const HEX_LOWER = '0123456789abcdef'

/**
 * Hexadecimal uppercase (16 chars).
 */
export const HEX_UPPER = '0123456789ABCDEF'

/**
 * Base58 Bitcoin alphabet (58 chars).
 * Excludes 0, O, I, l to avoid confusion.
 * Entropy: ~5.86 bits per character
 */
export const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Numeric only (10 chars).
 * Entropy: ~3.32 bits per character
 * 39 chars = ~129 bits of entropy
 */
export const NUMERIC = '0123456789'

export const alphabets = {
  URL_SAFE,
  ALPHANUMERIC,
  ALPHANUMERIC_LOWER,
  HEX_LOWER,
  HEX_UPPER,
  BASE58,
  NUMERIC,
} as const

export type AlphabetName = keyof typeof alphabets

/**
 * Get alphabet by name or return custom alphabet string.
 */
export function getAlphabet(nameOrCustom: AlphabetName | string): string {
  if (nameOrCustom in alphabets) {
    return alphabets[nameOrCustom as AlphabetName]
  }
  return nameOrCustom
}

/**
 * Validate an alphabet string.
 * Returns null if valid, error message if invalid.
 */
export function validateAlphabet(alphabet: string): string | null {
  if (!alphabet || alphabet.length === 0) {
    return 'Alphabet cannot be empty'
  }

  if (alphabet.length === 1) {
    return 'Alphabet must have at least 2 characters'
  }

  if (alphabet.length > 65536) {
    return 'Alphabet cannot exceed 65536 characters'
  }

  const seen = new Set<string>()
  for (const char of alphabet) {
    if (seen.has(char)) {
      return `Duplicate character in alphabet: "${char}"`
    }
    seen.add(char)
  }

  return null
}
