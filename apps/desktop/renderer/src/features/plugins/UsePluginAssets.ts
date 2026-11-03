import { useEffect, useState } from 'react'
import type { PluginAssetKind } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { PluginCatalogItem } from './PluginCatalog.js'

type Sources = Partial<Record<PluginAssetKind, string>>
const requests = new Map<string, Promise<string | undefined>>()

export function usePluginAssets(plugin?: PluginCatalogItem): Sources {
  const id = plugin?.id
  const workspace = plugin?.workspacePath
  const kinds = plugin?.assetKinds?.join(',') ?? ''
  const identity = `${workspace ?? ''}:${id}:${plugin?.version}:${plugin?.installed}:${kinds}`
  const [loaded, setLoaded] = useState<{ identity: string; sources: Sources }>()
  useEffect(() => {
    let cancelled = false
    if (id)
      for (const kind of ['logo', 'logoDark'] as const) {
        if (!kinds.split(',').includes(kind)) continue
        const key = `${identity}:${kind}`
        let request = requests.get(key)
        if (!request) {
          request = desktopClient
            .readPluginAsset(id, kind, workspace)
            .then((asset) => (asset ? `data:${asset.mimeType};base64,${asset.base64}` : undefined))
            .catch(() => undefined)
            .finally(() => requests.delete(key))
          requests.set(key, request)
        }
        void request.then((source) => {
          if (!cancelled && source)
            setLoaded((current) => ({
              identity,
              sources: {
                ...(current?.identity === identity ? current.sources : {}),
                [kind]: source,
              },
            }))
        })
      }
    return () => {
      cancelled = true
    }
  }, [id, workspace, kinds, identity])
  return loaded?.identity === identity ? loaded.sources : {}
}
