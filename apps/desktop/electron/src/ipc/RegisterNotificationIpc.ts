import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain, Notification } from 'electron'
import { DESKTOP_NOTIFICATION_IPC_CHANNELS } from '@pidex/shared/desktop-notification-ipc'
import type { WindowManager } from '../windows/WindowManager.js'
import {
  createShowNotificationHandler,
  type DesktopNotificationFactory,
  type DesktopNotificationService,
} from '../notifications/DesktopNotificationService.js'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))

export function registerNotificationIpc(
  windows: WindowManager,
  service: DesktopNotificationService,
): void {
  const handler = createShowNotificationHandler({
    isMainSender: (sender) => windows.isApplicationSender(sender as Electron.WebContents),
    service,
  })
  ipcMain.handle(DESKTOP_NOTIFICATION_IPC_CHANNELS.show, (event, payload: unknown) =>
    handler(event.sender, payload),
  )
}

// 桌面通知只接受主窗口 sender；preload 用字面量 channel 防止 drift。
export function createElectronNotificationFactory(): DesktopNotificationFactory {
  return {
    isSupported: () => Notification.isSupported(),
    create: (options) => {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        icon: options.icon,
      })
      return {
        show: () => notification.show(),
        onClick: (listener) => notification.on('click', listener),
        onClose: (listener) => notification.on('close', listener),
        onFailed: (listener) => notification.on('failed', (_event, error) => listener(error)),
      }
    },
  }
}

export function resolveNotificationIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : resolve(moduleDirectory, '../../build/icon.ico')
}

export function publishNotificationActivation(
  windows: WindowManager | undefined,
  activation: { notificationId: string; threadId: string },
): void {
  windows?.sendToFocused(DESKTOP_NOTIFICATION_IPC_CHANNELS.activated, activation)
}
