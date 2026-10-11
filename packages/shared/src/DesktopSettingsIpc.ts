export const DESKTOP_SETTINGS_IPC_CHANNELS = {
  get: 'desktop-settings:get',
  save: 'desktop-settings:save',
  changed: 'desktop-settings:changed',
} as const

export type DesktopSettingsValue =
  | boolean
  | number
  | string
  | null
  | DesktopSettingsValue[]
  | { [key: string]: DesktopSettingsValue }

export type DesktopSettingsPayload = Record<string, DesktopSettingsValue>

export interface DesktopSettingsIpcBridge {
  getDesktopSettings(): Promise<DesktopSettingsPayload>
  saveDesktopSettings(settings: DesktopSettingsPayload): Promise<DesktopSettingsPayload>
  onDesktopSettingsChange(listener: (settings: DesktopSettingsPayload) => void): () => void
}
