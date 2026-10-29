import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Info } from 'lucide-react'
import {
  mergeRefs,
  Portal,
  Slot,
  useControllableState,
  useTopLayer,
} from './floating/Primitives.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './IconTokens.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'

/* -------------------------------------------------------------------------------------------------
 * Types & Interfaces
 * -----------------------------------------------------------------------------------------------*/
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'
export type TooltipAlign = 'start' | 'center' | 'end'
export type TooltipVariant = 'default' | 'contrast' | 'glass' | 'accent' | 'unstyled'

export interface TooltipCoordinates {
  top: number
  left: number
  actualSide: TooltipSide
  arrowOffset: number
}

/* -------------------------------------------------------------------------------------------------
 * Pure Positioning Engine with Boundary Flip & Shift
 * -----------------------------------------------------------------------------------------------*/
export function computeTooltipPosition({
  triggerRect,
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  side = 'top',
  align = 'center',
  sideOffset = 7,
  collisionPadding = 8,
}: {
  triggerRect: { top: number; bottom: number; left: number; right: number; width: number; height: number }
  contentWidth: number
  contentHeight: number
  viewportWidth: number
  viewportHeight: number
  side?: TooltipSide
  align?: TooltipAlign
  sideOffset?: number
  collisionPadding?: number
}): TooltipCoordinates {
  const contentW = contentWidth || 140
  const contentH = contentHeight || 32
  let resolvedSide = side

  const spaceAbove = triggerRect.top - sideOffset - collisionPadding
  const spaceBelow = viewportHeight - triggerRect.bottom - sideOffset - collisionPadding
  const spaceLeft = triggerRect.left - sideOffset - collisionPadding
  const spaceRight = viewportWidth - triggerRect.right - sideOffset - collisionPadding

  // 视口边界碰撞检测与自动翻转 (Auto Flip: 上下与左右)
  if (side === 'top' && spaceAbove < contentH && spaceBelow >= contentH) {
    resolvedSide = 'bottom'
  } else if (side === 'bottom' && spaceBelow < contentH && spaceAbove >= contentH) {
    resolvedSide = 'top'
  } else if (side === 'left' && spaceLeft < contentW && spaceRight >= contentW) {
    resolvedSide = 'right'
  } else if (side === 'right' && spaceRight < contentW && spaceLeft >= contentW) {
    resolvedSide = 'left'
  } else if (side === 'top' && spaceAbove < contentH && spaceBelow > spaceAbove) {
    resolvedSide = 'bottom'
  } else if (side === 'bottom' && spaceBelow < contentH && spaceAbove > spaceBelow) {
    resolvedSide = 'top'
  } else if (side === 'left' && spaceLeft < contentW && spaceRight > spaceLeft) {
    resolvedSide = 'right'
  } else if (side === 'right' && spaceRight < contentW && spaceLeft > spaceRight) {
    resolvedSide = 'left'
  }

  let top = 0
  let left = 0
  let arrowOffset = 0

  if (resolvedSide === 'top') {
    top = triggerRect.top - contentH - sideOffset
  } else if (resolvedSide === 'bottom') {
    top = triggerRect.bottom + sideOffset
  } else if (resolvedSide === 'left') {
    left = triggerRect.left - contentW - sideOffset
  } else if (resolvedSide === 'right') {
    left = triggerRect.right + sideOffset
  }

  if (resolvedSide === 'top' || resolvedSide === 'bottom') {
    if (align === 'start') {
      left = triggerRect.left
    } else if (align === 'end') {
      left = triggerRect.right - contentW
    } else {
      left = triggerRect.left + (triggerRect.width - contentW) / 2
    }

    // 水平边界约束 (Shift)
    if (left + contentW > viewportWidth - collisionPadding) {
      left = Math.max(collisionPadding, viewportWidth - collisionPadding - contentW)
    }
    if (left < collisionPadding) {
      left = collisionPadding
    }

    // 主轴垂直边界兜底约束 (保证在极端情况下不溢出视口)
    if (top < collisionPadding) {
      top = collisionPadding
    } else if (top + contentH > viewportHeight - collisionPadding) {
      top = Math.max(collisionPadding, viewportHeight - collisionPadding - contentH)
    }

    const triggerCenterX = triggerRect.left + triggerRect.width / 2
    const arrowX = triggerCenterX - left
    const minArrow = Math.min(10, contentW / 2)
    const maxArrow = Math.max(minArrow, contentW - 10)
    arrowOffset = Math.max(minArrow, Math.min(maxArrow, arrowX))
  } else {
    if (align === 'start') {
      top = triggerRect.top
    } else if (align === 'end') {
      top = triggerRect.bottom - contentH
    } else {
      top = triggerRect.top + (triggerRect.height - contentH) / 2
    }

    // 垂直边界约束 (Shift)
    if (top + contentH > viewportHeight - collisionPadding) {
      top = Math.max(collisionPadding, viewportHeight - collisionPadding - contentH)
    }
    if (top < collisionPadding) {
      top = collisionPadding
    }

    // 主轴水平边界兜底约束 (保证在极端情况下不溢出视口)
    if (left < collisionPadding) {
      left = collisionPadding
    } else if (left + contentW > viewportWidth - collisionPadding) {
      left = Math.max(collisionPadding, viewportWidth - collisionPadding - contentW)
    }

    const triggerCenterY = triggerRect.top + triggerRect.height / 2
    const arrowY = triggerCenterY - top
    const minArrow = Math.min(8, contentH / 2)
    const maxArrow = Math.max(minArrow, contentH - 8)
    arrowOffset = Math.max(minArrow, Math.min(maxArrow, arrowY))
  }

  return {
    top: Math.round(top),
    left: Math.round(left),
    actualSide: resolvedSide,
    arrowOffset: Math.round(arrowOffset),
  }
}

/* -------------------------------------------------------------------------------------------------
 * Tooltip Provider Context
 * -----------------------------------------------------------------------------------------------*/
export type TooltipOpenMode = 'cold' | 'warm'

/** 单次打开的不可变会话快照：模式在提交瞬间确定，打开期间不再随 Provider 变化。 */
export interface TooltipOpenSession {
  id: string
  mode: TooltipOpenMode
}

/** requestClose 关闭业务状态，abortExit 立即终止退场呈现（不再等待 AnimatePresence）。 */
export interface TooltipOpenHandlers {
  requestClose: () => void
  abortExit: () => void
}

interface TooltipOwner extends TooltipOpenHandlers {
  id: string
  generation: number
}

interface TooltipProviderContextValue {
  delayDuration: number
  skipDelayDuration: number
  readonly isWarm: boolean
  claimOpen: (id: string, handlers: TooltipOpenHandlers) => number
  releaseOpen: (id: string, generation: number) => void
  registerExiting: (
    id: string,
    lastGeneration: number | null,
    abortExit: () => void,
  ) => () => void
}

const TooltipProviderContext = createContext<TooltipProviderContextValue>({
  delayDuration: 120,
  skipDelayDuration: 300,
  isWarm: false,
  claimOpen: () => 0,
  releaseOpen: () => {},
  registerExiting: () => () => {},
})

export interface TooltipProviderProps {
  children: ReactNode
  /** 鼠标悬停延时出现时间（毫秒），默认 120ms */
  delayDuration?: number
  /** 多个 Tooltip 之间快速切换的免等待预热时间（毫秒），默认 300ms */
  skipDelayDuration?: number
}

export function TooltipProvider({
  children,
  delayDuration = 120,
  skipDelayDuration = 300,
}: TooltipProviderProps) {
  const isWarmRef = useRef(false)
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const generationRef = useRef(0)
  const activeOwnerRef = useRef<TooltipOwner | null>(null)
  const exitingAbortersRef = useRef(new Map<string, () => void>())

  const clearWarmTimer = useCallback(() => {
    if (warmTimerRef.current) {
      clearTimeout(warmTimerRef.current)
      warmTimerRef.current = null
    }
  }, [])

  const resetWarmTimer = useCallback(() => {
    clearWarmTimer()
    warmTimerRef.current = setTimeout(() => {
      isWarmRef.current = false
      warmTimerRef.current = null
    }, skipDelayDuration)
  }, [clearWarmTimer, skipDelayDuration])

  // 抢占关闭：新所有者接管时，旧所有者与仍在退场的浮层必须在本次提交内让出屏幕。
  const claimOpen = useCallback(
    (id: string, handlers: TooltipOpenHandlers): number => {
      const generation = ++generationRef.current
      isWarmRef.current = true
      clearWarmTimer()
      const previous = activeOwnerRef.current
      activeOwnerRef.current = { id, generation, ...handlers }
      if (previous && previous.id !== id) {
        previous.abortExit()
        previous.requestClose()
      }
      for (const [exitingId, abortExit] of exitingAbortersRef.current) {
        if (exitingId === id) continue
        abortExit()
      }
      exitingAbortersRef.current.clear()
      return generation
    },
    [clearWarmTimer],
  )

  const releaseOpen = useCallback(
    (id: string, generation: number) => {
      const owner = activeOwnerRef.current
      // 已被新浮层抢占时，旧所有者的清理不得影响继任者的预热态。
      if (!owner || owner.id !== id || owner.generation !== generation) return
      activeOwnerRef.current = null
      resetWarmTimer()
    },
    [resetWarmTimer],
  )

  const registerExiting = useCallback(
    (id: string, lastGeneration: number | null, abortExit: () => void) => {
      const owner = activeOwnerRef.current
      const preempted =
        (owner !== null && owner.id !== id) ||
        (lastGeneration !== null && generationRef.current !== lastGeneration)
      if (preempted) {
        abortExit()
        return () => {}
      }
      exitingAbortersRef.current.set(id, abortExit)
      return () => {
        if (exitingAbortersRef.current.get(id) === abortExit) {
          exitingAbortersRef.current.delete(id)
        }
      }
    },
    [],
  )

  useEffect(() => {
    return () => {
      clearWarmTimer()
    }
  }, [clearWarmTimer])

  const value = useMemo<TooltipProviderContextValue>(() => {
    const contextObj = {
      delayDuration,
      skipDelayDuration,
      claimOpen,
      releaseOpen,
      registerExiting,
    }
    Object.defineProperty(contextObj, 'isWarm', {
      get() {
        return isWarmRef.current
      },
      enumerable: true,
      configurable: false,
    })
    return contextObj as TooltipProviderContextValue
  }, [delayDuration, skipDelayDuration, claimOpen, releaseOpen, registerExiting])

  return (
    <TooltipProviderContext.Provider value={value}>
      {children}
    </TooltipProviderContext.Provider>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Tooltip Root Context
 * -----------------------------------------------------------------------------------------------*/
interface TooltipContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
  contentId: string
  delayDuration: number
  disableHoverableContent: boolean
  cancelCloseTimer: () => void
  startCloseTimer: () => void
  openMode: TooltipOpenMode
  present: boolean
  setPresent: (present: boolean) => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

export function useTooltipContext(): TooltipContextValue {
  const context = useContext(TooltipContext)
  if (!context) {
    throw new Error('Tooltip compound parts must be used within <Tooltip.Root>')
  }
  return context
}

/* -------------------------------------------------------------------------------------------------
 * Tooltip Position Context (for Content & Arrow communication)
 * -----------------------------------------------------------------------------------------------*/
interface TooltipPositionContextValue {
  actualSide: TooltipSide
  arrowOffset: number
  variant: TooltipVariant
}

const TooltipPositionContext = createContext<TooltipPositionContextValue>({
  actualSide: 'top',
  arrowOffset: 10,
  variant: 'default',
})

/* -------------------------------------------------------------------------------------------------
 * Tooltip.Root
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipRootProps {
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 兼容现有 API 的 delay 参数 */
  delay?: number
  /** 覆盖 Provider 的延迟打开时间（毫秒） */
  delayDuration?: number
  /** 是否禁止鼠标移入 Tooltip 内容区保持展开，默认 true */
  disableHoverableContent?: boolean
  /** 内容是否可悬停保持（与 disableHoverableContent 相反） */
  hoverable?: boolean
  /** 内容是否可交互（与 disableHoverableContent 相反） */
  interactive?: boolean
}

export function TooltipRoot({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  delay,
  delayDuration,
  disableHoverableContent,
  hoverable,
  interactive,
}: TooltipRootProps) {
  const provider = useContext(TooltipProviderContext)
  const [isOpen, setOpen] = useControllableState(
    controlledOpen,
    defaultOpen,
    onOpenChange,
  )

  const triggerRef = useRef<HTMLElement | null>(null)
  const contentId = useId()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [present, setPresentState] = useState(isOpen)
  const isOpenRef = useRef(isOpen)
  isOpenRef.current = isOpen
  const previousOpenRef = useRef(isOpen)
  const openSessionRef = useRef<TooltipOpenSession | null>(null)
  const ownerGenerationRef = useRef(0)

  // 在 closed -> open 的渲染期快照模式：此刻 Provider 的 isWarm 尚未被本次打开改写，
  // StrictMode 重渲染与并发中断重渲染都不会把冷启动自我污染成预热。
  if (isOpen && (!previousOpenRef.current || openSessionRef.current === null)) {
    openSessionRef.current = { id: contentId, mode: provider.isWarm ? 'warm' : 'cold' }
  } else if (!isOpen && !present && openSessionRef.current !== null) {
    // 退场呈现结束前保留快照，避免退场途中改变呈现属性。
    openSessionRef.current = null
  }
  previousOpenRef.current = isOpen
  const openMode: TooltipOpenMode = openSessionRef.current?.mode ?? 'cold'

  const setPresent = useCallback((next: boolean) => {
    // 旧浮层的退场回调可能晚于新浮层的重新打开，不能凭过期信号清空当前呈现。
    if (!next && isOpenRef.current) return
    setPresentState(next)
  }, [])

  const cancelCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const isContentHoverDisabled =
    disableHoverableContent ??
    (hoverable !== undefined ? !hoverable : interactive !== undefined ? !interactive : true)

  // 打开所有权只在开合转换时申领；回调身份波动不应重新抢占。
  const ownerHandlersRef = useRef({ setOpen, cancelCloseTimer })
  ownerHandlersRef.current = { setOpen, cancelCloseTimer }

  const startCloseTimer = useCallback(() => {
    cancelCloseTimer()
    if (isContentHoverDisabled) {
      setOpen(false)
    } else {
      closeTimerRef.current = setTimeout(() => {
        setOpen(false)
      }, 150)
    }
  }, [cancelCloseTimer, isContentHoverDisabled, setOpen])

  useEffect(() => {
    return () => {
      cancelCloseTimer()
    }
  }, [cancelCloseTimer])

  useLayoutEffect(() => {
    if (!isOpen) return
    setPresentState(true)
    const generation = provider.claimOpen(contentId, {
      requestClose: () => {
        const handlers = ownerHandlersRef.current
        handlers.cancelCloseTimer()
        handlers.setOpen(false)
      },
      abortExit: () => setPresentState(false),
    })
    ownerGenerationRef.current = generation
    return () => {
      provider.releaseOpen(contentId, generation)
    }
  }, [isOpen, contentId, provider])

  // 退场期间登记可中断句柄：被新浮层抢占时必须在本次提交内同步卸载旧呈现。
  useLayoutEffect(() => {
    if (isOpen || !present) return
    return provider.registerExiting(contentId, ownerGenerationRef.current, () =>
      setPresentState(false),
    )
  }, [isOpen, present, contentId, provider])

  // 全局 Escape 键监听，确保悬停打开时按 Escape 也可立即关闭 Tooltip
  useEffect(() => {
    if (!isOpen) return
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation()
        cancelCloseTimer()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true)
    }
  }, [isOpen, cancelCloseTimer, setOpen])

  const effectiveDelay = delayDuration ?? delay ?? provider.delayDuration ?? 120

  const contextValue = useMemo<TooltipContextValue>(
    () => ({
      open: isOpen,
      setOpen,
      triggerRef,
      contentId,
      delayDuration: effectiveDelay,
      disableHoverableContent: isContentHoverDisabled,
      cancelCloseTimer,
      startCloseTimer,
      openMode,
      present,
      setPresent,
    }),
    [
      isOpen,
      setOpen,
      contentId,
      effectiveDelay,
      isContentHoverDisabled,
      cancelCloseTimer,
      startCloseTimer,
      openMode,
      present,
      setPresent,
    ],
  )

  return (
    <TooltipContext.Provider value={contextValue}>
      {children}
    </TooltipContext.Provider>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Tooltip.Trigger
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipTriggerProps
  extends React.ButtonHTMLAttributes<HTMLElement> {
  asChild?: boolean
}

export const TooltipTrigger = forwardRef<HTMLElement, TooltipTriggerProps>(
  (
    {
      asChild = false,
      disabled,
      children,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      onClick,
      ...props
    },
    ref,
  ) => {
    const context = useTooltipContext()
    const provider = useContext(TooltipProviderContext)
    const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clearEnterTimer = useCallback(() => {
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current)
        enterTimerRef.current = null
      }
    }, [])

    const delay = context.delayDuration

    const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
      onMouseEnter?.(e)
      if (disabled || e.defaultPrevented) return

      context.cancelCloseTimer()
      clearEnterTimer()

      // 只读预热态：预热窗口由 Provider 依据已提交的打开会话维护。
      if (provider.isWarm) {
        context.setOpen(true)
      } else {
        enterTimerRef.current = setTimeout(() => {
          context.setOpen(true)
        }, delay)
      }
    }

    const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
      onMouseLeave?.(e)
      clearEnterTimer()
      if (e.defaultPrevented) return
      context.startCloseTimer()
    }

    const handleClick = (e: React.MouseEvent<HTMLElement>) => {
      onClick?.(e)
      if (e.defaultPrevented) return
      clearEnterTimer()
      context.cancelCloseTimer()
      context.setOpen(false)
    }

    const handleFocus = (e: React.FocusEvent<HTMLElement>) => {
      onFocus?.(e)
      if (disabled || e.defaultPrevented || !e.currentTarget.matches(':focus-visible')) return
      clearEnterTimer()
      context.cancelCloseTimer()
      context.setOpen(true)
    }

    const handleBlur = (e: React.FocusEvent<HTMLElement>) => {
      onBlur?.(e)
      clearEnterTimer()
      if (e.defaultPrevented) return
      context.setOpen(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
      onKeyDown?.(e)
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && context.open && !e.nativeEvent.isComposing) {
        e.stopPropagation()
        clearEnterTimer()
        context.cancelCloseTimer()
        context.setOpen(false)
      }
    }

    useEffect(() => {
      return () => {
        clearEnterTimer()
      }
    }, [clearEnterTimer])

    const triggerAriaDescribedBy = props['aria-describedby']
    const childAriaDescribedBy =
      asChild && React.isValidElement(children)
        ? (children.props as any)?.['aria-describedby']
        : undefined
    const existingDescribedBy = [triggerAriaDescribedBy, childAriaDescribedBy]
      .filter(Boolean)
      .join(' ')
    const ariaDescribedBy = context.open
      ? [existingDescribedBy, context.contentId].filter(Boolean).join(' ')
      : existingDescribedBy

    const Component = asChild ? Slot : 'button'
    const extraProps = asChild ? {} : { type: (props as any).type ?? 'button' }

    return (
      <Component
        {...props}
        {...extraProps}
        ref={mergeRefs(ref, context.triggerRef) as React.Ref<any>}
        aria-describedby={ariaDescribedBy || undefined}
        data-state={context.open ? 'open' : 'closed'}
        disabled={disabled}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      >
        {children}
      </Component>
    )
  },
)
TooltipTrigger.displayName = 'Tooltip.Trigger'

/* -------------------------------------------------------------------------------------------------
 * Tooltip.Portal
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipPortalProps {
  children: ReactNode
  container?: HTMLElement | null
}

export function TooltipPortal({ children, container }: TooltipPortalProps) {
  const context = useContext(TooltipContext)
  // 抢占可独立于受控 open 终止呈现，且不留空 Portal 宿主。
  if (context && !context.present) return null
  if (typeof document === 'undefined') {
    return <>{children}</>
  }
  return (
    <Portal container={container} anchor={context?.triggerRef.current}>
      {children}
    </Portal>
  )
}

/* -------------------------------------------------------------------------------------------------
 * Tooltip.Content
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipContentProps extends HTMLAttributes<HTMLDivElement> {
  side?: TooltipSide
  align?: TooltipAlign
  offset?: number
  sideOffset?: number
  collisionPadding?: number
  variant?: TooltipVariant
  asChild?: boolean
}

const VARIANT_STYLES: Record<TooltipVariant, string> = {
  default:
    'tw:bg-app-raised tw:text-app-text tw:border tw:border-app-border-subtle tw:shadow-lg tw:backdrop-blur-md',
  contrast:
    'tw:bg-[#18181b] [data-theme=dark]_&:tw:bg-[#27272a] tw:text-white tw:border tw:border-white/10 tw:shadow-lg',
  glass:
    'tw:bg-app-glass tw:text-app-text tw:border tw:border-app-border-subtle tw:backdrop-blur-xl tw:shadow-lg',
  accent:
    'tw:bg-app-accent tw:text-app-on-accent tw:border tw:border-transparent tw:shadow-lg',
  unstyled: '',
}

export const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    {
      children,
      side = 'top',
      align = 'center',
      offset,
      sideOffset: propSideOffset,
      collisionPadding = 8,
      variant = 'default',
      className = '',
      style,
      asChild: _asChild,
      onMouseEnter,
      onMouseLeave,
      ...props
    },
    ref,
  ) => {
    const context = useTooltipContext()
    const contentRef = useRef<HTMLDivElement>(null)
    const [actualSide, setActualSide] = useState<TooltipSide>(side)
    const [arrowOffset, setArrowOffset] = useState<number>(10)
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
    const { present, setPresent } = context
    // 退出动画结束前留在顶层，避免落回浮层内部撑大滚动范围。
    const popover = useTopLayer(contentRef, present)
    const reducedMotion = usePrefersReducedMotion()
    const sideOffset = propSideOffset ?? offset ?? 7

    const updatePosition = useCallback(() => {
      const triggerEl = context.triggerRef.current
      const contentEl = contentRef.current
      if (!triggerEl || !contentEl || !context.open) return

      const triggerRect = triggerEl.getBoundingClientRect()
      const contentW = contentEl.offsetWidth || 140
      const contentH = contentEl.offsetHeight || 32
      const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
      const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768

      const result = computeTooltipPosition({
        triggerRect,
        contentWidth: contentW,
        contentHeight: contentH,
        viewportWidth: viewportW,
        viewportHeight: viewportH,
        side,
        align,
        sideOffset,
        collisionPadding,
      })

      setActualSide((prev) => (prev !== result.actualSide ? result.actualSide : prev))
      setArrowOffset((prev) => (Math.abs(prev - result.arrowOffset) > 0.5 ? result.arrowOffset : prev))
      setPosition((prev) => {
        if (prev && prev.top === result.top && prev.left === result.left) return prev
        return { top: result.top, left: result.left }
      })
    }, [context.triggerRef, context.open, side, align, sideOffset, collisionPadding])

    useLayoutEffect(() => {
      if (context.open) {
        updatePosition()
      }
    }, [context.open, updatePosition])

    useEffect(() => {
      if (!context.open) return
      const triggerEl = context.triggerRef.current
      const contentEl = contentRef.current
      if (typeof ResizeObserver === 'undefined') return

      const observer = new ResizeObserver(() => {
        updatePosition()
      })

      if (triggerEl) observer.observe(triggerEl)
      if (contentEl) observer.observe(contentEl)

      return () => {
        observer.disconnect()
      }
    }, [context.open, context.triggerRef, updatePosition])

    useEffect(() => {
      if (!context.open) return
      const handleScrollOrResize = () => updatePosition()
      window.addEventListener('resize', handleScrollOrResize)
      window.addEventListener('scroll', handleScrollOrResize, true)
      return () => {
        window.removeEventListener('resize', handleScrollOrResize)
        window.removeEventListener('scroll', handleScrollOrResize, true)
      }
    }, [context.open, updatePosition])

    const getInitialAnimation = () => {
      if (reducedMotion) return { opacity: 0, scale: 1, x: 0, y: 0 }
      switch (actualSide) {
        case 'top':
          return { opacity: 0, scale: 0.95, y: 3, x: 0 }
        case 'bottom':
          return { opacity: 0, scale: 0.95, y: -3, x: 0 }
        case 'left':
          return { opacity: 0, scale: 0.95, x: 3, y: 0 }
        case 'right':
          return { opacity: 0, scale: 0.95, x: -3, y: 0 }
      }
    }

    const getExitAnimation = () => {
      if (reducedMotion) return { opacity: 0, scale: 1, x: 0, y: 0 }
      switch (actualSide) {
        case 'top':
          return { opacity: 0, scale: 0.96, y: 2, x: 0 }
        case 'bottom':
          return { opacity: 0, scale: 0.96, y: -2, x: 0 }
        case 'left':
          return { opacity: 0, scale: 0.96, x: 2, y: 0 }
        case 'right':
          return { opacity: 0, scale: 0.96, x: -2, y: 0 }
      }
    }

    const positionContextValue = useMemo(
      () => ({
        actualSide,
        arrowOffset,
        variant,
      }),
      [actualSide, arrowOffset, variant],
    )

    const isUnstyled = variant === 'unstyled'
    const baseClasses = isUnstyled
      ? 'tooltip-presence'
      : 'tooltip-presence tooltip-content tw:inline-flex tw:items-center tw:px-2.5 tw:py-1.5 tw:rounded-sm tw:type-caption tw:max-w-[min(280px,calc(100vw-16px))] tw:break-words tw:select-none tw:box-border tw:z-tooltip'
    const variantClasses = isUnstyled ? '' : (VARIANT_STYLES[variant] || VARIANT_STYLES.default)

    const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
      onMouseEnter?.(e)
      if (!context.disableHoverableContent) {
        context.cancelCloseTimer()
      }
    }

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
      onMouseLeave?.(e)
      if (!context.disableHoverableContent) {
        context.startCloseTimer()
      }
    }

    const warm = context.openMode === 'warm'

    // 抢占关闭时 present 已被同步置 false：连 AnimatePresence 边界一起卸载，避免双影重叠。
    if (!present) return null

    return (
      <AnimatePresence onExitComplete={() => setPresent(false)}>
        {context.open && (
          <motion.div
            {...(props as any)}
            ref={mergeRefs(ref, contentRef)}
            popover={popover}
            id={context.contentId}
            role="tooltip"
            data-side={actualSide}
            data-state="open"
            data-warm-handoff={warm ? 'true' : undefined}
            initial={warm ? false : getInitialAnimation()}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{
              ...getExitAnimation(),
              transition: reducedMotion
                ? { duration: 0.08 }
                : { duration: 0.13, ease: 'easeIn' },
            }}
            transition={
              warm
                ? { duration: 0 }
                : reducedMotion
                  ? { duration: 0.08 }
                  : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }
            }
            style={{
              // 原生 popover 的默认居中不能覆盖按锚点计算的坐标。
              margin: 0,
              inset: 'auto',
              position: 'fixed',
              top: position ? `${position.top}px` : '-9999px',
              left: position ? `${position.left}px` : '-9999px',
              pointerEvents: context.disableHoverableContent ? 'none' : 'auto',
              ...style,
            }}
            className={[baseClasses, variantClasses, className].filter(Boolean).join(' ')}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <TooltipPositionContext.Provider value={positionContextValue}>
              {children}
            </TooltipPositionContext.Provider>
          </motion.div>
        )}
      </AnimatePresence>
    )
  },
)
TooltipContent.displayName = 'Tooltip.Content'

/* -------------------------------------------------------------------------------------------------
 * Tooltip.Arrow (No-op null component: 全局设计规范要求所有 Tooltip 均不展示箭头指示器)
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipArrowProps extends HTMLAttributes<HTMLDivElement> {
  width?: number
  height?: number
}

export const TooltipArrow = forwardRef<HTMLDivElement, TooltipArrowProps>(
  (_props, _ref) => {
    return null
  },
)
TooltipArrow.displayName = 'Tooltip.Arrow'

/* -------------------------------------------------------------------------------------------------
 * Shorthand Wrapper Component: <Tooltip />
 * -----------------------------------------------------------------------------------------------*/
export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  side?: TooltipSide
  align?: TooltipAlign
  offset?: number
  sideOffset?: number
  variant?: TooltipVariant
  delay?: number
  delayDuration?: number
  /** @deprecated 全局设计规范要求所有 Tooltip 均不展示箭头指示器，此选项已废弃并不再生效 */
  showArrow?: boolean
  className?: string
  asChild?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disableHoverableContent?: boolean
  hoverable?: boolean
  interactive?: boolean
  disabled?: boolean
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  offset,
  sideOffset: propSideOffset,
  variant = 'default',
  delay,
  delayDuration,
  showArrow: _showArrow,
  className = '',
  asChild = true,
  open,
  defaultOpen,
  onOpenChange,
  disableHoverableContent,
  hoverable,
  interactive,
  disabled,
}: TooltipProps) {
  const isEmpty =
    content === null ||
    content === undefined ||
    typeof content === 'boolean' ||
    content === ''
  if (disabled || isEmpty) return <>{children}</>

  const sideOffset = propSideOffset ?? offset ?? 7
  const effectiveDisableHoverable =
    disableHoverableContent ??
    (hoverable !== undefined ? !hoverable : interactive !== undefined ? !interactive : undefined)

  return (
    <TooltipRoot
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      delay={delay}
      delayDuration={delayDuration}
      disableHoverableContent={effectiveDisableHoverable}
      hoverable={hoverable}
      interactive={interactive}
    >
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={sideOffset}
          variant={variant}
          className={className}
        >
          {content}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  )
}

/* -------------------------------------------------------------------------------------------------
 * InfoTooltip - 专用于信息辅助说明的即开即用组件
 * -----------------------------------------------------------------------------------------------*/
export interface InfoTooltipProps {
  content: ReactNode
  side?: TooltipSide
  size?: number
  strokeWidth?: number
  variant?: TooltipVariant
  delayDuration?: number
  /** @deprecated 全局设计规范要求所有 Tooltip 均不展示箭头指示器，此选项已废弃并不再生效 */
  showArrow?: boolean
  className?: string
  iconClassName?: string
  ariaLabel?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const InfoTooltip = forwardRef<HTMLButtonElement, InfoTooltipProps>(
  (
    {
      content,
      side = 'top',
      size = APP_ICON_SIZE,
      strokeWidth = APP_ICON_STROKE_WIDTH,
      variant = 'default',
      delayDuration = 120,
      showArrow: _showArrow,
      className = '',
      iconClassName = '',
      ariaLabel = 'More information',
      open,
      defaultOpen,
      onOpenChange,
    },
    ref,
  ) => {
    return (
      <Tooltip
        content={content}
        side={side}
        variant={variant}
        delayDuration={delayDuration}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        asChild={true}
      >
        <button
          ref={ref}
          type="button"
          aria-label={ariaLabel}
          className={`tw:inline-flex tw:items-center tw:justify-center tw:w-6 tw:h-6 tw:rounded-full tw:text-app-text-meta tw:hover:text-app-text tw:hover:bg-app-hover tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-app-focus tw:transition tw:duration-150 tw:cursor-help tw:select-none tw:shrink-0 ${className}`}
        >
          <Info size={size} className={iconClassName} strokeWidth={strokeWidth} />
        </button>
      </Tooltip>
    )
  },
)
InfoTooltip.displayName = 'InfoTooltip'

/* -------------------------------------------------------------------------------------------------
 * Compound Object Attachment
 * -----------------------------------------------------------------------------------------------*/
Tooltip.Provider = TooltipProvider
Tooltip.Root = TooltipRoot
Tooltip.Trigger = TooltipTrigger
Tooltip.Portal = TooltipPortal
Tooltip.Content = TooltipContent
Tooltip.Arrow = TooltipArrow
