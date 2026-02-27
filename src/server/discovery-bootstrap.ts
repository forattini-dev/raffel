/**
 * Discovery watcher bootstrap module.
 *
 * Encapsulates file-system discovery initialization and lifecycle hooks.
 */

import type {
  DiscoveryWatcher,
  DiscoveryConfig,
} from './fs-routes/index.js'
import { createDiscoveryWatcher } from './fs-routes/index.js'

import type { DiscoveryResult } from './fs-routes/loader.js'

export interface DiscoveryBootstrap {
  watcher: DiscoveryWatcher | null
  start: () => Promise<DiscoveryResult | null>
  stop: () => void
}

export interface DiscoveryBootstrapOptions {
  discovery: boolean | DiscoveryConfig | undefined
  hotReload: boolean
  onLoad: (stats: DiscoveryResult['stats']) => void
  onReload: (result: DiscoveryResult) => Promise<void> | void
  onError: (err: Error) => void
}

export function createDiscoveryBootstrap({
  discovery,
  hotReload,
  onLoad,
  onReload,
  onError,
}: DiscoveryBootstrapOptions): DiscoveryBootstrap {
  if (!discovery) {
    return {
      watcher: null,
      start: async () => null,
      stop: () => {},
    }
  }

  const normalizedDiscovery: DiscoveryConfig | true = discovery === true
    ? { http: true, channels: true, rpc: true, streams: true, rest: true, resources: true, tcp: true, udp: true }
    : discovery

  const watcher = createDiscoveryWatcher({
    discovery: normalizedDiscovery,
    hotReload,
    onLoad: (stats) => {
      onLoad(stats)
    },
    onReload: async (result) => {
      await onReload(result)
    },
    onError,
  })

  return {
    watcher,
    start: async () => {
      return watcher.start()
    },
    stop: () => {
      watcher.stop()
    },
  }
}
