import { app, BrowserWindow, nativeTheme } from 'electron'
import { DESKTOP_APPEARANCE_IPC_CHANNELS } from '@pidex/shared/desktop-appearance-ipc'
import type { DesktopChromeTheme, DesktopThemeSettingsV7 } from '@pidex/shared/desktop-theme'
import { resolveStartupPageTheme } from './StartupPage.js'

export type SystemThemeVariant = 'light' | 'dark'

export class WindowAppearanceController {
  #currentSettings: DesktopThemeSettingsV7
  #themeChangeCallback?: (
    theme: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'> & {
      surfaceUnder: string
    },
  ) => void

  constructor(initialSettings: DesktopThemeSettingsV7) {
    this.#currentSettings = initialSettings
  }

  onThemeChange(
    callback: (
      theme: Pick<DesktopChromeTheme, 'surface' | 'ink' | 'accent'> & {
        surfaceUnder: string
      },
    ) => void,
  ): void {
    this.#themeChangeCallback = callback
  }

  updateSettings(settings: DesktopThemeSettingsV7): void {
    this.#currentSettings = settings
    this.#notifyThemeChange()
  }

  #notifyThemeChange(): void {
    const resolved = resolveStartupPageTheme(this.#currentSettings, this.systemThemeVariant())
    this.#themeChangeCallback?.(resolved.theme)
  }

  registerThemeBroadcast(): void {
    nativeTheme.on('updated', this.#broadcastSystemTheme)
    app.once('will-quit', () => {
      nativeTheme.removeListener('updated', this.#broadcastSystemTheme)
    })
  }

  systemThemeVariant(): SystemThemeVariant {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  broadcastAppearanceSettings(settings: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('appearance:settings:changed', settings)
      }
    }
  }

  readonly #broadcastSystemTheme = (): void => {
    const variant = this.systemThemeVariant()
    this.#notifyThemeChange()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(DESKTOP_APPEARANCE_IPC_CHANNELS.systemThemeChanged, variant)
      }
    }
  }
}
