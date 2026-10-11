export const DESKTOP_SHELL_IPC_CHANNELS = {
  openExternal: 'shell:open-external',
  listExternalOpenTargets: 'shell:list-external-open-targets',
  openPathWithTarget: 'shell:open-path-with-target',
  revealPathInFolder: 'shell:reveal-path-in-folder',
} as const

export type DesktopExternalOpenTargetKind = 'editor' | 'file-explorer' | 'terminal'

export type DesktopExternalOpenTarget = {
  targetId: string
  label: string
  kind: DesktopExternalOpenTargetKind
  iconDataUrl?: string
}

export interface DesktopShellIpcBridge {
  openExternal(url: string): Promise<void>
  listExternalOpenTargets(targetPath: string): Promise<DesktopExternalOpenTarget[]>
  openPathWithTarget(targetPath: string, targetId: string): Promise<void>
  revealPathInFolder(targetPath: string): Promise<void>
}
