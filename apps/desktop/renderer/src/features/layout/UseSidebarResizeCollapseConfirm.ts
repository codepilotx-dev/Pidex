import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeLiveResizeSize } from './UseLiveResizeValue.js'

export const SIDEBAR_COLLAPSE_HOLD_MS = 600
export const SIDEBAR_COLLAPSE_TARGET_SIZE = 72
export const SIDEBAR_COLLAPSE_JITTER_TOLERANCE = 6

export type ResizePhase = 'idle' | 'dragging' | 'settling'

export type ResizeCollapseBehavior =
  { kind: 'hold-target' } | { kind: 'threshold'; threshold: number }

export const DEFAULT_RESIZE_COLLAPSE_BEHAVIOR = {
  kind: 'hold-target',
} as const satisfies ResizeCollapseBehavior

export type SidebarCollapseConfirmTarget = {
  x: number
  y: number
}

type ResizeStart = {
  x: number
  width: number
}

type StopResizeOutcome = 'commit' | 'restore' | 'collapse'

type ComputeSidebarResizeCollapseConfirmInput = {
  rawWidth: number
  minWidth: number
  pointerX: number
  pointerY: number
  previousTarget: SidebarCollapseConfirmTarget | null
  jitterTolerance: number
}

type ComputeSidebarResizeCollapseConfirmResult = {
  width: number
  armed: boolean
  restartHold: boolean
  target: SidebarCollapseConfirmTarget | null
}

type ShouldRestartSidebarCollapseHoldInput = {
  previousTarget: SidebarCollapseConfirmTarget | null
  pointerX: number
  pointerY: number
  jitterTolerance: number
}

type UseSidebarResizeCollapseConfirmInput = {
  collapsed: boolean
  maxWidth: number
  minWidth: number
  width: number
  onCollapse: () => void
  collapseEnabled?: boolean
  onResetSize?: () => void
  onResizePhaseChange?: (phase: ResizePhase) => void
  onResizePreview?: (width: number | null) => void
  onSetWidth: (width: number) => void
  collapseBehavior?: ResizeCollapseBehavior
  /** `'left'` (default): drag right edge to resize, pointer right = wider.
   *  `'right'`: drag left edge to resize, pointer left = wider.
   *  `'bottom'`: drag top edge to resize, pointer up = taller. */
  direction?: 'left' | 'right' | 'bottom'
  /** 键盘方向键步长；默认 8px（底栏 10px），Shift 仍为 32/40。 */
  keyboardStep?: number
  /** 每次指针移动回调未夹紧的原始尺寸；停止/取消时回调 null。 */
  onResizeRawSize?: (rawSize: number | null) => void
  /**
   * 提交前裁决：返回 false 表示调用方已自行处理本次结果（例如越界后隐藏内容），
   * hook 不再写入尺寸并立即回到 idle。
   */
  shouldCommitResizeSize?: (rawSize: number) => boolean
}

export type UseSidebarResizeCollapseConfirmResult = {
  collapseConfirmTarget: SidebarCollapseConfirmTarget | null
  collapseConfirmKey: number
  resizing: boolean
  handleLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  handleResizeKey: (event: React.KeyboardEvent<HTMLDivElement>) => void
  startResize: (event: React.PointerEvent<HTMLDivElement>) => void
}

export function shouldRestartSidebarCollapseHold({
  previousTarget,
  pointerX,
  pointerY,
  jitterTolerance,
}: ShouldRestartSidebarCollapseHoldInput): boolean {
  if (!previousTarget) return true
  return Math.hypot(previousTarget.x - pointerX, previousTarget.y - pointerY) > jitterTolerance
}

export function computeSidebarResizeCollapseConfirm({
  rawWidth,
  minWidth,
  pointerX,
  pointerY,
  previousTarget,
  jitterTolerance,
}: ComputeSidebarResizeCollapseConfirmInput): ComputeSidebarResizeCollapseConfirmResult {
  if (rawWidth > minWidth) {
    return {
      width: rawWidth,
      armed: false,
      restartHold: false,
      target: null,
    }
  }

  const restartHold = shouldRestartSidebarCollapseHold({
    previousTarget,
    pointerX,
    pointerY,
    jitterTolerance,
  })

  return {
    width: minWidth,
    armed: true,
    restartHold,
    target: restartHold ? { x: pointerX, y: pointerY } : previousTarget,
  }
}

export function shouldCollapseSidebarResize(
  rawWidth: number,
  collapseBehavior: ResizeCollapseBehavior,
): boolean {
  return collapseBehavior.kind === 'threshold' && rawWidth < collapseBehavior.threshold
}

export function useSidebarResizeCollapseConfirm({
  collapsed,
  maxWidth,
  minWidth,
  width,
  onCollapse,
  collapseEnabled = true,
  onResetSize,
  onResizePhaseChange,
  onResizePreview,
  onSetWidth,
  collapseBehavior = DEFAULT_RESIZE_COLLAPSE_BEHAVIOR,
  direction = 'left',
  keyboardStep,
  onResizeRawSize,
  shouldCommitResizeSize,
}: UseSidebarResizeCollapseConfirmInput): UseSidebarResizeCollapseConfirmResult {
  const [resizing, setResizing] = useState(false)
  const startRef = useRef<ResizeStart>({ x: 0, width })
  const lastRawWidthRef = useRef<number | null>(null)
  const [collapseConfirmTarget, setCollapseConfirmTarget] =
    useState<SidebarCollapseConfirmTarget | null>(null)
  const [collapseConfirmKey, setCollapseConfirmKey] = useState(0)
  const collapseConfirmTargetRef = useRef<SidebarCollapseConfirmTarget | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerTargetRef = useRef<HTMLDivElement | null>(null)
  const previewWidthRef = useRef<number | null>(null)
  const lastEmittedPreviewRef = useRef<number | null>(null)
  const pointerMoveFrameRef = useRef<number | null>(null)
  const pendingPointerMoveRef = useRef<{
    x: number
    y: number
  } | null>(null)
  const settlementFrameRef = useRef<number | null>(null)
  const settlementPaintFrameRef = useRef<number | null>(null)
  const pendingCommitWidthRef = useRef<number | null>(null)
  const resizePhaseRef = useRef<ResizePhase>('idle')
  const onResizePhaseChangeRef = useRef(onResizePhaseChange)
  const onResizePreviewRef = useRef(onResizePreview)
  const onResizeRawSizeRef = useRef(onResizeRawSize)
  const shouldCommitResizeSizeRef = useRef(shouldCommitResizeSize)

  onResizePhaseChangeRef.current = onResizePhaseChange
  onResizePreviewRef.current = onResizePreview
  onResizeRawSizeRef.current = onResizeRawSize
  shouldCommitResizeSizeRef.current = shouldCommitResizeSize

  const setResizePhase = useCallback((phase: ResizePhase): void => {
    if (resizePhaseRef.current === phase) return
    resizePhaseRef.current = phase
    onResizePhaseChangeRef.current?.(phase)
  }, [])

  const clearHoldTimer = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearCollapseConfirm = useCallback((): void => {
    const hadTimer = holdTimerRef.current !== null
    const hadTarget = collapseConfirmTargetRef.current !== null
    if (!hadTimer && !hadTarget) return
    clearHoldTimer()
    collapseConfirmTargetRef.current = null
    if (hadTarget) setCollapseConfirmTarget(null)
  }, [clearHoldTimer])

  const clearSettlementFrames = useCallback((): void => {
    if (settlementFrameRef.current !== null) {
      window.cancelAnimationFrame(settlementFrameRef.current)
      settlementFrameRef.current = null
    }
    if (settlementPaintFrameRef.current !== null) {
      window.cancelAnimationFrame(settlementPaintFrameRef.current)
      settlementPaintFrameRef.current = null
    }
  }, [])

  const emitPreview = useCallback((nextWidth: number): void => {
    const normalizedWidth = normalizeLiveResizeSize(nextWidth)
    previewWidthRef.current = normalizedWidth
    if (normalizedWidth === lastEmittedPreviewRef.current) return
    lastEmittedPreviewRef.current = normalizedWidth
    onResizePreviewRef.current?.(normalizedWidth)
  }, [])

  const clearPointerMoveFrame = useCallback((): void => {
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current)
      pointerMoveFrameRef.current = null
    }
    pendingPointerMoveRef.current = null
  }, [])

  const stopResize = useCallback(
    (outcome: StopResizeOutcome): void => {
      if (resizePhaseRef.current !== 'dragging') {
        if (outcome !== 'commit' && resizePhaseRef.current === 'settling') {
          pendingCommitWidthRef.current = null
          clearSettlementFrames()
          onResizePreviewRef.current?.(null)
          setResizePhase('idle')
        }
        return
      }

      const finalWidth = previewWidthRef.current
      const pointerId = pointerIdRef.current
      const pointerTarget = pointerTargetRef.current
      pointerIdRef.current = null
      pointerTargetRef.current = null
      if (pointerId !== null && pointerTarget?.hasPointerCapture(pointerId)) {
        pointerTarget.releasePointerCapture(pointerId)
      }
      clearPointerMoveFrame()
      previewWidthRef.current = null
      lastEmittedPreviewRef.current = null
      lastRawWidthRef.current = null
      onResizeRawSizeRef.current?.(null)
      setResizing(false)
      clearCollapseConfirm()
      document.body.classList.remove(
        'workbench-is-resizing',
        'right-dock-is-resizing',
        'bottom-panel-is-resizing',
      )
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (!onResizePreviewRef.current) {
        setResizePhase('idle')
        return
      }

      if (outcome === 'collapse') {
        pendingCommitWidthRef.current = null
        setResizePhase('idle')
        return
      }

      if (outcome !== 'commit' || finalWidth === null) {
        pendingCommitWidthRef.current = null
        onResizePreviewRef.current(null)
        setResizePhase('idle')
        return
      }

      const rawWidth = lastRawWidthRef.current
      if (rawWidth !== null && shouldCommitResizeSizeRef.current?.(rawWidth) === false) {
        pendingCommitWidthRef.current = null
        onResizePreviewRef.current(null)
        setResizePhase('idle')
        return
      }

      setResizePhase('settling')
      pendingCommitWidthRef.current = finalWidth
      onSetWidth(finalWidth)
    },
    [
      clearCollapseConfirm,
      clearSettlementFrames,
      clearPointerMoveFrame,
      onSetWidth,
      setResizePhase,
    ],
  )

  const collapseFromResize = useCallback((): void => {
    stopResize('collapse')
    onCollapse()
    window.requestAnimationFrame(() => {
      onResizePreviewRef.current?.(null)
    })
  }, [onCollapse, stopResize])

  useEffect(() => {
    const pendingWidth = pendingCommitWidthRef.current
    if (
      resizePhaseRef.current !== 'settling' ||
      pendingWidth === null ||
      Math.abs(width - pendingWidth) > 1
    ) {
      return
    }
    pendingCommitWidthRef.current = null
    clearSettlementFrames()
    settlementFrameRef.current = window.requestAnimationFrame(() => {
      settlementFrameRef.current = null
      settlementPaintFrameRef.current = window.requestAnimationFrame(() => {
        settlementPaintFrameRef.current = null
        onResizePreviewRef.current?.(null)
        setResizePhase('idle')
      })
    })
  }, [clearSettlementFrames, setResizePhase, width])

  const scheduleCollapseHold = useCallback((): void => {
    clearHoldTimer()
    setCollapseConfirmKey((current) => current + 1)
    holdTimerRef.current = window.setTimeout(() => {
      collapseFromResize()
    }, SIDEBAR_COLLAPSE_HOLD_MS)
  }, [clearHoldTimer, collapseFromResize])

  const processPointerMove = useCallback(
    (pointerX: number, pointerY: number): void => {
      if (resizePhaseRef.current !== 'dragging') return
      const pointerPosition = direction === 'bottom' ? pointerY : pointerX
      const start = startRef.current
      const rawWidth =
        direction === 'left'
          ? start.width + pointerPosition - start.x
          : start.width + start.x - pointerPosition
      lastRawWidthRef.current = rawWidth
      onResizeRawSizeRef.current?.(rawWidth)
      if (!collapseEnabled) {
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, rawWidth))
        if (onResizePreview) emitPreview(nextWidth)
        return
      }
      if (shouldCollapseSidebarResize(rawWidth, collapseBehavior)) {
        collapseFromResize()
        return
      }
      if (collapseBehavior.kind === 'threshold') {
        const nextWidth = Math.min(maxWidth, Math.max(minWidth, rawWidth))
        if (onResizePreview) emitPreview(nextWidth)
        else onSetWidth(nextWidth)
        clearCollapseConfirm()
        return
      }
      const result = computeSidebarResizeCollapseConfirm({
        rawWidth,
        minWidth,
        pointerX,
        pointerY,
        previousTarget: collapseConfirmTargetRef.current,
        jitterTolerance: SIDEBAR_COLLAPSE_JITTER_TOLERANCE,
      })

      const nextWidth = Math.min(maxWidth, result.width)
      if (onResizePreview) emitPreview(nextWidth)
      else onSetWidth(nextWidth)

      if (!result.armed) {
        clearCollapseConfirm()
        return
      }
      if (result.restartHold && result.target) {
        collapseConfirmTargetRef.current = result.target
        setCollapseConfirmTarget(result.target)
        scheduleCollapseHold()
      }
    },
    [
      clearCollapseConfirm,
      collapseBehavior,
      collapseEnabled,
      direction,
      maxWidth,
      minWidth,
      collapseFromResize,
      onResizePreview,
      onSetWidth,
      emitPreview,
      scheduleCollapseHold,
      stopResize,
    ],
  )

  const flushPointerMove = useCallback((): void => {
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current)
      pointerMoveFrameRef.current = null
    }
    const pending = pendingPointerMoveRef.current
    pendingPointerMoveRef.current = null
    if (pending) processPointerMove(pending.x, pending.y)
  }, [processPointerMove])

  const queuePointerMove = useCallback(
    (pointerX: number, pointerY: number): void => {
      pendingPointerMoveRef.current = { x: pointerX, y: pointerY }
      if (pointerMoveFrameRef.current !== null) return
      pointerMoveFrameRef.current = window.requestAnimationFrame(() => {
        pointerMoveFrameRef.current = null
        const pending = pendingPointerMoveRef.current
        pendingPointerMoveRef.current = null
        if (pending) processPointerMove(pending.x, pending.y)
      })
    },
    [processPointerMove],
  )

  useEffect(() => {
    if (!resizing) return

    const handleWindowBlur = (): void => stopResize('restore')
    window.addEventListener('blur', handleWindowBlur)
    document.body.classList.add('workbench-is-resizing')
    if (direction === 'bottom') {
      document.body.classList.add('bottom-panel-is-resizing')
    } else if (direction === 'right') {
      document.body.classList.add('right-dock-is-resizing')
    }
    document.body.style.cursor = direction === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      document.body.classList.remove(
        'workbench-is-resizing',
        'right-dock-is-resizing',
        'bottom-panel-is-resizing',
      )
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      clearHoldTimer()
      clearPointerMoveFrame()
    }
  }, [clearHoldTimer, clearPointerMoveFrame, direction, resizing, stopResize])

  useEffect(() => {
    return () => {
      clearSettlementFrames()
      clearPointerMoveFrame()
      onResizePreviewRef.current?.(null)
      resizePhaseRef.current = 'idle'
    }
  }, [clearPointerMoveFrame, clearSettlementFrames])

  useEffect(() => {
    if (collapsed) {
      stopResize('restore')
    }
  }, [collapsed, stopResize])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerIdRef.current = event.pointerId
    pointerTargetRef.current = event.currentTarget
    clearSettlementFrames()
    startRef.current = {
      x: direction === 'bottom' ? event.clientY : event.clientX,
      width,
    }
    const normalizedWidth = normalizeLiveResizeSize(width)
    previewWidthRef.current = normalizedWidth
    lastEmittedPreviewRef.current = normalizedWidth
    onResizePreview?.(normalizedWidth)
    setResizePhase('dragging')
    setResizing(true)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return
    queuePointerMove(event.clientX, event.clientY)
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return
    flushPointerMove()
    stopResize('commit')
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return
    stopResize('restore')
  }

  function handleLostPointerCapture(event: React.PointerEvent<HTMLDivElement>): void {
    if (pointerIdRef.current !== event.pointerId) return
    stopResize('restore')
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return
    const step = event.shiftKey
      ? direction === 'bottom'
        ? 40
        : 32
      : (keyboardStep ?? (direction === 'bottom' ? 10 : 8))
    const decreaseKey =
      direction === 'left' ? 'ArrowLeft' : direction === 'right' ? 'ArrowRight' : 'ArrowDown'
    const increaseKey =
      direction === 'left' ? 'ArrowRight' : direction === 'right' ? 'ArrowLeft' : 'ArrowUp'
    if (event.key === decreaseKey) {
      event.preventDefault()
      onSetWidth(Math.max(minWidth, width - step))
    } else if (event.key === increaseKey) {
      event.preventDefault()
      onSetWidth(Math.min(maxWidth, width + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (onResetSize) onResetSize()
      else onSetWidth(minWidth)
    } else if (event.key === 'End') {
      event.preventDefault()
      onSetWidth(maxWidth)
    }
  }

  return {
    collapseConfirmTarget,
    collapseConfirmKey,
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerMove,
    handlePointerUp,
    handleResizeKey,
    resizing,
    startResize,
  }
}
