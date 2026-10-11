import type React from 'react'
import { useCallback, useLayoutEffect, useRef } from 'react'
import type { SidebarPane } from './SidebarNavigation.js'
import type { DesktopSidebarOrganization } from '../../../../shared/Types.js'

export type SidebarScrollModeKey =
  | 'timeline:priority'
  | 'standard:projects'
  | 'standard:flat'
  | `modern:${SidebarPane}:${'timeline:priority' | 'standard:projects' | 'standard:flat'}`

export function getSidebarScrollModeKey({
  organization,
  timelineEnabled,
  pane,
}: {
  organization: DesktopSidebarOrganization
  timelineEnabled: boolean
  pane?: SidebarPane
}): SidebarScrollModeKey {
  const mode = timelineEnabled
    ? 'timeline:priority'
    : organization === 'projects'
      ? 'standard:projects'
      : 'standard:flat'
  return pane ? `modern:${pane}:${mode}` : mode
}

export function useSidebarScrollController({
  activeSessionId,
  modeKey,
  positions,
  viewportRef,
  onScrollOverlapChange,
}: {
  activeSessionId: string | null
  modeKey: SidebarScrollModeKey
  positions: Map<SidebarScrollModeKey, number>
  viewportRef: React.RefObject<HTMLDivElement | null>
  onScrollOverlapChange: (overlapping: boolean) => void
}): {
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
} {
  const activeSessionIdRef = useRef(activeSessionId)
  const modeKeyRef = useRef(modeKey)
  const saveTimerRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef(false)
  const userSuppressedActiveIdRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const previousModeKey = modeKeyRef.current
    if (previousModeKey !== modeKey) {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      positions.set(previousModeKey, viewport.scrollTop)
      modeKeyRef.current = modeKey
    }

    programmaticScrollRef.current = true
    viewport.scrollTop = positions.get(modeKey) ?? 0
    onScrollOverlapChange(viewport.scrollTop > 0)
    const frame = window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [modeKey, onScrollOverlapChange, positions, viewportRef])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const activeChanged = activeSessionIdRef.current !== activeSessionId
    activeSessionIdRef.current = activeSessionId
    if (activeChanged) {
      userSuppressedActiveIdRef.current = null
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
        positions.set(modeKeyRef.current, viewport.scrollTop)
      }
    }
    if (!activeSessionId) return

    let disposed = false
    let stopObserving: (() => void) | undefined
    void import('./SidebarActiveSessionObserver.js').then((module) => {
      if (disposed) return
      stopObserving = module.observeActiveSidebarSession({
        activeSessionId,
        programmaticScrollRef,
        suppressedActiveIdRef: userSuppressedActiveIdRef,
        viewport,
      })
    })

    return () => {
      disposed = true
      stopObserving?.()
    }
  }, [activeSessionId, modeKey, positions, viewportRef])

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>): void => {
      const viewport = event.currentTarget
      onScrollOverlapChange(viewport.scrollTop > 0)
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = window.setTimeout(() => {
        positions.set(modeKeyRef.current, viewport.scrollTop)
        saveTimerRef.current = null
      }, 100)
    },
    [onScrollOverlapChange, positions],
  )

  useLayoutEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      const viewport = viewportRef.current
      if (viewport) positions.set(modeKeyRef.current, viewport.scrollTop)
    },
    [positions, viewportRef],
  )

  return { onScroll }
}
