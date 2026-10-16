import type { PluginSummary, PluginMarketplaceSection } from '@pidex/agent-protocol'
import { useCallback, useEffect, useState, useRef } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'

export type PluginCatalogState = {
  sections: readonly PluginMarketplaceSection[]
  plugins: PluginSummary[] | undefined
  error: string | null
  loading: boolean
  refresh: () => void
  setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginSummary>
}

export function usePluginCatalog(workspacePath?: string | null): PluginCatalogState {
  const [sections, setSections] = useState<readonly PluginMarketplaceSection[]>([])
  const [loading, setLoading] = useState(true)
  const workspaceRef = useRef(workspacePath)
  const [plugins, setPlugins] = useState<PluginSummary[] | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (workspaceRef.current !== workspacePath) {
      setPlugins(undefined)
      setSections([])
      workspaceRef.current = workspacePath
    }
    setError(null)
    desktopClient
      .listPlugins(workspacePath, reloadKey > 0)
      .then((result) => {
        if (!cancelled) {
          setSections(result.sections ?? [])
          setLoading(false)
          setPlugins([...result.plugins])
          setError(result.catalogError ?? null)
        }
      })
      .catch((cause) => {
        if (cancelled) return
        setLoading(false)
        setPlugins((current) => current ?? [])
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
      setPlugins((current) =>
        current?.map((plugin) => (plugin.id === result.id ? { ...plugin, ...result } : plugin)),
      )
      return result
    },
    [],
  )

  return {
    plugins,
    sections,
    error,
    loading,
    refresh: () => setReloadKey((current) => current + 1),
    setEnabled,
  }
}
