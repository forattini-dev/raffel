/**
 * Discovery bootstrap tests
 */

import { describe, it, expect, vi } from 'vitest'
import { createDiscoveryBootstrap } from '../../src/server/discovery-bootstrap.js'

describe('createDiscoveryBootstrap', () => {
  it('returns inert handles when discovery is disabled', async () => {
    const onLoad = vi.fn()
    const onReload = vi.fn()
    const bootstrap = createDiscoveryBootstrap({
      discovery: false,
      hotReload: false,
      onLoad,
      onReload: async () => {
        await onReload()
      },
      onError: vi.fn(),
    })

    expect(bootstrap.watcher).toBeNull()
    expect(await bootstrap.start()).toBeNull()
    expect(onLoad).not.toHaveBeenCalled()

    bootstrap.stop()
  })

  it('loads discovery result when enabled', async () => {
    const onLoad = vi.fn()
    const bootstrap = createDiscoveryBootstrap({
      discovery: {
        http: false,
        channels: false,
        rpc: false,
        streams: false,
        rest: false,
        resources: false,
        tcp: false,
        udp: false,
      },
      hotReload: false,
      onLoad,
      onReload: async () => {},
      onError: vi.fn(),
    })

    const result = await bootstrap.start()

    expect(result).toBeTruthy()
    expect(onLoad).toHaveBeenCalledTimes(1)

    bootstrap.stop()
  })
})
