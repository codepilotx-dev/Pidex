import { ipcMain, type WebContents } from 'electron'
import {
  DESKTOP_TERMINAL_IPC_CHANNELS,
  type AckDesktopTerminalOutputInput,
  type AttachDesktopTerminalInput,
  type CloseDesktopTerminalForThreadInput,
  type CloseDesktopTerminalInput,
  type EnsureDesktopTerminalInput,
  type ResizeDesktopTerminalInput,
  type WriteDesktopTerminalInput,
} from '@pidex/shared/desktop-terminal-ipc'
import type { TerminalManager } from '../terminal/TerminalManager.js'
import { TerminalError } from '../terminal/TerminalErrors.js'
import { requireRunTerminalActionInput } from './TerminalActionInput.js'
import { isRecord } from '@pidex/shared/guards'

interface TerminalIpcDependencies {
  manager: TerminalManager
  isMainWindowSender: (sender: WebContents) => boolean
}

export function registerTerminalIpc(dependencies: TerminalIpcDependencies): void {
  const { manager, isMainWindowSender } = dependencies
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.listProfiles, (event) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    return manager.listProfiles()
  })
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.ensure, async (event, input: unknown) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    return manager.ensure(requireEnsureInput(input))
  })
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.attach, (event, input: unknown) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireAttachInput(input)
    return manager.attach(value.terminalId, value.instanceId, value.afterSequence)
  })
  ipcMain.on(DESKTOP_TERMINAL_IPC_CHANNELS.write, (event, input: unknown) => {
    try {
      requireMainWindowSender(event.sender, isMainWindowSender)
      const value = requireWriteInput(input)
      manager.write(value.terminalId, value.instanceId, value.data)
    } catch {
      // Fire-and-forget terminal input must never surface as an uncaught
      // EventEmitter exception in the Electron main process.
    }
  })
  ipcMain.on(DESKTOP_TERMINAL_IPC_CHANNELS.resize, (event, input: unknown) => {
    try {
      requireMainWindowSender(event.sender, isMainWindowSender)
      const value = requireResizeInput(input)
      manager.resize(value.terminalId, value.instanceId, value.cols, value.rows)
    } catch {
      // A stale resize is expected while a terminal is closing.
    }
  })
  ipcMain.on(DESKTOP_TERMINAL_IPC_CHANNELS.ack, (event, input: unknown) => {
    try {
      requireMainWindowSender(event.sender, isMainWindowSender)
      const value = requireAckInput(input)
      manager.ack(value.terminalId, value.instanceId, value.sequence, value.characters)
    } catch {
      // Fire-and-forget 流量控制确认：非法输入只丢弃，不影响终端内容与顺序。
    }
  })
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.close, async (event, input: unknown) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireCloseInput(input)
    return manager.close(value.terminalId, value.instanceId, value.reason)
  })
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.closeThread, async (event, input: unknown) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    const value = requireCloseThreadInput(input)
    return manager.closeThread(value.threadId, value.reason)
  })
  ipcMain.handle(DESKTOP_TERMINAL_IPC_CHANNELS.runAction, async (event, input: unknown) => {
    requireMainWindowSender(event.sender, isMainWindowSender)
    return manager.runAction(requireRunTerminalActionInput(input))
  })
}

function requireEnsureInput(value: unknown): EnsureDesktopTerminalInput {
  if (!isRecord(value)) invalidInput()
  const allowedKeys = new Set(['threadId', 'profileId', 'cols', 'rows', 'terminalId', 'cwd'])
  if (!Object.keys(value).every((key) => allowedKeys.has(key)) || !isIdentifier(value.threadId)) {
    invalidInput()
  }
  if (value.terminalId !== undefined && !isIdentifier(value.terminalId)) invalidInput()
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd.trim()))
    invalidInput()
  if (!(value.profileId === null || isIdentifier(value.profileId))) invalidInput()
  if (!isTerminalSize(value.cols, value.rows)) invalidInput()
  return value as unknown as EnsureDesktopTerminalInput
}

function requireAttachInput(value: unknown): AttachDesktopTerminalInput {
  if (
    !isExactRecord(value, ['terminalId', 'instanceId', 'afterSequence']) ||
    !isIdentifier(value.terminalId) ||
    !isIdentifier(value.instanceId) ||
    !Number.isSafeInteger(value.afterSequence) ||
    Number(value.afterSequence) < -1
  )
    invalidInput()
  return value as unknown as AttachDesktopTerminalInput
}

function requireWriteInput(value: unknown): WriteDesktopTerminalInput {
  if (
    !isExactRecord(value, ['terminalId', 'instanceId', 'data']) ||
    !isIdentifier(value.terminalId) ||
    !isIdentifier(value.instanceId) ||
    typeof value.data !== 'string' ||
    Buffer.byteLength(value.data, 'utf8') > 65_536
  )
    invalidInput()
  return value as unknown as WriteDesktopTerminalInput
}

function requireResizeInput(value: unknown): ResizeDesktopTerminalInput {
  if (
    !isExactRecord(value, ['terminalId', 'instanceId', 'cols', 'rows']) ||
    !isIdentifier(value.terminalId) ||
    !isIdentifier(value.instanceId) ||
    !isTerminalSize(value.cols, value.rows)
  )
    invalidInput()
  return value as unknown as ResizeDesktopTerminalInput
}

function requireAckInput(value: unknown): AckDesktopTerminalOutputInput {
  if (
    !isExactRecord(value, ['terminalId', 'instanceId', 'sequence', 'characters']) ||
    !isIdentifier(value.terminalId) ||
    !isIdentifier(value.instanceId) ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 0 ||
    !Number.isSafeInteger(value.characters) ||
    Number(value.characters) < 0
  )
    invalidInput()
  return value as unknown as AckDesktopTerminalOutputInput
}

function requireCloseInput(value: unknown): CloseDesktopTerminalInput {
  if (!isRecord(value)) invalidInput()
  const allowedKeys = new Set(['terminalId', 'instanceId', 'reason'])
  if (!Object.keys(value).every((key) => allowedKeys.has(key))) invalidInput()
  if (!isIdentifier(value.terminalId)) invalidInput()
  if (value.instanceId !== undefined && !isIdentifier(value.instanceId)) invalidInput()
  if (!['user-close', 'task-close', 'workspace-delete'].includes(String(value.reason)))
    invalidInput()
  return value as unknown as CloseDesktopTerminalInput
}

function requireCloseThreadInput(value: unknown): CloseDesktopTerminalForThreadInput {
  if (
    !isExactRecord(value, ['threadId', 'reason']) ||
    !isIdentifier(value.threadId) ||
    !['user-close', 'task-close', 'workspace-delete'].includes(String(value.reason))
  )
    invalidInput()
  return value as unknown as CloseDesktopTerminalForThreadInput
}

function isTerminalSize(cols: unknown, rows: unknown): boolean {
  return (
    Number.isSafeInteger(cols) &&
    Number(cols) >= 2 &&
    Number(cols) <= 500 &&
    Number.isSafeInteger(rows) &&
    Number(rows) >= 1 &&
    Number(rows) <= 300
  )
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}

function invalidInput(): never {
  throw new TerminalError('TERMINAL_CONTEXT_STALE', '终端参数无效')
}

function requireMainWindowSender(
  sender: WebContents,
  isAllowed: (sender: WebContents) => boolean,
): void {
  if (!isAllowed(sender)) throw new Error('IPC 调用来源无效')
}
