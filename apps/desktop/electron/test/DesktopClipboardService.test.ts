import { describe, expect, test } from 'bun:test'
import {
  DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS,
  DESKTOP_CLIPBOARD_TEXT_MAX_BYTES,
  normalizeDesktopClipboardRichTextInput,
  normalizeDesktopClipboardTextInput,
  requireDesktopClipboardRichTextInput,
  requireDesktopClipboardTextInput,
  type DesktopClipboardRichTextInput,
  type DesktopClipboardTextInput,
} from '@pidex/shared/desktop-clipboard-ipc'
import {
  createDesktopClipboardService,
  type DesktopClipboardAdapter,
  type DesktopClipboardTimer,
  type DesktopClipboardTimerHandle,
} from '../src/clipboard/DesktopClipboardService'

class FakeClipboard implements DesktopClipboardAdapter {
  current = ''
  writes: Array<{ text: string } | { text: string; html: string }> = []
  cleared = 0

  writeText(text: string): void {
    this.current = text
    this.writes.push({ text })
  }

  writeRichText(payload: { text: string; html: string }): void {
    this.current = payload.text
    this.writes.push({ text: payload.text, html: payload.html })
  }

  readText(): string {
    return this.current
  }

  clear(): void {
    this.cleared += 1
    this.current = ''
  }
}

class FakeTimer implements DesktopClipboardTimer {
  #entries: Array<{
    cancelled: boolean
    delayMs: number
    callback: () => void
  }> = []

  setTimeout(callback: () => void, delayMs: number): DesktopClipboardTimerHandle {
    const entry = { cancelled: false, delayMs, callback }
    this.#entries.push(entry)
    return {
      clear: () => {
        entry.cancelled = true
      },
    }
  }

  get scheduled(): Array<{ delayMs: number }> {
    return this.#entries.map((entry) => ({ delayMs: entry.delayMs }))
  }

  get pendingCount(): number {
    return this.#entries.filter((entry) => !entry.cancelled).length
  }

  fireNext(): void {
    const entry = this.#entries.find((item) => !item.cancelled)
    if (!entry) throw new Error('no pending timer')
    entry.cancelled = true
    entry.callback()
  }
}

function createService() {
  const clipboard = new FakeClipboard()
  const timer = new FakeTimer()
  const service = createDesktopClipboardService({ adapter: clipboard, timer })
  return { service, clipboard, timer }
}

describe('desktop clipboard service', () => {
  test('纯文本精确写入且不安排清理 timer', () => {
    const { service, clipboard, timer } = createService()
    service.writeText('hello')
    expect(clipboard.writes).toEqual([{ text: 'hello' }])
    expect(clipboard.current).toBe('hello')
    expect(timer.pendingCount).toBe(0)
  })

  test('富文本精确写入 adapter.write 且不安排清理 timer', () => {
    const { service, clipboard, timer } = createService()
    service.writeRichText({ text: 'hello', html: '<b>hello</b>' })
    expect(clipboard.writes).toEqual([{ text: 'hello', html: '<b>hello</b>' }])
    expect(clipboard.current).toBe('hello')
    expect(timer.pendingCount).toBe(0)
  })

  test('敏感写入安排 60 秒清理，到期且内容未变时清除', () => {
    const { service, clipboard, timer } = createService()
    const result = service.writeSensitiveText('secret')
    expect(result).toEqual({ clearAfterMs: 60000 })
    expect(timer.scheduled).toEqual([{ delayMs: DESKTOP_CLIPBOARD_SENSITIVE_CLEAR_AFTER_MS }])
    expect(clipboard.writes).toEqual([{ text: 'secret' }])
    timer.fireNext()
    expect(clipboard.cleared).toBe(1)
    expect(clipboard.current).toBe('')
  })

  test('到期时剪贴板内容已被外部改写则不清理', () => {
    const { service, clipboard, timer } = createService()
    service.writeSensitiveText('secret')
    clipboard.writeText('other')
    timer.fireNext()
    expect(clipboard.cleared).toBe(0)
    expect(clipboard.current).toBe('other')
  })

  test('后续普通写入使旧敏感 timer 失效', () => {
    const { service, clipboard, timer } = createService()
    service.writeSensitiveText('secret')
    service.writeText('plain')
    expect(timer.pendingCount).toBe(0)
    expect(clipboard.writes).toEqual([{ text: 'secret' }, { text: 'plain' }])
    expect(clipboard.cleared).toBe(0)
  })

  test('第二次敏感写入使第一次的 timer 失效，只有最新一次可清理', () => {
    const { service, clipboard, timer } = createService()
    service.writeSensitiveText('secret-1')
    service.writeSensitiveText('secret-2')
    expect(timer.pendingCount).toBe(1)
    timer.fireNext()
    expect(clipboard.cleared).toBe(1)
    expect(clipboard.current).toBe('')
    expect(clipboard.writes).toEqual([{ text: 'secret-1' }, { text: 'secret-2' }])
  })

  test('普通富文本写入同样使旧敏感 timer 失效', () => {
    const { service, clipboard, timer } = createService()
    service.writeSensitiveText('secret')
    service.writeRichText({ text: 'rich', html: '<i>rich</i>' })
    expect(timer.pendingCount).toBe(0)
    expect(clipboard.cleared).toBe(0)
  })
})

describe('desktop clipboard shared contract', () => {
  test('纯文本归一化只返回精确字段并执行字节上限', () => {
    const input: DesktopClipboardTextInput = { text: 'hello' }
    expect(normalizeDesktopClipboardTextInput(input)).toEqual({ text: 'hello' })
    expect(normalizeDesktopClipboardTextInput({ text: '', extra: true })).toEqual({ text: '' })
    expect(normalizeDesktopClipboardTextInput(null)).toBeNull()
    expect(normalizeDesktopClipboardTextInput({})).toBeNull()
    expect(normalizeDesktopClipboardTextInput({ text: 42 })).toBeNull()
    expect(
      normalizeDesktopClipboardTextInput({
        text: 'x'.repeat(DESKTOP_CLIPBOARD_TEXT_MAX_BYTES + 1),
      }),
    ).toBeNull()
    expect(
      normalizeDesktopClipboardTextInput({
        text: 'x'.repeat(DESKTOP_CLIPBOARD_TEXT_MAX_BYTES),
      }),
    ).not.toBeNull()
  })

  test('富文本归一化要求两字段为字符串且合计字节受限', () => {
    const input: DesktopClipboardRichTextInput = {
      text: 'hello',
      html: '<b>hello</b>',
    }
    expect(normalizeDesktopClipboardRichTextInput(input)).toEqual({
      text: 'hello',
      html: '<b>hello</b>',
    })
    expect(normalizeDesktopClipboardRichTextInput({ text: 'hello' })).toBeNull()
    expect(
      normalizeDesktopClipboardRichTextInput({
        text: 'hello',
        html: 42,
      }),
    ).toBeNull()
    expect(
      normalizeDesktopClipboardRichTextInput({
        text: 'x'.repeat(DESKTOP_CLIPBOARD_TEXT_MAX_BYTES),
        html: 'y',
      }),
    ).toBeNull()
  })

  test('require helper 使用固定非敏感消息且不回显内容', () => {
    expect(requireDesktopClipboardTextInput({ text: 'hello' })).toEqual({ text: 'hello' })
    expect(() => requireDesktopClipboardTextInput(null)).toThrow('剪贴板文本输入无效')
    expect(() => requireDesktopClipboardTextInput({ text: '超敏感密钥内容' })).not.toThrow(
      /超敏感密钥内容/,
    )
    expect(() => requireDesktopClipboardRichTextInput({ text: 'a' })).toThrow(
      '剪贴板富文本输入无效',
    )
  })
})
