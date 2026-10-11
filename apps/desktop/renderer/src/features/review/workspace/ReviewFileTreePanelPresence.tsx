import type React from 'react'
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  usePresence,
  type MotionValue,
} from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import {
  exitTween,
  instantTween,
  layoutTween,
  motionTransition,
} from '../../motion/MotionTransitions.js'
import { REVIEW_FILE_TREE_PANEL_MIN_WIDTH } from '../diff/WorkspaceReviewDiff.js'

type Props = {
  children: React.ReactNode
  focusReturnRef: React.RefObject<HTMLButtonElement | null>
  liveWidthPixels: MotionValue<string>
  liveWidth: MotionValue<number>
  resizeHandle: React.ReactNode
  visible: boolean
  width: number
}

export function ReviewFileTreePanelPresence({
  children,
  focusReturnRef,
  liveWidthPixels,
  liveWidth,
  resizeHandle,
  visible,
  width,
}: Props): React.ReactNode {
  const initiallyVisibleRef = useRef(visible)

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <ReviewFileTreePanelPresenceItem
          key="review-file-tree"
          focusReturnRef={focusReturnRef}
          liveWidthPixels={liveWidthPixels}
          liveWidth={liveWidth}
          resizeHandle={resizeHandle}
          skipEnterAnimation={initiallyVisibleRef.current}
          width={width}
        >
          {children}
        </ReviewFileTreePanelPresenceItem>
      ) : null}
    </AnimatePresence>
  )
}

function ReviewFileTreePanelPresenceItem({
  children,
  focusReturnRef,
  liveWidthPixels,
  liveWidth,
  resizeHandle,
  skipEnterAnimation,
  width,
}: Omit<Props, 'visible'> & {
  skipEnterAnimation: boolean
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const shellRef = useRef<HTMLElement | null>(null)
  const [entryComplete, setEntryComplete] = useState(skipEnterAnimation)
  const visibleState = { opacity: 1, x: 0 }
  const hiddenState = { opacity: 0, x: 8 }
  const allocatedWidth = useMotionValue(skipEnterAnimation ? width : 0)
  const allocationAnimationRef = useRef<ReturnType<typeof animate> | null>(null)
  const isPresentRef = useRef(isPresent)
  isPresentRef.current = isPresent

  useMotionValueEvent(liveWidth, 'change', (nextWidth) => {
    if (!isPresentRef.current) return
    allocationAnimationRef.current?.stop()
    allocationAnimationRef.current = null
    allocatedWidth.set(nextWidth)
  })

  useEffect(() => {
    const animation = animate(
      allocatedWidth,
      isPresent ? liveWidth.get() : 0,
      motionTransition(reducedMotion, isPresent ? layoutTween : exitTween),
    )
    allocationAnimationRef.current = animation
    return () => {
      animation.stop()
      if (allocationAnimationRef.current === animation) {
        allocationAnimationRef.current = null
      }
    }
  }, [allocatedWidth, isPresent, liveWidth, reducedMotion, width])

  useLayoutEffect(() => {
    if (isPresent) return
    setEntryComplete(false)
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      (shellRef.current?.contains(activeElement) ||
        activeElement.matches('.review-file-tree-resize-handle'))
    ) {
      focusReturnRef.current?.focus({ preventScroll: true })
    }
  }, [focusReturnRef, isPresent])

  useEffect(() => {
    if (!reducedMotion || !isPresent) return
    setEntryComplete(true)
  }, [isPresent, reducedMotion])

  useEffect(() => {
    if (isPresent || !safeToRemove) return
    const timeout = window.setTimeout(
      safeToRemove,
      reducedMotion ? 0 : (exitTween.duration as number) * 1_000,
    )
    return () => window.clearTimeout(timeout)
  }, [isPresent, reducedMotion, safeToRemove])

  return (
    <>
      <span
        aria-hidden={!isPresent ? true : undefined}
        className="review-file-tree-resize-presence tw:contents"
        inert={!isPresent ? true : undefined}
      >
        {resizeHandle}
      </span>
      <motion.section
        ref={shellRef}
        aria-hidden={!isPresent ? true : undefined}
        aria-label="审查文件导航"
        animate={
          isPresent
            ? visibleState
            : {
                ...hiddenState,
                transition: motionTransition(reducedMotion, exitTween),
              }
        }
        className="review-file-tree-panel tw:relative tw:flex tw:w-[var(--review-file-tree-panel-w,340px)] tw:min-w-60 tw:min-h-0 tw:flex-none tw:flex-col tw:overflow-hidden tw:bg-app-panel tw:shadow-none tw:[contain:size_layout_paint]"
        data-presence={isPresent ? 'present' : 'exiting'}
        data-review-file-tree-presence={isPresent ? 'open' : 'exiting'}
        initial={skipEnterAnimation ? false : hiddenState}
        inert={!isPresent ? true : undefined}
        onAnimationComplete={() => {
          if (isPresent) setEntryComplete(true)
        }}
        style={{
          flexBasis: allocatedWidth,
          minWidth: isPresent && entryComplete ? REVIEW_FILE_TREE_PANEL_MIN_WIDTH : 0,
          width: allocatedWidth,
        }}
        transition={motionTransition(reducedMotion, entryComplete ? instantTween : layoutTween)}
      >
        <motion.div
          className="review-file-tree-panel-surface tw:flex tw:h-full tw:min-w-0 tw:min-h-0 tw:flex-col"
          style={{ width: liveWidthPixels }}
        >
          {children}
        </motion.div>
      </motion.section>
    </>
  )
}
