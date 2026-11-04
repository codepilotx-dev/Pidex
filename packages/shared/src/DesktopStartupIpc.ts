export const DESKTOP_STARTUP_IPC_CHANNELS = {
  snapshot: 'startup:snapshot',
  changed: 'startup:changed',
  retry: 'startup:retry',
  openLogs: 'startup:open-logs',
  quit: 'startup:quit',
  stopBackendAndExit: 'startup:stop-backend-and-exit',
} as const

export interface DesktopStartupSnapshot {
  generation: number
  revision: number
  state: 'loading' | 'connected' | 'failed'
  label: string
}

export interface DesktopStartupIpcBridge {
  getStartupSnapshot(): Promise<DesktopStartupSnapshot>
  onStartupChanged(listener: (snapshot: DesktopStartupSnapshot) => void): () => void
  retryStartup(generation: number): Promise<void>
  openLogDirectory(): Promise<string>
  quitDuringStartup(): Promise<void>
  stopBackendAndExit?(): Promise<void>
}
