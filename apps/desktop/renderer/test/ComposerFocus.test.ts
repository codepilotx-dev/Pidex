import { describe, expect, test } from 'bun:test'
import { focusComposerIfAvailable } from '../src/features/session/composer/ComposerFocus.js'

function focusFixture() {
  const body = {} as HTMLElement
  const button = {} as HTMLElement
  const document = {
    body,
    activeElement: body,
    hasFocus: () => true,
    querySelectorAll: () => [] as HTMLElement[],
  }
  const editor = {
    ownerDocument: document,
    isConnected: true,
    closest: () => null as Element | null,
    contains: (element: Element | null) => element === (editor as unknown as HTMLElement),
  }
  let focused = 0
  return {
    document,
    editor,
    button,
    restore: (returnFrom?: Element) => {
      focusComposerIfAvailable(editor as unknown as HTMLElement, () => focused++, returnFrom)
      return focused
    },
  }
}

describe('composer focus ownership', () => {
  test('新编辑器挂载及提交释放后可从页面空白恢复焦点', () => {
    expect(focusFixture().restore()).toBe(1)
  })

  test('发送、入队和命令执行后保留已在编辑器的焦点', () => {
    const fixture = focusFixture()
    fixture.document.activeElement = fixture.editor as unknown as HTMLElement
    expect(fixture.restore()).toBe(1)
  })

  test('异步操作结束不抢其他控件焦点', () => {
    const fixture = focusFixture()
    fixture.document.activeElement = fixture.button
    expect(fixture.restore()).toBe(0)
  })

  test('显式点击发送可以从该发送按钮返回编辑器', () => {
    const fixture = focusFixture()
    fixture.document.activeElement = fixture.button
    expect(fixture.restore(fixture.button)).toBe(1)
  })

  test('弹窗尚未聚焦内容时也不抢焦点', () => {
    const fixture = focusFixture()
    fixture.document.querySelectorAll = () => [
      { contains: () => false, getClientRects: () => [{}] } as unknown as HTMLElement,
    ]
    expect(fixture.restore()).toBe(0)
  })

  test('切到其他窗口及卸载旧会话后不恢复焦点', () => {
    const fixture = focusFixture()
    fixture.document.hasFocus = () => false
    expect(fixture.restore()).toBe(0)
    fixture.document.hasFocus = () => true
    fixture.editor.isConnected = false
    expect(fixture.restore()).toBe(0)
  })

  test('隐藏或禁止交互的输入区不聚焦', () => {
    const fixture = focusFixture()
    fixture.editor.closest = () => fixture.button
    expect(fixture.restore()).toBe(0)
  })
})
