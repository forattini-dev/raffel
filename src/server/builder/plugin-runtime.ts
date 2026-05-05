import type {
  RaffelServer,
  ResolvedProviders,
  ServerPlugin,
} from '../types.js'
import type {
  RuntimeInspectionContribution,
  RuntimeInspectionGraph,
} from '../../inspect/index.js'

export interface ServerPluginRuntime {
  getPluginProviders(): Readonly<ResolvedProviders>
  getPluginsInStartOrder(): ServerPlugin[]
  getPluginsInStopOrder(): ServerPlugin[]
  runPluginRuntimeHooks(
    hookName: 'beforeStart' | 'afterStart' | 'beforeStop' | 'afterStop',
    plugins: ServerPlugin[],
    signal: AbortSignal
  ): Promise<void>
  getInspectionExtensions(preview: RuntimeInspectionGraph): RuntimeInspectionContribution[]
}

export function createServerPluginRuntime(input: {
  registeredPlugins: Map<string, ServerPlugin>
  resolvedProviders: ResolvedProviders
  getServer: () => RaffelServer
}): ServerPluginRuntime {
  const { registeredPlugins, resolvedProviders, getServer } = input

  function getPluginProviders(): Readonly<ResolvedProviders> {
    return Object.freeze({ ...resolvedProviders })
  }

  function getPluginsInStartOrder(): ServerPlugin[] {
    return [...registeredPlugins.values()]
  }

  function getPluginsInStopOrder(): ServerPlugin[] {
    return getPluginsInStartOrder().reverse()
  }

  async function runPluginRuntimeHooks(
    hookName: 'beforeStart' | 'afterStart' | 'beforeStop' | 'afterStop',
    plugins: ServerPlugin[],
    signal: AbortSignal
  ): Promise<void> {
    for (const plugin of plugins) {
      const hook = plugin[hookName]
      if (!hook) continue

      await hook({
        server: getServer(),
        providers: getPluginProviders(),
        signal,
      })
    }
  }

  function getInspectionExtensions(
    preview: RuntimeInspectionGraph
  ): RuntimeInspectionContribution[] {
    const contributions: RuntimeInspectionContribution[] = []

    for (const plugin of registeredPlugins.values()) {
      if (!plugin.inspect) continue

      const result = plugin.inspect({
        server: getServer(),
        providers: getPluginProviders(),
        preview,
      })

      if (!result) continue

      if (Array.isArray(result)) {
        contributions.push(...result)
      } else {
        contributions.push(result)
      }
    }

    return contributions
  }

  return {
    getPluginProviders,
    getPluginsInStartOrder,
    getPluginsInStopOrder,
    runPluginRuntimeHooks,
    getInspectionExtensions,
  }
}
