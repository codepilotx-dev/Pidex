import type {
  DesktopStoredSettings,
  DesktopSystemFontsResult,
  DesktopThemeSettings,
} from '../shared/Types.js'
import type { DesktopPetOverlayBridge } from '@pidex/shared/desktop-pet-overlay'
import type { DesktopDataLocationIpcBridge } from '@pidex/shared/desktop-data-location-ipc'
import type { DesktopEditIpcBridge } from '@pidex/shared/desktop-edit-ipc'
import type { DesktopUpdateIpcBridge } from '@pidex/shared/desktop-update-ipc'
import type { DesktopTerminalIpcBridge } from '@pidex/shared/desktop-terminal-ipc'
import type { DesktopNotificationIpcBridge } from '@pidex/shared/desktop-notification-ipc'
import type { DesktopProviderIconIpcBridge } from '@pidex/shared/desktop-provider-icon-ipc'
import type { DesktopAttachmentIpcBridge } from '@pidex/shared/desktop-attachment-ipc'
import type { DesktopBrowserIpcBridge } from '@pidex/shared/desktop-browser-ipc'
import type { DesktopWindowIpcBridge } from '@pidex/shared/desktop-window-ipc'
import type { DesktopWorkspaceIpcBridge } from '@pidex/shared/desktop-workspace-ipc'
import type { DesktopShellIpcBridge } from '@pidex/shared/desktop-shell-ipc'
import type { DesktopClipboardIpcBridge } from '@pidex/shared/desktop-clipboard-ipc'
import type { DesktopStartupIpcBridge } from '@pidex/shared/desktop-startup-ipc'
import type { DesktopAppearanceIpcBridge } from '@pidex/shared/desktop-appearance-ipc'
import type { DesktopDeepLinkIpcBridge } from '@pidex/shared/desktop-deep-link-ipc'

declare global {
  const __PIDEX_VERSION__: string

  interface Window {
    DesktopBridge?: {
      listSystemFonts(): Promise<DesktopSystemFontsResult>
      getDesktopSettings(): Promise<DesktopStoredSettings>
      saveDesktopSettings(settings: DesktopStoredSettings): Promise<DesktopStoredSettings>
      onDesktopSettingsChange?(
        listener: (change: DesktopStoredSettings | { settings: DesktopStoredSettings }) => void,
      ): () => void
    } & DesktopPetOverlayBridge &
      DesktopDataLocationIpcBridge &
      DesktopEditIpcBridge &
      DesktopTerminalIpcBridge &
      DesktopUpdateIpcBridge &
      DesktopNotificationIpcBridge &
      DesktopProviderIconIpcBridge &
      DesktopAttachmentIpcBridge &
      DesktopBrowserIpcBridge &
      DesktopWindowIpcBridge &
      DesktopWorkspaceIpcBridge &
      DesktopShellIpcBridge &
      DesktopClipboardIpcBridge &
      DesktopStartupIpcBridge &
      DesktopAppearanceIpcBridge<DesktopThemeSettings['codeThemeIds']['light']> &
      DesktopDeepLinkIpcBridge
  }
}

declare module '*.css'

export {}
