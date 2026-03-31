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

  a.on('data', (chunk: Buffer) => {
    if (b.destroyed) {
      teardown()
      return
    }
    bytesFromA += chunk.length
    opts?.onDataFromA?.(chunk.length)
    if (!b.write(chunk)) a.pause()
  })

  b.on('data', (chunk: Buffer) => {
    if (a.destroyed) {
      teardown()
      return
    }
    bytesToA += chunk.length
    opts?.onDataToA?.(chunk.length)
    if (!a.write(chunk)) b.pause()
  })

  b.on('drain', () => { if (!a.destroyed) a.resume() })
  a.on('drain', () => { if (!b.destroyed) b.resume() })

  a.on('end', () => { if (!b.destroyed) b.end() })
  b.on('end', () => { if (!a.destroyed) a.end() })

  a.on('close', () => teardown(undefined, 'a'))
  b.on('close', () => teardown(undefined, 'b'))
  a.on('error', (err) => teardown(err, 'a'))
  b.on('error', (err) => teardown(err, 'b'))

  return () => teardown()
}
