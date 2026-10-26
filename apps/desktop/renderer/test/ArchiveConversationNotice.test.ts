import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createToastStore } from '../src/components/toast/ToastState.js'

const source = readFileSync(
  new URL('../src/features/layout/shell/DesktopLayout.tsx', import.meta.url), 'utf8',
)
const component = source.slice(source.indexOf('function ArchiveConversationNotice('))
const script = new Bun.Transpiler({
  loader: 'tsx', tsconfig: { compilerOptions: { jsx: 'react' } },
}).transformSync(component)
const store = createToastStore()
afterEach(() => { store.dismissAll(); store._clearTimer() })

// 直接执行真实组件的 effect，复现 StrictMode 的 setup/cleanup/setup。
function mountNotice(onClose: () => void, undoing = false) {
  const effects: Array<() => (() => void) | void> = []
  const render = new Function('React', 'useRef', 'useEffect', 'toastStore', 'Archive',
    `${script}; return ArchiveConversationNotice`)(
    { createElement: () => null },
    (current: unknown) => ({ current }),
    (effect: () => (() => void) | void) => effects.push(effect),
    store, null,
  )
  render({ onClose, onOpenSettings: () => {}, onUndo: () => {}, undoing })
  return () => {
    const cleanups = effects.map((effect) => effect())
    return () => cleanups.forEach((cleanup) => cleanup?.())
  }
}

test('StrictMode 清理重挂不会关闭归档提示，用户关闭仍通知父组件', () => {
  let closes = 0
  const setup = mountNotice(() => closes++)
  const cleanup = setup()
  expect(store.getState().toasts).toHaveLength(1)
  cleanup()
  expect(closes).toBe(0)
  const finalCleanup = setup()
  expect(store.getState().toasts).toHaveLength(1)
  store.dismiss('archive-conversation-notice')
  expect(closes).toBe(1)
  finalCleanup()
  expect(closes).toBe(1)
})

test('撤销进行中更新提示不会当作用户关闭', () => {
  let closes = 0
  const cleanup = mountNotice(() => closes++)()
  cleanup()
  const nextCleanup = mountNotice(() => closes++, true)()
  expect(closes).toBe(0)
  expect(store.getState().toasts[0]?.secondaryAction?.disabled).toBe(true)
  nextCleanup()
  expect(store.getState().toasts).toHaveLength(0)
  expect(closes).toBe(0)
})
