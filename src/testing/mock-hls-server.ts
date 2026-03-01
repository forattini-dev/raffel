/**
 * MockHlsServer — HTTP Live Streaming mock server.
 *
 * Serves synthetic HLS content (no real video encoding):
 * - Master playlist listing variants
 * - Per-variant playlists (VOD: static list; Live: sliding window)
 * - Deterministic fake TS segments (sha256-seeded bytes — same segment always returns the same bytes)
 *
 * Paths served:
 *   GET /master.m3u8         — master playlist
 *   GET /v{i}.m3u8           — variant i playlist
 *   GET /v{i}_{seqN}.ts      — segment seqN of variant i
 *
 * @example
 * const server = await createMockHlsServer({ mode: 'vod', segmentCount: 5 })
 * // fetch(server.masterUrl) → #EXTM3U …
 * await server.stop()
 */
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'

export interface MockHlsVariant {
  /** Target bitrate in bits/s (used for BANDWIDTH attribute). */
  bandwidth: number
  /** Optional resolution string, e.g. '1280x720'. */
  resolution?: string
  /** Optional CODECS string, e.g. 'avc1.42c01e,mp4a.40.2'. */
  codecs?: string
}

export interface MockHlsServerOptions {
  port?: number
  host?: string
  /**
   * Playlist mode.
   * - `'vod'`  — all segments available from the start; playlist ends with #EXT-X-ENDLIST
   * - `'live'` — sliding window; new segments are appended at the configured interval
   * Default: `'vod'`
   */
  mode?: 'vod' | 'live'
  /** Duration of each segment in seconds. Default: 6 */
  segmentDuration?: number
  /**
   * VOD: total number of segments.
   * Live: size of the sliding window.
   * Default: 6
   */
  segmentCount?: number
  /** #EXT-X-TARGETDURATION value. Default: ceil(segmentDuration) + 1 */
  targetDuration?: number
  /**
   * Variant streams. If omitted, a single 1 Mbps stream is used.
   * Multiple variants produce a master playlist with EXT-X-STREAM-INF entries.
   */
  variants?: MockHlsVariant[]
  /** Size in bytes of each fake TS segment. Default: 4096 */
  segmentSize?: number
  /**
   * Live mode only: interval between new segments appearing (ms).
   * Default: segmentDuration * 1000
   */
  liveInterval?: number
}

export class MockHlsServer extends EventEmitter {
  private readonly _opts: Required<MockHlsServerOptions>
  private _server: HttpServer | null = null
  private _port = 0
  private _running = false
  private _mediaSequence = 0
  private _liveTimer: ReturnType<typeof setInterval> | null = null
  private _playlistFetches = 0
  private _segmentFetches = 0
  private _totalBytesServed = 0

  constructor(options: MockHlsServerOptions = {}) {
    super()
    const segmentDuration = options.segmentDuration ?? 6
    this._opts = {
      port: options.port ?? 0,
      host: options.host ?? '127.0.0.1',
      mode: options.mode ?? 'vod',
      segmentDuration,
      segmentCount: options.segmentCount ?? 6,
      targetDuration: options.targetDuration ?? (Math.ceil(segmentDuration) + 1),
      variants: options.variants ?? [{ bandwidth: 1_000_000 }],
      segmentSize: options.segmentSize ?? 4096,
      liveInterval: options.liveInterval ?? segmentDuration * 1000,
    }
  }

  get port(): number {
    return this._port
  }

  get url(): string {
    return `http://${this._opts.host}:${this._port}`
  }

  /** URL of the master playlist. */
  get masterUrl(): string {
    return `${this.url}/master.m3u8`
  }

  get isRunning(): boolean {
    return this._running
  }

  get statistics(): { playlistFetches: number; segmentFetches: number; totalBytesServed: number } {
    return {
      playlistFetches: this._playlistFetches,
      segmentFetches: this._segmentFetches,
      totalBytesServed: this._totalBytesServed,
    }
  }

  /**
   * Manually advance the live sequence number by one (without waiting for the timer).
   * No-op in VOD mode.
   */
  advance(): void {
    if (this._opts.mode !== 'live') return
    this._mediaSequence++
    this.emit('advance', this._mediaSequence)
  }

  async start(): Promise<void> {
    if (this._running) return

    await new Promise<void>((resolve, reject) => {
      this._server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this._handleRequest(req.url ?? '/', res)
      })

      this._server.on('error', (err) => {
        if (!this._running) reject(err)
        else this.emit('error', err)
      })

      this._server.listen(this._opts.port, this._opts.host, () => {
        const addr = this._server?.address()
        if (typeof addr === 'string' || addr == null) {
          reject(new Error('Failed to resolve HLS server address'))
          return
        }
        this._port = addr.port
        this._running = true

        if (this._opts.mode === 'live') {
          this._liveTimer = setInterval(() => {
            this._mediaSequence++
            this.emit('advance', this._mediaSequence)
          }, this._opts.liveInterval)
        }

        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this._server) return

    if (this._liveTimer) {
      clearInterval(this._liveTimer)
      this._liveTimer = null
    }

    await new Promise<void>((resolve) => {
      this._server?.close(() => {
        this._running = false
        this._server = null
        resolve()
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Request router
  // ---------------------------------------------------------------------------

  private _handleRequest(url: string, res: ServerResponse): void {
    const path = url.split('?')[0]

    // Master playlist
    if (path === '/master.m3u8') {
      this._playlistFetches++
      const body = this._masterPlaylist()
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-cache',
      })
      res.end(body)
      return
    }

    // Variant playlist: /v{i}.m3u8
    const variantMatch = path.match(/^\/v(\d+)\.m3u8$/)
    if (variantMatch) {
      const vi = parseInt(variantMatch[1], 10)
      if (vi >= this._opts.variants.length) {
        res.writeHead(404)
        res.end('Variant not found')
        return
      }
      this._playlistFetches++
      const body = this._variantPlaylist(vi)
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(Buffer.byteLength(body)),
        'Cache-Control': 'no-cache',
      })
      res.end(body)
      return
    }

    // Segment: /v{i}_{seqN}.ts
    const segmentMatch = path.match(/^\/v(\d+)_(\d+)\.ts$/)
    if (segmentMatch) {
      const vi = parseInt(segmentMatch[1], 10)
      const seqN = parseInt(segmentMatch[2], 10)
      if (vi >= this._opts.variants.length) {
        res.writeHead(404)
        res.end('Variant not found')
        return
      }
      this._segmentFetches++
      const segment = this._fakeSegment(vi, seqN)
      this._totalBytesServed += segment.length
      res.writeHead(200, {
        'Content-Type': 'video/MP2T',
        'Content-Length': String(segment.length),
      })
      res.end(segment)
      this.emit('segment', { variantIndex: vi, seqN })
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  }

  // ---------------------------------------------------------------------------
  // Playlist builders
  // ---------------------------------------------------------------------------

  private _masterPlaylist(): string {
    const lines = ['#EXTM3U', '#EXT-X-VERSION:3']
    for (let i = 0; i < this._opts.variants.length; i++) {
      const v = this._opts.variants[i]
      const attrs: string[] = [`BANDWIDTH=${v.bandwidth}`]
      if (v.resolution) attrs.push(`RESOLUTION=${v.resolution}`)
      if (v.codecs) attrs.push(`CODECS="${v.codecs}"`)
      lines.push(`#EXT-X-STREAM-INF:${attrs.join(',')}`)
      lines.push(`v${i}.m3u8`)
    }
    return lines.join('\n') + '\n'
  }

  private _variantPlaylist(vi: number): string {
    const { mode, segmentDuration, segmentCount, targetDuration } = this._opts
    const dur = segmentDuration.toFixed(3)
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
    ]

    if (mode === 'vod') {
      lines.push('#EXT-X-PLAYLIST-TYPE:VOD')
      for (let i = 0; i < segmentCount; i++) {
        lines.push(`#EXTINF:${dur},`)
        lines.push(`v${vi}_${i}.ts`)
      }
      lines.push('#EXT-X-ENDLIST')
    } else {
      const seq = this._mediaSequence
      lines.push(`#EXT-X-MEDIA-SEQUENCE:${seq}`)
      for (let i = 0; i < segmentCount; i++) {
        lines.push(`#EXTINF:${dur},`)
        lines.push(`v${vi}_${seq + i}.ts`)
      }
    }

    return lines.join('\n') + '\n'
  }

  // ---------------------------------------------------------------------------
  // Segment generator
  // ---------------------------------------------------------------------------

  /**
   * Produces a deterministic buffer for a given variant + sequence number.
   * Same inputs always produce the same bytes (useful for caching tests).
   */
  private _fakeSegment(vi: number, seqN: number): Buffer {
    const seed = createHash('sha256').update(`v${vi}_seg${seqN}`).digest()
    const size = this._opts.segmentSize
    const buf = Buffer.allocUnsafe(size)
    for (let i = 0; i < size; i++) {
      buf[i] = seed[i % seed.length]
    }
    return buf
  }
}

export const createMockHlsServer = async (options?: MockHlsServerOptions): Promise<MockHlsServer> => {
  const server = new MockHlsServer(options)
  await server.start()
  return server
}

/** Shorthand: create a VOD HLS server. */
export const createMockHlsVod = async (port?: number): Promise<MockHlsServer> =>
  createMockHlsServer({ port, mode: 'vod' })

/** Shorthand: create a live HLS server. */
export const createMockHlsLive = async (port?: number): Promise<MockHlsServer> =>
  createMockHlsServer({ port, mode: 'live' })
