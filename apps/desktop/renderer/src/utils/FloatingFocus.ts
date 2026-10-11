import { useCallback, useMemo, useRef } from 'react'

// 浮层焦点环抑制：记录浮层是否由指针打开。指针打开的浮层在关闭恢复焦点时，
// 对恢复目标以 focusVisible:false 重聚焦，避免"鼠标打开 → Esc 关闭"这类鼠标
// 操作流在触发器上突兀地显示键盘焦点框（Esc 会把 Chromium 的 focus-visible
// modality 切到键盘，辅助技术模式下脚本聚焦一律匹配 :focus-visible）。
// 键盘打开的浮层不做干预，保持 浮层默认恢复行为，确保键盘用户焦点可见。
export function useFloatingFocusModality() {
  const openedByPointerRef = useRef(false)

  const markPointerDown = useCallback(() => {
    openedByPointerRef.current = true
  }, [])

  const markKeyboardDown = useCallback(() => {
    openedByPointerRef.current = false
  }, [])

  const suppressFocusRingOnClose = useCallback((event: Event) => {
    if (!openedByPointerRef.current) return
    // 浮层先把焦点恢复到打开前位置；下一帧对同一元素以 focusVisible:false
    // 重聚焦，仅抑制焦点环，不改变恢复目标。
    window.requestAnimationFrame(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.isConnected) {
        active.focus({ focusVisible: false } as FocusOptions)
      }
    })
  }, [])

  // 手动恢复触发器焦点时使用：指针打开的浮层抑制焦点环，键盘打开的保持默认。
  const refocusTrigger = useCallback((target: HTMLElement | null) => {
    if (!target) return
    if (openedByPointerRef.current) {
      target.focus({ focusVisible: false } as FocusOptions)
    } else {
      target.focus()
    }
  }, [])

  return useMemo(
    () => ({
      triggerInteractionProps: {
        onPointerDown: markPointerDown,
        onKeyDown: markKeyboardDown,
      },
      suppressFocusRingOnClose,
      refocusTrigger,
    }),
    [markKeyboardDown, markPointerDown, refocusTrigger, suppressFocusRingOnClose],
  )
}
