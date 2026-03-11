import { describe, expect, it } from 'vitest'
import type { ProtocolSniffer } from '../../../src/server/types.js'
import {
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
} from '../../../src/server/single-port/dispatcher.js'

describe('single-port dispatcher', () => {
  it('detects TLS ClientHello from first bytes', () => {
    const chunk = Buffer.from([0x16, 0x03, 0x03, 0x00, 0x2e])
    const decision = detectSinglePortProtocolFromChunk({ chunk })

    expect(decision.protocol).toBe('tls')
    expect(decision.detector).toBe('tls')
    expect(decision.reason).toBe('matched')
  })

  it('detects HTTP methods as HTTP protocol', () => {
    const chunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const decision = detectSinglePortProtocolFromChunk({ chunk })

    expect(decision.protocol).toBe('http')
    expect(decision.detector).toBe('http-method')
    expect(decision.reason).toBe('matched')
  })

  it('detects HTTP/2 preface as http2', () => {
    const chunk = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n')
    const decision = detectSinglePortProtocolFromChunk({ chunk })

    expect(decision.protocol).toBe('http2')
    expect(decision.detector).toBe('http2-preface')
    expect(decision.reason).toBe('matched')
  })

  it('detects TCP length-prefixed envelopes as tcp', () => {
    const payload = Buffer.from(JSON.stringify({ id: '1', procedure: 'ping', type: 'request', payload: {} }))
    const frame = Buffer.allocUnsafe(4 + payload.length)
    frame.writeUInt32BE(payload.length, 0)
    payload.copy(frame, 4)

    const decision = detectSinglePortProtocolFromChunk({ chunk: frame })

    expect(decision.protocol).toBe('tcp')
    expect(decision.detector).toBe('tcp-length-prefix')
    expect(decision.reason).toBe('matched')
  })

  it('keeps extended aliases disabled by default in single-port detection', () => {
    const pingChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const pingDecision = detectSinglePortProtocolFromChunk({
      chunk: pingChunk,
      protocols: ['ping'],
    })
    expect(pingDecision.protocol).toBe('http')
    expect(pingDecision.detector).toBe('http-method')
    expect(pingDecision.reason).toBe('unsupported')

    const icmpChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const icmpDecision = detectSinglePortProtocolFromChunk({
      chunk: icmpChunk,
      protocols: ['icmp'],
    })
    expect(icmpDecision.protocol).toBe('http')
    expect(icmpDecision.detector).toBe('http-method')
    expect(icmpDecision.reason).toBe('unsupported')

    const ftpPayload = Buffer.from(JSON.stringify({ id: '1', procedure: 'ping', type: 'request', payload: {} }))
    const ftpFrame = Buffer.allocUnsafe(4 + ftpPayload.length)
    ftpFrame.writeUInt32BE(ftpPayload.length, 0)
    ftpPayload.copy(ftpFrame, 4)

    const ftpDecision = detectSinglePortProtocolFromChunk({
      chunk: ftpFrame,
      protocols: ['ftp'],
    })
    expect(ftpDecision.protocol).toBe('tcp')
    expect(ftpDecision.detector).toBe('tcp-length-prefix')
    expect(ftpDecision.reason).toBe('unsupported')

    const whoisDecision = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('example.com\r\n'),
      protocols: ['whois'],
    })
    expect(whoisDecision.protocol).toBe('tcp')
    expect(whoisDecision.detector).toBe('text-protocol')
    expect(whoisDecision.reason).toBe('unsupported')

    const telnetDecision = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('open 127.0.0.1 80\r\n'),
      protocols: ['telnet'],
    })
    expect(telnetDecision.protocol).toBe('tcp')
    expect(telnetDecision.detector).toBe('text-protocol')
    expect(telnetDecision.reason).toBe('unsupported')
  })

  it('normalizes single-port alias protocols in extended mode', () => {
    const pingChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const pingDecision = detectSinglePortProtocolFromChunk({
      chunk: pingChunk,
      protocols: ['ping'],
      protocolAliasMode: 'extended',
    })
    expect(pingDecision.protocol).toBe('http')

    const icmpChunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const icmpDecision = detectSinglePortProtocolFromChunk({
      chunk: icmpChunk,
      protocols: ['icmp'],
      protocolAliasMode: 'extended',
    })
    expect(icmpDecision.protocol).toBe('http')

    const ftpPayload = Buffer.from(JSON.stringify({ id: '1', procedure: 'ping', type: 'request', payload: {} }))
    const ftpFrame = Buffer.allocUnsafe(4 + ftpPayload.length)
    ftpFrame.writeUInt32BE(ftpPayload.length, 0)
    ftpPayload.copy(ftpFrame, 4)

    const ftpDecision = detectSinglePortProtocolFromChunk({
      chunk: ftpFrame,
      protocols: ['ftp'],
      protocolAliasMode: 'extended',
    })
    expect(ftpDecision.protocol).toBe('tcp')

    const whoisDecision = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('example.com\r\n'),
      protocols: ['whois'],
      protocolAliasMode: 'extended',
    })
    expect(whoisDecision.protocol).toBe('tcp')
    expect(whoisDecision.detector).toBe('text-protocol')

    const telnetDecision = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('open 127.0.0.1 80\r\n'),
      protocols: ['telnet'],
      protocolAliasMode: 'extended',
    })
    expect(telnetDecision.protocol).toBe('tcp')
    expect(telnetDecision.detector).toBe('text-protocol')
  })

  it('respects allowlist when detecting tcp frames', () => {
    const payload = Buffer.from(JSON.stringify({ id: '1', procedure: 'ping', type: 'request', payload: {} }))
    const frame = Buffer.allocUnsafe(4 + payload.length)
    frame.writeUInt32BE(payload.length, 0)
    payload.copy(frame, 4)

    const decision = detectSinglePortProtocolFromChunk({
      chunk: frame,
      protocols: ['grpc'],
    })

    expect(decision.protocol).toBe('tcp')
    expect(decision.reason).toBe('unsupported')
    expect(decision.detector).toBe('tcp-length-prefix')
  })

  it('executes custom sniffers in order after built-ins', () => {
    const custom: ProtocolSniffer = {
      name: 'magic-hello',
      detect: ({ chunk }) => {
        return chunk.toString('utf8').includes('HELLO_TCP') ? 'tcp' : null
      },
    }

    const chunk = Buffer.from('HELLO_TCP_PROTOCOL')
    const decision = detectSinglePortProtocolFromChunk({
      chunk,
      sniffers: [custom],
    })

    expect(decision.protocol).toBe('tcp')
    expect(decision.detector).toBe('sniffer:magic-hello')
    expect(decision.reason).toBe('matched')
  })

  it('skips default HTTP detection when a protocol allowlist is provided', () => {
    const chunk = Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n')
    const decision = detectSinglePortProtocolFromChunk({
      chunk,
      protocols: ['grpc'],
    })

    expect(decision.protocol).toBe('http')
    expect(decision.reason).toBe('unsupported')
    expect(decision.detector).toBe('http-method')
  })

  it('keeps custom sniffers active only when protocol is allowed', () => {
    const custom: ProtocolSniffer = {
      name: 'magic-tcp',
      detect: ({ chunk }) => {
        return chunk.toString('utf8').includes('HELLO_TCP') ? 'tcp' : null
      },
    }

    const allowed = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('HELLO_TCP_PROTOCOL'),
      sniffers: [custom],
      protocols: ['udp'],
    })

    expect(allowed.protocol).toBe('tcp')
    expect(allowed.reason).toBe('unsupported')

    const matched = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('HELLO_TCP_PROTOCOL'),
      sniffers: [custom],
      protocols: ['tcp'],
    })

    expect(matched.protocol).toBe('tcp')
    expect(matched.detector).toBe('sniffer:magic-tcp')
    expect(matched.reason).toBe('matched')
  })

  it('does not use text-protocol TCP detector when tcp is not in the allowlist', () => {
    const decision = detectSinglePortProtocolFromChunk({
      chunk: Buffer.from('open example.com 80\r\n'),
      protocols: ['grpc'],
    })

    expect(decision.protocol).toBe('tcp')
    expect(decision.reason).toBe('unsupported')
    expect(decision.detector).toBe('text-protocol')
  })

  it('returns timeout when stream read exceeds sniff timeout', async () => {
    const readChunk = () => new Promise<Buffer>((resolve) => {
      setTimeout(() => {
        resolve(Buffer.from('GET / HTTP/1.1'))
      }, 50)
    })
    const decision = await detectSinglePortProtocolFromStream({
      readChunk,
      sniffTimeoutMs: 10,
    })

    expect(decision.timedOut).toBe(true)
    expect(decision.reason).toBe('timeout')
    expect(decision.protocol).toBe('unknown')
  }, 200)

  it('returns concurrency_limit when maxConcurrentDetections is exceeded', async () => {
    const readChunk = () => Promise.resolve(Buffer.from('GET / HTTP/1.1'))
    const decision = await detectSinglePortProtocolFromStream({
      readChunk,
      maxConcurrentDetections: 0,
    })

    expect(decision.reason).toBe('concurrency_limit')
    expect(decision.protocol).toBe('unknown')
  })
})
