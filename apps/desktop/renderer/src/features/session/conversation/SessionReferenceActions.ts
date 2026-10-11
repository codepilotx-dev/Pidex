import { buildThreadDeepLink } from '@pidex/shared/thread-reference'
import { desktopClipboard } from '../../../services/desktop-client/index.js'

export const SESSION_REFERENCE_COPY_ERROR = 'Failed to copy the session reference to the clipboard.'

export const SESSION_REFERENCE_SHORTCUTS = {
  workspaceCwd: 'Ctrl+Shift+C',
  threadId: 'Ctrl+Alt+C',
  threadDeepLink: 'Ctrl+Alt+L',
} as const

export const SESSION_REFERENCE_SHORTCUT_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '.cm-editor',
  '.CodeMirror',
  '[data-terminal-keyboard-capture]',
  '.xterm',
  '[data-component="thread-composer-dock"]',
].join(',')

export type SessionReferenceContext = {
  workspaceCwd: string
  threadId: string
}

export type SessionReferencePayload =
  | { kind: 'workspaceCwd'; workspaceCwd: string }
  | { kind: 'threadId'; threadId: string }
  | { kind: 'threadDeepLink'; threadId: string }

export type SessionReferenceShortcutEvent = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  keyCode?: number
  target?: unknown
}

export type SessionReferenceCopyDeps = {
  writeText: (text: string) => Promise<void>
  reportError: (error: Error) => void
}

export function resolveSessionReferenceShortcut(
  event: SessionReferenceShortcutEvent,
  context: SessionReferenceContext,
): SessionReferencePayload | null {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) {
    return null
  }
  if (!event.ctrlKey || event.metaKey) {
    return null
  }
  if (isSessionReferenceShortcutTarget(event.target)) {
    return null
  }
  const key = event.key.toLowerCase()
  if (event.shiftKey && !event.altKey && key === 'c') {
    return { kind: 'workspaceCwd', workspaceCwd: context.workspaceCwd }
  }
  if (!event.shiftKey && event.altKey && key === 'c') {
    return { kind: 'threadId', threadId: context.threadId }
  }
  if (!event.shiftKey && event.altKey && key === 'l') {
    return { kind: 'threadDeepLink', threadId: context.threadId }
  }
  return null
}

export function isSessionReferenceShortcutTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') {
    return false
  }
  const closest = (target as { closest?: (selector: string) => unknown }).closest
  if (typeof closest !== 'function') {
    return false
  }
  return Boolean(closest.call(target, SESSION_REFERENCE_SHORTCUT_TARGET_SELECTOR))
}

export async function copyWorkspaceCwd(
  workspaceCwd: string,
  deps?: SessionReferenceCopyDeps,
): Promise<void> {
  await copySessionReference({ kind: 'workspaceCwd', workspaceCwd }, deps)
}

export async function copyThreadId(
  threadId: string,
  deps?: SessionReferenceCopyDeps,
): Promise<void> {
  await copySessionReference({ kind: 'threadId', threadId }, deps)
}

export async function copyThreadDeepLink(
  threadId: string,
  deps?: SessionReferenceCopyDeps,
): Promise<void> {
  await copySessionReference({ kind: 'threadDeepLink', threadId }, deps)
}

export async function copySessionReference(
  payload: SessionReferencePayload,
  deps?: SessionReferenceCopyDeps,
): Promise<void> {
  const { writeText, reportError } = deps ?? defaultCopyDeps()
  try {
    await writeText(sessionReferenceClipboardText(payload))
  } catch {
    reportError(new Error(SESSION_REFERENCE_COPY_ERROR))
  }
}

function sessionReferenceClipboardText(payload: SessionReferencePayload): string {
  switch (payload.kind) {
    case 'workspaceCwd':
      return payload.workspaceCwd
    case 'threadId':
      return payload.threadId
    case 'threadDeepLink':
      return buildThreadDeepLink(payload.threadId)
  }
}

function defaultCopyDeps(): SessionReferenceCopyDeps {
  return {
    writeText: (text: string): Promise<void> => desktopClipboard.writeText(text),
    reportError: (error: Error): void => {
      window.dispatchEvent(new CustomEvent('desktop:error', { detail: error }))
    },
  }
}
