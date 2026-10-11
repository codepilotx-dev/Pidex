import type { KeyboardEvent } from 'react'

// ↑/↓ 在 selector 命中的兄弟列表项之间移动焦点（列表项仍保持独立 Tab stop）。
// Alt+方向键保留给重排快捷键，输入控件内的方向键保留给原生行为。
export function moveFocusOnArrowKey(event: KeyboardEvent<HTMLElement>, itemSelector: string): void {
  if (event.nativeEvent.isComposing) return
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const target = event.target
  if (!(target instanceof Element)) return
  const item = target.closest<HTMLElement>(itemSelector)
  if (!item) return
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(itemSelector)).filter(
    (candidate) =>
      !candidate.hasAttribute('disabled') &&
      candidate.getAttribute('aria-disabled') !== 'true' &&
      candidate.offsetParent !== null,
  )
  const index = items.indexOf(item)
  if (index < 0) return
  const next = items[index + (event.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  event.preventDefault()
  next.focus()
}
