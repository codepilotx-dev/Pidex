import { useCallback, useState } from 'react'
import type { DesktopRemovedWorkspace, DesktopWorkspace } from '../../../../shared/Types.js'
import type { UseDesktopSettingsResult } from '../../settings/UseDesktopSettings.js'
import { useWorkspaceState } from '../../workspace/UseWorkspaceState.js'

type WorkbenchWorkspaceSettings = Pick<
  UseDesktopSettingsResult,
  'setRecentWorkspaces' | 'syncExternalSettingsPatch'
>

export function useWorkbenchWorkspaceController({
  initialLastActiveWorkspacePath,
  initialRemovedWorkspaces,
  settings,
  onError,
}: {
  initialLastActiveWorkspacePath: string
  initialRemovedWorkspaces: DesktopRemovedWorkspace[]
  settings: WorkbenchWorkspaceSettings
  onError: (message: string) => void
}) {
  const [unavailableWorkspacePaths, setUnavailableWorkspacePaths] = useState<Set<string>>(
    () => new Set(),
  )
  const [removedWorkspaces, setRemovedWorkspaces] = useState<DesktopRemovedWorkspace[]>(
    () => initialRemovedWorkspaces,
  )
  const [lastActiveWorkspacePath, setLastActiveWorkspacePath] = useState(
    () => initialLastActiveWorkspacePath,
  )

  const markWorkspaceUnavailable = useCallback(
    (target: DesktopWorkspace): void => {
      onError('')
      setUnavailableWorkspacePaths((current) => {
        if (current.has(target.path)) return current
        const next = new Set(current)
        next.add(target.path)
        return next
      })
    },
    [onError],
  )

  const clearWorkspaceRemoved = useCallback(
    (target: DesktopWorkspace): void => {
      setRemovedWorkspaces((current) => {
        const next = current.filter((item) => item.path !== target.path)
        if (next.length === current.length) return current
        settings.syncExternalSettingsPatch({ removedWorkspaces: next })
        return next
      })
    },
    [settings],
  )

  const clearWorkspaceUnavailable = useCallback((target: DesktopWorkspace): void => {
    setUnavailableWorkspacePaths((current) => {
      if (!current.has(target.path)) return current
      const next = new Set(current)
      next.delete(target.path)
      return next
    })
  }, [])

  const workspace = useWorkspaceState({
    onError,
    onWorkspaceUnavailable: markWorkspaceUnavailable,
    onRecentWorkspacesChange: settings.setRecentWorkspaces,
  })

  return {
    workspace,
    unavailableWorkspacePaths,
    setUnavailableWorkspacePaths,
    removedWorkspaces,
    setRemovedWorkspaces,
    lastActiveWorkspacePath,
    setLastActiveWorkspacePath,
    clearWorkspaceRemoved,
    clearWorkspaceUnavailable,
  }
}
