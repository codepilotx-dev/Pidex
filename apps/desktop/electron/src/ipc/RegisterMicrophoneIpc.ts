import type { IpcMain, WebContents } from 'electron'
import { DESKTOP_MICROPHONE_IPC_CHANNELS } from '@pidex/shared/desktop-microphone-ipc'

export const WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL = 'ms-settings:privacy-microphone'

interface MicrophoneIpcDependencies {
  ipc: Pick<IpcMain, 'handle'>
  isMainWindowSender: (sender: WebContents) => boolean
  openMicrophonePrivacySettings: () => Promise<void>
}

export function registerMicrophoneIpc(dependencies: MicrophoneIpcDependencies): void {
  dependencies.ipc.handle(DESKTOP_MICROPHONE_IPC_CHANNELS.openPrivacySettings, async (event) => {
    if (!dependencies.isMainWindowSender(event.sender)) {
      throw new Error('IPC 调用来源无效')
    }
    await dependencies.openMicrophonePrivacySettings()
  })
}
