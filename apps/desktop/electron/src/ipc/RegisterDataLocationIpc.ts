import { dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { DESKTOP_DATA_LOCATION_IPC_CHANNELS } from '@pidex/shared/desktop-data-location-ipc'
import type { DataLocationStore } from '../settings/DataLocationStore.js'
import type { WindowManager } from '../windows/WindowManager.js'

type DataLocationIpcDependencies = {
  store: DataLocationStore
  windows: WindowManager
  installDirectory: string
  relaunch: () => void
}

export function registerDataLocationIpc(dependencies: DataLocationIpcDependencies): void {
  const { store, windows, installDirectory, relaunch } = dependencies
  ipcMain.handle(DESKTOP_DATA_LOCATION_IPC_CHANNELS.get, (event) => {
    requireApplicationWindow(event.sender, windows)
    return store.state()
  })
  ipcMain.handle(
    DESKTOP_DATA_LOCATION_IPC_CHANNELS.choose,
    async (event, workspaceRoots: unknown) => {
      const owner = requireApplicationWindow(event.sender, windows)
      const options: OpenDialogOptions = {
        title: '选择 Pidex 用户数据的父目录',
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = await dialog.showOpenDialog(owner, options)
      const selected = result.canceled ? null : (result.filePaths[0] ?? null)
      if (!selected) return null
      const change = await store.schedule(
        selected,
        installDirectory,
        normalizeWorkspaceRoots(workspaceRoots),
      )
      setImmediate(relaunch)
      return change
    },
  )
  ipcMain.handle(DESKTOP_DATA_LOCATION_IPC_CHANNELS.retry, (event) => {
    requireApplicationWindow(event.sender, windows)
    setImmediate(relaunch)
  })
  ipcMain.handle(DESKTOP_DATA_LOCATION_IPC_CHANNELS.restore, async (event) => {
    requireApplicationWindow(event.sender, windows)
    await store.restoreActive()
    setImmediate(relaunch)
  })
}

function normalizeWorkspaceRoots(value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value) ||
    value.length > 1_000 ||
    value.some((path) => typeof path !== 'string' || path.length > 32_768)
  ) {
    throw new Error('工作区路径列表无效')
  }
  return value
}

function requireApplicationWindow(
  sender: Electron.WebContents,
  windows: WindowManager,
): Electron.BrowserWindow {
  const owner = windows.windowForSender(sender)
  if (!owner) {
    throw new Error('IPC 调用来源无效')
  }
  return owner
}
