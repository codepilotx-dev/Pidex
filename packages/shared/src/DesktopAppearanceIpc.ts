import type { DesktopThemeSettingsV7, DesktopThemeVariant } from './DesktopTheme.js'

export const DESKTOP_APPEARANCE_IPC_CHANNELS = {
  getSettings: 'appearance:settings:get',
  saveSettings: 'appearance:settings:save',
  getSystemTheme: 'appearance:system-theme:get',
  getStartupThemeSeed: 'appearance:startup-theme-seed:get',
  systemThemeChanged: 'appearance:system-theme:changed',
  canRestorePreviousAppearance: 'appearance:previous-appearance:can-restore',
  restorePreviousAppearance: 'appearance:previous-appearance:restore',
  applyNewDesignTheme: 'appearance:new-design-theme:apply',
} as const

export interface DesktopStartupThemeSeed {
  version: 1
  variant: DesktopThemeVariant
  surface: `#${string}`
  ink: `#${string}`
}

export interface DesktopAppearanceIpcBridge<CodeThemeId extends string = string> {
  getAppearanceSettings(): Promise<DesktopThemeSettingsV7<CodeThemeId>>
  saveAppearanceSettings(settings: DesktopThemeSettingsV7<CodeThemeId>): Promise<void>
  getSystemTheme(): Promise<DesktopThemeVariant>
  onSystemThemeChange(listener: (variant: DesktopThemeVariant) => void): () => void
  canRestorePreviousAppearance(): Promise<boolean>
  restorePreviousAppearance(): Promise<DesktopThemeSettingsV7<CodeThemeId>>
  applyNewDesignTheme(): Promise<DesktopThemeSettingsV7<CodeThemeId>>
}
