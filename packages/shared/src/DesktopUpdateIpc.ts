export const DESKTOP_UPDATE_IPC_CHANNELS = {
  check: 'desktop-update:check',
  download: 'desktop-update:download',
  quitAndInstall: 'desktop-update:quit-and-install',
  status: 'desktop-update:status',
} as const

export type DesktopUpdateStatus =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; percent: number }
  | { phase: 'downloaded' }
  | { phase: 'no-update' }
  | { phase: 'error'; message: string }

export interface DesktopUpdateIpcBridge {
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): Promise<void>
  onUpdateStatusChange(listener: (status: DesktopUpdateStatus) => void): () => void
}
