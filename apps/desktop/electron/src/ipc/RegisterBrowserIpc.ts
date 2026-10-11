import { ipcMain, type BrowserWindow, type WebContents } from 'electron'
import {
  DESKTOP_BROWSER_IPC_CHANNELS,
  type CreateOrRestoreDesktopBrowserInput,
  type DesktopBrowserTabInput,
  type NavigateDesktopBrowserInput,
  type SetDesktopBrowserBoundsInput,
  type SetDesktopBrowserVisibleInput,
} from '@pidex/shared/desktop-browser-ipc'
import type { DesktopBrowserController } from '../browser/BrowserController.js'
import { isRecord } from '@pidex/shared/guards'
import { requireBrowserUtility, requireBrowserData } from '../browser/BrowserManagementInput.js'
import { requireBrowserAnnotation } from '../browser/BrowserAnnotations.js'

interface BrowserIpcDependencies {
  controller: DesktopBrowserController
  windowForSender(sender: WebContents): BrowserWindow | undefined
}

export function registerBrowserIpc(dependencies: BrowserIpcDependencies): void {
  const { controller, windowForSender } = dependencies
  const senderWindow = (sender: WebContents): BrowserWindow => {
    const owner = windowForSender(sender)
    if (!owner) throw new Error('IPC 调用来源无效')
    return owner
  }

  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.list, (event) =>
    controller.list(senderWindow(event.sender)),
  )
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.utility, (event, input) =>
    controller.utility(senderWindow(event.sender), requireBrowserUtility(input)),
  )
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.annotation, (event, input) =>
    controller.annotation(senderWindow(event.sender), requireBrowserAnnotation(input)),
  )
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.data, (event, input) =>
    controller.data(senderWindow(event.sender), requireBrowserData(input)),
  )
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.attach, (event, value: unknown) => {
    if (
      !isExactRecord(value, ['tabId', 'generation', 'guestId']) ||
      !isIdentifier(value.tabId) ||
      !isIdentifier(value.generation) ||
      !Number.isSafeInteger(value.guestId)
    )
      invalidInput()
    return controller.attach(
      senderWindow(event.sender),
      value.tabId,
      value.generation,
      value.guestId as number,
    )
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.control, (event, value: unknown) => {
    if (
      !isExactRecord(value, ['tabId', 'threadId']) ||
      !isIdentifier(value.tabId) ||
      !(value.threadId === null || isIdentifier(value.threadId))
    )
      invalidInput()
    return controller.control(
      senderWindow(event.sender),
      value.tabId,
      value.threadId as string | null,
    )
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.layout, (event, value: unknown) => {
    if (
      !isExactRecord(value, ['tabId', 'panel', 'order']) ||
      !isIdentifier(value.tabId) ||
      !['right', 'bottom'].includes(String(value.panel)) ||
      typeof value.order !== 'number' ||
      !Number.isFinite(value.order)
    )
      invalidInput()
    return controller.layout(
      senderWindow(event.sender),
      value.tabId,
      value.panel as 'right' | 'bottom',
      value.order,
    )
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.permission, (event, value: unknown) => {
    if (
      !isExactRecord(value, ['origin', 'decision']) ||
      !isUrlInput(value.origin) ||
      !['allow', 'deny', 'remove'].includes(String(value.decision))
    )
      invalidInput()
    return controller.permission(
      senderWindow(event.sender),
      value.origin,
      value.decision as 'allow' | 'deny' | 'remove',
    )
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.getState, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.getState(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.createOrRestore, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireCreateInput(input)
    return controller.createOrRestore(owner, value.tabId, value.url, value.sourceThreadId ?? null)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.navigate, async (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireNavigateInput(input)
    return controller.navigate(owner, value.tabId, value.url)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.reload, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.reload(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.stop, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.stop(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.goBack, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.goBack(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.goForward, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.goForward(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.setBounds, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireBoundsInput(input)
    return controller.setBounds(owner, value.tabId, value.bounds)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.setVisible, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireVisibleInput(input)
    return controller.setVisible(owner, value.tabId, value.visible)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.focus, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    controller.focus(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.close, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.close(owner, value.tabId)
  })
  ipcMain.handle(DESKTOP_BROWSER_IPC_CHANNELS.clearAllowedSites, (event, input) => {
    const owner = senderWindow(event.sender)
    const value = requireTabInput(input)
    return controller.clearAllowedSites(owner, value.tabId)
  })
}

function requireTabInput(value: unknown): DesktopBrowserTabInput {
  if (!isExactRecord(value, ['tabId']) || !isIdentifier(value.tabId)) invalidInput()
  return value as unknown as DesktopBrowserTabInput
}

function requireCreateInput(value: unknown): CreateOrRestoreDesktopBrowserInput {
  if (!isRecord(value)) invalidInput()
  const keys = [
    'tabId',
    ...(value.url === undefined ? [] : ['url']),
    ...(value.sourceThreadId === undefined ? [] : ['sourceThreadId']),
  ]
  if (!(
    value.sourceThreadId === undefined ||
    value.sourceThreadId === null ||
    isIdentifier(value.sourceThreadId)
  ))
    invalidInput()
  if (
    !isExactRecord(value, keys) ||
    !isIdentifier(value.tabId) ||
    !(value.url === undefined || isUrlInput(value.url))
  )
    invalidInput()
  return value as unknown as CreateOrRestoreDesktopBrowserInput
}

function requireNavigateInput(value: unknown): NavigateDesktopBrowserInput {
  if (
    !isExactRecord(value, ['tabId', 'url']) ||
    !isIdentifier(value.tabId) ||
    !isUrlInput(value.url)
  )
    invalidInput()
  return value as unknown as NavigateDesktopBrowserInput
}

function requireBoundsInput(value: unknown): SetDesktopBrowserBoundsInput {
  if (
    !isExactRecord(value, ['tabId', 'bounds']) ||
    !isIdentifier(value.tabId) ||
    !isExactRecord(value.bounds, ['x', 'y', 'width', 'height']) ||
    ![value.bounds.x, value.bounds.y, value.bounds.width, value.bounds.height].every(
      (item) => typeof item === 'number' && Number.isFinite(item),
    )
  )
    invalidInput()
  return value as unknown as SetDesktopBrowserBoundsInput
}

function requireVisibleInput(value: unknown): SetDesktopBrowserVisibleInput {
  if (
    !isExactRecord(value, ['tabId', 'visible']) ||
    !isIdentifier(value.tabId) ||
    typeof value.visible !== 'boolean'
  )
    invalidInput()
  return value as unknown as SetDesktopBrowserVisibleInput
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function isUrlInput(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 8_192
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function invalidInput(): never {
  throw new Error('浏览器参数无效')
}
