import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { DESKTOP_MICROPHONE_IPC_CHANNELS } from '../../../../packages/shared/src/DesktopMicrophoneIpc'
import { expectSourceContains } from './SourceContract.js'

mock.module('@pidex/shared/desktop-microphone-ipc', () => ({
  DESKTOP_MICROPHONE_IPC_CHANNELS,
}))

const { registerMicrophoneIpc, WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL } =
  await import('../src/ipc/RegisterMicrophoneIpc')

describe('desktop microphone IPC', () => {
  test('uses one fixed, typed Windows privacy-settings action', () => {
    expect(DESKTOP_MICROPHONE_IPC_CHANNELS).toEqual({
      openPrivacySettings: 'desktop-microphone:open-privacy-settings',
    })
    expect(WINDOWS_MICROPHONE_PRIVACY_SETTINGS_URL).toBe('ms-settings:privacy-microphone')

    const preload = readFileSync(resolve(import.meta.dir, '../src/preload.cts'), 'utf8')
    expectSourceContains(
      preload,
      'typeof import("@pidex/shared/desktop-microphone-ipc").DESKTOP_MICROPHONE_IPC_CHANNELS',
    )
    expectSourceContains(
      preload,
      'ipcRenderer.invoke(DESKTOP_MICROPHONE_IPC_CHANNELS.openPrivacySettings)',
    )
  })

  test('only opens settings for the main-window sender', async () => {
    let handler: ((event: IpcMainInvokeEvent) => Promise<void>) | undefined
    const mainWindow = {} as WebContents
    let opens = 0
    registerMicrophoneIpc({
      ipc: {
        handle: (_channel, registered) => {
          handler = registered as typeof handler
        },
      } as Pick<IpcMain, 'handle'>,
      isMainWindowSender: (sender) => sender === mainWindow,
      openMicrophonePrivacySettings: async () => {
        opens += 1
      },
    })

    await expect(handler!({ sender: {} as WebContents } as IpcMainInvokeEvent)).rejects.toThrow(
      'IPC 调用来源无效',
    )
    expect(opens).toBe(0)

    await handler!({ sender: mainWindow } as IpcMainInvokeEvent)
    expect(opens).toBe(1)
  })
})
