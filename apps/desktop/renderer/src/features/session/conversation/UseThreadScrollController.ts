import React from 'react'
import type { VirtualizerHandle } from 'virtua'

import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'

export const THREAD_BOTTOM_THRESHOLD_PX = 24
export const LATEST_TURN_PLACEMENT_THRESHOLD_PX = 300

export type ThreadScrollMode = 'static' | 'prework_watch' | 'prework_follow' | 'user_follow'

type ScrollMetrics = {
  scrollOffset: number
  scrollSize: number
  viewportSize: number
}

type ScrollModeInput = {
  mode: ThreadScrollMode
  active: boolean
  atBottom: boolean
  userScrolledUp: boolean
  contentChanged: boolean
  explicitFollow?: boolean
}

export type ScrollModeDecision = {
  mode: ThreadScrollMode
  hasNewContent: boolean
}

export function distanceFromThreadBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollSize - metrics.viewportSize - metrics.scrollOffset)
}

export function canReturnToThreadBottom(hasMeasuredBottom: boolean, isAtBottom: boolean): boolean {
  return hasMeasuredBottom && !isAtBottom
}

export function scrollOffsetForThreadBottomDistance(
  metrics: Pick<ScrollMetrics, 'scrollSize' | 'viewportSize'>,
  distanceFromBottom: number,
): number {
  return Math.max(0, metrics.scrollSize - metrics.viewportSize - Math.max(0, distanceFromBottom))
}

export function clampThreadScrollOffset(
  metrics: Pick<ScrollMetrics, 'scrollSize' | 'viewportSize'>,
  scrollOffset: number,
): number {
  return Math.min(Math.max(0, metrics.scrollSize - metrics.viewportSize), Math.max(0, scrollOffset))
}

export function resolveThreadScrollMode({
  mode,
  active,
  atBottom,
  userScrolledUp,
  contentChanged,
  explicitFollow = false,
}: ScrollModeInput): ScrollModeDecision {
  if (!active) {
    return { mode: 'static', hasNewContent: false }
  }
  if (explicitFollow) {
    return { mode: 'user_follow', hasNewContent: false }
  }
  if (userScrolledUp && !atBottom) {
    return { mode: 'static', hasNewContent: contentChanged }
  }
  if (atBottom) {
    return {
      mode: mode === 'user_follow' ? 'user_follow' : 'prework_follow',
      hasNewContent: false,
    }
  }
  if (contentChanged && mode === 'static') {
    return { mode: 'static', hasNewContent: true }
  }
  return { mode, hasNewContent: false }
}

type UseThreadScrollControllerOptions = {
  active: boolean
  contentRevision?: unknown
  initialScrollOffset?: number
  itemCount: number
  layoutResizeActive?: boolean
  listRef: React.RefObject<VirtualizerHandle | null>
  onScroll?: (scrollTop: number) => void
  scrollRef: React.RefObject<HTMLElement | null>
  sessionKey?: string
}

export type SavedThreadScrollState = {
  distanceFromBottom: number
  mode: ThreadScrollMode
  scrollOffset: number
}

export type ThreadResizeAnchor = {
  fallbackScrollOffset: number
  turnId: string
  viewportOffset: number
}

export function scrollOffsetForThreadResizeAnchor({
  anchor,
  currentScrollOffset,
  currentViewportOffset,
  metrics,
}: {
  anchor: Pick<ThreadResizeAnchor, 'fallbackScrollOffset' | 'viewportOffset'>
  currentScrollOffset: number
  currentViewportOffset: number | null
  metrics: Pick<ScrollMetrics, 'scrollSize' | 'viewportSize'>
}): number {
  return clampThreadScrollOffset(
    metrics,
    currentViewportOffset === null
      ? anchor.fallbackScrollOffset
      : currentScrollOffset + currentViewportOffset - anchor.viewportOffset,
  )
}

export const THREAD_SCROLL_STATE_CACHE_CAPACITY = 4
export const THREAD_SCROLL_STATE_CACHE_TTL_MS = 10 * 60 * 1_000

export type ThreadScrollStateCache = {
  clear(): void
  delete(sessionKey: string): void
  get(sessionKey: string): SavedThreadScrollState | null
  set(sessionKey: string, state: SavedThreadScrollState): void
  size(): number
}

export function createThreadScrollStateCache(
  options: {
    capacity?: number
    now?: () => number
    ttlMs?: number
  } = {},
): ThreadScrollStateCache {
  const capacity = Math.max(1, Math.floor(options.capacity ?? THREAD_SCROLL_STATE_CACHE_CAPACITY))
  const now = options.now ?? Date.now
  const ttlMs = Math.max(0, options.ttlMs ?? THREAD_SCROLL_STATE_CACHE_TTL_MS)
  const entries = new Map<
    string,
    {
      lastAccessAt: number
      state: SavedThreadScrollState
    }
  >()

  function removeExpired(timestamp: number): void {
    for (const [sessionKey, entry] of entries) {
      if (timestamp - entry.lastAccessAt >= ttlMs) entries.delete(sessionKey)
    }
  }

  return {
    clear(): void {
      entries.clear()
    },
    delete(sessionKey: string): void {
      entries.delete(sessionKey)
    },
    get(sessionKey: string): SavedThreadScrollState | null {
      const timestamp = now()
      const entry = entries.get(sessionKey)
      if (!entry) {
        removeExpired(timestamp)
        return null
      }
      if (timestamp - entry.lastAccessAt >= ttlMs) {
        entries.delete(sessionKey)
        return null
      }
      entry.lastAccessAt = timestamp
      entries.delete(sessionKey)
      entries.set(sessionKey, entry)
      return entry.state
    },
    set(sessionKey: string, state: SavedThreadScrollState): void {
      const timestamp = now()
      removeExpired(timestamp)
      entries.delete(sessionKey)
      entries.set(sessionKey, { lastAccessAt: timestamp, state })
      while (entries.size > capacity) {
        const oldestSessionKey = entries.keys().next().value
        if (oldestSessionKey === undefined) break
        entries.delete(oldestSessionKey)
      }
    },
    size(): number {
      removeExpired(now())
      return entries.size
    },
  }
}

const savedThreadScrollStates = createThreadScrollStateCache()

export function forgetThreadScrollState(sessionKey: string): void {
  savedThreadScrollStates.delete(sessionKey)
}

type ThreadScrollController = {
  pauseFollowing: () => void
  beginProgrammaticScroll: (smooth: boolean) => boolean
  bottomSentinelRef: (node: HTMLDivElement | null) => void
  handleScroll: (scrollTop: number) => void
  canReturnToBottom: boolean
  hasNewContent: boolean
  isAtBottom: boolean
  mode: ThreadScrollMode
  returnToBottom: () => void
}

export function isProgrammaticScrollActive(now: number, programmaticScrollUntil: number): boolean {
  return now <= programmaticScrollUntil
}

export function resolveThreadAtBottomDuringExplicitReturn({
  actualAtBottom,
  explicitReturnInProgress,
  now,
  programmaticScrollUntil,
}: {
  actualAtBottom: boolean
  explicitReturnInProgress: boolean
  now: number
  programmaticScrollUntil: number
}): boolean {
  return (
    actualAtBottom ||
    (explicitReturnInProgress && isProgrammaticScrollActive(now, programmaticScrollUntil))
  )
}

export function scrollVirtualizerToThreadBottom(
  handle: VirtualizerHandle | null,
  bottomSentinelIndex: number,
  smooth: boolean,
  footerOffset = 0,
): boolean {
  if (!handle) return false
  try {
    handle.scrollToIndex(bottomSentinelIndex, {
      align: 'end',
      offset: normalizeThreadFooterOffset(footerOffset),
      smooth,
    })
    return true
  } catch {
    // The sentinel can briefly be unavailable while virtua applies new data.
    // A later resize/count observation will request the bottom again.
    return false
  }
}

export function normalizeThreadFooterOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function readThreadFooterOffset(scrollElement: HTMLElement | null): number {
  if (!scrollElement || typeof getComputedStyle === 'undefined') return 0
  const value = Number.parseFloat(
    getComputedStyle(scrollElement).getPropertyValue('--thread-scroll-footer-height'),
  )
  return normalizeThreadFooterOffset(value)
}

function readMetrics(
  handle: VirtualizerHandle | null,
  scrollElement?: HTMLElement | null,
): ScrollMetrics | null {
  if (scrollElement) {
    return {
      scrollOffset: scrollElement.scrollTop,
      scrollSize: scrollElement.scrollHeight,
      viewportSize: scrollElement.clientHeight,
    }
  }
  if (!handle) return null
  return {
    scrollOffset: handle.scrollOffset,
    scrollSize: handle.scrollSize,
    viewportSize: handle.viewportSize,
  }
}

function isDisclosureGridTransition(
  event: TransitionEvent,
): event is TransitionEvent & { target: HTMLElement } {
  return (
    event.propertyName === 'grid-template-rows' &&
    event.target instanceof HTMLElement &&
    event.target.classList.contains('ui-disclosure-content')
  )
}

function readThreadResizeAnchor(viewport: HTMLElement | null): ThreadResizeAnchor | null {
  if (!viewport) return null
  const viewportRect = viewport.getBoundingClientRect()
  const rows = viewport.querySelectorAll<HTMLElement>('[data-turn-navigation-id]')
  for (const row of rows) {
    const turnId = row.getAttribute('data-turn-navigation-id')
    if (!turnId) continue
    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom) {
      continue
    }
    return {
      fallbackScrollOffset: viewport.scrollTop,
      turnId,
      viewportOffset: rowRect.top - viewportRect.top,
    }
  }
  return null
}

function findThreadTurnRow(viewport: HTMLElement, turnId: string): HTMLElement | null {
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-turn-navigation-id]')) {
    if (row.getAttribute('data-turn-navigation-id') === turnId) return row
  }
  return null
}

export function useThreadScrollController({
  active,
  contentRevision,
  initialScrollOffset = 0,
  itemCount,
  layoutResizeActive = false,
  listRef,
  onScroll,
  scrollRef,
  sessionKey,
}: UseThreadScrollControllerOptions): ThreadScrollController {
  const reducedMotion = usePrefersReducedMotion()
  const [mode, setModeState] = React.useState<ThreadScrollMode>('static')
  const [hasNewContent, setHasNewContent] = React.useState(false)
  const [hasMeasuredBottom, setHasMeasuredBottom] = React.useState(false)
  const [isAtBottom, setIsAtBottom] = React.useState(false)
  const [bottomSentinel, setBottomSentinel] = React.useState<HTMLDivElement | null>(null)
  const modeRef = React.useRef<ThreadScrollMode>('static')
  const activeRef = React.useRef(active)
  const atBottomRef = React.useRef(false)
  const intersectionAtBottomRef = React.useRef(false)
  const previousActiveRef = React.useRef(active)
  const previousCountRef = React.useRef(itemCount)
  const itemCountRef = React.useRef(itemCount)
  const previousOffsetRef = React.useRef(0)
  const previousScrollSizeRef = React.useRef(0)
  const previousDistanceFromBottomRef = React.useRef(0)
  const previousContentInlineSizeRef = React.useRef(0)
  const observedItemCountRef = React.useRef(itemCount)
  const contentRevisionRef = React.useRef(contentRevision)
  const observedContentRevisionRef = React.useRef(contentRevision)
  const contentResizeFrameRef = React.useRef<number | null>(null)
  const pendingContentSizeRef = React.useRef<{
    blockSize: number
    inlineSize: number
  } | null>(null)
  const activeDisclosureTransitionDepthRef = React.useRef(0)
  const disclosureSettleFrameRef = React.useRef<number | null>(null)
  const disclosureFixedScrollOffsetRef = React.useRef<number | null>(null)
  const contentReflowActiveUntilRef = React.useRef(0)
  const programmaticScrollUntilRef = React.useRef(0)
  const explicitReturnInProgressRef = React.useRef(false)
  const scrollFrameRef = React.useRef<number | null>(null)
  const sessionKeyRef = React.useRef(sessionKey)
  const layoutResizeActiveRef = React.useRef(layoutResizeActive)
  const resizeAnchorRef = React.useRef<ThreadResizeAnchor | null>(null)

  activeRef.current = active
  itemCountRef.current = itemCount
  contentRevisionRef.current = contentRevision
  layoutResizeActiveRef.current = layoutResizeActive

  const setMode = React.useCallback((nextMode: ThreadScrollMode): void => {
    modeRef.current = nextMode
    setModeState(nextMode)
  }, [])

  const updateAtBottom = React.useCallback((nextAtBottom: boolean): void => {
    setHasMeasuredBottom(true)
    atBottomRef.current = nextAtBottom
    setIsAtBottom((current) => (current === nextAtBottom ? current : nextAtBottom))
  }, [])

  const resetBottomMeasurement = React.useCallback((): void => {
    atBottomRef.current = false
    setHasMeasuredBottom(false)
    setIsAtBottom(false)
  }, [])

  const beginProgrammaticScroll = React.useCallback(
    (smooth: boolean): boolean => {
      const useSmoothScroll = smooth && !reducedMotion
      programmaticScrollUntilRef.current = Date.now() + (useSmoothScroll ? 500 : 140)
      return useSmoothScroll
    },
    [reducedMotion],
  )

  const pauseFollowing = React.useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = null
    }
    explicitReturnInProgressRef.current = false
    setMode('static')
  }, [setMode])

  const scrollToEnd = React.useCallback(
    (smooth: boolean, explicitReturn = false): void => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        const handle = listRef.current
        if (!handle) {
          explicitReturnInProgressRef.current = false
          return
        }
        const useSmoothScroll = beginProgrammaticScroll(smooth)
        explicitReturnInProgressRef.current = explicitReturn
        if (
          !scrollVirtualizerToThreadBottom(
            handle,
            itemCountRef.current,
            useSmoothScroll,
            readThreadFooterOffset(scrollRef.current),
          )
        ) {
          explicitReturnInProgressRef.current = false
        }
      })
    },
    [beginProgrammaticScroll, listRef, scrollRef],
  )

  const applyDecision = React.useCallback(
    (decision: ScrollModeDecision): void => {
      setMode(decision.mode)
      setHasNewContent(decision.hasNewContent)
    },
    [setMode],
  )

  const restoreResizeAnchor = React.useCallback((): void => {
    const viewport = scrollRef.current
    const anchor = resizeAnchorRef.current
    const metrics = readMetrics(listRef.current, viewport)
    if (!viewport || !anchor || !metrics) return

    const row = findThreadTurnRow(viewport, anchor.turnId)
    const viewportTop = viewport.getBoundingClientRect().top
    const currentViewportOffset = row ? row.getBoundingClientRect().top - viewportTop : null
    const targetOffset = scrollOffsetForThreadResizeAnchor({
      anchor,
      currentScrollOffset: metrics.scrollOffset,
      currentViewportOffset,
      metrics,
    })
    if (Math.abs(targetOffset - metrics.scrollOffset) <= 0.5) return

    programmaticScrollUntilRef.current = Date.now() + 140
    previousOffsetRef.current = targetOffset
    viewport.scrollTop = targetOffset
  }, [listRef, scrollRef])

  const syncDisclosureTransitionScroll = React.useCallback(
    (metrics: ScrollMetrics, settled: boolean): void => {
      const viewport = scrollRef.current
      const fixedScrollOffset = disclosureFixedScrollOffsetRef.current
      const shouldFollow =
        fixedScrollOffset === null &&
        (modeRef.current === 'prework_follow' ||
          modeRef.current === 'user_follow' ||
          (activeRef.current && atBottomRef.current))
      const targetOffset = shouldFollow
        ? scrollOffsetForThreadBottomDistance(metrics, 0)
        : clampThreadScrollOffset(metrics, fixedScrollOffset ?? metrics.scrollOffset)

      if (viewport && Math.abs(targetOffset - metrics.scrollOffset) > 0.5) {
        programmaticScrollUntilRef.current = Date.now() + 140
        previousOffsetRef.current = targetOffset
        viewport.scrollTop = targetOffset
      }

      previousScrollSizeRef.current = metrics.scrollSize
      previousDistanceFromBottomRef.current = shouldFollow
        ? 0
        : distanceFromThreadBottom({ ...metrics, scrollOffset: targetOffset })

      if (!settled) return
      if (shouldFollow) setHasNewContent(false)
      const currentSessionKey = sessionKeyRef.current
      if (currentSessionKey) {
        savedThreadScrollStates.set(currentSessionKey, {
          distanceFromBottom: previousDistanceFromBottomRef.current,
          mode: modeRef.current,
          scrollOffset: targetOffset,
        })
      }
    },
    [scrollRef],
  )

  React.useLayoutEffect(() => {
    if (layoutResizeActive) {
      const metrics = readMetrics(listRef.current, scrollRef.current)
      const shouldFollow =
        modeRef.current === 'prework_follow' ||
        modeRef.current === 'user_follow' ||
        atBottomRef.current ||
        (metrics !== null && distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX)
      if (shouldFollow) {
        resizeAnchorRef.current = null
      } else {
        resizeAnchorRef.current ??= readThreadResizeAnchor(scrollRef.current)
      }
      return
    }
    if (!resizeAnchorRef.current) return
    let settleFrame: number | null = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = null
        restoreResizeAnchor()
        resizeAnchorRef.current = null
      })
    })
    return () => {
      if (settleFrame !== null) cancelAnimationFrame(settleFrame)
    }
  }, [layoutResizeActive, listRef, restoreResizeAnchor, scrollRef])

  const handleScroll = React.useCallback(
    (scrollTop: number): void => {
      onScroll?.(scrollTop)
      const metrics = readMetrics(listRef.current, scrollRef.current)
      if (!metrics) return

      const distance = distanceFromThreadBottom({
        ...metrics,
        scrollOffset: scrollTop,
      })
      const actualAtBottom =
        distance <= THREAD_BOTTOM_THRESHOLD_PX || intersectionAtBottomRef.current
      const atBottom = resolveThreadAtBottomDuringExplicitReturn({
        actualAtBottom,
        explicitReturnInProgress: explicitReturnInProgressRef.current,
        now: Date.now(),
        programmaticScrollUntil: programmaticScrollUntilRef.current,
      })
      if (actualAtBottom || !atBottom) {
        explicitReturnInProgressRef.current = false
      }
      const previousOffset = previousOffsetRef.current
      const programmaticScrollActive = isProgrammaticScrollActive(
        Date.now(),
        programmaticScrollUntilRef.current,
      )
      const userScrolledUp = scrollTop < previousOffset - 2 && !programmaticScrollActive

      previousOffsetRef.current = scrollTop
      previousDistanceFromBottomRef.current = distance
      updateAtBottom(atBottom)
      const decision = resolveThreadScrollMode({
        mode: modeRef.current,
        active: activeRef.current,
        atBottom,
        userScrolledUp,
        contentChanged: userScrolledUp,
      })
      applyDecision(decision)
      const currentSessionKey = sessionKeyRef.current
      if (currentSessionKey) {
        savedThreadScrollStates.set(currentSessionKey, {
          distanceFromBottom: distance,
          mode: decision.mode,
          scrollOffset: scrollTop,
        })
      }
    },
    [applyDecision, listRef, onScroll, scrollRef, updateAtBottom],
  )

  const handleContentResize = React.useCallback(
    (entry: ResizeObserverEntry): void => {
      pendingContentSizeRef.current = {
        blockSize: entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
        inlineSize: entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width,
      }
      if (contentResizeFrameRef.current !== null) return
      contentResizeFrameRef.current = requestAnimationFrame(() => {
        contentResizeFrameRef.current = null
        const observedSize = pendingContentSizeRef.current
        pendingContentSizeRef.current = null
        const metrics = readMetrics(listRef.current, scrollRef.current)
        if (!observedSize || !metrics) return

        if (activeDisclosureTransitionDepthRef.current > 0) {
          syncDisclosureTransitionScroll(metrics, false)
          return
        }

        const now = performance.now()
        const previousInlineSize = previousContentInlineSizeRef.current
        const inlineSizeChanged =
          previousInlineSize > 0 && Math.abs(observedSize.inlineSize - previousInlineSize) > 0.5
        previousContentInlineSizeRef.current = observedSize.inlineSize

        const itemCountChanged = observedItemCountRef.current !== itemCountRef.current
        observedItemCountRef.current = itemCountRef.current
        const contentRevisionChanged =
          observedContentRevisionRef.current !== contentRevisionRef.current
        observedContentRevisionRef.current = contentRevisionRef.current
        const contentChanged = itemCountChanged || contentRevisionChanged
        if (inlineSizeChanged || layoutResizeActiveRef.current) {
          contentReflowActiveUntilRef.current = now + 100
        }
        const widthReflow = !contentChanged && now <= contentReflowActiveUntilRef.current

        const previousSize = previousScrollSizeRef.current
        previousScrollSizeRef.current = metrics.scrollSize
        if (previousSize === 0) {
          previousDistanceFromBottomRef.current = distanceFromThreadBottom(metrics)
          return
        }

        if (widthReflow) {
          const shouldFollow =
            modeRef.current === 'prework_follow' ||
            modeRef.current === 'user_follow' ||
            atBottomRef.current ||
            distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX
          if (shouldFollow) resizeAnchorRef.current = null
          if (
            !shouldFollow &&
            (layoutResizeActiveRef.current || resizeAnchorRef.current !== null)
          ) {
            if (layoutResizeActiveRef.current) {
              resizeAnchorRef.current ??= readThreadResizeAnchor(scrollRef.current)
            }
            restoreResizeAnchor()
            const anchoredMetrics = readMetrics(listRef.current, scrollRef.current)
            if (anchoredMetrics) {
              previousDistanceFromBottomRef.current = distanceFromThreadBottom(anchoredMetrics)
            }
            return
          }
          const distance = shouldFollow ? 0 : previousDistanceFromBottomRef.current
          const targetOffset = scrollOffsetForThreadBottomDistance(metrics, distance)
          if (Math.abs(targetOffset - metrics.scrollOffset) > 0.5) {
            programmaticScrollUntilRef.current = Date.now() + 140
            previousOffsetRef.current = targetOffset
            if (scrollRef.current) scrollRef.current.scrollTop = targetOffset
            else listRef.current?.scrollTo(targetOffset)
          }
          previousDistanceFromBottomRef.current = distance
          const currentSessionKey = sessionKeyRef.current
          if (currentSessionKey) {
            savedThreadScrollStates.set(currentSessionKey, {
              distanceFromBottom: distance,
              mode: modeRef.current,
              scrollOffset: targetOffset,
            })
          }
          return
        }

        if (metrics.scrollSize <= previousSize + 0.5) {
          previousDistanceFromBottomRef.current = distanceFromThreadBottom(metrics)
          return
        }

        const shouldFollow =
          modeRef.current === 'prework_follow' ||
          modeRef.current === 'user_follow' ||
          (activeRef.current && atBottomRef.current)
        if (shouldFollow) {
          previousDistanceFromBottomRef.current = 0
          setHasNewContent(false)
          scrollToEnd(false)
          return
        }
        const distance = distanceFromThreadBottom(metrics)
        previousDistanceFromBottomRef.current = distance
        if (activeRef.current) setHasNewContent(true)
        const currentSessionKey = sessionKeyRef.current
        if (currentSessionKey) {
          savedThreadScrollStates.set(currentSessionKey, {
            distanceFromBottom: distance,
            mode: modeRef.current,
            scrollOffset: metrics.scrollOffset,
          })
        }
      })
    },
    [listRef, restoreResizeAnchor, scrollRef, scrollToEnd, syncDisclosureTransitionScroll],
  )

  const returnToBottom = React.useCallback((): void => {
    applyDecision(
      resolveThreadScrollMode({
        mode: modeRef.current,
        active: activeRef.current,
        atBottom: true,
        userScrolledUp: false,
        contentChanged: false,
        explicitFollow: true,
      }),
    )
    scrollToEnd(true, true)
  }, [applyDecision, scrollToEnd])

  React.useEffect(() => {
    sessionKeyRef.current = sessionKey
    resizeAnchorRef.current = null
    const savedState = sessionKey ? savedThreadScrollStates.get(sessionKey) : null
    const restoredOffset = savedState?.scrollOffset ?? initialScrollOffset
    const preserveHistoricalPosition = savedState
      ? savedState.distanceFromBottom > THREAD_BOTTOM_THRESHOLD_PX
      : initialScrollOffset > 0

    setMode('static')
    setHasNewContent(false)
    explicitReturnInProgressRef.current = false
    intersectionAtBottomRef.current = false
    previousActiveRef.current = preserveHistoricalPosition ? activeRef.current : false
    const metrics = readMetrics(listRef.current, scrollRef.current)
    previousCountRef.current = itemCountRef.current
    previousOffsetRef.current = restoredOffset
    previousScrollSizeRef.current = metrics?.scrollSize ?? 0
    previousDistanceFromBottomRef.current = metrics
      ? distanceFromThreadBottom({ ...metrics, scrollOffset: restoredOffset })
      : 0
    resetBottomMeasurement()

    if (restoredOffset > 0) {
      programmaticScrollUntilRef.current = Date.now() + 180
      const frame = requestAnimationFrame(() => {
        const currentMetrics = readMetrics(listRef.current, scrollRef.current)
        const targetOffset = currentMetrics
          ? clampThreadScrollOffset(currentMetrics, restoredOffset)
          : Math.max(0, restoredOffset)
        previousOffsetRef.current = targetOffset
        if (listRef.current) {
          listRef.current.scrollTo(targetOffset)
          return
        }
        if (scrollRef.current) scrollRef.current.scrollTop = targetOffset
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [initialScrollOffset, listRef, scrollRef, sessionKey, setMode, resetBottomMeasurement])

  React.useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = active
    if (!active) {
      setMode('static')
      setHasNewContent(false)
      return
    }
    if (wasActive) return

    setMode('prework_watch')
    const frame = requestAnimationFrame(() => {
      const handle = listRef.current
      const metrics = readMetrics(handle, scrollRef.current)
      if (!handle || !metrics) return
      const atBottom = distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX
      setMode('prework_follow')
      setHasNewContent(false)
      if (atBottom) {
        scrollToEnd(false)
        return
      }

      try {
        const latestTurnIndex = Math.max(0, itemCount - 1)
        const latestTurnDistance = handle.getItemOffset(latestTurnIndex) - metrics.scrollOffset
        programmaticScrollUntilRef.current = Date.now() + 180
        if (latestTurnDistance > LATEST_TURN_PLACEMENT_THRESHOLD_PX) {
          handle.scrollToIndex(latestTurnIndex, { align: 'start' })
          return
        }
      } catch {
        // The virtualizer can still be measuring the new row; bottom anchoring
        // is the safe fallback and the ResizeObserver will correct it again.
      }
      if (activeRef.current) {
        scrollToEnd(false)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, itemCount, listRef, scrollRef, scrollToEnd, sessionKey, setMode])

  React.useEffect(() => {
    if (itemCount <= previousCountRef.current) {
      previousCountRef.current = itemCount
      return
    }
    previousCountRef.current = itemCount
    if (modeRef.current === 'prework_follow' || modeRef.current === 'user_follow') {
      scrollToEnd(false)
    } else if (activeRef.current) {
      setHasNewContent(true)
    }
  }, [itemCount, scrollToEnd])

  React.useEffect(() => {
    const content = scrollRef.current?.querySelector<HTMLElement>('.session-timeline-virtualizer')
    if (!content || typeof ResizeObserver === 'undefined') return
    const metrics = readMetrics(listRef.current, scrollRef.current)
    previousScrollSizeRef.current = metrics?.scrollSize ?? 0
    previousDistanceFromBottomRef.current = metrics ? distanceFromThreadBottom(metrics) : 0
    previousContentInlineSizeRef.current = content.getBoundingClientRect().width
    observedItemCountRef.current = itemCountRef.current
    observedContentRevisionRef.current = contentRevisionRef.current
    const observer = new ResizeObserver(([entry]) => {
      if (entry) handleContentResize(entry)
    })
    const handleDisclosureTransitionRun = (event: TransitionEvent): void => {
      if (!isDisclosureGridTransition(event)) return
      if (activeDisclosureTransitionDepthRef.current === 0) {
        const transitionMetrics = readMetrics(listRef.current, scrollRef.current)
        const shouldFollow =
          transitionMetrics !== null &&
          (modeRef.current === 'prework_follow' ||
            modeRef.current === 'user_follow' ||
            (activeRef.current && atBottomRef.current))
        disclosureFixedScrollOffsetRef.current = shouldFollow
          ? null
          : (transitionMetrics?.scrollOffset ?? null)
      }
      activeDisclosureTransitionDepthRef.current += 1
    }
    const handleDisclosureTransitionComplete = (event: TransitionEvent): void => {
      if (!isDisclosureGridTransition(event)) return
      activeDisclosureTransitionDepthRef.current = Math.max(
        0,
        activeDisclosureTransitionDepthRef.current - 1,
      )
      if (activeDisclosureTransitionDepthRef.current > 0) return
      if (disclosureSettleFrameRef.current !== null) {
        cancelAnimationFrame(disclosureSettleFrameRef.current)
      }
      if (contentResizeFrameRef.current !== null) {
        cancelAnimationFrame(contentResizeFrameRef.current)
        contentResizeFrameRef.current = null
      }
      pendingContentSizeRef.current = null
      disclosureSettleFrameRef.current = requestAnimationFrame(() => {
        disclosureSettleFrameRef.current = null
        if (activeDisclosureTransitionDepthRef.current > 0) return
        const transitionMetrics = readMetrics(listRef.current, scrollRef.current)
        if (transitionMetrics) {
          syncDisclosureTransitionScroll(transitionMetrics, true)
        }
        disclosureFixedScrollOffsetRef.current = null
      })
    }
    observer.observe(content)
    content.addEventListener('transitionrun', handleDisclosureTransitionRun)
    content.addEventListener('transitionend', handleDisclosureTransitionComplete)
    content.addEventListener('transitioncancel', handleDisclosureTransitionComplete)
    return () => {
      observer.disconnect()
      content.removeEventListener('transitionrun', handleDisclosureTransitionRun)
      content.removeEventListener('transitionend', handleDisclosureTransitionComplete)
      content.removeEventListener('transitioncancel', handleDisclosureTransitionComplete)
      if (contentResizeFrameRef.current !== null) {
        cancelAnimationFrame(contentResizeFrameRef.current)
        contentResizeFrameRef.current = null
      }
      if (disclosureSettleFrameRef.current !== null) {
        cancelAnimationFrame(disclosureSettleFrameRef.current)
        disclosureSettleFrameRef.current = null
      }
      activeDisclosureTransitionDepthRef.current = 0
      disclosureFixedScrollOffsetRef.current = null
      pendingContentSizeRef.current = null
    }
  }, [handleContentResize, listRef, scrollRef, sessionKey, syncDisclosureTransitionScroll])

  React.useEffect(() => {
    const viewport = scrollRef.current
    intersectionAtBottomRef.current = false
    if (!viewport || !bottomSentinel || typeof IntersectionObserver === 'undefined') {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting)
        intersectionAtBottomRef.current = visible
        const metrics = readMetrics(listRef.current, viewport)
        const actualAtBottom =
          visible ||
          (metrics !== null && distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX)
        const atBottom = resolveThreadAtBottomDuringExplicitReturn({
          actualAtBottom,
          explicitReturnInProgress: explicitReturnInProgressRef.current,
          now: Date.now(),
          programmaticScrollUntil: programmaticScrollUntilRef.current,
        })
        if (actualAtBottom || !atBottom) {
          explicitReturnInProgressRef.current = false
        }
        updateAtBottom(atBottom)
      },
      { root: viewport, threshold: 0.01 },
    )
    observer.observe(bottomSentinel)
    return () => {
      observer.disconnect()
      intersectionAtBottomRef.current = false
    }
  }, [bottomSentinel, listRef, scrollRef, sessionKey, updateAtBottom])

  React.useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    [],
  )

  return {
    pauseFollowing,
    beginProgrammaticScroll,
    bottomSentinelRef: setBottomSentinel,
    canReturnToBottom: canReturnToThreadBottom(hasMeasuredBottom, isAtBottom),
    handleScroll,
    hasNewContent,
    isAtBottom,
    mode,
    returnToBottom,
  }
}
