import { useCallback, useRef } from 'react'

type DialogFocusRestore = {
  onCloseAutoFocus: (event: Event) => void
  restoreFocusElement: HTMLElement | null
}

export function useDialogFocusRestore(
  open: boolean,
  explicitRestoreFocusElement?: HTMLElement | null,
): DialogFocusRestore {
  const capturedRestoreFocusElement = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  if (open && !wasOpen.current) {
    capturedRestoreFocusElement.current = explicitRestoreFocusElement ?? activeDialogRestoreTarget()
  }
  wasOpen.current = open

  const restoreFocusElement = explicitRestoreFocusElement ?? capturedRestoreFocusElement.current
  const onCloseAutoFocus = useCallback(
    (event: Event): void => {
      if (!restoreFocusElement?.isConnected) return
      event.preventDefault()
      restoreFocusElement.focus()
    },
    [restoreFocusElement],
  )

  return { onCloseAutoFocus, restoreFocusElement }
}

function activeDialogRestoreTarget(): HTMLElement | null {
  if (typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)) {
    return null
  }

  let candidate = document.activeElement
  const visited = new Set<HTMLElement>()
  while (!visited.has(candidate)) {
    visited.add(candidate)
    const menu = candidate.closest<HTMLElement>('[role="menu"]')
    const triggerId = menu?.getAttribute('aria-labelledby')
    const trigger = triggerId ? document.getElementById(triggerId) : null
    if (!(trigger instanceof HTMLElement)) break
    candidate = trigger
  }
  return candidate
}
