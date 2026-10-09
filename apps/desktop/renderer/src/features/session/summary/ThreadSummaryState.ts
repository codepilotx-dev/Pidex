import * as React from 'react'

export const THREAD_SUMMARY_PANEL_WIDTH = 300
/** 正文与摘要并排时预留的间隙，决定分裂态正文的偏移量。 */
export const THREAD_SUMMARY_SHIFT_GAP = 8
export const THREAD_SUMMARY_BODY_WIDTH = 736
export const THREAD_SUMMARY_OVERLAY_MAX_WIDTH = 1095
export const THREAD_SUMMARY_SHIFT_MAX_WIDTH = 1535
/** 置顶偏好是独立的 UI 偏好键；浮层开合只存在于当前会话状态。 */
export const THREAD_SUMMARY_PINNED_STORAGE_KEY = 'pidex.desktop.threadSummaryPinned.v1'

export type ThreadSummaryDisplayMode = 'overlay' | 'shift' | 'gutter'

export type ThreadSummaryPreferenceState = {
  isPinned: boolean
  isPopoverOpen: boolean
}

export type ThreadSummaryState = ThreadSummaryPreferenceState & {
  displayMode: ThreadSummaryDisplayMode
  shouldShowInline: boolean
  shiftOffset: number
}

const DEFAULT_PREFERENCE: ThreadSummaryPreferenceState = {
  isPinned: true,
  isPopoverOpen: false,
}

let preferenceSnapshot: ThreadSummaryPreferenceState | null = null
const preferenceListeners = new Set<() => void>()

export function readThreadSummaryPinnedPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(THREAD_SUMMARY_PINNED_STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    /* localStorage disabled; the default preference stays authoritative. */
  }
  return DEFAULT_PREFERENCE.isPinned
}

function writeThreadSummaryPinnedPreference(isPinned: boolean): void {
  try {
    window.localStorage.setItem(THREAD_SUMMARY_PINNED_STORAGE_KEY, String(isPinned))
  } catch {
    /* localStorage full or disabled; the in-memory preference remains authoritative. */
  }
}

function currentPreference(): ThreadSummaryPreferenceState {
  preferenceSnapshot ??= {
    isPinned: readThreadSummaryPinnedPreference(),
    isPopoverOpen: DEFAULT_PREFERENCE.isPopoverOpen,
  }
  return preferenceSnapshot
}

/** 唯一的偏好写入点：置顶变更写入 UI 偏好键，浮层开合只留在内存。 */
export function publishThreadSummaryPreference(next: ThreadSummaryPreferenceState): void {
  const current = currentPreference()
  if (next.isPinned === current.isPinned && next.isPopoverOpen === current.isPopoverOpen) {
    return
  }
  preferenceSnapshot = next
  if (next.isPinned !== current.isPinned) writeThreadSummaryPinnedPreference(next.isPinned)
  for (const listener of preferenceListeners) listener()
}

function subscribePreference(listener: () => void): () => void {
  preferenceListeners.add(listener)
  return () => preferenceListeners.delete(listener)
}

export function resolveThreadSummaryDisplayMode(
  containerWidth: number,
  panelWidth: number = THREAD_SUMMARY_PANEL_WIDTH,
): ThreadSummaryDisplayMode {
  const width = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0
  const g = (width - THREAD_SUMMARY_BODY_WIDTH) / 2
  const r = panelWidth - THREAD_SUMMARY_PANEL_WIDTH
  if (g < 180 + r / 2) return 'overlay'
  if (g < 400 + r) return 'shift'
  return 'gutter'
}

export function resolveThreadSummaryShiftOffset(params: {
  displayMode: ThreadSummaryDisplayMode
  isPinned: boolean
  panelWidth?: number
}): number {
  const panelWidth = params.panelWidth ?? THREAD_SUMMARY_PANEL_WIDTH
  // 正文让出摘要与间距的一半，使两者在新居中位置保持并排。
  return params.isPinned && params.displayMode === 'shift'
    ? -(panelWidth + THREAD_SUMMARY_SHIFT_GAP) / 2
    : 0
}

export function resolveThreadSummaryDisplayModeUpdate(
  currentMode: ThreadSummaryDisplayMode,
  containerWidth: number,
): ThreadSummaryDisplayMode | null {
  const nextMode = resolveThreadSummaryDisplayMode(containerWidth)
  return nextMode === currentMode ? null : nextMode
}

export function deriveThreadSummaryState(
  containerWidth: number,
  preference: ThreadSummaryPreferenceState,
): ThreadSummaryState {
  const displayMode = resolveThreadSummaryDisplayMode(containerWidth)
  return deriveThreadSummaryStateForMode(displayMode, preference)
}

function deriveThreadSummaryStateForMode(
  displayMode: ThreadSummaryDisplayMode,
  preference: ThreadSummaryPreferenceState,
): ThreadSummaryState {
  return {
    ...preference,
    displayMode,
    isPopoverOpen: displayMode === 'overlay' ? preference.isPopoverOpen : false,
    shouldShowInline: preference.isPinned && displayMode !== 'overlay',
    shiftOffset: resolveThreadSummaryShiftOffset({ displayMode, isPinned: preference.isPinned }),
  }
}

export function toggleThreadSummaryPreference(
  preference: ThreadSummaryPreferenceState,
  displayMode: ThreadSummaryDisplayMode,
): ThreadSummaryPreferenceState {
  if (displayMode === 'overlay') {
    return {
      ...preference,
      isPopoverOpen: !preference.isPopoverOpen,
    }
  }
  return {
    isPinned: !preference.isPinned,
    isPopoverOpen: false,
  }
}

export function transitionThreadSummaryMode(
  preference: ThreadSummaryPreferenceState,
  previousMode: ThreadSummaryDisplayMode,
  nextMode: ThreadSummaryDisplayMode,
): ThreadSummaryPreferenceState {
  if (previousMode === 'overlay' && nextMode !== 'overlay') {
    return { ...preference, isPopoverOpen: false }
  }
  return preference
}

export type ThreadSummaryController = ThreadSummaryState & {
  setPopoverOpen: (open: boolean) => void
  toggle: () => void
}

/** Agent 全部结束后延迟自动折叠该分区的等待时间。 */
export const THREAD_SUMMARY_AGENTS_AUTO_COLLAPSE_DELAY_MS = 30_000

export type ThreadSummaryAgentsCollapseDecision =
  | 'idle'
  | 'reset-override'
  | 'schedule-collapse'

/**
 * Agent 分区自动折叠决策：有活动 Agent 时清除手动覆盖；全部结束后若用户没有
 * 手动操作过该分区，则安排延迟折叠。手动折叠选择始终优先。
 */
export function resolveThreadSummaryAgentsAutoCollapse(input: {
  activeCount: number
  manualOverride: boolean
  totalCount: number
}): ThreadSummaryAgentsCollapseDecision {
  if (input.totalCount === 0) return 'idle'
  if (input.activeCount > 0) return 'reset-override'
  if (input.manualOverride) return 'idle'
  return 'schedule-collapse'
}

export function useThreadSummaryController(
  containerRef: React.RefObject<HTMLElement | null>,
): ThreadSummaryController {
  const preference = React.useSyncExternalStore(
    subscribePreference,
    currentPreference,
    () => DEFAULT_PREFERENCE,
  )
  const [displayMode, setDisplayMode] = React.useState<ThreadSummaryDisplayMode>('overlay')
  const displayModeRef = React.useRef(displayMode)
  const state = React.useMemo(
    () => deriveThreadSummaryStateForMode(displayMode, preference),
    [displayMode, preference],
  )
  const previousModeRef = React.useRef(state.displayMode)

  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateDisplayMode = (width: number): void => {
      if (!Number.isFinite(width)) return
      const nextMode = resolveThreadSummaryDisplayModeUpdate(
        displayModeRef.current,
        Math.max(0, width),
      )
      if (nextMode === null) return
      displayModeRef.current = nextMode
      setDisplayMode(nextMode)
    }
    updateDisplayMode(container.getBoundingClientRect().width)

    let observer: ResizeObserver | null = null
    try {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (!entry) return
        const width =
          entry.borderBoxSize?.[0]?.inlineSize ??
          entry.contentBoxSize?.[0]?.inlineSize ??
          entry.contentRect.width
        updateDisplayMode(width)
      })
      observer.observe(container)
    } catch {
      // The initial DOM measurement is a sufficient fallback.
    }
    return () => observer?.disconnect()
  }, [containerRef])

  React.useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = state.displayMode
    publishThreadSummaryPreference(
      transitionThreadSummaryMode(currentPreference(), previousMode, state.displayMode),
    )
  }, [state.displayMode])

  const setPopoverOpen = React.useCallback(
    (open: boolean): void => {
      publishThreadSummaryPreference({
        ...currentPreference(),
        isPopoverOpen: state.displayMode === 'overlay' && open,
      })
    },
    [state.displayMode],
  )

  const toggle = React.useCallback((): void => {
    publishThreadSummaryPreference(toggleThreadSummaryPreference(currentPreference(), state.displayMode))
  }, [state.displayMode])

  return {
    ...state,
    setPopoverOpen,
    toggle,
  }
}
