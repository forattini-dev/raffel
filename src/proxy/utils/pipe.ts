/**
 * Bidirectional socket piping with backpressure support.
 */
import type { Socket } from 'node:net'

export interface PipeBidirectionalOptions {
  /** Called on each chunk flowing from socket A to socket B. */
  onDataFromA?(bytes: number): void
  /** Called on each chunk flowing from socket B to socket A. */
  onDataToA?(bytes: number): void
  /** Called when piping ends (either side closes or errors). Reports total bytes. */
  onStats?(d: { bytesFromA: number; bytesToA: number }): void
  /** Called when piping ends cleanly or with error. */
  onEnd?(): void
  /** Called on socket error. */
  onError?(err: Error, side: 'a' | 'b'): void
}

/**
 * Wire one direction of socket piping (src → dst) with backpressure handling.
 * The two directions of `pipeBidirectional` share this exact shape.
 */
function wireDirection(
  src: Socket,
  dst: Socket,
  onChunk: (bytes: number) => void,
  onClosed: () => void,
): void {
  src.on('data', (chunk: Buffer) => {
    if (dst.destroyed) {
      onClosed()
      return
    }
    onChunk(chunk.length)
    if (!dst.write(chunk)) src.pause()
  })
  dst.on('drain', () => { if (!src.destroyed) src.resume() })
  src.on('end', () => { if (!dst.destroyed) dst.end() })
}

/**
 * Pipe data bidirectionally between two sockets with backpressure.
 *
 * Returns an idempotent teardown function that destroys both sockets.
 */
export function pipeBidirectional(
  a: Socket,
  b: Socket,
  opts?: PipeBidirectionalOptions,
): () => void {
  let bytesFromA = 0
  let bytesToA = 0
  let torn = false

  function teardown(err?: Error, side?: 'a' | 'b') {
    if (torn) return
    torn = true
    if (err && opts?.onError) opts.onError(err, side!)
    opts?.onStats?.({ bytesFromA, bytesToA })
    opts?.onEnd?.()
    if (!a.destroyed) a.destroy()
    if (!b.destroyed) b.destroy()
  }

  wireDirection(a, b, (n) => { bytesFromA += n; opts?.onDataFromA?.(n) }, () => teardown())
  wireDirection(b, a, (n) => { bytesToA += n; opts?.onDataToA?.(n) }, () => teardown())

  a.on('close', () => teardown(undefined, 'a'))
  b.on('close', () => teardown(undefined, 'b'))
  a.on('error', (err) => teardown(err, 'a'))
  b.on('error', (err) => teardown(err, 'b'))

  return () => teardown()
}
