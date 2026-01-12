import { describe, it, expect } from 'vitest'
import { createStream } from './raffel-stream.js'

describe('RaffelStream', () => {
  describe('basic operations', () => {
    it('should create a stream with default options', () => {
      const stream = createStream<string>()

      expect(stream.id).toBeTruthy()
      expect(stream.priority).toBe(0)
      expect(stream.bufferedAmount).toBe(0)
      expect(stream.readable).toBe(true)
      expect(stream.writable).toBe(true)
      expect(stream.closed).toBe(false)
      expect(stream.errored).toBeNull()
    })

    it('should create a stream with custom options', () => {
      const stream = createStream<string>({
        id: 'my-stream',
        priority: 5,
        highWaterMark: 32,
      })

      expect(stream.id).toBe('my-stream')
      expect(stream.priority).toBe(5)
    })

    it('should write and read a single value', async () => {
      const stream = createStream<string>()

      await stream.write('hello')
      const chunk = await stream.read()

      expect(chunk.done).toBe(false)
      expect(chunk.value).toBe('hello')
    })

    it('should maintain FIFO order', async () => {
      const stream = createStream<number>()

      await stream.write(1)
      await stream.write(2)
      await stream.write(3)

      const c1 = await stream.read()
      const c2 = await stream.read()
      const c3 = await stream.read()

      expect(c1.value).toBe(1)
      expect(c2.value).toBe(2)
      expect(c3.value).toBe(3)
    })
  })

  describe('end/close', () => {
    it('should signal done when stream ends', async () => {
      const stream = createStream<string>()

      await stream.write('last')
      stream.end()

      const c1 = await stream.read()
      expect(c1.value).toBe('last')

      const c2 = await stream.read()
      expect(c2.done).toBe(true)
    })

    it('should return done for subsequent reads after close', async () => {
      const stream = createStream<string>()
      stream.end()

      const c1 = await stream.read()
      const c2 = await stream.read()

      expect(c1.done).toBe(true)
      expect(c2.done).toBe(true)
    })

    it('should reject writes after end()', async () => {
      const stream = createStream<string>()
      stream.end()

      await expect(stream.write('fail')).rejects.toThrow(/Cannot write to stream/)
    })

    it('should update state correctly', () => {
      const stream = createStream<string>()

      expect(stream.writable).toBe(true)
      expect(stream.closed).toBe(false)

      stream.end()

      expect(stream.writable).toBe(false)
      // closed becomes true only after buffer is drained
    })
  })

  describe('error handling', () => {
    it('should propagate errors to readers', async () => {
      const stream = createStream<string>()
      const error = new Error('test error')

      // Start a read that will be pending
      const readPromise = stream.read()

      // Error the stream
      stream.error(error)

      await expect(readPromise).rejects.toThrow(/test error/)
    })

    it('should reject writes after error', async () => {
      const stream = createStream<string>()
      stream.error(new Error('failed'))

      await expect(stream.write('fail')).rejects.toThrow(/Cannot write to stream/)
    })

    it('should expose error via errored property', () => {
      const stream = createStream<string>()
      const error = new Error('oops')

      expect(stream.errored).toBeNull()

      stream.error(error)

      expect(stream.errored).toBe(error)
    })
  })

  describe('backpressure', () => {
    it('should buffer values up to highWaterMark', async () => {
      const stream = createStream<number>({ highWaterMark: 3 })

      // These should all resolve immediately
      await stream.write(1)
      await stream.write(2)
      await stream.write(3)

      expect(stream.bufferedAmount).toBe(3)
    })

    it('should block writes when buffer is full', async () => {
      const stream = createStream<number>({ highWaterMark: 2 })

      await stream.write(1)
      await stream.write(2)

      // This write should block
      let writeResolved = false
      const writePromise = stream.write(3).then(() => {
        writeResolved = true
      })

      // Give microtask a chance to run
      await new Promise((r) => setTimeout(r, 10))
      expect(writeResolved).toBe(false)

      // Read to free space
      await stream.read()

      // Now write should resolve
      await writePromise
      expect(writeResolved).toBe(true)
    })

    it('should deliver directly to waiting reader (fast path)', async () => {
      const stream = createStream<string>()

      // Start a read before writing
      const readPromise = stream.read()

      // Write should deliver directly
      await stream.write('fast')

      const chunk = await readPromise
      expect(chunk.value).toBe('fast')

      // Buffer should be empty (direct delivery)
      expect(stream.bufferedAmount).toBe(0)
    })
  })

  describe('pause/resume', () => {
    it('should not deliver values when paused', async () => {
      const stream = createStream<string>()

      await stream.write('data')
      stream.pause()

      // Start a read - should not resolve while paused
      let readResolved = false
      const readPromise = stream.read().then((chunk) => {
        readResolved = true
        return chunk
      })

      await new Promise((r) => setTimeout(r, 10))
      expect(readResolved).toBe(false)

      // Resume
      stream.resume()

      const chunk = await readPromise
      expect(chunk.value).toBe('data')
    })
  })

  describe('cancel', () => {
    it('should terminate stream with error', async () => {
      const stream = createStream<string>()

      // Queue a read
      const readPromise = stream.read()

      stream.cancel('user cancelled')

      await expect(readPromise).rejects.toThrow(/user cancelled/)
    })

    it('should clear buffer on cancel', async () => {
      const stream = createStream<string>()

      await stream.write('data1')
      await stream.write('data2')

      expect(stream.bufferedAmount).toBe(2)

      stream.cancel()

      expect(stream.bufferedAmount).toBe(0)
    })

    it('should reject pending writes on cancel', async () => {
      const stream = createStream<number>({ highWaterMark: 1 })

      await stream.write(1)

      // This will be pending
      const writePromise = stream.write(2)

      stream.cancel('cancelled')

      await expect(writePromise).rejects.toThrow(/cancelled/)
    })
  })

  describe('AsyncIterator', () => {
    it('should work with for-await-of', async () => {
      const stream = createStream<number>()

      // Write some data and end
      await stream.write(1)
      await stream.write(2)
      await stream.write(3)
      stream.end()

      const values: number[] = []
      for await (const value of stream) {
        values.push(value)
      }

      expect(values).toEqual([1, 2, 3])
    })

    it('should handle concurrent producer/consumer', async () => {
      const stream = createStream<number>()

      // Producer
      const producer = async () => {
        for (let i = 0; i < 5; i++) {
          await stream.write(i)
        }
        stream.end()
      }

      // Consumer
      const consumer = async () => {
        const values: number[] = []
        for await (const value of stream) {
          values.push(value)
        }
        return values
      }

      // Run concurrently
      const [_, values] = await Promise.all([producer(), consumer()])

      expect(values).toEqual([0, 1, 2, 3, 4])
    })

    it('should clean up when break is called', async () => {
      const stream = createStream<number>()

      await stream.write(1)
      await stream.write(2)
      await stream.write(3)

      const values: number[] = []
      for await (const value of stream) {
        values.push(value)
        if (value === 2) break
      }

      expect(values).toEqual([1, 2])
      // Stream should be cancelled
      expect(stream.errored).not.toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should handle rapid writes and reads', async () => {
      const stream = createStream<number>({ highWaterMark: 10 })
      const count = 100

      // Concurrent writes and reads
      const writes = Promise.all(
        Array.from({ length: count }, (_, i) => stream.write(i))
      )

      const reads: number[] = []
      for (let i = 0; i < count; i++) {
        const chunk = await stream.read()
        if (!chunk.done) reads.push(chunk.value!)
      }

      await writes

      expect(reads.length).toBe(count)
    })

    it('should handle zero highWaterMark (synchronous mode)', async () => {
      const stream = createStream<string>({ highWaterMark: 0 })

      // Write should block immediately
      let writeResolved = false
      const writePromise = stream.write('sync').then(() => {
        writeResolved = true
      })

      await new Promise((r) => setTimeout(r, 10))
      expect(writeResolved).toBe(false)

      // Read should unblock write
      const chunk = await stream.read()
      expect(chunk.value).toBe('sync')

      await writePromise
      expect(writeResolved).toBe(true)
    })
  })
})
