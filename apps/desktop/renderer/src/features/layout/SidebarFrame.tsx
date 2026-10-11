import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Bot, History } from 'lucide-react'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { animate, motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'
import { layoutTween, motionTransition } from '../motion/MotionTransitions.js'
import { useSidebarResizeCollapseConfirm } from './UseSidebarResizeCollapseConfirm.js'
import { useLiveResizeValue } from './UseLiveResizeValue.js'
import {
  SIDEBAR_PREVIEW_ENTER_DURATION,
  SIDEBAR_PREVIEW_EXIT_DURATION,
  SIDEBAR_PREVIEW_SETTLE_DURATION,
  type SidebarShellController,
} from './SidebarShellState.js'
import { SIDEBAR_RAIL_WIDTH } from './sidebar/SidebarNavigation.js'
import { cx } from '../../utils/Cx.js'

export type SidebarContentKind = 'tasks' | 'settings'

export function getSidebarContentLabels(contentKind: SidebarContentKind): {
  resize: string
  sidebar: string
} {
  const name = contentKind === 'settings' ? '设置侧栏' : '任务侧栏'
  return {
    resize: `调整${name}宽度`,
    sidebar: name,
  }
}

type Props = {
  rail?: React.ReactNode
  children: React.ReactNode
  collapsed: boolean
  contentKind: SidebarContentKind
  maxWidth: number
  minWidth: number
  width: number
  defaultWidth: number
  onCollapse: () => void
  onSetWidth: (width: number) => void
  shell: SidebarShellController
}

export function SidebarFrame({
  rail,
  children,
  collapsed,
  contentKind,
  maxWidth,
  minWidth,
  width,
  defaultWidth,
  onCollapse,
  onSetWidth,
  shell,
}: Props): React.ReactNode {
  const railWidth = SIDEBAR_RAIL_WIDTH
  const sidebarRef = useRef<HTMLElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const labels = getSidebarContentLabels(contentKind)
  const {
    liveSize: liveWidth,
    liveSizePixels: liveWidthPixels,
    previewSize: previewWidth,
  } = useLiveResizeValue(width)
  const handleResetWidth = useCallback((): void => {
    onSetWidth(defaultWidth)
  }, [defaultWidth, onSetWidth])

  const {
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerMove,
    handlePointerUp,
    handleResizeKey,
    resizing,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: shell.mode === 'collapsed' && collapsed,
    maxWidth,
    minWidth,
    width,
    collapseBehavior: {
      kind: 'threshold',
      threshold: minWidth / 2,
    },
    onCollapse,
    onResetSize: handleResetWidth,
    onResizePreview: previewWidth,
    onSetWidth,
  })

  const floating = shell.mode === 'preview'
  const hidden = shell.mode === 'collapsed'
  const docked = shell.dockedVisible
  const previousModeRef = useRef(shell.mode)
  const modeDurationRef = useRef(0.3)
  if (previousModeRef.current !== shell.mode) {
    const previousMode = previousModeRef.current
    previousModeRef.current = shell.mode
    if (shell.mode === 'preview') {
      modeDurationRef.current = SIDEBAR_PREVIEW_ENTER_DURATION
    } else if (previousMode === 'preview' && shell.mode === 'docked') {
      modeDurationRef.current = SIDEBAR_PREVIEW_SETTLE_DURATION
    } else if (previousMode === 'preview' && shell.mode === 'collapsed') {
      modeDurationRef.current = SIDEBAR_PREVIEW_EXIT_DURATION
    } else {
      modeDurationRef.current = 0.3
    }
  }
  const duration = modeDurationRef.current
  const transition = { ...layoutTween, duration }
  const dockedRef = useRef(docked)
  dockedRef.current = docked
  const allocatedWidth = useMotionValue(docked ? width : railWidth)
  const allocatedWidthAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const previousHiddenRef = useRef(hidden)

  useMotionValueEvent(liveWidth, 'change', (nextWidth) => {
    if (!dockedRef.current) return
    allocatedWidthAnimationRef.current?.stop()
    allocatedWidthAnimationRef.current = null
    allocatedWidth.set(nextWidth)
  })

  useEffect(() => {
    const animation = animate(
      allocatedWidth,
      docked ? liveWidth.get() : railWidth,
      motionTransition(reducedMotion, transition),
    )
    allocatedWidthAnimationRef.current = animation
    return () => {
      animation.stop()
      if (allocatedWidthAnimationRef.current === animation) {
        allocatedWidthAnimationRef.current = null
      }
    }
  }, [allocatedWidth, docked, liveWidth, reducedMotion, duration, railWidth])

  useEffect(() => {
    const active = floating && resizing
    shell.onFloatingResizeChange(active)
    return () => {
      if (active) shell.onFloatingResizeChange(false)
    }
  }, [floating, resizing, shell.onFloatingResizeChange])

  useLayoutEffect(() => {
    const wasHidden = previousHiddenRef.current
    previousHiddenRef.current = hidden
    if (!hidden || wasHidden) return

    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement) || !sidebarRef.current?.contains(activeElement))
      return
    document
      .querySelector<HTMLElement>('[data-app-shell-sidebar-trigger]')
      ?.focus({ preventScroll: true })
  }, [hidden])

  return (
    <>
      <div
        className="desktop-sidebar-rail-slot tw:absolute tw:inset-y-0 tw:left-0 tw:z-composer tw:w-[var(--sidebar-rail-width)] tw:bg-app-sidebar"
        data-sidebar-layout="modern"
        style={{ '--sidebar-rail-width': `${railWidth}px` } as React.CSSProperties}
      >
        {rail}
      </div>
      <motion.div
        aria-hidden="true"
        className="desktop-sidebar-spacer tw:w-0 tw:min-w-0 tw:flex-none"
        style={{ width: allocatedWidth }}
      />
      <motion.aside
        id="desktop-sidebar-pane"
        ref={sidebarRef}
        onClick={
          docked
            ? undefined
            : () => {
                shell.pin()
              }
        }
        onPointerEnter={floating ? shell.onPreviewPanelEnter : undefined}
        onPointerLeave={floating ? shell.onPreviewPanelLeave : undefined}
        aria-label={labels.sidebar}
        aria-hidden={hidden || undefined}
        className={cx(
          'desktop-sidebar tw:absolute tw:inset-y-0 tw:flex tw:h-full tw:flex-none tw:flex-col tw:overflow-hidden tw:select-none tw:type-body tw:text-app-text tw:antialiased tw:[text-rendering:optimizeLegibility]',
          // Modern 布局：面板起点与宽度按图标栏宽度让位。
          'tw:left-[var(--sidebar-rail-width)] tw:w-[calc(var(--sidebar-current-width)-var(--sidebar-rail-width))]',
          `is-${shell.mode}`,
          floating
            ? 'is-floating tw:[&.is-resizing]:border-r-app-border-strong tw:has-[.sidebar-resizer:hover]:border-r-app-border-strong tw:has-[.sidebar-resizer:focus-visible]:border-r-app-border-strong tw:z-composer tw:rounded-xl tw:border-r tw:border-app-border tw:bg-app-raised tw:shadow-lg'
            : 'tw:z-dock',
          !floating && docked ? 'is-docked tw:bg-app-main' : undefined,
          !floating && !docked ? 'tw:bg-app-sidebar' : undefined,
          hidden ? 'is-collapsed tw:pointer-events-none' : undefined,
          resizing ? 'is-resizing' : undefined,
        )}
        animate={
          hidden
            ? {
                opacity: 0,
                x: -8,
                transitionEnd: { visibility: 'hidden' },
              }
            : {
                opacity: 1,
                visibility: 'visible',
                x: 0,
              }
        }
        data-sidebar-content={contentKind}
        data-sidebar-layout="modern"
        data-sidebar-pane={shell.pane ?? undefined}
        initial={hidden ? { opacity: 0, visibility: 'hidden', x: -8 } : false}
        inert={hidden ? true : undefined}
        style={
          {
            '--sidebar-current-width': liveWidthPixels,
            '--sidebar-rail-width': `${railWidth}px`,
          } as unknown as React.CSSProperties
        }
        transition={motionTransition(reducedMotion, transition)}
      >
        {children}

        {shell.mode === 'docked' || shell.mode === 'preview' ? (
          <div
            aria-label={labels.resize}
            aria-orientation="vertical"
            aria-valuemax={maxWidth}
            aria-valuemin={minWidth}
            aria-valuenow={width}
            className="sidebar-resizer tw:absolute tw:inset-y-0 tw:right-0 tw:z-local tw:w-1.5 tw:cursor-col-resize tw:touch-none tw:focus-visible:outline-none"
            onDoubleClick={handleResetWidth}
            onKeyDown={handleResizeKey}
            onLostPointerCapture={handleLostPointerCapture}
            onPointerCancel={handlePointerCancel}
            onPointerDown={startResize}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            role="separator"
            tabIndex={0}
          />
        ) : null}
        <div className="icon-button sidebar-brand-floating tw:hidden tw:text-app-text-meta">
          <Bot size={APP_ICON_SIZE} />
        </div>
        <History
          className="icon-button sidebar-history-watermark tw:hidden tw:text-app-text-meta"
          size={APP_ICON_SIZE}
        />
      </motion.aside>
    </>
  )
}
