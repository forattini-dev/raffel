/**
 * MockDnsServer — DNS over UDP (RFC 1035), no external dependencies.
 */
import { EventEmitter } from 'node:events'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'PTR' | 'SRV'

export interface MockDnsServerOptions {
  port?: number
  host?: string
  /** Default TTL for records (seconds). Default: 60 */
  ttl?: number
  /** Artificial delay before responding (ms). Default: 0 */
  delay?: number
}

interface MxValue {
  priority: number
  exchange: string
}

interface SrvValue {
  priority: number
  weight: number
  port: number
  target: string
}

interface DnsRecord {
  type: DnsRecordType
  value: string | MxValue | SrvValue
  ttl: number
}

const DNS_TYPE: Record<DnsRecordType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
}

const DNS_TYPE_REVERSE = Object.fromEntries(
  Object.entries(DNS_TYPE).map(([k, v]) => [v, k as DnsRecordType]),
) as Record<number, DnsRecordType>

// ---------------------------------------------------------------------------
// DNS wire-format helpers
// ---------------------------------------------------------------------------

function encodeDnsName(name: string): Buffer {
  const labels = name.replace(/\.$/, '').split('.')
  const parts: Buffer[] = labels.map((label) => {
    const buf = Buffer.from(label, 'ascii')
    return Buffer.concat([Buffer.from([buf.length]), buf])
  })
  parts.push(Buffer.from([0x00]))
  return Buffer.concat(parts)
}

function parseDnsName(
  data: Buffer,
  offset: number,
): { name: string; end: number } {
  const labels: string[] = []
  let pos = offset
  let endPos = -1

  while (pos < data.length) {
    const len = data[pos]
    if (len === 0) {
      pos++
      break
    }
    if ((len & 0xc0) === 0xc0) {
      // Pointer: 2-byte offset from start of message
      const ptr = ((len & 0x3f) << 8) | data[pos + 1]
      if (endPos === -1) endPos = pos + 2
      const { name: pName } = parseDnsName(data, ptr)
      labels.push(...pName.split('.').filter(Boolean))
      pos = endPos
      break
    }
    pos++
    labels.push(data.subarray(pos, pos + len).toString('ascii'))
    pos += len
  }

  return { name: labels.join('.'), end: endPos === -1 ? pos : endPos }
}

function expandIPv6ToBytes(addr: string): Buffer {
  let expanded = addr
  if (expanded.includes('::')) {
    const [left, right] = expanded.split('::')
    const leftParts = left ? left.split(':') : []
    const rightParts = right ? right.split(':') : []
    const missing = 8 - leftParts.length - rightParts.length
    expanded = [...leftParts, ...Array<string>(missing).fill('0'), ...rightParts].join(':')
  }
  const bytes: number[] = []
  for (const group of expanded.split(':')) {
    const n = parseInt(group.padStart(4, '0'), 16)
    bytes.push((n >> 8) & 0xff, n & 0xff)
  }
  return Buffer.from(bytes)
}

function encodeRdata(type: DnsRecordType, value: string | MxValue | SrvValue): Buffer {
  switch (type) {
    case 'A':
      return Buffer.from((value as string).split('.').map(Number))

    case 'AAAA':
      return expandIPv6ToBytes(value as string)

    case 'TXT': {
      const text = Buffer.from(value as string, 'utf8')
      return Buffer.concat([Buffer.from([text.length]), text])
    }

    case 'CNAME':
    case 'NS':
    case 'PTR':
      return encodeDnsName(value as string)

    case 'MX': {
      const mx = value as MxValue
      const prio = Buffer.alloc(2)
      prio.writeUInt16BE(mx.priority)
      return Buffer.concat([prio, encodeDnsName(mx.exchange)])
    }

    case 'SRV': {
      const srv = value as SrvValue
      const header = Buffer.alloc(6)
      header.writeUInt16BE(srv.priority, 0)
      header.writeUInt16BE(srv.weight, 2)
      header.writeUInt16BE(srv.port, 4)
      return Buffer.concat([header, encodeDnsName(srv.target)])
    }

    default:
      return Buffer.alloc(0)
  }
}

function buildDnsAnswer(namePtr: Buffer, type: DnsRecordType, ttl: number, rdata: Buffer): Buffer {
  const meta = Buffer.alloc(10)
  meta.writeUInt16BE(DNS_TYPE[type], 0) // TYPE
  meta.writeUInt16BE(1, 2) // CLASS IN
  meta.writeUInt32BE(ttl, 4) // TTL
  meta.writeUInt16BE(rdata.length, 8) // RDLENGTH
  return Buffer.concat([namePtr, meta, rdata])
}

// ---------------------------------------------------------------------------
// MockDnsServer
// ---------------------------------------------------------------------------

export class MockDnsServer extends EventEmitter {
  private readonly _options: Required<MockDnsServerOptions>
  private readonly _records = new Map<string, DnsRecord[]>()
  private _socket: UdpSocket | null = null
  private _port = 0
  private _running = false

  constructor(options: MockDnsServerOptions = {}) {
    super()
    this._options = {
      port: options.port ?? 0,
      host: options.host ?? '127.0.0.1',
      ttl: options.ttl ?? 60,
      delay: options.delay ?? 0,
    }
  }

  get port(): number {
    return this._port
  }

  get isRunning(): boolean {
    return this._running
  }

  addRecord(domain: string, type: DnsRecordType, value: string | object, ttl?: number): this {
    const key = domain.toLowerCase().replace(/\.$/, '')
    const list = this._records.get(key) ?? []
    list.push({ type, value: value as string | MxValue | SrvValue, ttl: ttl ?? this._options.ttl })
    this._records.set(key, list)
    return this
  }

  removeRecords(domain: string): this {
    this._records.delete(domain.toLowerCase().replace(/\.$/, ''))
    return this
  }

  clearRecords(): this {
    this._records.clear()
    return this
  }

  async start(): Promise<void> {
    if (this._running) return

    this._socket = createSocket('udp4')

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        if (!this._running) reject(err)
        else this.emit('error', err)
      }

      this._socket!.on('error', onError)
      this._socket!.on('message', (msg: Buffer, rinfo) => {
        if (msg.length < 12) return

        const id = msg.readUInt16BE(0)
        const flags = msg.readUInt16BE(2)
        const qdcount = msg.readUInt16BE(4)

        // Only handle standard queries (QR=0, OPCODE=0)
        if ((flags & 0x8000) !== 0 || qdcount === 0) return

        const { name, end } = parseDnsName(msg, 12)
        const qtype = msg.readUInt16BE(end)
        // qclass at end+2 — we accept any class

        const normalizedName = name.toLowerCase().replace(/\.$/, '')
        const allRecords = this._records.get(normalizedName) ?? []
        const qtypeName = DNS_TYPE_REVERSE[qtype]
        const matchingRecords = qtypeName
          ? allRecords.filter((r) => r.type === qtypeName)
          : allRecords

        // Slice the question section to echo it back in the response
        const questionSection = msg.subarray(12, end + 4)

        const respond = () => {
          const response = this._buildResponse(
            id,
            questionSection,
            matchingRecords,
            matchingRecords.length === 0,
          )
          this._socket?.send(response, 0, response.length, rinfo.port, rinfo.address)
          this.emit('query', { name: normalizedName, type: qtypeName, records: matchingRecords })
        }

        if (this._options.delay > 0) {
          setTimeout(respond, this._options.delay)
        } else {
          respond()
        }
      })

      this._socket!.bind(this._options.port, this._options.host, () => {
        const addr = this._socket?.address()
        if (typeof addr === 'string' || addr == null) {
          reject(new Error('Failed to resolve mock DNS address'))
          return
        }
        this._port = addr.port
        this._running = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._socket) return
    await new Promise<void>((resolve) => {
      this._socket?.close(() => {
        this._running = false
        this._socket = null
        resolve()
      })
    })
  }

  private _buildResponse(
    id: number,
    questionSection: Buffer,
    records: DnsRecord[],
    nxdomain: boolean,
  ): Buffer {
    const header = Buffer.alloc(12)
    header.writeUInt16BE(id, 0)
    // QR=1 (response), AA=1 (authoritative), RA=1 (recursion available)
    // RCODE: 0=NOERROR, 3=NXDOMAIN
    const rcode = nxdomain ? 3 : 0
    header.writeUInt16BE(0x8400 | rcode, 2)
    header.writeUInt16BE(1, 4) // QDCOUNT — echo back 1 question
    header.writeUInt16BE(records.length, 6) // ANCOUNT
    header.writeUInt16BE(0, 8) // NSCOUNT
    header.writeUInt16BE(0, 10) // ARCOUNT

    if (nxdomain || records.length === 0) {
      return Buffer.concat([header, questionSection])
    }

    // Use a pointer (0xC00C) to reference the name in the question section
    // (question section starts at offset 12 in the original packet)
    const namePtr = Buffer.from([0xc0, 0x0c])
    const answers = records.map((r) => {
      const rdata = encodeRdata(r.type, r.value)
      return buildDnsAnswer(namePtr, r.type, r.ttl, rdata)
    })

    return Buffer.concat([header, questionSection, ...answers])
  }
}

export const createMockDnsServer = async (options?: MockDnsServerOptions): Promise<MockDnsServer> => {
  const server = new MockDnsServer(options)
  await server.start()
  return server
}
