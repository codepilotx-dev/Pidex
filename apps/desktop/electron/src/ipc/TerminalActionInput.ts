import type { RunDesktopTerminalActionInput } from '@pidex/shared/desktop-terminal-ipc'
import { TerminalError } from '../terminal/TerminalErrors.js'
import { isRecord } from '@pidex/shared/guards'

export function requireRunTerminalActionInput(value: unknown): RunDesktopTerminalActionInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['threadId', 'actionName', 'profileId', 'cols', 'rows']) ||
    !isIdentifier(value.threadId) ||
    typeof value.actionName !== 'string' ||
    !value.actionName.trim() ||
    value.actionName.length > 200 ||
    !(value.profileId === null || isIdentifier(value.profileId)) ||
    !isTerminalSize(value.cols, value.rows)
  ) {
    throw new TerminalError('TERMINAL_CONTEXT_STALE', '终端参数无效')
  }
  return value as unknown as RunDesktopTerminalActionInput
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function isTerminalSize(cols: unknown, rows: unknown) {
  return (
    Number.isSafeInteger(cols) &&
    Number(cols) >= 2 &&
    Number(cols) <= 500 &&
    Number.isSafeInteger(rows) &&
    Number(rows) >= 1 &&
    Number(rows) <= 300
  )
}
