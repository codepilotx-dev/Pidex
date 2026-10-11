import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import {
  buildPopoverSizingStyle,
  type PopoverSizingProps,
} from '../../../components/ui/PopoverSizing.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { cx } from '../../../utils/Cx.js'
import {
  enterTween,
  exitTween,
  floatingSurfaceMotion,
  motionTransition,
} from '../../motion/MotionTransitions.js'

/*
 * The dropdown anchors above (or below) the composer input. Motion owns the
 * enter/exit transform, so only the static anchoring geometry lives here.
 */
const DROPDOWN_CLASS = cx(
  'popover-surface chat-input__dropdown tw:absolute tw:left-0 tw:z-popover',
  'tw:bottom-[calc(100%+var(--cpx-sys-space-1))]',
)
const DROPDOWN_SUGGESTION_CLASS = cx(
  'popover-surface chat-input__dropdown chat-input__dropdown--suggestion tw:absolute tw:left-0 tw:z-popover',
  'tw:bottom-[calc(100%+var(--cpx-sys-space-2))]',
)
const DROPDOWN_BOTTOM_CLASS = cx(
  'popover-surface chat-input__dropdown chat-input__dropdown--bottom tw:absolute tw:left-0 tw:z-popover',
  'tw:bottom-auto tw:top-[calc(100%+var(--cpx-sys-space-1))]',
)
const DROPDOWN_SUGGESTION_BOTTOM_CLASS = cx(
  'popover-surface chat-input__dropdown chat-input__dropdown--bottom chat-input__dropdown--suggestion tw:absolute tw:left-0 tw:z-popover',
  'tw:bottom-auto tw:top-[calc(100%+var(--cpx-sys-space-2))]',
)

type Props = {
  open: boolean
  onClose: (reason?: 'outside' | 'escape') => void
  side?: 'top' | 'bottom'
  children: React.ReactNode
  suggestion?: boolean
} & PopoverSizingProps

export type ComputeDropdownMaxHeightInput = {
  side: 'top' | 'bottom'
  anchorTop: number
  windowHeight: number
  maxCap: number
  safetyMargin: number
}

const DROPDOWN_MAX_CAP = 420
const DROPDOWN_SAFETY_MARGIN = 16

export function computeDropdownMaxHeight({
  side,
  anchorTop,
  windowHeight,
  maxCap,
  safetyMargin,
}: ComputeDropdownMaxHeightInput): number {
  const available =
    side === 'bottom' ? windowHeight - anchorTop - safetyMargin : anchorTop - safetyMargin
  return Math.max(0, Math.min(available, maxCap))
}

export function shouldCloseChatInputDropdownForClick(target: HTMLElement): boolean {
  const composerTop = target.closest('.composer-top')
  const dropdown = target.closest('.chat-input__dropdown')
  return !composerTop && !dropdown
}

export function ChatInputDropdown({
  open,
  onClose,
  side = 'top',
  size,
  children,
  suggestion = false,
}: Props): React.ReactNode | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const measure = (): void => {
      const el = ref.current
      if (!el) return
      const anchor = el.parentElement
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const anchorTop = side === 'top' ? rect.top : rect.bottom
      setMaxHeight(
        computeDropdownMaxHeight({
          side,
          anchorTop,
          windowHeight: window.innerHeight,
          maxCap: suggestion ? 320 : DROPDOWN_MAX_CAP,
          safetyMargin: DROPDOWN_SAFETY_MARGIN,
        }),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    if (ref.current.parentElement) observer.observe(ref.current.parentElement)
    return () => {
      window.removeEventListener('resize', measure)
      observer.disconnect()
    }
  }, [open, side, suggestion])

  useEffect(() => {
    if (!open) return

    function onDocumentClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (shouldCloseChatInputDropdownForClick(target)) {
        onClose('outside')
      }
    }

    function onEscKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode !== 229) {
        onClose('escape')
      }
    }

    document.addEventListener('click', onDocumentClick, true)
    document.addEventListener('keydown', onEscKey)
    return () => {
      document.removeEventListener('click', onDocumentClick, true)
      document.removeEventListener('keydown', onEscKey)
    }
  }, [open, onClose])

  const style: React.CSSProperties = buildPopoverSizingStyle({ size })
  if (maxHeight !== null) {
    style.maxHeight = `${maxHeight}px`
    style.overflowY = suggestion ? 'hidden' : 'auto'
    style.overflowX = 'hidden'
  }
  if (suggestion)
    Object.assign(style, { '--composer-suggestion-max-height': `${maxHeight ?? 320}px` })

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <ChatInputDropdownSurface
          key="chat-input-dropdown"
          size={size}
          maxHeightStyle={style}
          ref={ref}
          side={side}
          suggestion={suggestion}
        >
          {children}
        </ChatInputDropdownSurface>
      ) : null}
    </AnimatePresence>
  )
}

function ChatInputDropdownSurface({
  children,
  maxHeightStyle,
  size,
  ref,
  side,
  suggestion,
}: {
  children: React.ReactNode
  size: PopoverSizingProps['size']
  maxHeightStyle: React.CSSProperties
  ref: React.Ref<HTMLDivElement>
  side: 'top' | 'bottom'
  suggestion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()
  const reducedMotion = usePrefersReducedMotion()
  const surfaceMotion = floatingSurfaceMotion(side)

  return (
    <motion.div
      animate={surfaceMotion.animate}
      aria-hidden={!isPresent ? true : undefined}
      className={
        suggestion
          ? side === 'bottom'
            ? DROPDOWN_SUGGESTION_BOTTOM_CLASS
            : DROPDOWN_SUGGESTION_CLASS
          : side === 'bottom'
            ? DROPDOWN_BOTTOM_CLASS
            : DROPDOWN_CLASS
      }
      data-popover-size={size}
      data-presence={isPresent ? 'present' : 'exiting'}
      data-theme-component="dropdown-surface"
      exit={{
        ...surfaceMotion.exit,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={surfaceMotion.initial}
      onClick={(event) => event.stopPropagation()}
      ref={ref}
      style={{
        ...maxHeightStyle,
        pointerEvents: isPresent ? undefined : 'none',
      }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      <div className="chat-input__dropdown-content tw:p-2">{children}</div>
    </motion.div>
  )
}
