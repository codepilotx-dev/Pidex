import { describe, expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { DESKTOP_PROVIDER_ICON_IPC_CHANNELS } from '../../../../packages/shared/src/DesktopProviderIconIpc'
import { expectSourceContains } from './SourceContract.js'

mock.module('@pidex/shared/desktop-provider-icon-ipc', () => ({
  DESKTOP_PROVIDER_ICON_IPC_CHANNELS,
}))

const { registerProviderIconIpc } = await import('../src/ipc/RegisterProviderIconIpc')

describe('供应商图标 IPC 契约', () => {
  test('preload literal 与共享通道保持一致', async () => {
    expect(DESKTOP_PROVIDER_ICON_IPC_CHANNELS).toEqual({
      resolve: 'desktop-provider-icon:resolve',
      changed: 'desktop-provider-icon:changed',
    })

    const preload = await readFile(resolve(import.meta.dir, '../src/preload.cts'), 'utf8')
    expectSourceContains(preload, 'resolve: "desktop-provider-icon:resolve"')
    expectSourceContains(
      preload,
      'typeof import("@pidex/shared/desktop-provider-icon-ipc").DESKTOP_PROVIDER_ICON_IPC_CHANNELS',
    )
    expectSourceContains(
      preload,
      'ipcRenderer.invoke(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.resolve, input)',
    )
    expectSourceContains(preload, 'ipcRenderer.on(DESKTOP_PROVIDER_ICON_IPC_CHANNELS.changed')
  })

  test('解析前校验主窗口来源并透传原始输入', async () => {
    let handler:
      | ((event: IpcMainInvokeEvent, input: unknown) => Promise<{ source: string | null }>)
      | undefined
    const mainWindow = {} as WebContents
    const received: unknown[] = []
    registerProviderIconIpc({
      ipc: {
        handle: (_channel, registered) => {
          handler = registered as typeof handler
        },
      } as Pick<IpcMain, 'handle'>,
      isMainWindowSender: (sender) => sender === mainWindow,
      providerIcons: {
        resolve: async (input: unknown) => {
          received.push(input)
          return { source: 'data:image/svg+xml;base64,AAA' }
        },
      } as never,
    })

    const input = { url: 'https://models.dev/logos/openai.svg' }
    await expect(
      handler!({ sender: {} as WebContents } as IpcMainInvokeEvent, input),
    ).rejects.toThrow('IPC 调用来源无效')
    expect(received).toEqual([])

    await expect(handler!({ sender: mainWindow } as IpcMainInvokeEvent, input)).resolves.toEqual({
      source: 'data:image/svg+xml;base64,AAA',
    })
    expect(received).toEqual([input])
  })
})
