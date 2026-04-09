import { describe, expect, it, vi } from 'vitest'
import { startManagedRuntimeResource } from '../../src/server/builder/execution-runtime-resource.js'

describe('execution runtime resource', () => {
  it('starts a resource and registers a stop task', async () => {
    const order: string[] = []
    const resource = { kind: 'resource' }
    const tasks: Array<{ name: string; stop: () => Promise<void> }> = []

    const result = await startManagedRuntimeResource({
      resource,
      name: 'mcp',
      registerStopTask: (task) => {
        tasks.push(task)
      },
      start: async () => {
        order.push('start')
      },
      stop: async () => {
        order.push('stop')
      },
    })

    expect(result).toBe(resource)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('mcp')

    await tasks[0].stop()

    expect(order).toEqual(['start', 'stop'])
  })

  it('runs beforeStop and afterStop around stop', async () => {
    const order: string[] = []
    let task: { name: string; stop: () => Promise<void> } | null = null

    await startManagedRuntimeResource({
      resource: { id: 'x' },
      name: 'udp-handler:ping',
      registerStopTask: (registeredTask) => {
        task = registeredTask
      },
      start: async () => {
        order.push('start')
      },
      beforeStop: async () => {
        order.push('beforeStop')
      },
      stop: async () => {
        order.push('stop')
      },
      afterStop: async () => {
        order.push('afterStop')
      },
    })

    await task!.stop()

    expect(order).toEqual(['start', 'beforeStop', 'stop', 'afterStop'])
  })

  it('propagates the same resource instance to all callbacks', async () => {
    const resource = { id: 'shared' }
    const seen = {
      start: vi.fn(),
      stop: vi.fn(),
      beforeStop: vi.fn(),
      afterStop: vi.fn(),
    }
    let task: { name: string; stop: () => Promise<void> } | null = null

    await startManagedRuntimeResource({
      resource,
      name: 'tcp-handler:ping',
      registerStopTask: (registeredTask) => {
        task = registeredTask
      },
      start: async (current) => {
        seen.start(current)
      },
      beforeStop: async (current) => {
        seen.beforeStop(current)
      },
      stop: async (current) => {
        seen.stop(current)
      },
      afterStop: async (current) => {
        seen.afterStop(current)
      },
    })

    await task!.stop()

    expect(seen.start).toHaveBeenCalledWith(resource)
    expect(seen.beforeStop).toHaveBeenCalledWith(resource)
    expect(seen.stop).toHaveBeenCalledWith(resource)
    expect(seen.afterStop).toHaveBeenCalledWith(resource)
  })
})
