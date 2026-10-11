export const DESKTOP_WORKSPACE_IPC_CHANNELS = {
  pickDirectory: 'workspace:pick-directory',
  pickDirectories: 'workspace:pick-directories',
} as const

export interface DesktopWorkspaceIpcBridge {
  pickWorkspaceDirectory(): Promise<string | null>
  pickWorkspaceDirectories(): Promise<string[]>
}
