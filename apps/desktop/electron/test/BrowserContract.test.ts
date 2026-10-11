import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DESKTOP_BROWSER_IPC_CHANNELS } from '@pidex/shared/desktop-browser-ipc'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

describe('内置浏览器 IPC 契约', () => {
  test('preload literal 与共享通道保持一致', async () => {
    expect(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged).toBe('desktop-browser:state-changed')
    const preload = await readSource('../src/preload.cts')
    expectSourceContains(preload, 'getState: "desktop-browser:get-state"')
    expectSourceContains(preload, 'DESKTOP_BROWSER_IPC_CHANNELS')
  })

  test('所有 handler 都按受管 renderer 窗口隔离 Browser owner', async () => {
    const source = await readSource('../src/ipc/RegisterBrowserIpc.ts')
    expectSourceContains(source, 'const owner = senderWindow(event.sender)')
    expectSourceContains(source, 'if (!owner) throw new Error("IPC 调用来源无效")')
    expectSourceContains(source, 'controller.getState(owner, value.tabId)')
    expectSourceContains(
      source,
      'controller.createOrRestore(owner, value.tabId, value.url, value.sourceThreadId ?? null)',
    )
    expectSourceNotContains(source, 'ipcRenderer')
  })
})

function readSource(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}
