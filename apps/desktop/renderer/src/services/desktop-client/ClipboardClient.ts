import type {
  DesktopClipboardIpcBridge,
  DesktopSensitiveClipboardResult,
} from '@pidex/shared/desktop-clipboard-ipc'

export type DesktopClipboard = {
  writeText(text: string): Promise<void>
  writeRichText(input: { text: string; html: string }): Promise<void>
  copyProviderApiKey(credentialId: string): Promise<DesktopSensitiveClipboardResult>
}

export type DesktopClipboardRichItem = {
  types: ReadonlyArray<string>
}

export type ClipboardTextarea = {
  value: string
  setAttribute(name: string, value: string): void
  style: Pick<CSSStyleDeclaration, 'position' | 'opacity'>
  select(): void
  remove(): void
}

export type ClipboardDocument = {
  createElement(tag: 'textarea'): ClipboardTextarea
  execCommand(command: 'copy'): boolean
  body?: {
    append(...nodes: unknown[]): void
  }
}

export type DesktopClipboardWindow = {
  DesktopBridge?: DesktopClipboardIpcBridge
  navigator?: {
    clipboard?: {
      writeText?: (text: string) => Promise<void>
      write?: (items: ReadonlyArray<DesktopClipboardRichItem>) => Promise<void>
    }
  }
  document?: ClipboardDocument
}

type ClipboardItemConstructor = {
  new (items: Record<string, string | Blob>): DesktopClipboardRichItem
}

const CLIPBOARD_WRITE_UNAVAILABLE_ERROR = '复制不可用。'
const API_KEY_DESKTOP_ONLY_ERROR = '安全复制仅在桌面应用中可用。'

export function createDesktopClipboardClient(win?: DesktopClipboardWindow): DesktopClipboard {
  return {
    writeText: async (text: string) => {
      const bridge = win?.DesktopBridge
      if (bridge) {
        await bridge.writeClipboardText({ text })
        return
      }
      await writeTextBrowserFallback(win, text)
    },
    writeRichText: async (input: { text: string; html: string }) => {
      const bridge = win?.DesktopBridge
      if (bridge) {
        await bridge.writeClipboardRichText(input)
        return
      }
      await writeRichTextBrowserFallback(win, input)
    },
    copyProviderApiKey: async (credentialId: string) => {
      const bridge = win?.DesktopBridge
      if (!bridge?.copyProviderApiKey) throw new Error(API_KEY_DESKTOP_ONLY_ERROR)
      return bridge.copyProviderApiKey(credentialId)
    },
  }
}

async function writeTextBrowserFallback(
  win: DesktopClipboardWindow | undefined,
  text: string,
): Promise<void> {
  const clipboard = win?.navigator?.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return
    } catch {
      // 浏览器层降级：navigator 失败时继续尝试 textarea 路径
    }
  }
  if (!writeLegacyTextarea(win?.document, text)) {
    throw new Error(CLIPBOARD_WRITE_UNAVAILABLE_ERROR)
  }
}

function writeLegacyTextarea(doc: ClipboardDocument | undefined, text: string): boolean {
  if (!doc) return false
  const textarea = doc.createElement('textarea')
  try {
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    const body = doc.body
    if (!body) return false
    body.append(textarea)
    textarea.select()
    return doc.execCommand('copy')
  } finally {
    textarea.remove()
  }
}

async function writeRichTextBrowserFallback(
  win: DesktopClipboardWindow | undefined,
  input: { text: string; html: string },
): Promise<void> {
  const clipboard = win?.navigator?.clipboard
  const itemConstructor = getClipboardItemConstructor()
  if (clipboard?.write && itemConstructor && typeof Blob !== 'undefined') {
    try {
      await clipboard.write([
        new itemConstructor({
          'text/html': new Blob([input.html], { type: 'text/html' }),
          'text/plain': new Blob([input.text], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // 浏览器层降级：富文本写入失败时走纯文本路径
    }
  }
  await writeTextBrowserFallback(win, input.text)
}

function getClipboardItemConstructor(): ClipboardItemConstructor | undefined {
  const candidate = globalThis.ClipboardItem
  if (typeof candidate === 'undefined') return undefined
  return candidate
}

export const desktopClipboard: DesktopClipboard = createDesktopClipboardClient(
  typeof window === 'undefined' ? undefined : window,
)
