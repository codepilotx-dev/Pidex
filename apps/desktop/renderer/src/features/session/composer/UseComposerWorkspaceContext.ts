import { useEffect, useRef, useState } from 'react'
import type { DesktopFileEntry, DesktopWorkspace } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'

/** Directory results belong to one workspace and folder, including while requests race. */
export function useComposerWorkspaceContext(workspace: DesktopWorkspace | null, active: boolean) {
  const workspaceKey = JSON.stringify([
    workspace?.path,
    workspace?.projectId,
    workspace?.primaryFolderId,
  ])
  const [directory, setDirectory] = useState({ workspaceKey, path: '.' })
  const path = directory.workspaceKey === workspaceKey ? directory.path : '.'
  const scope = `${workspaceKey}:${path}`
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<{
    scope: string
    entries: DesktopFileEntry[]
    loading: boolean
    error: string | null
  }>({ scope: '', entries: [], loading: false, error: null })
  const generation = useRef(0)
  useEffect(() => {
    const request = ++generation.current
    if (!active || !workspace) return
    setResult({ scope, entries: [], loading: true, error: null })
    void desktopClient
      .listWorkspaceFiles(workspace.path, path, workspace.primaryFolderId, workspace.projectId)
      .then((entries) => {
        if (request === generation.current)
          setResult({ scope, entries, loading: false, error: null })
      })
      .catch((error) => {
        if (request === generation.current)
          setResult({ scope, entries: [], loading: false, error: toUserErrorMessage(error) })
      })
    return () => {
      generation.current++
    }
  }, [active, scope, reload])
  useEffect(() => {
    if (!active) setDirectory({ workspaceKey, path: '.' })
  }, [active, workspaceKey])
  const current = result.scope === scope && active
  return {
    contextDirectory: path,
    setContextDirectory: (next: string) => setDirectory({ workspaceKey, path: next }),
    contextEntries: current ? result.entries : [],
    contextEntriesLoading: Boolean(active && workspace && (!current || result.loading)),
    contextEntriesError: current ? result.error : null,
    reloadContext: () => setReload((value) => value + 1),
  }
}
