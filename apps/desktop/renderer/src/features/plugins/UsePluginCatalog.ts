import type { PluginSummary } from '@pidex/agent-protocol'
import { useCallback, useEffect, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'

export type PluginCatalogState = {
  plugins: PluginSummary[] | undefined
  error: string | null
  loading: boolean
  refresh: () => void
  setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginSummary>
}

export function usePluginCatalog(workspacePath?: string | null): PluginCatalogState {
  const [plugins, setPlugins] = useState<PluginSummary[] | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setPlugins(undefined)
    setError(null)
    desktopClient
      .listPlugins(workspacePath, reloadKey > 0)
      .then((result) => {
        if (!cancelled) setPlugins([...result.plugins])
      })
      .catch((cause) => {
        if (cancelled) return
        setPlugins([])
        setError(cause instanceof Error ? cause.message : '插件状态读取失败。')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey, workspacePath])

  useEffect(
    () =>
      desktopClient.onPluginsUpdated(() => {
        setReloadKey((current) => current + 1)
      }),
    [],
  )

  const setEnabled = useCallback(
    async (pluginId: string, enabled: boolean): Promise<PluginSummary> => {
      const result = await desktopClient.setPluginEnabled(pluginId, enabled)
      setPlugins((current) => current?.map((plugin) => (plugin.id === result.id ? result : plugin)))
      return result
    },
    [],
  )

  return {
    plugins,
    error,
    loading: plugins === undefined && error === null,
    refresh: () => setReloadKey((current) => current + 1),
    setEnabled,
  }
}
