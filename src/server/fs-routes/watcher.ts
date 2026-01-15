/**
 * Hot Reload Watcher
 *
 * Watches discovery directories for changes and triggers reload.
 */

import { watch, type FSWatcher } from 'node:fs'
import { join, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { createLogger } from '../../utils/logger.js'
import { loadDiscovery, clearModuleCache, type DiscoveryResult } from './loader.js'
import type { DiscoveryLoaderOptions } from './types.js'

const logger = createLogger('fs-watcher')

export interface DiscoveryWatcherOptions extends DiscoveryLoaderOptions {
  /** Debounce delay in ms (default: 100) */
  debounceMs?: number

  /** Called when handlers are reloaded */
  onReload?: (result: DiscoveryResult) => void | Promise<void>
}

export interface DiscoveryWatcher {
  /** Start watching for changes */
  start(): Promise<DiscoveryResult>

  /** Stop watching */
  stop(): void

  /** Force reload all handlers */
  reload(): Promise<DiscoveryResult>

  /** Check if watcher is active */
  readonly isWatching: boolean

  /** Get current discovery result */
  readonly result: DiscoveryResult | null
}

/**
 * Create a discovery watcher for hot reload
 */
export function createDiscoveryWatcher(options: DiscoveryWatcherOptions): DiscoveryWatcher {
  const {
    debounceMs = 100,
    onReload,
    onError,
    ...loaderOptions
  } = options

  const watchers: FSWatcher[] = []
  let currentResult: DiscoveryResult | null = null
  let reloadTimeout: NodeJS.Timeout | null = null
  let isWatching = false

  const extensions = loaderOptions.extensions ?? ['.ts', '.js']

  /**
   * Get directories to watch
   */
  function getWatchDirs(): string[] {
    const baseDir = loaderOptions.baseDir ?? process.cwd()
    const dirs: string[] = []

    const config = loaderOptions.discovery === true
      ? { http: true, channels: true, rpc: true, streams: true, rest: true, resources: true, tcp: true, udp: true }
      : loaderOptions.discovery || {}

    const defaults: Record<string, string> = {
      http: './src/http',
      channels: './src/channels',
      rpc: './src/rpc',
      streams: './src/streams',
      rest: './src/rest',
      resources: './src/resources',
      tcp: './src/tcp',
      udp: './src/udp',
    }

    for (const [key, defaultPath] of Object.entries(defaults)) {
      const value = config[key as keyof typeof config]
      if (value) {
        const dir = value === true ? join(baseDir, defaultPath) : join(baseDir, value as string)
        if (existsSync(dir)) {
          dirs.push(dir)
        }
      }
    }

    return dirs
  }

  /**
   * Schedule a debounced reload
   */
  function scheduleReload(changedFile: string): void {
    if (reloadTimeout) {
      clearTimeout(reloadTimeout)
    }

    reloadTimeout = setTimeout(async () => {
      reloadTimeout = null

      try {
        logger.info({ file: changedFile }, 'File changed, reloading handlers...')

        // Clear cache for changed file
        clearModuleCache(changedFile)

        // Reload all handlers
        const result = await loadDiscovery(loaderOptions)
        currentResult = result

        logger.info(
          { total: result.stats.total, duration: result.stats.duration },
          'Handlers reloaded'
        )

        if (onReload) {
          await onReload(result)
        }
      } catch (err) {
        logger.error({ err }, 'Failed to reload handlers')
        if (onError) {
          onError(err as Error)
        }
      }
    }, debounceMs)
  }

  /**
   * Handle file change event
   */
  function handleChange(_eventType: string, filename: string | null, dir: string): void {
    if (!filename) return

    // Check if it's a relevant file
    const ext = extname(filename)
    if (!extensions.includes(ext)) return

    const fullPath = join(dir, filename)
    scheduleReload(fullPath)
  }

  return {
    async start(): Promise<DiscoveryResult> {
      if (isWatching) {
        throw new Error('Watcher is already running')
      }

      // Initial load
      currentResult = await loadDiscovery(loaderOptions)

      // Start watching if hot reload is enabled
      if (loaderOptions.hotReload !== false) {
        const dirs = getWatchDirs()

        for (const dir of dirs) {
          try {
            const watcher = watch(
              dir,
              { recursive: true },
              (eventType, filename) => handleChange(eventType, filename, dir)
            )

            watcher.on('error', (err) => {
              logger.error({ err, dir }, 'Watcher error')
              if (onError) {
                onError(err)
              }
            })

            watchers.push(watcher)
            logger.debug({ dir }, 'Watching directory')
          } catch (err) {
            logger.warn({ err, dir }, 'Failed to watch directory')
          }
        }

        isWatching = true
        logger.info({ dirs: dirs.length }, 'Hot reload watcher started')
      }

      return currentResult
    },

    stop(): void {
      if (reloadTimeout) {
        clearTimeout(reloadTimeout)
        reloadTimeout = null
      }

      for (const watcher of watchers) {
        watcher.close()
      }
      watchers.length = 0
      isWatching = false

      logger.info('Hot reload watcher stopped')
    },

    async reload(): Promise<DiscoveryResult> {
      currentResult = await loadDiscovery(loaderOptions)

      if (onReload) {
        await onReload(currentResult)
      }

      return currentResult
    },

    get isWatching(): boolean {
      return isWatching
    },

    get result(): DiscoveryResult | null {
      return currentResult
    },
  }
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production'
}
