/**
 * Unified proxy suite for explicit HTTP/HTTPS proxying plus SOCKS5h.
 */
import type { MetricRegistry } from '../metrics/types.js'
import { createExplicitProxy, type ExplicitProxy, type ExplicitProxyOptions } from './explicit.js'
import { createSocks5Proxy, type Socks5Options, type Socks5Proxy } from './socks5.js'
import {
  createOrReuseProxyTelemetry,
  type ProxyTelemetryOptionsBase,
} from './telemetry-options.js'
import type { ProxyGraphSnapshot } from './telemetry.js'
import type { ProxyStats } from './types.js'

export interface ProxySuiteTelemetryOptions extends ProxyTelemetryOptionsBase {
  metricsEndpoint?: string | false
  graphEndpoint?: string | false
}

export interface ProxySuiteOptions {
  explicit: Omit<ExplicitProxyOptions, 'telemetry'>
  socks5: Omit<Socks5Options, 'telemetry'>
  telemetry?: ProxySuiteTelemetryOptions
}

export interface ProxySuite {
  readonly explicit: ExplicitProxy
  readonly socks5: Socks5Proxy
  readonly metricsRegistry: MetricRegistry | null
  readonly isRunning: boolean
  readonly ports: { explicit: number | null; socks5: number | null }
  readonly stats: ProxyStats
  start(): Promise<{ explicitPort: number; socks5Port: number }>
  stop(drainTimeoutMs?: number): Promise<void>
  graphSnapshot(): ProxyGraphSnapshot
}

function sumStats(...parts: ProxyStats[]): ProxyStats {
  return parts.reduce<ProxyStats>(
    (acc, next) => ({
      connectionsTotal: acc.connectionsTotal + next.connectionsTotal,
      connectionsActive: acc.connectionsActive + next.connectionsActive,
      bytesFromClient: acc.bytesFromClient + next.bytesFromClient,
      bytesToClient: acc.bytesToClient + next.bytesToClient,
      connectionsErrored: acc.connectionsErrored + next.connectionsErrored,
      authFailures: acc.authFailures + next.authFailures,
    }),
    {
      connectionsTotal: 0,
      connectionsActive: 0,
      bytesFromClient: 0,
      bytesToClient: 0,
      connectionsErrored: 0,
      authFailures: 0,
    },
  )
}

export function createProxySuite(options: ProxySuiteOptions): ProxySuite {
  const collector = createOrReuseProxyTelemetry(options.telemetry)

  const explicit = createExplicitProxy({
    ...options.explicit,
    telemetry: options.telemetry
      ? {
          ...options.telemetry,
          collector: collector ?? options.telemetry.collector,
        }
      : undefined,
  })

  const socks5 = createSocks5Proxy({
    ...options.socks5,
    telemetry: options.telemetry
      ? {
          ...options.telemetry,
          collector: collector ?? options.telemetry.collector,
        }
      : undefined,
  })

  let running = false

  return {
    explicit,
    socks5,

    async start(): Promise<{ explicitPort: number; socks5Port: number }> {
      const explicitPort = await explicit.start()
      try {
        const socks5Port = await socks5.start()
        running = true
        return { explicitPort, socks5Port }
      } catch (error) {
        await explicit.stop().catch(() => {})
        throw error
      }
    },

    async stop(drainTimeoutMs = 5000): Promise<void> {
      await Promise.allSettled([
        explicit.stop(drainTimeoutMs),
        socks5.stop(drainTimeoutMs),
      ])
      running = false
    },

    graphSnapshot(): ProxyGraphSnapshot {
      return collector?.snapshot() ?? explicit.graphSnapshot()
    },

    get metricsRegistry(): MetricRegistry | null {
      return collector?.registry ?? explicit.metricsRegistry ?? socks5.metricsRegistry
    },

    get isRunning(): boolean {
      return running
    },

    get ports(): { explicit: number | null; socks5: number | null } {
      return {
        explicit: explicit.boundPort,
        socks5: socks5.boundPort,
      }
    },

    get stats(): ProxyStats {
      return sumStats(explicit.stats, socks5.stats)
    },
  }
}
