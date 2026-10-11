import { SearchInput } from '../SearchInput.js'
import { ContextMenu, MenuRoot, selectMenuItem, useMenu, useMenuSurface } from './Menu.js'
import type { PopoverSize } from '../PopoverSizing.js'
import { useLocale as useI18n } from '../../../features/i18n/LocaleProvider.js'
import React, {
  createContext,
  forwardRef,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { Check } from 'lucide-react'
import { useFloatingPosition, type FloatingPlacement } from './UseFloatingPosition.js'
import {
  mergeRefs,
  Slot,
  useControllableState,
  useDismissableLayer,
  useFocusReturn,
  usePortal,
  useTopLayer,
  type DismissEvents,
} from './Primitives.js'

interface DropdownContextValue {
  mode: 'menu' | 'select'
  open: boolean
  setOpen: (open: boolean) => void
  value?: string
  setValue: (value: string) => void
  disabled: boolean
  triggerRef: React.MutableRefObject<HTMLElement | null>
  contentId: string
}
const DropdownContext = createContext<DropdownContextValue | null>(null)
function useDropdown() {
  const context = useContext(DropdownContext)
  if (!context) throw new Error('Dropdown parts must be inside Dropdown.Root')
  return context
}

export interface DropdownRootProps<T extends string = string> {
  children: ReactNode
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  mode?: 'menu' | 'select'
  disabled?: boolean
}
function DropdownRoot<T extends string = string>({
  children,
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  mode = 'select',
}: DropdownRootProps<T>) {
  const [activeValue, setValue] = useControllableState<T | undefined>(
    value,
    defaultValue,
    (next) => {
      if (next !== undefined) onValueChange?.(next)
    },
  )
  const [activeOpen, setOpen] = useControllableState(open, defaultOpen, onOpenChange)
  const triggerRef = useRef<HTMLElement | null>(null)
  const contentId = useId()
  return (
    <MenuRoot open={activeOpen} onOpenChange={setOpen}>
      <DropdownContext.Provider
        value={{
          mode,
          open: activeOpen,
          setOpen,
          value: activeValue,
          setValue: (next) => setValue(next as T),
          disabled,
          triggerRef,
          contentId,
        }}
      >
        {children}
      </DropdownContext.Provider>
    </MenuRoot>
  )
}

export interface DropdownTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}
const DropdownTrigger = forwardRef<HTMLElement, DropdownTriggerProps>(
  ({ asChild = false, disabled, onClick, onKeyDown, ...props }, ref) => {
    const context = useDropdown()
    const menu = useMenu()
    const isDisabled = disabled || context.disabled
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        {...props}
        type="button"
        ref={mergeRefs(ref, context.triggerRef, menu.triggerRef) as React.Ref<HTMLButtonElement>}
        disabled={isDisabled}
        aria-haspopup={context.mode === 'menu' ? 'menu' : 'listbox'}
        aria-expanded={context.open}
        aria-controls={context.open ? context.contentId : undefined}
        data-state={context.open ? 'open' : 'closed'}
        data-disabled={isDisabled ? '' : undefined}
        onClick={(event) => {
          onClick?.(event as React.MouseEvent<HTMLButtonElement>)
          if (!event.defaultPrevented && !isDisabled) context.setOpen(!context.open)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          // 方向键打开下拉是选择型下拉的惯例，且此时不应滚动页面
          if (
            !event.defaultPrevented &&
            !isDisabled &&
            !context.open &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
          ) {
            event.preventDefault()
            context.setOpen(true)
          }
        }}
      />
    )
  },
)
DropdownTrigger.displayName = 'Dropdown.Trigger'

const SearchContext = createContext('')
export function matchesDropdownSearch(query: string, text: string, description = '') {
  return `${text} ${description}`.toLowerCase().includes(query.trim().toLowerCase())
}
export interface DropdownContentProps extends HTMLAttributes<HTMLDivElement>, DismissEvents {
  /** 原生搜索、外部锚点和 UI-Design 三档尺寸。 */
  showSearch?: boolean
  searchLabel?: string
  listLabel?: string
  searchPlaceholder?: string
  searchValue?: string
  onSearchValueChange?: (value: string) => void
  title?: string
  emptyText?: string
  anchor?: HTMLElement | null | React.RefObject<HTMLElement | null>
  size?: PopoverSize
  collisionPadding?: number
  avoidCollisions?: boolean
  onOpenAutoFocus?: (event: Event) => void
  onCloseAutoFocus?: (event: Event) => void
  footer?: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}
const DropdownContent = forwardRef<HTMLDivElement, DropdownContentProps>(
  (
    {
      children,
      showSearch = false,
      searchLabel,
      listLabel,
      searchPlaceholder: customSearchPlaceholder,
      searchValue,
      onSearchValueChange,
      title: customTitle,
      emptyText: customEmptyText,
      anchor,
      size = 'md',
      collisionPadding = 8,
      avoidCollisions = true,
      onOpenAutoFocus,
      onCloseAutoFocus,
      footer,
      side = 'bottom',
      align = 'start',
      sideOffset = 6,
      className = '',
      style,
      onKeyDown,
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      onEscapeKeyDown,
      ...props
    },
    ref,
  ) => {
    const { t } = useI18n()
    const searchPlaceholder = customSearchPlaceholder ?? t('搜索…')
    const title = customTitle ?? ''
    const emptyText = customEmptyText ?? t('没有匹配的选项')
    const context = useDropdown()
    const contentRef = useRef<HTMLDivElement>(null)
    const menu = useMenuSurface(contentRef)
    const popover = useTopLayer(contentRef, context.open)
    const searchRef = useRef<HTMLInputElement>(null)
    const anchorRef = useRef<HTMLElement | null>(null)
    anchorRef.current =
      anchor === undefined
        ? context.triggerRef.current
        : anchor && 'current' in anchor
          ? anchor.current
          : ((anchor as HTMLElement | null) ?? null)
    const [query, setQuery] = useControllableState(searchValue, '', onSearchValueChange)
    const [empty, setEmpty] = useState(false)
    useLayoutEffect(() => {
      anchorRef.current =
        anchor === undefined
          ? context.triggerRef.current
          : anchor && 'current' in anchor
            ? anchor.current
            : ((anchor as HTMLElement | null) ?? null)
    })
    const portal = usePortal()
    const { coords, floatingStyle } = useFloatingPosition({
      anchor: anchor ?? context.triggerRef,
      contentRef,
      isOpen: context.open,
      placement: (align === 'center' ? side : `${side}-${align}`) as FloatingPlacement,
      offset: sideOffset,
      collisionPadding,
      avoidCollisions,
      portal,
    })
    useDismissableLayer({
      open: context.open,
      contentRef,
      anchorRef,
      additionalRefs: menu.submenuRefs,
      onDismiss: () => context.setOpen(false),
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      onEscapeKeyDown,
    })
    useFocusReturn(context.open, contentRef, anchorRef, onCloseAutoFocus)
    useLayoutEffect(() => {
      if (!context.open) return
      const event = new Event('floating.openAutoFocus', { cancelable: true })
      onOpenAutoFocus?.(event)
      if (event.defaultPrevented) return
      if (showSearch) searchRef.current?.focus()
      else
        (
          contentRef.current?.querySelector<HTMLElement>(
            '[data-dropdown-item][aria-selected="true"]:not([aria-disabled="true"])',
          ) ??
          contentRef.current?.querySelector<HTMLElement>(
            '[data-dropdown-item]:not([aria-disabled="true"]):not([hidden])',
          ) ??
          contentRef.current
        )?.focus()
    }, [context.open, showSearch])
    useLayoutEffect(() => {
      if (context.open)
        setEmpty(!contentRef.current?.querySelector('[data-dropdown-item]:not([hidden])'))
    }, [context.open, children, query, showSearch])
    if (!context.open) return null
    const listboxId = `${context.contentId}-listbox`
    return (
      <div
        {...props}
        ref={mergeRefs(ref, contentRef)}
        popover={popover}
        id={context.contentId}
        data-state="open"
        data-side={coords?.actualPlacement.split('-')[0] ?? side}
        data-popover-size={size}
        data-theme-component="dropdown-surface"
        tabIndex={-1}
        style={{ ...floatingStyle, ...style }}
        className={`popover-surface popover tw:p-1.5  tw:select-none tw:text-[var(--cpx-sys-color-fg-primary)] ${className}`}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return
          const target = event.target as HTMLElement
          if (target.matches('input, textarea, select, [contenteditable="true"]')) {
            if (target !== searchRef.current || event.key === 'Home' || event.key === 'End') return
          }
          const items = Array.from(
            contentRef.current?.querySelectorAll<HTMLElement>(
              '[data-dropdown-item]:not([hidden]):not([aria-disabled="true"])',
            ) ?? [],
          )
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
            // 搜索模式下从首项继续上移时把焦点交还搜索框，方便继续输入
            if (showSearch && searchRef.current && event.key === 'ArrowUp' && index <= 0) {
              searchRef.current.focus()
            } else {
              items[next].focus()
            }
          } else if (event.key === 'Tab' && !showSearch) context.setOpen(false)
        }}
      >
        {title && !showSearch && (
          <div className="tw:px-2.5 tw:py-1 tw:type-label tw:text-[var(--cpx-sys-color-fg-tertiary)] tw:uppercase tw:tracking-[0.8px]">
            {title}
          </div>
        )}
        {showSearch && (
          <div className="popover-search-region tw:flex-none tw:bg-transparent tw:p-1">
            <SearchInput
              ref={searchRef}
              className="tw:w-full tw:max-w-full tw:box-border"
              aria-label={searchLabel ?? searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={setQuery}
              clearLabel={t('清空搜索')}
              variant="compact"
              mode="combobox"
              expanded
              controls={listboxId}
            />
          </div>
        )}
        <div
          role={context.mode === 'menu' ? 'menu' : 'listbox'}
          id={listboxId}
          aria-label={listLabel ?? props['aria-label'] ?? (title || searchPlaceholder)}
          className={`tw:flex tw:flex-col tw:gap-0.5 ${context.mode === 'select' ? 'tw:max-h-[220px] tw:overflow-y-auto' : ''}`}
        >
          <SearchContext.Provider value={showSearch ? query : ''}>
            {children}
          </SearchContext.Provider>
        </div>
        {footer}
        {empty && (
          <div
            className="tw:px-2.5 tw:py-3 tw:text-center tw:text-[var(--cpx-sys-color-fg-tertiary)] tw:type-caption"
            role="status"
          >
            {emptyText}
          </div>
        )}
      </div>
    )
  },
)
DropdownContent.displayName = 'Dropdown.Content'

export interface DropdownItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  asChild?: boolean
  value?: string
  filter?: boolean
  textValue?: string
  description?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  onSelect?: (event: Event) => void
}
const DropdownItem = forwardRef<HTMLDivElement, DropdownItemProps>(
  (
    {
      value,
      children,
      textValue,
      filter = true,
      description,
      icon,
      asChild = false,
      disabled = false,
      className = '',
      onClick,
      onKeyDown,
      onSelect,
      ...props
    },
    ref,
  ) => {
    const context = useDropdown()
    const query = useContext(SearchContext).trim().toLowerCase()
    const [highlighted, setHighlighted] = useState(false)
    const selected = context.mode === 'select' && value !== undefined && value === context.value
    const hidden =
      filter &&
      !!query &&
      !matchesDropdownSearch(
        query,
        textValue ?? (typeof children === 'string' ? children : (value ?? '')),
        typeof description === 'string' ? description : '',
      )
    const select = () => {
      if (disabled || context.disabled) return
      selectMenuItem(
        onSelect,
        () => context.setOpen(false),
        () => {
          if (context.mode === 'select' && value !== undefined) context.setValue(value)
        },
      )
    }
    const ItemComponent = asChild ? Slot : 'div'
    if (context.mode === 'menu')
      return (
        <ContextMenu.Item
          {...props}
          ref={ref}
          disabled={disabled || context.disabled}
          hidden={hidden}
          onSelect={onSelect}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className={className}
          asChild={asChild}
        >
          {children}
        </ContextMenu.Item>
      )
    return (
      <ItemComponent
        {...props}
        ref={ref}
        data-dropdown-item
        role="option"
        aria-selected={context.mode === 'select' ? selected : undefined}
        aria-disabled={disabled || context.disabled}
        data-state={selected ? 'checked' : 'unchecked'}
        data-disabled={disabled || context.disabled ? '' : undefined}
        data-highlighted={highlighted ? '' : undefined}
        hidden={hidden}
        tabIndex={disabled || context.disabled ? undefined : -1}
        onFocus={(event) => {
          props.onFocus?.(event)
          setHighlighted(true)
        }}
        onBlur={(event) => {
          props.onBlur?.(event)
          setHighlighted(false)
        }}
        onClick={(event) => {
          if (disabled || context.disabled) return
          onClick?.(event)
          if (!event.defaultPrevented) select()
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (
            !event.defaultPrevented &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229 &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault()
            select()
          }
        }}
        className={
          asChild
            ? `${hidden ? 'tw:hidden' : ''} ${className}`
            : `tw:px-2.5 tw:py-1.5 tw:type-control tw:rounded-[var(--cpx-sys-radius-control)] tw:cursor-pointer tw:items-center tw:justify-between tw:transition-colors tw:outline-none ${hidden ? 'tw:hidden' : 'tw:flex'} ${disabled || context.disabled ? 'tw:opacity-40 tw:cursor-not-allowed' : highlighted ? 'tw:bg-[var(--cpx-sys-color-hover)] tw:text-[var(--cpx-sys-color-fg-primary)]' : selected ? 'tw:text-[var(--cpx-sys-color-fg-primary)] tw:hover:bg-[var(--cpx-sys-color-hover)]' : 'tw:text-[var(--cpx-sys-color-fg-secondary)] tw:hover:text-[var(--cpx-sys-color-fg-primary)] tw:hover:bg-[var(--cpx-sys-color-hover)]'} ${className}`
        }
      >
        {asChild ? (
          children
        ) : (
          <>
            <div className="tw:flex tw:items-center tw:gap-2 tw:min-w-0 tw:pr-1">
              {icon && <span className="tw:flex-shrink-0">{icon}</span>}
              <div className="tw:min-w-0">
                <div className="tw:truncate">{children}</div>
                {description && (
                  <div className="tw:type-caption tw:text-[var(--cpx-sys-color-fg-tertiary)] tw:truncate tw:mt-0.5">
                    {description}
                  </div>
                )}
              </div>
            </div>
            {selected && (
              <Check
                size={13}
                strokeWidth={2.8}
                className="tw:text-[var(--cpx-sys-color-accent)] tw:flex-shrink-0 tw:ml-1.5"
              />
            )}
          </>
        )}
      </ItemComponent>
    )
  },
)
DropdownItem.displayName = 'Dropdown.Item'

export const Dropdown = {
  ...ContextMenu,
  Root: DropdownRoot,
  Trigger: DropdownTrigger,
  Portal: ContextMenu.Portal,
  Content: DropdownContent,
  Item: DropdownItem,
}
