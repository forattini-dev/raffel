import type { StopTask } from '../telemetry-bootstrap.js'
import type { MutableRef } from './state.js'

interface StartStopAdapter {
  start(): Promise<unknown> | unknown
  stop(): Promise<unknown> | unknown
}

interface ManagedAdapterLifecycleOptions<T extends StartStopAdapter> {
  ref: MutableRef<T | null>
  name: string
  registerStopTask: (task: StopTask) => void
  beforeStop?: (adapter: T) => Promise<void> | void
}

function registerManagedAdapterStopTask<T extends StartStopAdapter>(
  options: ManagedAdapterLifecycleOptions<T>
) {
  const { ref, name, registerStopTask, beforeStop } = options

  registerStopTask({
    name,
    stop: async () => {
      const adapter = ref.value
      if (!adapter) return
      await beforeStop?.(adapter)
      await adapter.stop()
      ref.value = null
    },
  })
}

export async function startAssignedManagedAdapter<T extends StartStopAdapter>(
  options: ManagedAdapterLifecycleOptions<T> & {
    adapter: T
  }
) {
  const { ref, adapter } = options
  ref.value = adapter
  await adapter.start()
  registerManagedAdapterStopTask(options)
  return adapter
}

export async function startExistingManagedAdapter<T extends StartStopAdapter>(
  options: ManagedAdapterLifecycleOptions<T>
) {
  const adapter = options.ref.value
  if (!adapter) {
    return null
  }

  await adapter.start()
  registerManagedAdapterStopTask(options)
  return adapter
}
