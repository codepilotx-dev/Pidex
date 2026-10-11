export const DESKTOP_STARTUP_IPC_CHANNELS = {
  openLogs: 'startup:open-logs',
  quit: 'startup:quit',
} as const

export interface DesktopStartupIpcBridge {
  openLogDirectory(): Promise<string>
  quitDuringStartup(): Promise<void>
}
