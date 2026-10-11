import type React from 'react'
import {
  AnimatePresence,
  animate as animateMotionValue,
  motion,
  usePresence,
  useMotionValueEvent,
} from 'motion/react'
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import {
  exitTween,
  instantTween,
  layoutTween,
  motionTransition,
  workspacePanelExitSpring,
  workspacePanelSpring,
} from '../../motion/MotionTransitions.js'
import type { WorkbenchPanelTarget } from '../dock/RightDockState.js'
import type { LiveResizeValue } from '../UseLiveResizeValue.js'
import type { ResizePhase } from '../UseSidebarResizeCollapseConfirm.js'

type Props = {
  children: React.ReactNode
  liveResize: LiveResizeValue
  mainRouteRef: React.RefObject<HTMLDivElement | null>
  workspaceRef: React.RefObject<HTMLDivElement | null>
  minSize: number
  size: number
  target: WorkbenchPanelTarget
  visible: boolean
  /**
   * 右工作区在隐藏时保留宿主：布局切换只改变几何、可见性与 inert，
   * 已打开的内容（含滚动、编辑草稿）不会被卸载重建。
   */
  keepMounted?: boolean
  onResizePhaseChange?: (phase: ResizePhase) => void
}

export type WorkbenchPanelLiveResize = LiveResizeValue & {
  committedSize: number
  phase: ResizePhase
  previewSize: (nextSize: number | null) => void
  setPhase: (phase: ResizePhase) => void
  target: WorkbenchPanelTarget
}

const WorkbenchPanelResizePreviewContext = createContext<WorkbenchPanelLiveResize | null>(null)

export function useWorkbenchPanelLiveResize(
  target: WorkbenchPanelTarget,
): WorkbenchPanelLiveResize | null {
  const context = useContext(WorkbenchPanelResizePreviewContext)
  return context?.target === target ? context : null
}

export function WorkbenchPanelPresence({
  children,
  keepMounted = false,
  liveResize,
  mainRouteRef,
  workspaceRef,
  minSize,
  size,
  target,
  visible,
  onResizePhaseChange,
}: Props): React.ReactNode {
  const initiallyVisibleRef = useRef(visible)

  return (
    <AnimatePresence initial={false}>
      {keepMounted || visible ? (
        <WorkbenchPanelPresenceItem
          key={target}
          liveResize={liveResize}
          mainRouteRef={mainRouteRef}
          workspaceRef={workspaceRef}
          minSize={minSize}
          size={size}
          skipEnterAnimation={initiallyVisibleRef.current}
          target={target}
          visible={visible}
          onResizePhaseChange={onResizePhaseChange}
        >
          {children}
        </WorkbenchPanelPresenceItem>
      ) : null}
    </AnimatePresence>
  )
}

function WorkbenchPanelPresenceItem({
  children,
  liveResize,
  mainRouteRef,
  workspaceRef,
  minSize,
  size,
  skipEnterAnimation,
  target,
  visible,
  onResizePhaseChange,
}: Omit<Props, 'visible' | 'keepMounted'> & {
  skipEnterAnimation: boolean
  visible: boolean
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const shellRef = useRef<HTMLDivElement>(null)
  const [entryComplete, setEntryComplete] = useState(skipEnterAnimation)
  const [resizePhase, setResizePhase] = useState<ResizePhase>('idle')
  const isBottom = target === 'bottom'
  const { liveSize, liveSizePixels, previewSize } = liveResize
  const shown = isPresent && visible

  useMotionValueEvent(liveSizePixels, 'change', (nextSize) => {
    if (target !== 'right') return
    workspaceRef.current?.style.setProperty('--workspace-right-panel-live-width', nextSize)
  })

  const updateResizePhase = useCallback(
    (phase: ResizePhase): void => {
      setResizePhase((current) => (current === phase ? current : phase))
      onResizePhaseChange?.(phase)
    },
    [onResizePhaseChange],
  )
  const resizePreviewContext = useMemo<WorkbenchPanelLiveResize>(
    () => ({
      committedSize: size,
      liveSize,
      liveSizePixels,
      phase: resizePhase,
      previewSize,
      setPhase: updateResizePhase,
      target,
    }),
    [liveSize, liveSizePixels, previewSize, resizePhase, size, target, updateResizePhase],
  )
  const visibleState = isBottom ? { height: size, opacity: 1, y: 0 } : { opacity: 1, x: 0 }
  const hiddenState = isBottom ? { height: 0, opacity: 0, y: 8 } : { opacity: 0, x: 8 }
  const spacerVisibleState = { height: size }
  const spacerHiddenState = { height: 0 }
  const enforcedMinSize = shown && entryComplete ? minSize : 0
  const liveSizeStyle = isBottom
    ? { height: liveSize, minHeight: enforcedMinSize }
    : { minWidth: enforcedMinSize, width: liveSize }

  useLayoutEffect(() => {
    if (target === 'right') {
      workspaceRef.current?.style.setProperty(
        '--workspace-right-panel-live-width',
        `${liveSize.get()}px`,
      )
    }
    return () => {
      if (target === 'right') {
        workspaceRef.current?.style.removeProperty('--workspace-right-panel-live-width')
      }
    }
  }, [liveSize, target, workspaceRef])

  useLayoutEffect(() => {
    if (target !== 'right') return
    if (!shown) {
      const controls = animateMotionValue(
        liveSize,
        0,
        motionTransition(reducedMotion, workspacePanelExitSpring),
      )
      return () => controls.stop()
    }
    if (entryComplete) {
      // 已提交尺寸变化同样走宽度 spring，而不是直接跳变。
      if (liveSize.get() === size) return
      const controls = animateMotionValue(
        liveSize,
        size,
        motionTransition(reducedMotion, workspacePanelSpring),
      )
      return () => controls.stop()
    }
    if (skipEnterAnimation) {
      liveSize.set(size)
      return
    }
    liveSize.set(0)
    const controls = animateMotionValue(
      liveSize,
      size,
      motionTransition(reducedMotion, workspacePanelSpring),
    )
    return () => controls.stop()
  }, [entryComplete, shown, liveSize, reducedMotion, size, skipEnterAnimation, target])

  useLayoutEffect(() => {
    if (shown) return
    setEntryComplete(false)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && shellRef.current?.contains(activeElement)) {
      mainRouteRef.current?.focus({ preventScroll: true })
    }
  }, [shown, mainRouteRef])

  useEffect(
    () => () => {
      onResizePhaseChange?.('idle')
    },
    [onResizePhaseChange],
  )

  useEffect(() => {
    if (!reducedMotion || !shown) return
    setEntryComplete(true)
  }, [shown, reducedMotion])

  useEffect(() => {
    if (isPresent || !safeToRemove) return
    const timeout = window.setTimeout(
      safeToRemove,
      reducedMotion ? 0 : (exitTween.duration as number) * 1_000,
    )
    return () => window.clearTimeout(timeout)
  }, [isPresent, reducedMotion, safeToRemove])

  return (
    <WorkbenchPanelResizePreviewContext.Provider value={resizePreviewContext}>
      {isBottom ? (
        <motion.div
          aria-hidden="true"
          animate={
            isPresent
              ? spacerVisibleState
              : {
                  ...spacerHiddenState,
                  transition: motionTransition(reducedMotion, exitTween),
                }
          }
          className="desktop-workspace-panel-spacer desktop-workspace-panel-spacer--bottom"
          initial={skipEnterAnimation ? false : spacerHiddenState}
          style={liveSizeStyle}
          transition={motionTransition(reducedMotion, entryComplete ? instantTween : layoutTween)}
        />
      ) : null}
      <motion.div
        ref={shellRef}
        aria-hidden={!shown ? true : undefined}
        animate={
          shown
            ? visibleState
            : {
                ...hiddenState,
                transition: motionTransition(
                  reducedMotion,
                  isBottom ? exitTween : workspacePanelExitSpring,
                ),
              }
        }
        className={[
          'desktop-workspace-panel',
          `desktop-workspace-panel--${target === 'right' ? 'right' : 'bottom'}`,
        ]
          .filter(Boolean)
          .join(' ')}
        data-workbench-panel-presence={shown ? 'open' : 'hidden'}
        initial={skipEnterAnimation ? false : hiddenState}
        inert={!shown ? true : undefined}
        onAnimationComplete={() => {
          if (shown) setEntryComplete(true)
        }}
        style={liveSizeStyle}
        transition={motionTransition(
          reducedMotion,
          entryComplete ? instantTween : isBottom ? layoutTween : workspacePanelSpring,
        )}
      >
        <div className="desktop-workspace-panel__surface">{children}</div>
      </motion.div>
    </WorkbenchPanelResizePreviewContext.Provider>
  )
}
