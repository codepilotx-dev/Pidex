import { isRecord } from './Guards'
export const DESKTOP_CLIPBOARD_IPC_CHANNELS = {
  writeText: 'clipboard:write-text',
  writeRichText: 'clipboard:write-rich-text',
  copyProviderApiKey: 'clipboard:copy-provider-api-key',
} as const

export const DESKTOP_CLIPBOARD_TEXT_MAX_BYTES = 16 * 1024 * 1024

export const DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS = 60_000 as const

export type DesktopClipboardTextInput = {
  text: string
}

export type DesktopClipboardRichTextInput = {
  text: string
  html: string
}

export type DesktopSensitiveClipboardResult = {
  clearAfterMs: typeof DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS
}

export interface DesktopClipboardIpcBridge {
  writeClipboardText(input: DesktopClipboardTextInput): Promise<void>
  writeClipboardRichText(input: DesktopClipboardRichTextInput): Promise<void>
  copyProviderApiKey(credentialId: string): Promise<DesktopSensitiveClipboardResult>
}

// IPC 边界校验：只返回契约定义的精确字段，不透传额外字段；错误使用
// 固定非敏感消息，不回显文本内容。纯文本允许空字符串，但 UTF-8 字节数
// 不得超过上限；富文本要求 text/html 均为字符串且合计 UTF-8 字节数受限。
export function normalizeDesktopClipboardTextInput(
  value: unknown,
): DesktopClipboardTextInput | null {
  if (!isRecord(value)) return null
  if (typeof value.text !== 'string') return null
  if (utf8ByteLength(value.text) > DESKTOP_CLIPBOARD_TEXT_MAX_BYTES) return null
  return { text: value.text }
}

export function normalizeDesktopClipboardRichTextInput(
  value: unknown,
): DesktopClipboardRichTextInput | null {
  if (!isRecord(value)) return null
  if (typeof value.text !== 'string') return null
  if (typeof value.html !== 'string') return null
  if (utf8ByteLength(value.text) + utf8ByteLength(value.html) > DESKTOP_CLIPBOARD_TEXT_MAX_BYTES) {
    return null
  }
  return { text: value.text, html: value.html }
}

export function requireDesktopClipboardTextInput(value: unknown): DesktopClipboardTextInput {
  const input = normalizeDesktopClipboardTextInput(value)
  if (!input) throw new Error('剪贴板文本输入无效')
  return input
}

export function requireDesktopClipboardRichTextInput(
  value: unknown,
): DesktopClipboardRichTextInput {
  const input = normalizeDesktopClipboardRichTextInput(value)
  if (!input) throw new Error('剪贴板富文本输入无效')
  return input
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
