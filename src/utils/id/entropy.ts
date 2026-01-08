/**
 * Entropy Pool and Random Generation
 *
 * Provides cryptographically secure random generation with:
 * - Pre-allocated entropy pool for performance
 * - Rejection sampling for zero modulo bias
 * - Efficient batch generation
 */

import { randomFillSync } from 'node:crypto'

const DEFAULT_POOL_SIZE = 2048
const MIN_POOL_SIZE = 256

let pool: Uint8Array
let poolOffset: number = 0

/**
 * Initialize or resize the entropy pool.
 * Uses a pre-allocated buffer to reduce GC pressure and improve performance.
 */
export function initPool(size: number = DEFAULT_POOL_SIZE): void {
  const actualSize = Math.max(size, MIN_POOL_SIZE)
  pool = new Uint8Array(actualSize)
  randomFillSync(pool)
  poolOffset = 0
}

/**
 * Get cryptographically secure random bytes from the pool.
 * Automatically refills the pool when exhausted.
 */
export function getRandomBytes(count: number): Uint8Array {
  if (!pool) {
    initPool()
  }

  if (count > pool.length) {
    const bytes = new Uint8Array(count)
    randomFillSync(bytes)
    return bytes
  }

  if (poolOffset + count > pool.length) {
    randomFillSync(pool)
    poolOffset = 0
  }

  const bytes = pool.slice(poolOffset, poolOffset + count)
  poolOffset += count
  return bytes
}

/**
 * Fill a pre-allocated buffer with random bytes.
 * More efficient than getRandomBytes when you already have a buffer.
 */
export function fillRandomBytes(buffer: Uint8Array): Uint8Array {
  if (!pool) {
    initPool()
  }

  const needed = buffer.length

  if (poolOffset + needed <= pool.length) {
    buffer.set(pool.subarray(poolOffset, poolOffset + needed))
    poolOffset += needed
  } else {
    const remaining = pool.length - poolOffset
    if (remaining > 0) {
      buffer.set(pool.subarray(poolOffset, pool.length), 0)
    }
    randomFillSync(pool)
    poolOffset = 0
    buffer.set(pool.subarray(0, needed - remaining), remaining)
    poolOffset = needed - remaining
  }

  return buffer
}

/**
 * Generate multiple unbiased random indices efficiently.
 * Pre-calculates rejection threshold and batches random byte generation.
 *
 * Uses rejection sampling to eliminate modulo bias for non-power-of-2
 * alphabet sizes.
 */
export function randomIndicesUnbiased(alphabetSize: number, count: number): Uint16Array {
  if (alphabetSize <= 0 || alphabetSize > 65536) {
    throw new Error(`Invalid alphabet size: ${alphabetSize}. Must be 1-65536.`)
  }

  const result = new Uint16Array(count)

  if (alphabetSize === 1) {
    return result
  }

  if (alphabetSize <= 256) {
    const threshold = 256 - (256 % alphabetSize)
    const estimatedBytes = Math.ceil(count * (256 / threshold) * 1.1)
    let bytes = getRandomBytes(Math.max(estimatedBytes, count * 2))
    let byteIndex = 0
    let resultIndex = 0

    while (resultIndex < count) {
      if (byteIndex >= bytes.length) {
        const extraBytes = getRandomBytes(Math.max(16, (count - resultIndex) * 2))
        const newBytes = new Uint8Array(bytes.length + extraBytes.length)
        newBytes.set(bytes)
        newBytes.set(extraBytes, bytes.length)
        bytes = newBytes
        byteIndex = 0
      }

      const byte = bytes[byteIndex++]!
      if (byte < threshold) {
        result[resultIndex++] = byte % alphabetSize
      }
    }

    return result
  }

  const threshold = 65536 - (65536 % alphabetSize)
  const estimatedBytes = Math.ceil(count * 2 * (65536 / threshold) * 1.1)
  let bytes = getRandomBytes(Math.max(estimatedBytes, count * 4))
  let byteIndex = 0
  let resultIndex = 0

  while (resultIndex < count) {
    if (byteIndex + 1 >= bytes.length) {
      const extraBytes = getRandomBytes(Math.max(32, (count - resultIndex) * 4))
      const newBytes = new Uint8Array(bytes.length + extraBytes.length)
      newBytes.set(bytes)
      newBytes.set(extraBytes, bytes.length)
      bytes = newBytes
    }

    const value = (bytes[byteIndex]! << 8) | bytes[byteIndex + 1]!
    byteIndex += 2

    if (value < threshold) {
      result[resultIndex++] = value % alphabetSize
    }
  }

  return result
}

/**
 * Generate a string from an alphabet using unbiased random selection.
 * This is the core function for generating IDs.
 */
export function randomString(alphabet: string, length: number): string {
  const alphabetSize = alphabet.length
  const indices = randomIndicesUnbiased(alphabetSize, length)
  let result = ''

  for (let i = 0; i < length; i++) {
    result += alphabet[indices[i]!]
  }

  return result
}

/**
 * Calculate the entropy bits for a given alphabet size and ID length.
 */
export function calculateEntropyBits(alphabetSize: number, length: number): number {
  return Math.log2(alphabetSize) * length
}

/**
 * Reset the entropy pool (useful for testing).
 */
export function resetPool(): void {
  pool = undefined as unknown as Uint8Array
  poolOffset = 0
}
