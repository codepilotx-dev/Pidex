export type LastWorkspaceRestoreState = {
  settingsLoaded: boolean
  isQuickChatPage: boolean
  hasCurrentWorkspace: boolean
  hasAttemptedRestore: boolean
  hasLastActiveWorkspacePath?: boolean
  recentWorkspaceCount?: number
}

export function shouldRestoreLastWorkspace(state: LastWorkspaceRestoreState): boolean {
  return (
    state.settingsLoaded &&
    state.isQuickChatPage &&
    !state.hasCurrentWorkspace &&
    !state.hasAttemptedRestore &&
    (state.hasLastActiveWorkspacePath || (state.recentWorkspaceCount ?? 0) > 0)
  )
}
