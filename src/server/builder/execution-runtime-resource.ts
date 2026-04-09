import type { StopTask } from '../telemetry-bootstrap.js'

interface ManagedRuntimeResourceOptions<T> {
  resource: T
  name: string
  registerStopTask: (task: StopTask) => void
  start: (resource: T) => Promise<unknown> | unknown
  stop: (resource: T) => Promise<unknown> | unknown
  beforeStop?: (resource: T) => Promise<void> | void
  afterStop?: (resource: T) => Promise<void> | void
}

export async function startManagedRuntimeResource<T>(
  options: ManagedRuntimeResourceOptions<T>
) {
  const {
    resource,
    name,
    registerStopTask,
    start,
    stop,
    beforeStop,
    afterStop,
  } = options

  await start(resource)

  registerStopTask({
    name,
    stop: async () => {
      await beforeStop?.(resource)
      await stop(resource)
      await afterStop?.(resource)
    },
  })

  return resource
}
