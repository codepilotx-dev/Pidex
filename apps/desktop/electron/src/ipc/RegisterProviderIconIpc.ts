import type { IpcMain, WebContents } from 'electron'
import {
  DESKTOP_PROVIDER_ICON_IPC_CHANNELS,
  type DesktopProviderIconResolveInput,
} from '@pidex/shared/desktop-provider-icon-ipc'
import type { ProviderIconCacheService } from './ProviderIconCacheService.js'

interface ProviderIconIpcDependencies {
  ipc: Pick<IpcMain, 'handle'>
  isMainWindowSender: (sender: WebContents) => boolean
  providerIcons: ProviderIconCacheService
}

export function registerProviderIconIpc(dependencies: ProviderIconIpcDependencies): void {
  dependencies.ipc.handle(
    DESKTOP_PROVIDER_ICON_IPC_CHANNELS.resolve,
    async (event, input: DesktopProviderIconResolveInput) => {
      if (!dependencies.isMainWindowSender(event.sender)) {
        throw new Error('IPC 调用来源无效')
      }
      return dependencies.providerIcons.resolve(input)
    },
  )
}
