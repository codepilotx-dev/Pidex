import type { PopoverSize } from '../PopoverSizing.js'
import { useLocale as useI18n } from '../../../features/i18n/LocaleProvider.js'
import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
} from 'react'
import { X } from 'lucide-react'
import {
  useFloatingPosition,
  type FloatingPlacement,
  type FloatingAnchor,
  type FloatingCollisionPadding,
} from './UseFloatingPosition.js'
import {
  mergeRefs,
  Portal,
  Slot,
  useControllableState,
  useDismissableLayer,
  useFocusReturn,
  usePortal,
  useTopLayer,
  type PortalProps,
  type DismissEvents,
} from './Primitives.js'

export type PopoverSide = 'top' | 'bottom' | 'left' | 'right'
export type PopoverAlign = 'start' | 'center' | 'end'

interface PopoverContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
  anchorRef: React.MutableRefObject<FloatingAnchor | null>
  contentId: string
}
const PopoverContext = createContext<PopoverContextValue | null>(null)
function usePopoverContext() {
  const context = useContext(PopoverContext)
  if (!context) throw new Error('Popover parts must be inside Popover.Root')
  return context
}
export interface PopoverRootProps {
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}
function PopoverRoot({ children, open, defaultOpen = false, onOpenChange }: PopoverRootProps) {
  const [activeOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange)
  const triggerRef = useRef<HTMLElement | null>(null)
  const anchorRef = useRef<FloatingAnchor | null>(null)
  const contentId = useId()
  return (
    <PopoverContext.Provider
      value={{ open: activeOpen, setOpen, triggerRef, anchorRef, contentId }}
    >
      {children}
    </PopoverContext.Provider>
  )
}
export interface PopoverTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}
const PopoverTrigger = forwardRef<HTMLElement, PopoverTriggerProps>(
  ({ asChild = false, disabled, onClick, ...props }, ref) => {
    const context = usePopoverContext()
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        {...props}
        type="button"
        ref={mergeRefs(ref, context.triggerRef) as React.Ref<HTMLButtonElement>}
        disabled={disabled}
        aria-expanded={context.open}
        aria-haspopup="dialog"
        aria-controls={context.open ? context.contentId : undefined}
        data-state={context.open ? 'open' : 'closed'}
        data-disabled={disabled ? '' : undefined}
        onClick={(event) => {
          onClick?.(event as React.MouseEvent<HTMLButtonElement>)
          if (!event.defaultPrevented && !disabled) context.setOpen(!context.open)
        }}
      />
    )
  },
)
PopoverTrigger.displayName = 'Popover.Trigger'
export interface PopoverAnchorProps extends HTMLAttributes<HTMLDivElement> {
  asChild?: boolean
  virtualRef?: React.RefObject<FloatingAnchor | null>
}
const PopoverAnchor = forwardRef<HTMLElement, PopoverAnchorProps>(
  ({ asChild = false, virtualRef, ...props }, ref) => {
    const context = usePopoverContext()
    useLayoutEffect(() => {
      if (virtualRef) context.anchorRef.current = virtualRef.current
      return () => {
        if (virtualRef) context.anchorRef.current = null
      }
    }, [virtualRef, context.anchorRef])
    if (virtualRef) return null
    const Component = asChild ? Slot : 'div'
    return (
      <Component
        {...props}
        ref={
          mergeRefs(
            ref,
            context.anchorRef as React.MutableRefObject<HTMLElement | null>,
          ) as React.Ref<HTMLDivElement>
        }
      />
    )
  },
)
PopoverAnchor.displayName = 'Popover.Anchor'
function PopoverPortal(props: PortalProps) {
  const context = usePopoverContext()
  return context.open ? <Portal {...props} anchor={context.triggerRef.current} /> : null
}
export interface PopoverContentProps extends HTMLAttributes<HTMLDivElement>, DismissEvents {
  side?: PopoverSide
  align?: PopoverAlign
  sideOffset?: number
  /** UI-Design 的三档浮层尺寸。 */
  size?: PopoverSize
  asChild?: boolean
  anchor?: HTMLElement | null | React.RefObject<HTMLElement | null>
  collisionPadding?: FloatingCollisionPadding
  avoidCollisions?: boolean
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
}
const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      side = 'bottom',
      align = 'start',
      sideOffset = 8,
      size = 'md',
      asChild = false,
      anchor,
      collisionPadding = 8,
      avoidCollisions = true,
      onOpenAutoFocus,
      onCloseAutoFocus,
      onInteractOutside,
      className = '',
      style,
      onPointerDownOutside,
      onFocusOutside,
      onEscapeKeyDown,
      ...props
    },
    ref,
  ) => {
    const context = usePopoverContext()
    const contentRef = useRef<HTMLDivElement>(null)
    const popover = useTopLayer(contentRef, context.open)
    const positionRef = useRef<FloatingAnchor | null>(null)
    positionRef.current = context.anchorRef.current ?? context.triggerRef.current
    useLayoutEffect(() => {
      positionRef.current = context.anchorRef.current ?? context.triggerRef.current
    })
    const portal = usePortal()
    const { coords, floatingStyle } = useFloatingPosition({
      anchor: anchor ?? positionRef,
      contentRef,
      isOpen: context.open,
      placement: (align === 'center' ? side : `${side}-${align}`) as FloatingPlacement,
      offset: sideOffset,
      collisionPadding,
      avoidCollisions,
      portal,
    })
    const dismissAnchorRef = useRef<HTMLElement | null>(null)
    const externalAnchor =
      anchor && 'current' in anchor ? anchor.current : (anchor as HTMLElement | null | undefined)
    const anchorElement = externalAnchor ?? positionRef.current
    dismissAnchorRef.current =
      anchorElement instanceof HTMLElement ? anchorElement : context.triggerRef.current
    useDismissableLayer({
      open: context.open,
      contentRef,
      anchorRef: dismissAnchorRef,
      onDismiss: () => context.setOpen(false),
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      onEscapeKeyDown,
    })
    useFocusReturn(context.open, contentRef, dismissAnchorRef, onCloseAutoFocus)
    // 打开后将焦点移入内容（Portal 挂在 body 末尾，无初始焦点时键盘用户无法到达浮层）
    useEffect(() => {
      if (!context.open) return
      const timer = requestAnimationFrame(() => {
        const el = contentRef.current
        if (!el) return
        const event = new Event('floating.openAutoFocus', { cancelable: true })
        onOpenAutoFocus?.(event)
        if (event.defaultPrevented) return
        const firstFocusable = el.querySelector<HTMLElement>(
          'button:not([disabled]), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        )
        ;(firstFocusable ?? el).focus()
      })
      return () => cancelAnimationFrame(timer)
    }, [context.open])
    if (!context.open) return null
    const Component = asChild ? Slot : 'div'
    const [actualSide, actualAlign = 'center'] = (coords?.actualPlacement ?? side).split('-')
    const anchorRect = anchorElement?.getBoundingClientRect()
    const arrowStyle =
      coords && anchorRect
        ? {
            '--popover-arrow-x': `${Math.max(12, Math.min((contentRef.current?.offsetWidth ?? 280) - 12, anchorRect.left + anchorRect.width / 2 - coords.left))}px`,
            '--popover-arrow-y': `${Math.max(12, Math.min((contentRef.current?.offsetHeight ?? 180) - 12, anchorRect.top + anchorRect.height / 2 - coords.top))}px`,
          }
        : {}
    return (
      <Component
        {...props}
        ref={mergeRefs(ref, contentRef)}
        popover={popover}
        id={context.contentId}
        role={props.role ?? 'dialog'}
        aria-label={props['aria-label'] ?? 'Popover'}
        tabIndex={-1}
        data-state="open"
        data-popover-size={size}
        data-side={actualSide}
        data-align={actualAlign}
        style={{ ...floatingStyle, ...arrowStyle, ...style }}
        className={`popover-surface popover ${asChild ? '' : 'tw:p-3.5'} tw:text-app-text ${className}`}
      />
    )
  },
)
PopoverContent.displayName = 'Popover.Content'

export interface PopoverHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const PopoverHeader = forwardRef<HTMLDivElement, PopoverHeaderProps>(
  ({ children, className = '', ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={`tw:flex tw:items-start tw:justify-between tw:gap-2 tw:mb-2 tw:pb-1.5 tw:border-b tw:border-[var(--cpx-sys-color-border-subtle)] ${className}`}
        {...rest}
      >
        {children}
      </div>
    )
  },
)
PopoverHeader.displayName = 'Popover.Header'

/* -------------------------------------------------------------------------------------------------
 * Popover.Title
 * -----------------------------------------------------------------------------------------------*/
export interface PopoverTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode
}

export const PopoverTitle = forwardRef<HTMLHeadingElement, PopoverTitleProps>(
  ({ children, className = '', ...rest }, ref) => {
    return (
      <h4
        ref={ref}
        className={`tw:type-label tw:text-[var(--cpx-sys-color-fg-primary)] tw:tracking-[-0.1px] ${className}`}
        {...rest}
      >
        {children}
      </h4>
    )
  },
)
PopoverTitle.displayName = 'Popover.Title'

/* -------------------------------------------------------------------------------------------------
 * Popover.Description
 * -----------------------------------------------------------------------------------------------*/
export interface PopoverDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode
}

export const PopoverDescription = forwardRef<HTMLParagraphElement, PopoverDescriptionProps>(
  ({ children, className = '', ...rest }, ref) => {
    return (
      <p
        ref={ref}
        className={`tw:type-caption tw:text-[var(--cpx-sys-color-fg-tertiary)] tw:mt-0.5 ${className}`}
        {...rest}
      >
        {children}
      </p>
    )
  },
)
PopoverDescription.displayName = 'Popover.Description'

/* -------------------------------------------------------------------------------------------------
 * Popover.Close
 * -----------------------------------------------------------------------------------------------*/
export interface PopoverCloseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}
const PopoverClose = forwardRef<HTMLElement, PopoverCloseProps>(
  ({ asChild = false, children, className = '', onClick, ...props }, ref) => {
    const { t } = useI18n()
    const context = usePopoverContext()
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        {...props}
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        aria-label={props['aria-label'] ?? t('Close popover')}
        className={`tw:flex tw:items-center tw:justify-center ${children ? '' : 'tw:w-5 tw:h-5 -mr-1 -mt-0.5 tw:rounded-control'} tw:text-[var(--cpx-sys-color-fg-tertiary)] tw:hover:text-[var(--cpx-sys-color-fg-primary)] tw:hover:bg-[var(--cpx-sys-color-hover)] tw:active:scale-95 tw:transition-colors tw:duration-150 tw:cursor-pointer ${className}`}
        onClick={(event) => {
          onClick?.(event as React.MouseEvent<HTMLButtonElement>)
          if (!event.defaultPrevented) context.setOpen(false)
        }}
      >
        {children ?? <X size={12} strokeWidth={2.4} />}
      </Component>
    )
  },
)
PopoverClose.displayName = 'Popover.Close'

export interface PopoverFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const PopoverFooter = forwardRef<HTMLDivElement, PopoverFooterProps>(
  ({ children, className = '', ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={`tw:mt-3 tw:pt-2.5 tw:border-t tw:border-[var(--cpx-sys-color-border-subtle)] tw:flex tw:items-center tw:justify-end tw:gap-2 ${className}`}
        {...rest}
      >
        {children}
      </div>
    )
  },
)
PopoverFooter.displayName = 'Popover.Footer'

const PopoverArrow = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <svg
    {...props}
    ref={ref}
    aria-hidden="true"
    width="10"
    height="5"
    viewBox="0 0 10 5"
    className={['popover-arrow', props.className].filter(Boolean).join(' ')}
  >
    <path d="M0 5L5 0L10 5Z" />
  </svg>
))
export const Popover = {
  Arrow: PopoverArrow,
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Anchor: PopoverAnchor,
  Portal: PopoverPortal,
  Content: PopoverContent,
  Header: PopoverHeader,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
  Footer: PopoverFooter,
}
