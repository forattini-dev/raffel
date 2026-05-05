import { randomUUID } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import type {
  MitmCaptureConfig,
  MitmCaptureMode,
  MitmCaptureRecord,
  MitmCaptureState,
  MitmRequest,
  ReplayMitmCaptureOptions,
  ReplayMitmCaptureResult,
  ReplayMitmRequest,
  StartMitmCaptureOptions,
} from './connect-tunnel.js'

export interface UpstreamTlsBase {
  host: string
  port: number
  rejectUnauthorized: boolean
  cert?: string
  key?: string
  ca?: string
}

export interface UpstreamTlsOverrides {
  cert?: string
  key?: string
  ca?: string
  rejectUnauthorized?: boolean
}

export interface MitmCaptureController {
  isEnabled(): boolean
  getMode(): MitmCaptureMode
  startCapture(options: StartMitmCaptureOptions): void
  stopCapture(): void
  getCaptureState(): MitmCaptureState
  persistCaptureRecord(req: MitmRequest): Promise<string>
  serializeCaptureOnlyResponse(captureId: string): Buffer
  replayCapture(options?: ReplayMitmCaptureOptions): Promise<ReplayMitmCaptureResult>
}

export function createMitmCaptureController(
  config: MitmCaptureConfig | undefined,
  upstreamOpts: UpstreamTlsOverrides | undefined
): MitmCaptureController {
  let captureWriteChain = Promise.resolve<void>(undefined)
  const captureState: MitmCaptureState = {
    enabled: config?.enabled ?? false,
    mode: config?.mode ?? 'passthrough',
    file: config?.file?.trim() || null,
    captured: 0,
    replayed: 0,
    lastCaptureAt: null,
  }

  function normalizeCaptureMode(mode: MitmCaptureMode = 'passthrough'): MitmCaptureMode {
    return mode === 'capture-only' ? 'capture-only' : 'passthrough'
  }

  function normalizeCapturePath(file: string): string {
    const trimmed = file.trim()
    if (!trimmed) {
      throw new Error('Capture file path cannot be empty')
    }
    return trimmed
  }

  function normalizeCaptureHeaders(
    headers: Record<string, unknown> | undefined | null,
  ): Record<string, string> {
    if (!headers || typeof headers !== 'object') {
      return {}
    }

    return Object.fromEntries(
      Object.entries(headers)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)]),
    )
  }

  function createCapturePayload(req: MitmRequest, id: string): MitmCaptureRecord {
    return {
      id,
      capturedAt: new Date().toISOString(),
      host: req.host,
      port: req.port,
      method: req.method,
      path: req.path,
      headers: req.headers,
      bodyBase64: req.body.toString('base64'),
    }
  }

  function parsePersistedRecord(value: unknown): ReplayMitmRequest {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Invalid capture record')
    }
    const candidate = value as Record<string, unknown>

    const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
      ? candidate.id
      : randomUUID()
    const host = typeof candidate.host === 'string' ? candidate.host.trim() : ''
    const port = Number(candidate.port)
    const method = typeof candidate.method === 'string' && candidate.method.trim().length > 0
      ? candidate.method.trim().toUpperCase()
      : 'GET'
    const path = typeof candidate.path === 'string' ? candidate.path : '/'
    const headers = normalizeCaptureHeaders(
      candidate.headers as Record<string, unknown> | undefined,
    )
    const bodyBase64 = typeof candidate.bodyBase64 === 'string' ? candidate.bodyBase64 : ''

    if (!host) {
      throw new Error(`Invalid capture record: missing host`)
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid capture record host/port: ${host}:${port}`)
    }

    let body: Buffer
    try {
      body = Buffer.from(bodyBase64, 'base64')
    } catch {
      throw new Error(`Invalid capture record bodyBase64 for ${host}:${port}`)
    }

    return {
      id,
      host,
      port,
      method,
      path,
      headers,
      body,
    }
  }

  async function persistCaptureRecord(req: MitmRequest): Promise<string> {
    if (!captureState.enabled) {
      return ''
    }
    if (!captureState.file) {
      throw new Error('MITM capture is enabled but no file path was configured')
    }

    const id = randomUUID()
    const payload = createCapturePayload(req, id)
    const line = `${JSON.stringify(payload)}\n`

    captureWriteChain = captureWriteChain
      .catch(() => undefined)
      .then(() => appendFile(captureState.file!, line, 'utf-8'))

    await captureWriteChain

    captureState.captured += 1
    captureState.lastCaptureAt = payload.capturedAt
    return id
  }

  function serializeCaptureOnlyResponse(captureId: string): Buffer {
    return Buffer.from(
      JSON.stringify({ captured: true, id: captureId, mode: captureState.mode }),
      'utf-8',
    )
  }

  async function parseCaptureFile(filePath: string): Promise<ReplayMitmRequest[]> {
    const raw = await readFile(filePath, 'utf-8')
    const content = raw.trim()
    if (!content) return []

    const records: ReplayMitmRequest[] = []
    if (content.startsWith('[')) {
      const decoded = JSON.parse(content) as unknown
      if (!Array.isArray(decoded)) {
        throw new Error('Invalid JSON capture file format')
      }
      for (const item of decoded) {
        records.push(parsePersistedRecord(item))
      }
      return records
    }

    if (content.startsWith('{')) {
      records.push(parsePersistedRecord(JSON.parse(content)))
      return records
    }

    const rows = content.split('\n')
    for (const row of rows) {
      const trimmed = row.trim()
      if (!trimmed) continue
      records.push(parsePersistedRecord(JSON.parse(trimmed)))
    }
    return records
  }

  async function replayCapturedRequest(
    req: ReplayMitmRequest,
    upstream: UpstreamTlsBase,
    timeoutMs: number,
    rejectUnauthorized: boolean,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const upReq = httpsRequest(
        {
          ...upstream,
          hostname: req.host,
          port: req.port,
          path: req.path,
          method: req.method,
          headers: req.headers,
          timeout: timeoutMs,
          rejectUnauthorized,
        },
        (upRes) => {
          upRes.on('data', () => {})
            upRes.on('end', () => resolve(upRes.statusCode ?? 200))
            upRes.on('error', reject)
          },
        )

      upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout')))
      upReq.on('error', reject)
      if (req.body.length > 0) upReq.write(req.body)
      upReq.end()
    })
  }

  async function doReplayCapture(filePath: string, options: ReplayMitmCaptureOptions = {}): Promise<ReplayMitmCaptureResult> {
    const startedAt = performance.now()
    const records = await parseCaptureFile(filePath)
    const rejectUnauthorized = options.rejectUnauthorized ?? upstreamOpts?.rejectUnauthorized ?? false
    const upstreamBase: UpstreamTlsBase = {
      host: '',
      port: 0,
      rejectUnauthorized,
      ...(upstreamOpts?.cert ? { cert: upstreamOpts.cert } : {}),
      ...(upstreamOpts?.key ? { key: upstreamOpts.key } : {}),
      ...(upstreamOpts?.ca ? { ca: upstreamOpts.ca } : {}),
    }

    const result: ReplayMitmCaptureResult = {
      total: records.length,
      success: 0,
      failed: 0,
      durationMs: 0,
      entries: [],
    }

    for (const req of records) {
      const startedAtEntry = performance.now()
      try {
        const status = await replayCapturedRequest(
          req,
          {
            ...upstreamBase,
            host: req.host,
            port: req.port,
            rejectUnauthorized,
            ...(upstreamOpts?.cert ? { cert: upstreamBase.cert } : {}),
            ...(upstreamOpts?.key ? { key: upstreamBase.key } : {}),
            ...(upstreamOpts?.ca ? { ca: upstreamBase.ca } : {}),
          },
          options.timeoutMs ?? 15_000,
          rejectUnauthorized,
        )
        result.success += 1
        result.entries.push({
          id: req.id,
          host: req.host,
          port: req.port,
          method: req.method,
          path: req.path,
          status,
          ok: true,
          durationMs: Math.max(0, performance.now() - startedAtEntry),
        })
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : `${error}`
        result.failed += 1
        result.entries.push({
          id: req.id,
          host: req.host,
          port: req.port,
          method: req.method,
          path: req.path,
          status: null,
          ok: false,
          error: reason,
          durationMs: Math.max(0, performance.now() - startedAtEntry),
        })
      }
    }

    result.durationMs = Math.max(0, performance.now() - startedAt)
    captureState.replayed += result.success
    return result
  }

  return {
    isEnabled: () => captureState.enabled,
    getMode: () => captureState.mode,
    startCapture(options: StartMitmCaptureOptions): void {
      const file = normalizeCapturePath(options.file)
      captureState.file = file
      captureState.mode = normalizeCaptureMode(options.mode)
      captureState.enabled = true
    },
    stopCapture(): void {
      captureState.enabled = false
    },
    getCaptureState(): MitmCaptureState {
      return { ...captureState }
    },
    persistCaptureRecord,
    serializeCaptureOnlyResponse,
    async replayCapture(options: ReplayMitmCaptureOptions = {}): Promise<ReplayMitmCaptureResult> {
      const file = options.file ?? captureState.file
      if (!file) {
        throw new Error('No capture file configured. Start capture with startCapture({ file }) or provide replay options.file')
      }
      return doReplayCapture(file, options)
    },
  }
}
