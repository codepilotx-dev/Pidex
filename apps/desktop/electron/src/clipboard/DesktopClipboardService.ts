import {
  DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS,
  type DesktopClipboardRichTextInput,
  type DesktopSensitiveClipboardResult,
} from '@pidex/shared/desktop-clipboard-ipc'

export interface DesktopClipboardAdapter {
  writeText(text: string): void
  writeRichText(payload: { text: string; html: string }): void
  readText(): string
  clear(): void
}

export interface DesktopClipboardTimerHandle {
  clear(): void
}

export interface DesktopClipboardTimer {
  setTimeout(callback: () => void, delayMs: number): DesktopClipboardTimerHandle
}

export type DesktopClipboardServiceOptions = {
  adapter: DesktopClipboardAdapter
  timer: DesktopClipboardTimer
}

export class DesktopClipboardService {
  readonly #adapter: DesktopClipboardAdapter
  readonly #timer: DesktopClipboardTimer
  #generation = 0
  #pendingClear: DesktopClipboardTimerHandle | null = null

  constructor(options: DesktopClipboardServiceOptions) {
    this.#adapter = options.adapter
    this.#timer = options.timer
  }

  writeText(text: string): void {
    this.#invalidatePendingClear()
    this.#generation += 1
    this.#adapter.writeText(text)
  }

  writeRichText(input: DesktopClipboardRichTextInput): void {
    this.#invalidatePendingClear()
    this.#generation += 1
    this.#adapter.writeRichText({ text: input.text, html: input.html })
  }

  writeSensitiveText(
    secret: string,
    clearAfterMs: typeof DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS = DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS,
  ): DesktopSensitiveClipboardResult {
    this.#invalidatePendingClear()
    this.#generation += 1
    const generation = this.#generation
    this.#adapter.writeText(secret)
    this.#pendingClear = this.#timer.setTimeout(() => {
      if (this.#generation === generation && this.#adapter.readText() === secret) {
        this.#adapter.clear()
      }
    }, clearAfterMs)
    return { clearAfterMs: DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS }
  }

  #invalidatePendingClear(): void {
    if (this.#pendingClear) {
      this.#pendingClear.clear()
      this.#pendingClear = null
    }
  }
}

export function createDesktopClipboardService(
  options: DesktopClipboardServiceOptions,
): DesktopClipboardService {
  return new DesktopClipboardService(options)
}

// 生产默认 timer adapter：包装 Node setTimeout 并保持 unref 语义，
// 避免敏感清理任务阻止进程退出。
export function createDesktopClipboardTimer(): DesktopClipboardTimer {
  return {
    setTimeout(callback, delayMs) {
      const handle = setTimeout(callback, delayMs)
      if (typeof handle.unref === 'function') {
        handle.unref()
      }
      return {
        clear() {
          clearTimeout(handle)
        },
      }
    },
  }
}
