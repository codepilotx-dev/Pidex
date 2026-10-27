import { forwardRef, useCallback, useRef } from 'react'
import type React from 'react'
import { Search, X } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from './IconTokens.js'
import { Button } from './Button.js'
import { cx } from '../../utils/Cx.js'
import './SearchInput.css'

export type SearchInputVariant = 'standard' | 'compact' | 'embedded' | 'outlined'
export type SearchInputSize = 'sm' | 'md'
export type SearchInputShape = 'default' | 'pill'

type SearchInputFilterMode = { mode?: 'filter' }

type SearchInputComboboxMode = {
  mode: 'combobox'
  controls: string
  expanded: boolean
  activeDescendant?: string
}

type SearchInputMode = SearchInputFilterMode | SearchInputComboboxMode

export type SearchInputProps = {
  'aria-label': string
  clearLabel?: string
  onChange: (value: string) => void
  onEscapeEmpty?: () => void
  onClose?: () => void
  placeholder: string
  value: string
  variant?: SearchInputVariant
  size?: SearchInputSize
  shape?: SearchInputShape
  /** IME composition in progress — suppresses Escape/arrow/Enter handling */
  isComposing?: boolean
} & SearchInputMode &
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'aria-label' | 'size'
  >

/** Internal helper: strip discrimated-union fields not intended for <input> DOM. */
function stripModeFields(props: Record<string, unknown>): Record<string, unknown> {
  const { mode: _, controls: _c, expanded: _e, activeDescendant: _a, ...rest } = props
  return rest
}

/*
 * Appearance lives here as complete static class lists: the variant modifier
 * class stays as a query hook, and never carries the Tailwind classes itself.
 */
const SIZE_BOX_CLASSES: Record<SearchInputSize, string> = {
  sm: 'tw:h-7 tw:min-h-7 tw:px-2.5',
  md: 'tw:h-9 tw:min-h-9 tw:px-3.5',
}

const DEFAULT_VARIANT_SIZE_CLASSES: Record<SearchInputVariant, string> = {
  outlined: 'tw:h-7 tw:px-2.5',
  standard: 'tw:py-control-block tw:px-control-inline',
  compact: 'tw:py-1 tw:px-control-inline',
  embedded: 'tw:py-control-block tw:px-control-inline',
}

const DEFAULT_VARIANT_RADIUS_CLASSES: Record<SearchInputVariant, string> = {
  outlined: 'tw:rounded-control',
  standard: 'tw:rounded-md',
  compact: 'tw:rounded-md',
  embedded: 'tw:rounded-none',
}

const VARIANT_BASE_CLASSES: Record<SearchInputVariant, string> = {
  outlined:
    'search-input--outlined tw:bg-app-control tw:type-secondary tw:has-[:focus-visible]:outline-none',
  standard: 'search-input--standard tw:type-control',
  compact: 'search-input--compact tw:type-control',
  embedded: 'search-input--embedded tw:border-0 tw:bg-transparent tw:type-body-sm',
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    'aria-label': ariaLabel,
    clearLabel = '清除搜索',
    onChange,
    onEscapeEmpty,
    onClose,
    onKeyDown,
    placeholder,
    value,
    variant = 'standard',
    size,
    shape,
    isComposing = false,
    className,
    ...rawRest
  },
  forwardedRef,
): React.ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isCombobox = rawRest.mode === 'combobox'
  const isFilter = rawRest.mode === undefined || rawRest.mode === 'filter'
  const safeInputProps = stripModeFields(rawRest)

  const setRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  const handleClear = useCallback((): void => {
    onChange('')
    if (onClose) {
      onClose()
      return
    }
    inputRef.current?.focus()
  }, [onChange, onClose])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (!isComposing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        if (event.key === 'Escape') {
          if (onClose) {
            event.preventDefault()
            event.stopPropagation()
            onChange('')
            onClose()
            return
          }
          if (value.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            onChange('')
            return
          }
          onEscapeEmpty?.()
        }
      }
      onKeyDown?.(event)
    },
    [isComposing, value, onChange, onEscapeEmpty, onClose, onKeyDown],
  )

  const comboboxProps = isCombobox
    ? {
        role: 'combobox' as const,
        'aria-autocomplete': 'list' as const,
        'aria-controls': rawRest.controls ?? '',
        'aria-expanded': rawRest.expanded ?? false,
        'aria-activedescendant': rawRest.activeDescendant,
      }
    : {}

  const sizeClass = size ? SIZE_BOX_CLASSES[size] : DEFAULT_VARIANT_SIZE_CLASSES[variant]
  const radiusClass = shape === 'pill' ? 'tw:rounded-full' : DEFAULT_VARIANT_RADIUS_CLASSES[variant]

  return (
    <div
      className={cx(
        'search-input tw:type-control tw:inline-flex tw:min-w-0 tw:items-center tw:gap-control-gap tw:border tw:border-app-border-subtle tw:bg-app-canvas',
        'tw:transition-[background-color,border-color,color,opacity] tw:duration-feedback tw:ease-standard',
        'tw:hover:border-app-border-strong',
        'tw:has-[:focus-visible]:border-app-focus tw:has-[:focus-visible]:outline-2 tw:has-[:focus-visible]:outline-offset-1 tw:has-[:focus-visible]:outline-app-focus',
        'tw:has-[input:disabled]:cursor-default tw:has-[input:disabled]:bg-app-panel tw:has-[input:disabled]:outline-none tw:has-[input:disabled]:opacity-55',
        VARIANT_BASE_CLASSES[variant],
        sizeClass,
        radiusClass,
        className,
      )}
      data-shape={shape}
      data-size={size}
    >
      <Search
        aria-hidden="true"
        className="search-input-icon tw:size-[var(--inline-icon-size,1em)] tw:shrink-0 tw:pointer-events-none tw:text-app-text"
        size={APP_ICON_SIZE}
      />
      <input
        {...safeInputProps}
        {...comboboxProps}
        ref={setRef}
        aria-label={ariaLabel}
        className="search-input-field tw:min-w-0 tw:flex-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text tw:shadow-none tw:outline-none tw:placeholder:text-app-text-meta tw:disabled:cursor-default tw:disabled:text-app-text-disabled"
        data-mode={isCombobox ? 'combobox' : isFilter ? 'filter' : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value || (variant === 'outlined' && onClose) ? (
        <Button
          isIconOnly
          aria-label={onClose ? '清除并关闭搜索' : clearLabel}
          className={cx('search-input-clear', variant === 'outlined' && 'tw:text-app-text-meta')}
          color="ghostSecondary"
          onClick={handleClear}
          size="iconMd"
          title={onClose ? '清除并关闭搜索' : clearLabel}
        >
          <X size={APP_ICON_SIZES.sm} />
        </Button>
      ) : null}
    </div>
  )
})
