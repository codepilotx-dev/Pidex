import type React from 'react'
import { Dropdown } from './floating/Dropdown.js'
import { ChevronRight } from 'lucide-react'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from './IconTokens.js'
import type { PopoverSizingProps } from './PopoverSizing.js'
import { cx } from '../../utils/Cx.js'
export type SearchablePopoverOption = {
  disabled?: boolean
  filter?: boolean
  textValue?: string
  value: string
}

type Props<Option extends SearchablePopoverOption> = {
  align?: 'start' | 'center' | 'end'
  className?: string
  contentLabel: string
  emptyLabel: string
  footer?: React.ReactNode
  listClassName?: string
  listLabel: string
  onOpenChange: (open: boolean) => void
  onSearchChange: (value: string) => void
  onSelect: (option: Option) => void | Promise<void>
  open: boolean
  options: Option[]
  renderOption: (option: Option, selected: boolean) => React.ReactNode
  search: string
  searchLabel: string
  searchPlaceholder: string
  selectedValue?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactElement
} & PopoverSizingProps

export function SearchablePopoverContent<Option extends SearchablePopoverOption>({
  align = 'start',
  className = '',
  contentLabel,
  emptyLabel,
  footer,
  listClassName = '',
  listLabel,
  onOpenChange,
  onSearchChange,
  onSelect,
  open,
  options,
  renderOption,
  search,
  searchLabel,
  searchPlaceholder,
  selectedValue,
  side = 'bottom',
  sideOffset = 4,
  trigger,
  size,
}: Props<Option>): React.ReactNode {
  return (
    <Dropdown.Root value={selectedValue} open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          size={size}
          align={align}
          side={side}
          sideOffset={sideOffset}
          showSearch
          searchValue={search}
          onSearchValueChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
          searchLabel={searchLabel}
          aria-label={contentLabel}
          listLabel={listLabel}
          title=""
          emptyText={emptyLabel}
          footer={footer}
          className={cx('popover-menu--grid', className)}
        >
          <div className={listClassName}>
            {options.map((option) => (
              <Dropdown.Item
                key={option.value}
                value={option.value}
                textValue={option.textValue ?? option.value}
                filter={option.filter}
                disabled={option.disabled}
                onSelect={() => {
                  void onSelect(option)
                }}
                asChild
              >
                <div className="interactive-row interactive-row--menu popover-item tw:w-full tw:min-w-0 tw:items-center tw:text-left">
                  {renderOption(option, option.value === selectedValue)}
                </div>
              </Dropdown.Item>
            ))}
          </div>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
type ActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: React.ReactNode
  withArrow?: boolean
}

export function SearchablePopoverAction({
  children,
  className = '',
  icon,
  withArrow,
  ...buttonProps
}: ActionProps): React.ReactNode {
  return (
    <button
      {...buttonProps}
      className={cx('interactive-row', 'interactive-row--menu', 'popover-item', className)}
      type="button"
    >
      <span className="popover-item-leading">
        {icon ? <span className="popover-item-icon">{icon}</span> : null}
      </span>
      <span className="popover-item-label">{children}</span>
      <span className="popover-item-trailing">
        {withArrow ? (
          <ChevronRight
            aria-hidden="true"
            className="popover-item-arrow"
            size={APP_ICON_SIZES.sm}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        ) : null}
      </span>
    </button>
  )
}
