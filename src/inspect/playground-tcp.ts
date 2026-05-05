import { createConnection, type Socket } from 'node:net'
import type { RuntimePlaygroundEntry } from './playground.js'
import { normalizeConnectHost } from './playground-targets.js'

const TCP_LENGTH_HEADER_SIZE = 4

export type RawTcpFraming = {
  type: 'none' | 'length-prefixed' | 'delimiter'
  lengthBytes?: 1 | 2 | 4
  lengthEncoding?: 'BE' | 'LE'
  delimiter?: string
}

export function encodeTcpRawPayload(payload: unknown): Buffer {
  if (payload === undefined || payload === null) {
    return Buffer.alloc(0)
  }

  if (typeof payload === 'string') {
    return Buffer.from(payload, 'utf8')
  }

  return Buffer.from(JSON.stringify(payload), 'utf8')
}

export function frameTcpMessage(message: Record<string, unknown>): Buffer {
  const data = Buffer.from(JSON.stringify(message), 'utf8')
  const frame = Buffer.allocUnsafe(TCP_LENGTH_HEADER_SIZE + data.length)
  frame.writeUInt32BE(data.length, 0)
  data.copy(frame, TCP_LENGTH_HEADER_SIZE)
  return frame
}

export function connectTcpSocket(entry: RuntimePlaygroundEntry): Promise<Socket> {
  const port = entry.target.port
  if (port === undefined) {
    throw new Error(`Missing TCP target port for playground entry "${entry.key}"`)
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: normalizeConnectHost(entry.target.host),
      port,
    }, () => resolve(socket))

    socket.once('error', reject)
  })
}

export function waitForTcpEnvelope(socket: Socket, timeoutMs = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for TCP response after ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const onClose = () => {
      cleanup()
      reject(new Error('TCP socket closed before a response was received'))
    }

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      while (buffer.length >= TCP_LENGTH_HEADER_SIZE) {
        const messageLength = buffer.readUInt32BE(0)
        const totalLength = TCP_LENGTH_HEADER_SIZE + messageLength
        if (buffer.length < totalLength) {
          return
        }

        const messageData = buffer.subarray(TCP_LENGTH_HEADER_SIZE, totalLength)
        buffer = buffer.subarray(totalLength)

        try {
          cleanup()
          resolve(JSON.parse(messageData.toString('utf8')) as Record<string, unknown>)
        } catch (error) {
          cleanup()
          reject(error as Error)
        }
        return
      }
    }

    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

export function attachTcpEnvelopeStream(
  socket: Socket,
  handlers: {
    onEnvelope: (envelope: Record<string, unknown>) => void
    onError: (error: Error) => void
    onClose?: () => void
  }
): void {
  let buffer = Buffer.alloc(0)

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
    while (buffer.length >= TCP_LENGTH_HEADER_SIZE) {
      const messageLength = buffer.readUInt32BE(0)
      const totalLength = TCP_LENGTH_HEADER_SIZE + messageLength
      if (buffer.length < totalLength) {
        return
      }

      const messageData = buffer.subarray(TCP_LENGTH_HEADER_SIZE, totalLength)
      buffer = buffer.subarray(totalLength)

      try {
        handlers.onEnvelope(JSON.parse(messageData.toString('utf8')) as Record<string, unknown>)
      } catch (error) {
        handlers.onError(error as Error)
      }
    }
  })

  socket.on('error', handlers.onError)
  if (handlers.onClose) {
    socket.on('close', handlers.onClose)
  }
}

export function attachRawTcpMessageStream(
  socket: Socket,
  framing: RawTcpFraming | undefined,
  handlers: {
    onMessage: (message: Buffer) => void
    onError: (error: Error) => void
    onClose?: () => void
  }
): void {
  if (!framing || framing.type === 'none') {
    socket.on('data', (chunk) => {
      handlers.onMessage(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
  } else if (framing.type === 'delimiter' && framing.delimiter) {
    let buffer = Buffer.alloc(0)
    const delimiter = Buffer.from(framing.delimiter, 'utf8')
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      let index = -1
      while ((index = buffer.indexOf(delimiter)) !== -1) {
        const message = buffer.subarray(0, index)
        buffer = buffer.subarray(index + delimiter.length)
        handlers.onMessage(message)
      }
    })
  } else if (framing.type === 'length-prefixed') {
    const lengthBytes = framing.lengthBytes ?? 4
    const lengthEncoding = framing.lengthEncoding ?? 'BE'
    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      while (buffer.length >= lengthBytes) {
        const length = lengthBytes === 1
          ? buffer.readUInt8(0)
          : lengthBytes === 2
            ? (lengthEncoding === 'BE' ? buffer.readUInt16BE(0) : buffer.readUInt16LE(0))
            : (lengthEncoding === 'BE' ? buffer.readUInt32BE(0) : buffer.readUInt32LE(0))

        const totalLength = lengthBytes + length
        if (buffer.length < totalLength) {
          return
        }

        const message = buffer.subarray(lengthBytes, totalLength)
        buffer = buffer.subarray(totalLength)
        handlers.onMessage(message)
      }
    })
  }

  socket.on('error', handlers.onError)
  if (handlers.onClose) {
    socket.on('close', handlers.onClose)
  }
}

export function frameRawTcpMessage(payload: Buffer, framing: RawTcpFraming | undefined): Buffer {
  if (!framing || framing.type === 'none') {
    return payload
  }

  if (framing.type === 'delimiter' && framing.delimiter) {
    return Buffer.concat([payload, Buffer.from(framing.delimiter, 'utf8')])
  }

  const lengthBytes = framing.lengthBytes ?? 4
  const lengthEncoding = framing.lengthEncoding ?? 'BE'
  const header = Buffer.alloc(lengthBytes)
  if (lengthBytes === 1) {
    header.writeUInt8(payload.length, 0)
  } else if (lengthBytes === 2) {
    if (lengthEncoding === 'BE') {
      header.writeUInt16BE(payload.length, 0)
    } else {
      header.writeUInt16LE(payload.length, 0)
    }
  } else if (lengthEncoding === 'BE') {
    header.writeUInt32BE(payload.length, 0)
  } else {
    header.writeUInt32LE(payload.length, 0)
  }

  return Buffer.concat([header, payload])
}
