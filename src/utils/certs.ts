/**
 * X.509 certificate generation utilities.
 *
 * Generates self-signed CA and leaf certificates using node:crypto
 * with manual DER/ASN.1 encoding — no external dependencies.
 *
 * Used by connect-tunnel.ts (MITM mode) and testing utilities.
 */
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto'

export interface CertificateInfo {
  key: string
  cert: string
  ca?: string
}

export interface CertificateOptions {
  caCert?: string
  caKey?: string
  validityDays?: number
}

// ---------------------------------------------------------------------------
// DER / ASN.1 encoding helpers
// ---------------------------------------------------------------------------

function derLen(n: number): Buffer {
  if (n < 128) return Buffer.from([n])
  const bytes: number[] = []
  let rem = n
  while (rem > 0) {
    bytes.unshift(rem & 0xff)
    rem >>>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(value.length), value])
}

function encodeOID(oidStr: string): Buffer {
  const parts = oidStr.split('.').map((s) => parseInt(s, 10))
  const bytes: number[] = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    const n = parts[i]
    if (n === 0) {
      bytes.push(0)
      continue
    }
    const group: number[] = []
    let rem = n
    group.unshift(rem & 0x7f)
    rem = Math.floor(rem / 128)
    while (rem > 0) {
      group.unshift((rem & 0x7f) | 0x80)
      rem = Math.floor(rem / 128)
    }
    bytes.push(...group)
  }
  return tlv(0x06, Buffer.from(bytes))
}

/** AlgorithmIdentifier ::= SEQUENCE { algorithm OID, parameters NULL } */
function algId(oidStr: string): Buffer {
  return tlv(0x30, Buffer.concat([encodeOID(oidStr), tlv(0x05, Buffer.alloc(0))]))
}

/** RDN: SET { SEQUENCE { OID, UTF8String } } */
function encodeRDN(attrOid: string, value: string): Buffer {
  return tlv(
    0x31,
    tlv(0x30, Buffer.concat([encodeOID(attrOid), tlv(0x0c, Buffer.from(value, 'utf8'))])),
  )
}

/** Name ::= SEQUENCE OF RelativeDistinguishedName */
function encodeName(components: Array<[string, string]>): Buffer {
  return tlv(0x30, Buffer.concat(components.map(([oid, val]) => encodeRDN(oid, val))))
}

function encodeUTCTime(d: Date): Buffer {
  const p = (n: number) => n.toString().padStart(2, '0')
  const yr = d.getUTCFullYear() % 100
  const s = `${p(yr)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  return tlv(0x17, Buffer.from(s))
}

function encodeValidity(notBefore: Date, notAfter: Date): Buffer {
  return tlv(0x30, Buffer.concat([encodeUTCTime(notBefore), encodeUTCTime(notAfter)]))
}

/** Extension ::= SEQUENCE { extnId OID, critical BOOLEAN OPTIONAL, extnValue OCTET STRING } */
function encodeExtension(extOid: string, critical: boolean, extValueDer: Buffer): Buffer {
  const parts: Buffer[] = [encodeOID(extOid)]
  if (critical) parts.push(tlv(0x01, Buffer.from([0xff])))
  parts.push(tlv(0x04, extValueDer))
  return tlv(0x30, Buffer.concat(parts))
}

function encodeBasicConstraints(isCA: boolean): Buffer {
  const inner = isCA
    ? tlv(0x30, tlv(0x01, Buffer.from([0xff]))) // SEQUENCE { BOOLEAN TRUE }
    : tlv(0x30, Buffer.alloc(0)) // empty SEQUENCE
  return encodeExtension('2.5.29.19', true, inner)
}

function encodeSAN(hosts: string[]): Buffer {
  const names = hosts.map((h) => {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
      // iPAddress [7] IMPLICIT OCTET STRING (4 bytes for IPv4)
      return tlv(0x87, Buffer.from(h.split('.').map(Number)))
    }
    // dNSName [2] IMPLICIT IA5String
    return tlv(0x82, Buffer.from(h, 'ascii'))
  })
  return encodeExtension('2.5.29.17', false, tlv(0x30, Buffer.concat(names)))
}

/** Ensure INTEGER is encoded as positive (prepend 0x00 if high bit is set) */
function posInt(bytes: Buffer): Buffer {
  return bytes.length > 0 && bytes[0] & 0x80
    ? Buffer.concat([Buffer.from([0x00]), bytes])
    : bytes
}

function toPEM(der: Buffer, label: string): string {
  const b64 = der.toString('base64')
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}

// ---------------------------------------------------------------------------
// OID constants
// ---------------------------------------------------------------------------

const SHA256_WITH_RSA = '1.2.840.113549.1.1.11'
const OID_CN = '2.5.4.3'
const OID_O = '2.5.4.10'

const CA_NAME_COMPONENTS: Array<[string, string]> = [
  [OID_O, 'Raffel'],
  [OID_CN, 'Raffel Proxy CA'],
]

// ---------------------------------------------------------------------------
// Certificate builder
// ---------------------------------------------------------------------------

function buildCertificate(params: {
  serialBytes: Buffer
  sigAlg: Buffer
  issuerName: Buffer
  validity: Buffer
  subjectName: Buffer
  spkiDer: Buffer
  extensions: Buffer[]
  signerKey: string
}): string {
  // [0] EXPLICIT INTEGER v3 (value=2)
  const version = tlv(0xa0, tlv(0x02, Buffer.from([0x02])))
  const serial = tlv(0x02, posInt(params.serialBytes))

  const exts =
    params.extensions.length > 0
      ? tlv(0xa3, tlv(0x30, Buffer.concat(params.extensions))) // [3] EXPLICIT SEQUENCE OF Extension
      : Buffer.alloc(0)

  const tbs = tlv(
    0x30,
    Buffer.concat([
      version,
      serial,
      params.sigAlg,
      params.issuerName,
      params.validity,
      params.subjectName,
      params.spkiDer,
      ...(exts.length > 0 ? [exts] : []),
    ]),
  )

  const signer = createSign('SHA256')
  signer.update(tbs)
  const sig = signer.sign(params.signerKey)

  const cert = tlv(
    0x30,
    Buffer.concat([
      tbs,
      params.sigAlg,
      tlv(0x03, Buffer.concat([Buffer.from([0x00]), sig])), // BIT STRING, 0 unused bits
    ]),
  )

  return toPEM(cert, 'CERTIFICATE')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a self-signed root CA key pair and certificate.
 */
export function generateCA(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer

  const now = new Date()
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60 * 1000)
  const sigAlg = algId(SHA256_WITH_RSA)
  const name = encodeName(CA_NAME_COMPONENTS)

  const cert = buildCertificate({
    serialBytes: Buffer.from([0x01]),
    sigAlg,
    issuerName: name,
    validity: encodeValidity(now, notAfter),
    subjectName: name,
    spkiDer,
    extensions: [encodeBasicConstraints(true)],
    signerKey: privateKeyPem,
  })

  return { key: privateKeyPem, cert }
}

let _defaultCA: { key: string; cert: string } | null = null

/**
 * Return (and lazily generate) a singleton default CA.
 */
export function getDefaultCA(): { key: string; cert: string } {
  if (!_defaultCA) {
    _defaultCA = generateCA()
  }
  return _defaultCA
}

/**
 * Generate a leaf certificate for `host`, signed by the given CA (or the
 * default CA when no CA options are provided).
 */
export async function generateCertificate(
  host: string,
  options?: CertificateOptions,
): Promise<CertificateInfo> {
  const ca =
    options?.caKey != null && options?.caCert != null
      ? { key: options.caKey, cert: options.caCert }
      : getDefaultCA()

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer

  // Determine the issuer Name DER bytes
  let issuerName: Buffer
  if (options?.caKey == null) {
    // Using our default CA — we know its name structure
    issuerName = encodeName(CA_NAME_COMPONENTS)
  } else {
    // Custom CA: try to extract CN from the X509Certificate subject string
    try {
      const { X509Certificate } = await import('node:crypto')
      const x509 = new X509Certificate(ca.cert)
      const cnMatch = x509.subject.match(/CN=([^\n,/]+)/)
      const cn = cnMatch?.[1]?.trim() ?? host
      issuerName = encodeName([[OID_CN, cn]])
    } catch {
      issuerName = encodeName([[OID_CN, 'Unknown CA']])
    }
  }

  const now = new Date()
  const validityDays = options?.validityDays ?? 365
  const notAfter = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000)
  const sigAlg = algId(SHA256_WITH_RSA)

  // 16-byte random serial, high bit cleared to ensure positive,
  // low bit set to avoid a leading zero byte (which would be a non-minimal
  // INTEGER encoding and rejected by strict DER parsers).
  const serialBytes = randomBytes(16)
  serialBytes[0] = (serialBytes[0] & 0x7f) | 0x01

  const cert = buildCertificate({
    serialBytes,
    sigAlg,
    issuerName,
    validity: encodeValidity(now, notAfter),
    subjectName: encodeName([[OID_CN, host]]),
    spkiDer,
    extensions: [encodeBasicConstraints(false), encodeSAN([host])],
    signerKey: ca.key,
  })

  return { key: privateKeyPem, cert, ca: ca.cert }
}
