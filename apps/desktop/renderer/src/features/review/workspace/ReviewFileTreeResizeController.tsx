import React from 'react'
import type { MotionValue } from 'motion/react'
import { normalizeLiveResizeSize } from '../../layout/UseLiveResizeValue.js'
import {
  REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH,
  REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP,
  REVIEW_FILE_TREE_PANEL_MAX_WIDTH,
  REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
  clampReviewFileTreePanelWidth,
} from '../diff/WorkspaceReviewDiff.js'

type ReviewFileTreeResizeControllerProps = {
  containerRef: React.RefObject<HTMLDivElement | null>
  liveWidthPixels: MotionValue<string>
  width: number
  onResizePreview: (width: number | null) => void
  onSetWidth: (width: number) => void
}

type ResizeSession = {
  containerWidth: number | undefined
  lastEmittedWidth: number
  lastWidth: number
  pointerId: number
  startWidth: number
  startX: number
}

export function ReviewFileTreeResizeController({
  containerRef,
  width,
  onResizePreview,
  onSetWidth,
}: ReviewFileTreeResizeControllerProps): React.ReactNode {
  const handleRef = React.useRef<HTMLDivElement | null>(null)
  const resizeFrameRef = React.useRef<number | null>(null)
  const settleFrameRef = React.useRef<number | null>(null)
  const settlePaintFrameRef = React.useRef<number | null>(null)
  const pendingCommitWidthRef = React.useRef<number | null>(null)
  const removeNativeListenersRef = React.useRef<(() => void) | null>(null)
  const sessionRef = React.useRef<ResizeSession | null>(null)
  const onResizePreviewRef = React.useRef(onResizePreview)
  const onSetWidthRef = React.useRef(onSetWidth)
  onResizePreviewRef.current = onResizePreview
  onSetWidthRef.current = onSetWidth

  const clearNativeListeners = React.useCallback((): void => {
    removeNativeListenersRef.current?.()
    removeNativeListenersRef.current = null
  }, [])

  const clearScheduledFrames = React.useCallback((): void => {
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
    if (settleFrameRef.current !== null) {
      window.cancelAnimationFrame(settleFrameRef.current)
      settleFrameRef.current = null
    }
    if (settlePaintFrameRef.current !== null) {
      window.cancelAnimationFrame(settlePaintFrameRef.current)
      settlePaintFrameRef.current = null
    }
  }, [])

  const finishResize = React.useCallback(
    (commit: boolean): void => {
      const session = sessionRef.current
      if (!session) return
      sessionRef.current = null
      clearNativeListeners()
      clearScheduledFrames()

      const handle = handleRef.current
      if (handle?.hasPointerCapture(session.pointerId)) {
        handle.releasePointerCapture(session.pointerId)
      }

      if (!commit) {
        pendingCommitWidthRef.current = null
        onResizePreviewRef.current(null)
        containerRef.current?.removeAttribute('data-review-file-tree-resizing')
        handle?.setAttribute('aria-valuenow', String(session.startWidth))
        if (handle) delete handle.dataset.resizePhase
        return
      }

      onResizePreviewRef.current(session.lastWidth)
      handle?.setAttribute('aria-valuenow', String(session.lastWidth))
      if (handle) handle.dataset.resizePhase = 'settling'
      pendingCommitWidthRef.current = session.lastWidth
      onSetWidthRef.current(session.lastWidth)
    },
    [clearNativeListeners, clearScheduledFrames, containerRef],
  )

  React.useEffect(() => {
    const pendingWidth = pendingCommitWidthRef.current
    if (pendingWidth === null || width !== pendingWidth) return
    pendingCommitWidthRef.current = null
    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = null
      settlePaintFrameRef.current = window.requestAnimationFrame(() => {
        settlePaintFrameRef.current = null
        const handle = handleRef.current
        if (handle) delete handle.dataset.resizePhase
        onResizePreviewRef.current(null)
        containerRef.current?.removeAttribute('data-review-file-tree-resizing')
      })
    })
  }, [containerRef, width])

  React.useEffect(() => {
    const handleWindowBlur = (): void => finishResize(false)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      finishResize(false)
      clearNativeListeners()
      clearScheduledFrames()
    }
  }, [clearNativeListeners, clearScheduledFrames, finishResize])

  const setClampedWidth = React.useCallback(
    (nextWidth: number): void => {
      const containerWidth = containerRef.current?.getBoundingClientRect().width
      onSetWidthRef.current(clampReviewFileTreePanelWidth(nextWidth, containerWidth))
    },
    [containerRef],
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Home') {
        event.preventDefault()
        setClampedWidth(REVIEW_FILE_TREE_PANEL_MIN_WIDTH)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        setClampedWidth(REVIEW_FILE_TREE_PANEL_MAX_WIDTH)
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const step = event.shiftKey
        ? REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP * 3
        : REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP
      setClampedWidth(width + (event.key === 'ArrowLeft' ? step : -step))
    },
    [setClampedWidth, width],
  )

  const applyPointerMove = React.useCallback((clientX: number, pointerId: number): void => {
    const session = sessionRef.current
    if (!session || session.pointerId !== pointerId) return

    session.lastWidth = normalizeLiveResizeSize(
      clampReviewFileTreePanelWidth(
        session.startWidth + session.startX - clientX,
        session.containerWidth,
      ),
    )
    if (resizeFrameRef.current !== null) return
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const activeSession = sessionRef.current
      if (!activeSession) return
      if (activeSession.lastWidth === activeSession.lastEmittedWidth) return
      activeSession.lastEmittedWidth = activeSession.lastWidth
      onResizePreviewRef.current(activeSession.lastWidth)
      handleRef.current?.setAttribute('aria-valuenow', String(activeSession.lastWidth))
    })
  }, [])

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()

      finishResize(false)
      clearScheduledFrames()

      const containerRect = containerRef.current?.getBoundingClientRect()
      const handle = event.currentTarget
      const pointerId = event.pointerId
      const normalizedWidth = normalizeLiveResizeSize(width)
      sessionRef.current = {
        containerWidth: containerRect?.width,
        lastEmittedWidth: normalizedWidth,
        lastWidth: normalizedWidth,
        pointerId,
        startWidth: normalizedWidth,
        startX: event.clientX,
      }
      handle.setPointerCapture(pointerId)
      handle.dataset.resizePhase = 'dragging'
      containerRef.current?.setAttribute('data-review-file-tree-resizing', 'true')
      onResizePreviewRef.current(normalizedWidth)

      const handleDocumentPointerMove = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== pointerId) return
        pointerEvent.preventDefault()
        applyPointerMove(pointerEvent.clientX, pointerEvent.pointerId)
      }
      const handleDocumentPointerUp = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId === pointerId) finishResize(true)
      }
      const handleDocumentPointerCancel = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId === pointerId) finishResize(false)
      }
      document.addEventListener('pointermove', handleDocumentPointerMove, true)
      document.addEventListener('pointerup', handleDocumentPointerUp, true)
      document.addEventListener('pointercancel', handleDocumentPointerCancel, true)
      removeNativeListenersRef.current = () => {
        document.removeEventListener('pointermove', handleDocumentPointerMove, true)
        document.removeEventListener('pointerup', handleDocumentPointerUp, true)
        document.removeEventListener('pointercancel', handleDocumentPointerCancel, true)
      }
    },
    [applyPointerMove, clearScheduledFrames, containerRef, finishResize, width],
  )

  return (
    <>
      <div
        aria-label="调整审查文件导航宽度"
        aria-orientation="vertical"
        aria-valuemax={REVIEW_FILE_TREE_PANEL_MAX_WIDTH}
        aria-valuemin={REVIEW_FILE_TREE_PANEL_MIN_WIDTH}
        aria-valuenow={width}
        className="review-file-tree-resize-handle tw:relative tw:z-1 tw:w-2 tw:flex-none tw:-mr-1 tw:-ml-1 tw:cursor-col-resize tw:touch-none tw:select-none tw:outline-none"
        data-resize-handle="true"
        ref={handleRef}
        role="separator"
        tabIndex={0}
        title="拖拽调整文件导航宽度，双击恢复默认宽度"
        onDoubleClick={() => setClampedWidth(REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH)}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={(event) => {
          if (sessionRef.current?.pointerId === event.pointerId) {
            finishResize(false)
          }
        }}
        onPointerCancel={(event) => {
          if (sessionRef.current?.pointerId === event.pointerId) {
            finishResize(false)
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={(event) => {
          if (sessionRef.current?.pointerId === event.pointerId) {
            finishResize(true)
          }
        }}
      />
    </>
  )
}
