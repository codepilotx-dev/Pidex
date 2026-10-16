import { useEffect, useState } from 'react'
import type { PluginDetails } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { PluginCatalogItem } from './PluginCatalog.js'

export function usePluginDetails(item: PluginCatalogItem | null, workspacePath?: string | null) {
  const [revision, setRevision] = useState(0)
  const id = item?.id
  const identity = JSON.stringify([id, item?.version, item?.installed, workspacePath, revision])
  const [state, setState] = useState<{
    identity: string
    details: PluginDetails | null
    error: string | null
  }>()
  useEffect(() => {
    let cancelled = false
    if (id)
      desktopClient
        .getPluginDetails(id, workspacePath)
        .then((details) => {
          if (!cancelled) setState({ identity, details, error: null })
        })
        .catch((cause) => {
          if (!cancelled)
            setState({
              identity,
              details: null,
              error: cause instanceof Error ? cause.message : '插件详情读取失败。',
            })
        })
    return () => {
      cancelled = true
    }
  }, [id, workspacePath, identity])
  return {
    details: state?.identity === identity ? state.details : null,
    error: state?.identity === identity ? state.error : null,
    retry: () => setRevision((current) => current + 1),
  }
}
