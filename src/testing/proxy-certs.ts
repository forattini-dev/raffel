/**
 * X.509 certificate generation for testing.
 *
 * Re-exports from src/utils/certs.ts for backward compatibility.
 * Production code (connect-tunnel.ts) imports directly from ../utils/certs.js.
 */
export type { CertificateInfo, CertificateOptions } from '../utils/certs.js'
export { generateCA, getDefaultCA, generateCertificate } from '../utils/certs.js'
