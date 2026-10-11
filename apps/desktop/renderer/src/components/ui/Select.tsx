import React, { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { APP_ICON_SIZES } from './IconTokens.js'
import { cx } from '../../utils/Cx.js'
import { useFloatingFocusModality } from '../../utils/FloatingFocus.js'
import { Dropdown } from './floating/Dropdown.js'
import type { PopoverSize } from './PopoverSizing.js'
import { useLocale } from '../../features/i18n/LocaleProvider.js'
export type SelectOption<T extends string = string> = {
  value: T
  label: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
}

export type SelectProps<T extends string = string> = {
  value: T
  options: readonly SelectOption<T>[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  searchValue?: string
  loading?: boolean
  emptyText?: string
  size?: PopoverSize
  showSelectedIndicator?: boolean
  triggerClassName?: string
  variant?: string
  onOpenChange?: (open: boolean) => void
  onSearchChange?: (query: string) => void
  onValueChange: (value: T) => void
}

const SELECT_TRIGGER_CLASSNAME =
  'ui-select-trigger settings-dropdown settings-dropdown-trigger tw:min-h-7 tw:min-w-0 tw:appearance-none tw:inline-flex tw:items-center tw:justify-between tw:gap-control-gap tw:border tw:rounded-control tw:px-row-inline tw:py-0 tw:text-left tw:type-control tw:cursor-pointer tw:outline-none tw:transition-[background-color,border-color,color,opacity] tw:duration-feedback tw:ease-out tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1'
function OptionContent({
  option,
  selected,
  showSelectedIndicator,
}: {
  option: SelectOption
  selected: boolean
  showSelectedIndicator: boolean
}): React.ReactNode {
  return (
    <div className="ui-select-item-inner settings-dropdown-item-inner tw:flex tw:w-full tw:min-w-0 tw:items-center tw:gap-2">
      {option.icon}
      <div className="ui-select-item-copy settings-dropdown-item-copy tw:grid tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:gap-1">
        <span className="ui-select-item-label settings-dropdown-item-label tw:truncate tw:type-row-title">
          {option.label}
        </span>
        {option.detail ? (
          <span className="ui-select-item-detail settings-dropdown-item-detail tw:truncate tw:text-app-text-meta tw:type-caption">
            {option.detail}
          </span>
        ) : null}
      </div>
      {showSelectedIndicator && selected ? (
        <Check
          aria-hidden="true"
          className="ui-select-item-indicator settings-dropdown-item-indicator tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:text-app-accent-fg"
          size={APP_ICON_SIZES.sm}
        />
      ) : null}
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  ariaLabel,
  placeholder,
  disabled,
  searchable = false,
  searchPlaceholder,
  searchValue,
  loading,
  emptyText,
  size = 'md',
  showSelectedIndicator = true,
  triggerClassName,
  variant,
  onOpenChange,
  onSearchChange,
  onValueChange,
}: SelectProps<T>): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { t } = useLocale()
  const focus = useFloatingFocusModality()
  const selected = options.find((option) => option.value === value)
  return (
    <Dropdown.Root
      value={value}
      onValueChange={onValueChange}
      open={open}
      disabled={disabled}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
        if (!next) onSearchChange?.('')
      }}
    >
      <Dropdown.Trigger
        aria-label={ariaLabel}
        className={cx(SELECT_TRIGGER_CLASSNAME, triggerClassName)}
        data-theme-component="dropdown-trigger"
        data-variant={variant}
        {...focus.triggerInteractionProps}
      >
        <span className="ui-select-value tw:min-w-0 tw:truncate">
          {selected?.label ?? placeholder ?? ariaLabel}
        </span>
        <ChevronDown size={APP_ICON_SIZES.sm} />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          size={size}
          showSearch={searchable}
          searchPlaceholder={searchPlaceholder}
          searchValue={searchValue}
          onSearchValueChange={onSearchChange}
          emptyText={loading ? t('加载中…') : emptyText}
          aria-label={ariaLabel}
          title=""
          className="ui-select-content settings-dropdown-content"
          onCloseAutoFocus={focus.suppressFocusRingOnClose}
        >
          {!loading &&
            options.map((option) => (
              <Dropdown.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                textValue={[option.value, option.label, option.detail]
                  .filter((part) => typeof part === 'string')
                  .join(' ')}
                asChild
              >
                <div className="ui-select-item settings-dropdown-item">
                  <OptionContent
                    option={option}
                    selected={option.value === value}
                    showSelectedIndicator={showSelectedIndicator}
                  />
                </div>
              </Dropdown.Item>
            ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
