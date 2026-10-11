import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  DESKTOP_WINDOW_IPC_CHANNELS,
  normalizeDesktopOpenWindowInput,
} from '@pidex/shared/desktop-window-ipc'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

describe('desktop multi-window contract', () => {
  test('validates controlled home and thread window inputs', () => {
    expect(DESKTOP_WINDOW_IPC_CHANNELS.openWindow).toBe('window:open')
    expect(normalizeDesktopOpenWindowInput({ kind: 'home' })).toEqual({
      kind: 'home',
    })
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'thread',
        threadId: 'thread:1',
      }),
    ).toEqual({ kind: 'thread', threadId: 'thread:1' })
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'thread',
        threadId: ' ',
      }),
    ).toBeNull()
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'thread',
        threadId: 'x'.repeat(513),
      }),
    ).toBeNull()
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'url',
        url: 'https://example.com',
      }),
    ).toBeNull()
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'home',
        unexpected: 'value',
      }),
    ).toBeNull()
    expect(
      normalizeDesktopOpenWindowInput({
        kind: 'thread',
        threadId: 'thread:1',
        unexpected: 'value',
      }),
    ).toBeNull()
  })

  test('preload exposes typed fixed-channel window operations', async () => {
    const preload = await readSource('../src/preload.cts')
    expectSourceContains(preload, 'openWindow: "window:open"')
    expectSourceContains(
      preload,
      'ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.openWindow, input)',
    )
    expect(DESKTOP_WINDOW_IPC_CHANNELS.getPageZoom).toBe('window:page-zoom:get')
    expect(DESKTOP_WINDOW_IPC_CHANNELS.changePageZoom).toBe('window:page-zoom:change')
    expect(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged).toBe('window:page-zoom:changed')
    expect(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged).toBe('window:resize-state-changed')
    expectSourceContains(
      preload,
      'ipcRenderer.invoke(DESKTOP_WINDOW_IPC_CHANNELS.changePageZoom, action)',
    )
    expectSourceContains(
      preload,
      'ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.pageZoomChanged, handler)',
    )
    expectSourceContains(
      preload,
      'ipcRenderer.on(DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged, handler)',
    )
    expectSourceContains(preload, 'if (typeof resizing === "boolean") listener(resizing)')
    expectSourceContains(
      preload,
      'ipcRenderer.removeListener(\n        DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged',
    )
  })

  test('managed windows share the hardened BrowserWindow configuration', async () => {
    const source = await readSource('../src/windows/WindowManager.ts')
    expectSourceContains(source, 'readonly #applicationWindows = new Map<number, BrowserWindow>()')
    expectSourceContains(source, 'contextIsolation: true')
    expectSourceContains(source, 'nodeIntegration: false')
    expectSourceContains(source, 'sandbox: true')
    expectSourceContains(source, 'webSecurity: true')
    expectSourceContains(source, 'createWindowsTitleBarOverlay')
    expectSourceContains(source, '#/threads/${encodeURIComponent(input.threadId)}')
    expect(source.match(/window\.on\(['"]will-resize['"]/g)).toHaveLength(1)
    expect(source.match(/window\.on\(['"]resized['"]/g)).toHaveLength(1)
    expectSourceContains(
      source,
      'if (manualResizeActive || window.webContents.isDestroyed()) return',
    )
    expectSourceContains(source, 'DESKTOP_WINDOW_IPC_CHANNELS.resizeStateChanged')
  })

  test('原生缩放发出配对的 resize activity 并带 revision', async () => {
    const source = await readSource('../src/windows/WindowManager.ts')
    expectSourceContains(source, 'DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity')
    expectSourceContains(source, 'windowId: window.id')
    expectSourceContains(source, 'revision: resizeActivityRevision')
    expectSourceContains(source, 'sendResizeActivity("start")')
    expectSourceContains(source, 'sendResizeActivity("end")')
    // 取消拖拽时 resized 不再触发，必须由静默间隔补齐一次 end，保证 start/end 配对。
    expectSourceContains(source, 'RESIZE_SETTLE_MS')
    expectSourceContains(source, 'const armResizeSettleTimer')
    expectSourceContains(source, 'if (manualResizeActive) armResizeSettleTimer()')
    expectSourceContains(source, 'const finishManualResize')
    // 窗口关闭时停止结算定时器，避免已销毁窗口继续发事件。
    expectSourceContains(source, 'clearResizeSettleTimer()')
  })

  test('resize activity 通道在共享契约与 preload 中一致', async () => {
    const preload = await readSource('../src/preload.cts')
    expect(DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity).toBe('window:resize-activity')
    expectSourceContains(preload, 'resizeActivity: "window:resize-activity"')
    expectSourceContains(preload, 'onWindowResizeActivity:')
    expectSourceContains(preload, 'isDesktopResizeActivity(activity)')
    expectSourceContains(preload, 'DESKTOP_WINDOW_IPC_CHANNELS.resizeActivity')
  })

  test('window controls and dialogs resolve the invoking managed window', async () => {
    const source = await readSource('../src/ipc/RegisterDesktopIpc.ts')
    const handlers = source.slice(
      source.indexOf('DESKTOP_WINDOW_IPC_CHANNELS.openWindow'),
      source.indexOf('DESKTOP_UPDATE_IPC_CHANNELS.check'),
    )
    expectSourceContains(handlers, 'windows.openWindow(normalized)')
    expectSourceContains(handlers, 'requireMainWindowSender(event, windows).minimize()')
    expectSourceContains(handlers, 'const target = requireMainWindowSender(event, windows)')
    expectSourceContains(handlers, 'requireMainWindowSender(event, windows).close()')
    expectSourceContains(handlers, 'requireMainWindowSender(event, windows)')
    expectSourceContains(handlers, 'isDesktopPageZoomAction(action)')
    expectSourceContains(handlers, 'windows.changePageZoom(action)')
    expectSourceNotContains(handlers, 'windows.mainWindow')
    expectSourceContains(source, 'return windows.requireApplicationWindow(event.sender)')
    expectSourceContains(source, 'dialog.showOpenDialog(ownerWindow, options)')
  })
})

async function readSource(relativePath: string): Promise<string> {
  const content = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
  return content.replace(/\r\n/g, '\n')
}
