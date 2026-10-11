// Menu root, keyboard navigation and delayed submenus migrated from UI-Design ContextMenu.
import React, {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import {
  Portal,
  Slot,
  mergeRefs,
  useControllableState,
  useDismissableLayer,
  useFocusReturn,
  useTopLayer,
  type DismissEvents,
  type PortalProps,
} from './Primitives.js'
import { useFloatingPosition } from './UseFloatingPosition.js'
import type { PopoverSize } from '../PopoverSizing.js'

export type MenuRootProps = {
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}
const MenuContext = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
  submenuRefs: React.RefObject<HTMLElement | null>[]
  point: { x: number; y: number }
  setPoint: (point: { x: number; y: number }) => void
} | null>(null)
export function useMenu() {
  const context = useContext(MenuContext)
  if (!context) throw new Error('Menu parts must be inside a menu root')
  return context
}
export function MenuRoot({ children, open, defaultOpen = false, onOpenChange }: MenuRootProps) {
  const [activeOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange)
  const triggerRef = useRef<HTMLElement | null>(null)
  const submenuRefs = useRef<React.RefObject<HTMLElement | null>[]>([])
  const [point, setPoint] = useState({ x: 0, y: 0 })
  return (
    <MenuContext.Provider
      value={{
        open: activeOpen,
        setOpen,
        triggerRef,
        submenuRefs: submenuRefs.current,
        point,
        setPoint,
      }}
    >
      {children}
    </MenuContext.Provider>
  )
}
function MenuPortal(props: PortalProps) {
  const root = useMenu()
  return root.open ? <Portal {...props} anchor={root.triggerRef.current} /> : null
}
export function useMenuSurface(ref: React.RefObject<HTMLElement | null>) {
  const root = useMenu()
  useLayoutEffect(() => {
    root.submenuRefs.push(ref)
    return () => {
      const index = root.submenuRefs.indexOf(ref)
      if (index >= 0) root.submenuRefs.splice(index, 1)
    }
  }, [root.submenuRefs, ref])
  return root
}
export function menuKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
    return
  const target = event.target as HTMLElement
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[role^="menuitem"]:not([aria-disabled="true"]):not([hidden]), [role="option"]:not([aria-disabled="true"]):not([hidden])',
    ),
  ).filter((item) => item.closest('[role="menu"], [role="listbox"]') === event.currentTarget)
  const index = items.indexOf(document.activeElement as HTMLElement)
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && items.length) {
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % items.length
            : index <= 0
              ? items.length - 1
              : index - 1
    items[next]?.focus()
  } else if (event.key === 'Enter' || event.key === ' ') {
    if (target.getAttribute('role')?.startsWith('menuitem')) {
      event.preventDefault()
      target.click()
    }
  }
}
export function selectMenuItem(
  onSelect: ((event: Event) => void) | undefined,
  close: () => void,
  select?: () => void,
) {
  const event = new Event('menu.select', { cancelable: true })
  onSelect?.(event)
  select?.()
  if (!event.defaultPrevented) close()
}
type ItemProps = Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
  disabled?: boolean
  onSelect?: (event: Event) => void
  asChild?: boolean
}
export const MenuItem = forwardRef<HTMLDivElement, ItemProps>(
  (
    { disabled = false, onSelect, asChild = false, children, onClick, onKeyDown, ...props },
    ref,
  ) => {
    const root = useMenu()
    const Component = asChild ? Slot : 'div'
    return (
      <Component
        {...props}
        ref={ref}
        data-dropdown-item
        role={props.role ?? 'menuitem'}
        aria-disabled={disabled}
        data-disabled={disabled ? '' : undefined}
        tabIndex={disabled ? undefined : -1}
        onFocus={(event) => {
          props.onFocus?.(event as React.FocusEvent<HTMLDivElement>)
          event.currentTarget.dataset.highlighted = ''
        }}
        onBlur={(event) => {
          props.onBlur?.(event as React.FocusEvent<HTMLDivElement>)
          delete event.currentTarget.dataset.highlighted
        }}
        onClick={(event) => {
          if (disabled) return
          onClick?.(event as React.MouseEvent<HTMLDivElement>)
          if (event.defaultPrevented || disabled) return
          selectMenuItem(onSelect, () => root.setOpen(false))
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event as React.KeyboardEvent<HTMLDivElement>)
          if (
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229 &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault()
            event.currentTarget.click()
          }
        }}
      >
        {children}
      </Component>
    )
  },
)
MenuItem.displayName = 'Menu.Item'
const IndicatorContext = createContext(false)
export function MenuIndicator({
  asChild,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { asChild?: boolean }) {
  const checked = useContext(IndicatorContext)
  if (!checked) return null
  const Component = asChild ? Slot : 'span'
  return <Component {...props}>{children}</Component>
}
export function MenuCheckboxItem({
  checked = false,
  onCheckedChange,
  onSelect,
  children,
  ...props
}: ItemProps & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }) {
  return (
    <MenuItem
      {...props}
      role="menuitemcheckbox"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      onSelect={(event) => {
        onCheckedChange?.(!checked)
        onSelect?.(event)
      }}
    >
      <IndicatorContext.Provider value={checked}>{children}</IndicatorContext.Provider>
    </MenuItem>
  )
}
const RadioContext = createContext<{ value?: string; onValueChange?: (value: string) => void }>({})
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value?: string; onValueChange?: (value: string) => void }) {
  return (
    <RadioContext.Provider value={{ value, onValueChange }}>
      <div {...props} role="group">
        {children}
      </div>
    </RadioContext.Provider>
  )
}
export function MenuRadioItem({
  value,
  onSelect,
  children,
  ...props
}: ItemProps & { value: string }) {
  const radio = useContext(RadioContext)
  const checked = value === radio.value
  return (
    <MenuItem
      {...props}
      role="menuitemradio"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      onSelect={(event) => {
        radio.onValueChange?.(value)
        onSelect?.(event)
      }}
    >
      <IndicatorContext.Provider value={checked}>{children}</IndicatorContext.Provider>
    </MenuItem>
  )
}
export function MenuGroup(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="group" />
}
export function MenuLabel(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />
}
export function MenuSeparator(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role="separator" />
}
const SubContext = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
  hoverOpen: () => void
  hoverClose: () => void
  pointerOpened: React.MutableRefObject<boolean>
} | null>(null)
export function MenuSub({ children, open, defaultOpen = false, onOpenChange }: MenuRootProps) {
  const root = useMenu()
  const [activeOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange)
  const triggerRef = useRef<HTMLElement | null>(null)
  const pointerOpened = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedule = (next: boolean) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), next ? 120 : 140)
  }
  useEffect(() => {
    if (!root.open) {
      if (timer.current) clearTimeout(timer.current)
      setOpen(false)
    }
  }, [root.open, setOpen])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <SubContext.Provider
      value={{
        open: activeOpen,
        setOpen,
        triggerRef,
        pointerOpened,
        hoverOpen: () => {
          pointerOpened.current = true
          schedule(true)
        },
        hoverClose: () => schedule(false),
      }}
    >
      {children}
    </SubContext.Provider>
  )
}
export const MenuSubTrigger = forwardRef<HTMLDivElement, ItemProps>(
  (
    {
      disabled,
      asChild = false,
      children,
      onPointerEnter,
      onPointerLeave,
      onKeyDown,
      onClick,
      onSelect: _onSelect,
      ...props
    },
    ref,
  ) => {
    const sub = useContext(SubContext)!
    const Component = asChild ? Slot : 'div'
    return (
      <Component
        {...props}
        ref={mergeRefs(ref as React.Ref<HTMLElement>, sub.triggerRef)}
        data-dropdown-item
        role="menuitem"
        tabIndex={disabled ? undefined : -1}
        aria-haspopup="menu"
        aria-expanded={sub.open}
        aria-disabled={disabled}
        data-state={sub.open ? 'open' : 'closed'}
        data-disabled={disabled ? '' : undefined}
        onPointerEnter={(event) => {
          onPointerEnter?.(event as React.PointerEvent<HTMLDivElement>)
          if (!disabled) sub.hoverOpen()
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event as React.PointerEvent<HTMLDivElement>)
          sub.hoverClose()
        }}
        onClick={(event) => {
          if (disabled) return
          onClick?.(event as React.MouseEvent<HTMLDivElement>)
          if (!disabled && !event.defaultPrevented) {
            sub.pointerOpened.current = false
            sub.setOpen(!sub.open)
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event as React.KeyboardEvent<HTMLDivElement>)
          if (
            !event.defaultPrevented &&
            !disabled &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229 &&
            ['ArrowRight', 'Enter', ' '].includes(event.key)
          ) {
            event.preventDefault()
            sub.pointerOpened.current = false
            sub.setOpen(true)
          }
        }}
      >
        {children}
      </Component>
    )
  },
)
MenuSubTrigger.displayName = 'Menu.SubTrigger'
export function MenuSubContent({
  children,
  size = 'md',
  sideOffset = 4,
  collisionPadding = 8,
  onKeyDown,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  size?: PopoverSize
  sideOffset?: number
  collisionPadding?: number
}) {
  const sub = useContext(SubContext)!
  const contentRef = useRef<HTMLDivElement | null>(null)
  const root = useMenuSurface(contentRef)
  const popover = useTopLayer(contentRef, root.open && sub.open)
  const { coords, floatingStyle } = useFloatingPosition({
    anchor: sub.triggerRef,
    contentRef,
    isOpen: root.open && sub.open,
    placement: 'right-start',
    offset: sideOffset,
    collisionPadding,
  })
  useDismissableLayer({
    open: root.open && sub.open,
    contentRef,
    anchorRef: sub.triggerRef,
    additionalRefs: root.submenuRefs,
    onDismiss: () => root.setOpen(false),
    onEscapeKeyDown: (event) => {
      event.preventDefault()
      sub.setOpen(false)
      sub.triggerRef.current?.focus()
    },
  })
  useLayoutEffect(() => {
    if (root.open && sub.open && !sub.pointerOpened.current)
      contentRef.current
        ?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
        ?.focus()
  }, [root.open, sub.open, sub.pointerOpened])
  if (!root.open || !sub.open) return null
  return (
    <div
      {...props}
      ref={contentRef}
      popover={popover}
      role="menu"
      tabIndex={-1}
      data-state="open"
      data-side={coords?.actualPlacement.split('-')[0] ?? 'right'}
      data-popover-size={size}
      data-theme-component="dropdown-surface"
      data-menu-subcontent=""
      className={`popover-surface popover tw:p-1.5 ${className}`}
      style={{ ...floatingStyle, ...props.style }}
      onPointerEnter={sub.hoverOpen}
      onPointerLeave={sub.hoverClose}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        )
          return
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          sub.setOpen(false)
          sub.triggerRef.current?.focus()
        } else menuKeyDown(event)
      }}
    >
      {children}
    </div>
  )
}
export const ContextTrigger = forwardRef<
  HTMLElement,
  HTMLAttributes<HTMLDivElement> & { asChild?: boolean; disabled?: boolean }
>(({ asChild = false, disabled, onContextMenu, onKeyDown, children, ...props }, ref) => {
  const root = useMenu()
  const Component = asChild ? Slot : 'div'
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelTouch = () => {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current)
      touchTimer.current = null
    }
  }
  useEffect(() => cancelTouch, [])
  return (
    <Component
      {...props}
      ref={mergeRefs(ref, root.triggerRef)}
      onContextMenu={(event) => {
        onContextMenu?.(event as React.MouseEvent<HTMLDivElement>)
        if (disabled || event.defaultPrevented) return
        event.preventDefault()
        root.setPoint({ x: event.clientX, y: event.clientY })
        root.setOpen(true)
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event as React.KeyboardEvent<HTMLDivElement>)
        if (
          !disabled &&
          !event.defaultPrevented &&
          (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
        ) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          root.setPoint({ x: rect.left, y: rect.bottom })
          root.setOpen(true)
        }
      }}
      onTouchStart={(event) => {
        props.onTouchStart?.(event as React.TouchEvent<HTMLDivElement>)
        if (disabled || event.defaultPrevented) return
        const touch = event.touches[0]
        if (!touch) return
        cancelTouch()
        touchTimer.current = setTimeout(() => {
          root.setPoint({ x: touch.clientX, y: touch.clientY })
          root.setOpen(true)
        }, 500)
      }}
      onTouchMove={cancelTouch}
      onTouchEnd={cancelTouch}
    >
      {children}
    </Component>
  )
})
ContextTrigger.displayName = 'ContextMenu.Trigger'
export function ContextContent({
  children,
  size = 'md',
  className = '',
  collisionPadding = 8,
  onCloseAutoFocus,
  onKeyDown,
  onPointerDownOutside,
  onFocusOutside,
  onInteractOutside,
  onEscapeKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement> &
  DismissEvents & {
    size?: PopoverSize
    collisionPadding?: number
    onCloseAutoFocus?: (event: Event) => void
  }) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const root = useMenuSurface(contentRef)
  const popover = useTopLayer(contentRef, root.open)
  useFocusReturn(root.open, contentRef, root.triggerRef, onCloseAutoFocus)
  const [point, setPoint] = useState(root.point)
  useLayoutEffect(() => {
    if (!root.open || !contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    setPoint({
      x: Math.max(
        collisionPadding,
        Math.min(root.point.x, window.innerWidth - rect.width - collisionPadding),
      ),
      y: Math.max(
        collisionPadding,
        Math.min(root.point.y, window.innerHeight - rect.height - collisionPadding),
      ),
    })
    contentRef.current
      .querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')
      ?.focus()
  }, [root.open, root.point, collisionPadding])
  useDismissableLayer({
    open: root.open,
    contentRef,
    additionalRefs: root.submenuRefs,
    onDismiss: () => root.setOpen(false),
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onEscapeKeyDown,
  })
  if (!root.open) return null
  return (
    <div
      {...props}
      ref={contentRef}
      popover={popover}
      role="menu"
      tabIndex={-1}
      data-state="open"
      data-popover-size={size}
      data-theme-component="dropdown-surface"
      className={`popover-surface tw:p-1.5 ${className}`}
      style={{
        ...props.style,
        position: 'fixed',
        margin: 0,
        inset: 'auto',
        left: point.x,
        top: point.y,
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented) {
          if (event.key === 'Tab') root.setOpen(false)
          else menuKeyDown(event)
        }
      }}
    >
      {children}
    </div>
  )
}
export const ContextMenu = {
  Root: MenuRoot,
  Trigger: ContextTrigger,
  Content: ContextContent,
  Portal: MenuPortal,
  Item: MenuItem,
  CheckboxItem: MenuCheckboxItem,
  RadioGroup: MenuRadioGroup,
  RadioItem: MenuRadioItem,
  ItemIndicator: MenuIndicator,
  Group: MenuGroup,
  Label: MenuLabel,
  Separator: MenuSeparator,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
}
