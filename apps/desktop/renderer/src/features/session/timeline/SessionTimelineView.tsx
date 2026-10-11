/**
 * SessionTimelineView — Virtual-scrolling container for session timeline.
 *
 * Wraps virtua's Virtualizer and handles scroll management, bottom anchoring,
 * and hash navigation. Row rendering is done by the parent via children,
 * avoiding circular import issues with ConversationPage's renderers.
 *
 * Layout follows opencode's turn/part spirit via data-* attributes
 * on the container.
 */

import React from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'

import { useThreadScrollController } from '../conversation/UseThreadScrollController.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'

const TIMELINE_BOTTOM_SENTINEL = Symbol('timeline-bottom-sentinel')

/* ── Props ──────────────────────────────────────────────── */

export type SessionTimelineViewProps<T> = {
  /** Timeline rows; the virtualizer asks for React elements only near the viewport. */
  items: readonly T[]
  /** Lazily renders a row. Returned elements must have stable keys. */
  renderItem: (item: T, index: number) => React.ReactElement
  /** Ref to the VirtualizerHandle for imperative scroll control. */
  listRef?: React.RefObject<VirtualizerHandle | null>
  /** Commands used by overlays that navigate within the virtual timeline. */
  navigationRef?: React.Ref<ThreadTimelineNavigationHandle>
  /** The single overflow element owned by ThreadScrollLayout. */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Called when the user scrolls (for scroll-position persistence). */
  onScroll?: (scrollTop: number) => void
  /** Reports whether the timeline has been measured away from the bottom. */
  onCanReturnToBottomChange?: (canReturnToBottom: boolean) => void
  /** Persisted scroll offset to restore when mounting this session. */
  initialScrollOffset?: number
  /** True only for the start/end-bounded workbench resize session. */
  layoutResizeActive?: boolean
  /**
   * If true, scroll to the end whenever the child count changes.
   * Used during streaming to keep the latest content visible.
   */
  scrollToBottom?: boolean
  /** Number of children — used to detect additions for auto-scroll. */
  count: number
  /** Stable session identity used to reset and restore per-session scroll state. */
  sessionKey?: string
}

export type ThreadTimelineNavigationHandle = {
  captureHistoryAnchor: () => () => void
  revealInput: (
    target: { turnId: string; inputId: string; rowIndex: number },
    behavior: 'smooth' | 'instant',
  ) => boolean
  revealTurn: (index: number, behavior: 'smooth' | 'instant') => boolean
  returnToBottom: () => void
}

/* ── Main component ─────────────────────────────────────── */

export function SessionTimelineView<T>({
  items,
  renderItem,
  listRef: externalListRef,
  navigationRef,
  scrollRef,
  onScroll,
  onCanReturnToBottomChange,
  initialScrollOffset,
  layoutResizeActive,
  scrollToBottom,
  count,
  sessionKey,
}: SessionTimelineViewProps<T>): React.ReactNode {
  const internalListRef = React.useRef<VirtualizerHandle>(null)
  const listHandle = externalListRef ?? internalListRef
  const reducedMotion = usePrefersReducedMotion()
  const navigationFrameRef = React.useRef<number | null>(null)
  const navigationRevisionRef = React.useRef(0)
  const cancelNavigation = React.useCallback(() => {
    navigationRevisionRef.current += 1
    if (navigationFrameRef.current !== null) window.cancelAnimationFrame(navigationFrameRef.current)
    navigationFrameRef.current = null
  }, [])
  React.useEffect(() => {
    const root = scrollRef.current
    const cancelKeyboardNavigation = (event: KeyboardEvent) => {
      if (
        ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key) &&
        !event.altKey
      )
        cancelNavigation()
    }
    root?.addEventListener('wheel', cancelNavigation, { passive: true })
    root?.addEventListener('pointerdown', cancelNavigation)
    root?.addEventListener('keydown', cancelKeyboardNavigation)
    return () => {
      cancelNavigation()
      root?.removeEventListener('wheel', cancelNavigation)
      root?.removeEventListener('pointerdown', cancelNavigation)
      root?.removeEventListener('keydown', cancelKeyboardNavigation)
    }
  }, [cancelNavigation, scrollRef, sessionKey])
  const virtualItems = React.useMemo(() => [...items, TIMELINE_BOTTOM_SENTINEL], [items])
  const scrollController = useThreadScrollController({
    active: Boolean(scrollToBottom),
    contentRevision: items.at(-1),
    initialScrollOffset,
    itemCount: count,
    layoutResizeActive,
    listRef: listHandle,
    onScroll,
    scrollRef,
    sessionKey,
  })

  const { beginProgrammaticScroll, pauseFollowing, returnToBottom } = scrollController

  React.useImperativeHandle(
    navigationRef,
    () => ({
      captureHistoryAnchor: () => {
        const revision = navigationRevisionRef.current
        return captureThreadHistoryAnchor(
          listHandle.current,
          scrollRef.current,
          () => navigationRevisionRef.current === revision,
        )
      },
      revealInput: (target, behavior): boolean => {
        cancelNavigation()
        const root = scrollRef.current
        const handle = listHandle.current
        if (!root || !handle) return false
        pauseFollowing()
        const alignInput = (): boolean => {
          const input = [...root.querySelectorAll<HTMLElement>('[data-input-navigation-id]')].find(
            (node) =>
              node.dataset.inputNavigationId === target.inputId &&
              node.closest<HTMLElement>('[data-turn-navigation-id]')?.dataset.turnNavigationId ===
                target.turnId,
          )
          if (!input) return false
          const smooth = beginProgrammaticScroll(behavior === 'smooth')
          root.scrollTo({
            top:
              root.scrollTop + input.getBoundingClientRect().top - root.getBoundingClientRect().top,
            behavior: smooth ? 'smooth' : 'instant',
          })
          if (!reducedMotion) {
            const bubble = input.querySelector<HTMLElement>('[data-user-message-bubble]') ?? input
            bubble.animate?.(
              [
                {
                  backgroundColor:
                    'color-mix(in srgb, var(--cpx-sys-color-fg-primary) 14%, transparent)',
                },
                {
                  backgroundColor:
                    'color-mix(in srgb, var(--cpx-sys-color-fg-primary) 14%, transparent)',
                  offset: 0.35,
                },
                {
                  backgroundColor:
                    'color-mix(in srgb, var(--cpx-sys-color-fg-primary) 5%, transparent)',
                },
              ],
              { duration: 350, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
            )
          }
          return true
        }
        if (alignInput()) return true
        beginProgrammaticScroll(false)
        handle.scrollToIndex(target.rowIndex, { align: 'start' })
        let attempts = 12
        const alignMountedInput = () => {
          navigationFrameRef.current = null
          if (alignInput() || --attempts === 0) return
          navigationFrameRef.current = window.requestAnimationFrame(alignMountedInput)
        }
        navigationFrameRef.current = window.requestAnimationFrame(alignMountedInput)
        return true
      },
      revealTurn: (index: number, behavior: 'smooth' | 'instant'): boolean => {
        cancelNavigation()
        const handle = listHandle.current
        if (!handle) return false
        const smooth = beginProgrammaticScroll(behavior === 'smooth')
        try {
          handle.scrollToIndex(index, { align: 'start', smooth })
          return true
        } catch {
          return false
        }
      },
      returnToBottom: () => {
        cancelNavigation()
        returnToBottom()
      },
    }),
    [
      cancelNavigation,
      listHandle,
      reducedMotion,
      scrollRef,
      beginProgrammaticScroll,
      pauseFollowing,
      returnToBottom,
    ],
  )

  React.useEffect(() => {
    onCanReturnToBottomChange?.(scrollController.canReturnToBottom)
  }, [onCanReturnToBottomChange, scrollController.canReturnToBottom])

  React.useEffect(
    () => () => {
      onCanReturnToBottomChange?.(false)
    },
    [onCanReturnToBottomChange],
  )

  return (
    <div
      className="session-timeline-container tw:relative tw:mx-auto tw:min-w-0 tw:max-w-none tw:w-[var(--session-content-w,100%)]"
      data-component="session-timeline"
      data-session-key={sessionKey}
      data-scroll-mode={scrollController.mode}
    >
      <div className="session-timeline-virtualizer tw:relative tw:z-0 tw:w-full tw:outline-none tw:[&>:first-child]:w-full tw:[&>:first-child]:min-w-0">
        <Virtualizer
          data={virtualItems}
          key={sessionKey}
          ref={listHandle}
          scrollRef={scrollRef}
          onScroll={scrollController.handleScroll}
        >
          {(item, index) =>
            item === TIMELINE_BOTTOM_SENTINEL ? (
              <div
                aria-hidden="true"
                className="session-timeline-bottom-sentinel tw:relative tw:w-full tw:h-[calc(var(--thread-scroll-footer-fade-height)+var(--thread-scroll-content-bottom-gap))] tw:pointer-events-none"
                key="timeline-bottom-sentinel"
              >
                <div
                  ref={scrollController.bottomSentinelRef}
                  className="session-timeline-bottom-observer tw:absolute tw:inset-x-0 tw:bottom-0 tw:h-px tw:pointer-events-none"
                />
              </div>
            ) : (
              renderItem(item as T, index)
            )
          }
        </Virtualizer>
      </div>
    </div>
  )
}

/* ── Scroll helpers ─────────────────────────────────────── */

export function captureThreadHistoryAnchor(
  handle: VirtualizerHandle | null,
  root: HTMLElement | null,
  isCurrent: () => boolean = () => true,
): () => void {
  if (!handle || !root) return () => undefined
  const container = root.querySelector<HTMLElement>('[data-component="session-timeline"]')
  const sessionKey = container?.dataset.sessionKey
  const following = ['prework_follow', 'user_follow'].includes(container?.dataset.scrollMode ?? '')
  const previousSize = handle.scrollSize
  const previousOffset = handle.scrollOffset
  const top = root.getBoundingClientRect().top
  const input = [...root.querySelectorAll<HTMLElement>('[data-input-navigation-id]')].find(
    (node) => node.getBoundingClientRect().bottom >= top,
  )
  const inputId = input?.dataset.inputNavigationId
  const relativeTop = input ? input.getBoundingClientRect().top - top : 0
  return () => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        if (
          !isCurrent() ||
          !root.isConnected ||
          !container?.isConnected ||
          container.dataset.sessionKey !== sessionKey
        )
          return
        if (following) {
          handle.scrollTo(handle.scrollSize)
          return
        }
        handle.scrollTo(previousOffset + Math.max(0, handle.scrollSize - previousSize))
        let attempts = 12
        const align = () => {
          if (
            !isCurrent() ||
            !root.isConnected ||
            !container?.isConnected ||
            container.dataset.sessionKey !== sessionKey
          )
            return
          const anchor = [...root.querySelectorAll<HTMLElement>('[data-input-navigation-id]')].find(
            (node) => node.dataset.inputNavigationId === inputId,
          )
          if (anchor) {
            handle.scrollTo(
              root.scrollTop +
                anchor.getBoundingClientRect().top -
                root.getBoundingClientRect().top -
                relativeTop,
            )
          } else if (inputId && --attempts > 0) window.requestAnimationFrame(align)
        }
        window.requestAnimationFrame(align)
      }),
    )
  }
}

/**
 * Imperative scroll to a given index.
 */
export function scrollToIndex(
  handle: VirtualizerHandle | null,
  index: number,
  align: 'start' | 'end' | 'center' = 'start',
): void {
  if (!handle) return
  try {
    handle.scrollToIndex(index, { align })
  } catch {
    // Virtualizer may not be mounted yet
  }
}
