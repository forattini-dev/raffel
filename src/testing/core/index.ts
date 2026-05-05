export function normalizeMockHost(host?: string): string {
  return host && host.length > 0 ? host : '127.0.0.1'
}

export function delay(ms = 0): Promise<void> {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve()
}

export type MaybeAsync<T> = T | Promise<T>
export type BufferLike = string | Buffer

export function appendLineIfNeeded(payload: BufferLike, delimiter: string): Buffer {
  if (Buffer.isBuffer(payload)) {
    return payload
  }

  return payload.endsWith('\r\n') || payload.endsWith('\n')
    ? Buffer.from(payload)
    : Buffer.from(`${payload}${delimiter}`)
}

export function safeJson(body: unknown): { body: string; contentType: string } {
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return {
      body: Buffer.isBuffer(body) ? body.toString('utf8') : body,
      contentType: 'text/plain',
    }
  }

  if (body == null) {
    return { body: '', contentType: 'application/json' }
  }

  return {
    body: JSON.stringify(body),
    contentType: 'application/json',
  }
}

export interface MockLifecycleState {
  readonly port: number
  readonly host: string
  readonly isRunning: boolean
}
