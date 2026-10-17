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
  dependencies.ipc.handle(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.website, async (event, input: unknown) => {
    if (!dependencies.isMainWindowSender(event.sender)) throw new Error('IPC 调用来源无效')
    try { return await dependencies.providerIcons.setWebsiteIcon(input) }
    catch { throw new Error('无法获取或保存网站图标，请确认公网 HTTPS 地址；原图标已保留') }
  })
  dependencies.ipc.handle(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.upload, async (event, input: unknown) => {
    if (!dependencies.isMainWindowSender(event.sender)) throw new Error('IPC 调用来源无效')
    try { return await dependencies.providerIcons.setUploadedIcon(input) }
    catch { throw new Error('无法保存供应商图标，请确认图片格式受支持且不超过 512 KB') }
  })
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
