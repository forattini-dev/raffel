/**
 * SSH Adapter — Host key utilities
 *
 * Auto-generates an ephemeral RSA host key for dev. For production,
 * users should provide a persistent key via `hostKeys` so clients don't
 * see a "host key changed" warning each restart.
 */

import { generateKeyPairSync } from 'node:crypto'

/**
 * Generate an ephemeral RSA 2048 private key in PEM (PKCS#1) format.
 * Suitable for ssh2 ServerConfig.hostKeys.
 *
 * RSA + PKCS#1 was chosen because it is the format ssh2 parses most
 * reliably across versions. Ed25519 in PKCS#8 (Node's default) is not
 * accepted by ssh2's key parser.
 */
export function generateEphemeralHostKey(): Buffer {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  return Buffer.from(privateKey as string, 'utf8')
}
