import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DESKTOP_ATTACHMENT_IPC_CHANNELS } from '@pidex/shared/desktop-attachment-ipc'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

describe('用户附件 IPC 契约', () => {
  test('preload literal 与共享通道保持一致', async () => {
    expect(DESKTOP_ATTACHMENT_IPC_CHANNELS).toEqual({
      saveToDownloads: 'desktop-attachment:save-to-downloads',
      chooseComposerFiles: 'desktop-attachment:choose-composer-files',
      grantComposerPaths: 'desktop-attachment:grant-composer-paths',
      readComposerPathGrant: 'desktop-attachment:read-composer-path-grant',
      listComposerPathGrant: 'desktop-attachment:list-composer-path-grant',
    })
    const preload = await readSource('../src/preload.cts')
    expectSourceContains(preload, 'saveToDownloads: "desktop-attachment:save-to-downloads"')
    expectSourceContains(
      preload,
      'typeof import("@pidex/shared/desktop-attachment-ipc").DESKTOP_ATTACHMENT_IPC_CHANNELS',
    )
    expectSourceContains(preload, 'webUtils.getPathForFile(file)')
    expectSourceContains(preload, 'pendingComposerDropPaths.has(path)')
    expectSourceNotContains(preload, 'readFile(')
  })

  test('下载 handler 在调用服务前校验主 renderer 来源', async () => {
    const source = await readSource('../src/ipc/RegisterDesktopIpc.ts')
    const handler = source.slice(
      source.indexOf('DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads'),
      source.indexOf('DESKTOP_WINDOW_IPC_CHANNELS.minimize'),
    )
    expectSourceContains(handler, 'requireMainWindowSender(event, windows)')
    expectSourceContains(handler, 'attachmentDownloads.save(input)')
  })

  test('Windows 文件入口只启用多文件选择，所有本地预览 handler 均校验主 renderer', async () => {
    const source = await readSource('../src/ipc/RegisterDesktopIpc.ts')
    const handlers = source.slice(
      source.indexOf('DESKTOP_ATTACHMENT_IPC_CHANNELS.chooseComposerFiles'),
      source.indexOf('DESKTOP_WINDOW_IPC_CHANNELS.openWindow'),
    )
    expectSourceContains(handlers, 'properties: ["openFile", "multiSelections"]')
    expectSourceNotContains(handlers, '"openDirectory"')
    expect(handlers.match(/requireMainWindowSender\(event, windows\)/g)?.length).toBe(4)
    expectSourceContains(handlers, 'composerPathGrants.grantPaths(event.sender.id')
    expectSourceContains(handlers, 'composerPathGrants.read(event.sender.id')
    expectSourceContains(handlers, 'composerPathGrants.list(event.sender.id')
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}
