import { describe, expect, it, vi } from 'vitest'
import {
  startAssignedManagedAdapter,
  startExistingManagedAdapter,
} from '../../src/server/builder/execution-adapter-lifecycle.js'

function createAdapter() {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }
}

describe('execution adapter lifecycle', () => {
  it('starts an assigned adapter and clears its ref on registered stop', async () => {
    const adapter = createAdapter()
    const ref = { value: null as typeof adapter | null }
    const tasks: Array<{ name: string; stop: () => Promise<void> }> = []

    await startAssignedManagedAdapter({
      ref,
      adapter,
      name: 'websocket',
      registerStopTask: (task) => {
        tasks.push(task)
      },
    })

    expect(ref.value).toBe(adapter)
    expect(adapter.start).toHaveBeenCalledOnce()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('websocket')

    await tasks[0].stop()

    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(ref.value).toBeNull()
  })

  it('runs beforeStop before adapter.stop', async () => {
    const order: string[] = []
    const adapter = {
      start: vi.fn(async () => {
        order.push('start')
      }),
      stop: vi.fn(async () => {
        order.push('stop')
      }),
    }
    const ref = { value: null as typeof adapter | null }
    let task: { name: string; stop: () => Promise<void> } | null = null

    await startAssignedManagedAdapter({
      ref,
      adapter,
      name: 'grpc',
      registerStopTask: (registeredTask) => {
        task = registeredTask
      },
      beforeStop: async () => {
        order.push('beforeStop')
      },
    })

    await task!.stop()

    expect(order).toEqual(['start', 'beforeStop', 'stop'])
  })

  it('returns null and does not register a stop task when existing ref is empty', async () => {
    const ref = { value: null as ReturnType<typeof createAdapter> | null }
    const registerStopTask = vi.fn()

    const result = await startExistingManagedAdapter({
      ref,
      name: 'graphql',
      registerStopTask,
    })

    expect(result).toBeNull()
    expect(registerStopTask).not.toHaveBeenCalled()
  })

  it('starts an existing adapter and clears its ref on registered stop', async () => {
    const adapter = createAdapter()
    const ref = { value: adapter }
    let task: { name: string; stop: () => Promise<void> } | null = null

    const result = await startExistingManagedAdapter({
      ref,
      name: 'graphql',
      registerStopTask: (registeredTask) => {
        task = registeredTask
      },
    })

    expect(result).toBe(adapter)
    expect(adapter.start).toHaveBeenCalledOnce()
    expect(task?.name).toBe('graphql')

    await task!.stop()

    expect(adapter.stop).toHaveBeenCalledOnce()
    expect(ref.value).toBeNull()
  })
})
