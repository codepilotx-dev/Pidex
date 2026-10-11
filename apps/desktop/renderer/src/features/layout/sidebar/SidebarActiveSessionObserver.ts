const USER_SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

export function observeActiveSidebarSession({
  activeSessionId,
  programmaticScrollRef,
  suppressedActiveIdRef,
  viewport,
}: {
  activeSessionId: string
  programmaticScrollRef: { current: boolean }
  suppressedActiveIdRef: { current: string | null }
  viewport: HTMLDivElement
}): () => void {
  let animationFrame: number | null = null
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  let observedRow: HTMLElement | null = null

  const isSuppressed = (): boolean => suppressedActiveIdRef.current === activeSessionId

  const findActiveRow = (): HTMLElement | null => {
    for (const row of viewport.querySelectorAll<HTMLElement>('[data-sidebar-session-id]')) {
      if (row.dataset.sidebarSessionId === activeSessionId) return row
    }
    return null
  }

  const stopResizeObserver = (): void => {
    resizeObserver?.disconnect()
    resizeObserver = null
    observedRow = null
  }

  const observeRowAndAncestors = (row: HTMLElement): void => {
    if (observedRow === row || typeof ResizeObserver === 'undefined') return
    stopResizeObserver()
    observedRow = row
    resizeObserver = new ResizeObserver(scheduleReveal)
    let current: HTMLElement | null = row
    while (current && current !== viewport) {
      resizeObserver.observe(current)
      current = current.parentElement
    }
  }

  const reveal = (): void => {
    animationFrame = null
    if (isSuppressed()) return
    const row = findActiveRow()
    if (!row) {
      stopResizeObserver()
      return
    }
    observeRowAndAncestors(row)
    programmaticScrollRef.current = true
    row.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
  }

  function scheduleReveal(): void {
    if (animationFrame !== null || isSuppressed()) return
    animationFrame = window.requestAnimationFrame(reveal)
  }

  const suppressForUserInput = (): void => {
    if (programmaticScrollRef.current) return
    suppressedActiveIdRef.current = activeSessionId
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    stopResizeObserver()
  }
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (USER_SCROLL_KEYS.has(event.key)) suppressForUserInput()
  }

  viewport.addEventListener('wheel', suppressForUserInput, { passive: true })
  viewport.addEventListener('touchstart', suppressForUserInput, {
    passive: true,
  })
  viewport.addEventListener('pointerdown', suppressForUserInput, {
    passive: true,
  })
  viewport.addEventListener('keydown', handleKeyDown, true)

  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(scheduleReveal)
    mutationObserver.observe(viewport, { childList: true, subtree: true })
  }
  scheduleReveal()

  return () => {
    viewport.removeEventListener('wheel', suppressForUserInput)
    viewport.removeEventListener('touchstart', suppressForUserInput)
    viewport.removeEventListener('pointerdown', suppressForUserInput)
    viewport.removeEventListener('keydown', handleKeyDown, true)
    mutationObserver?.disconnect()
    stopResizeObserver()
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
  }
}
