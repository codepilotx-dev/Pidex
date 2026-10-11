import { describe, expect, test } from 'bun:test'
import { isDevToolsShortcut } from '../src/windows/DevtoolsShortcut'

describe('主窗口 DevTools 快捷键', () => {
  test('仅在首次按下 F12 时触发', () => {
    expect(
      isDevToolsShortcut({
        type: 'keyDown',
        key: 'F12',
        isAutoRepeat: false,
      }),
    ).toBe(true)
    expect(
      isDevToolsShortcut({
        type: 'keyUp',
        key: 'F12',
        isAutoRepeat: false,
      }),
    ).toBe(false)
    expect(
      isDevToolsShortcut({
        type: 'keyDown',
        key: 'F12',
        isAutoRepeat: true,
      }),
    ).toBe(false)
    expect(
      isDevToolsShortcut({
        type: 'keyDown',
        key: 'F11',
        isAutoRepeat: false,
      }),
    ).toBe(false)
  })
})
