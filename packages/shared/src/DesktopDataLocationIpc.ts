export const DESKTOP_DATA_LOCATION_IPC_CHANNELS = {
  get: 'desktop-data-location:get',
  choose: 'desktop-data-location:choose',
  retry: 'desktop-data-location:retry',
  restore: 'desktop-data-location:restore',
} as const

export type DesktopDataLocationControlSource = 'default' | 'bootstrap' | 'env'

export type DesktopDataLocationState = {
  defaultDataDir: string
  currentDataDir: string
  pendingDataDir: string | null
  controlSource: DesktopDataLocationControlSource
  isEnvControlled: boolean
}

export type DesktopDataLocationChange = {
  sourceDataDir: string
  targetDataDir: string
  restartScheduled: true
}

export interface DesktopDataLocationIpcBridge {
  getDataLocation(): Promise<DesktopDataLocationState>
  chooseDataLocation(workspaceRoots?: readonly string[]): Promise<DesktopDataLocationChange | null>
  retryDataLocation(): Promise<void>
  restoreDataLocation(): Promise<void>
}
