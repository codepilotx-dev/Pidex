import type React from 'react'
import { Dropdown as DropdownMenu } from './floating/Dropdown.js'
import { Check, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from './IconTokens.js'
import { Tooltip } from './Tooltip.js'
import { cx } from '../../utils/Cx.js'

type BaseProps = {
  children: React.ReactNode
  active?: boolean
  description?: React.ReactNode
  disabled?: boolean
  icon?: React.ReactNode
  meta?: React.ReactNode
  selected?: boolean
  shortcut?: React.ReactNode
  withArrow?: boolean
  arrowDirection?: 'up' | 'down' | 'right'
  withCheck?: boolean
  keepOpen?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

type Props = BaseProps & {
  selected?: boolean
  withCheck?: boolean
}

type CheckboxProps = BaseProps & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

type RadioItemProps = BaseProps & {
  value: string
}

type ItemContentProps = BaseProps & {
  indicator?: React.ReactNode
  selected?: boolean
}

function buildItemClassName({
  active,
  hasRichContent,
  selected,
}: {
  active?: boolean
  hasRichContent: boolean
  selected?: boolean
}): string {
  return [
    'interactive-row',
    'interactive-row--menu',
    'popover-item',
    'tw:w-full',
    'tw:min-w-0',
    'tw:items-center',
    'tw:text-left',
    hasRichContent ? 'rich' : '',
    active ? 'active' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function PopoverItemContent({
  children,
  description,
  icon,
  indicator,
  shortcut,
  withArrow,
  arrowDirection = 'right',
}: ItemContentProps): React.ReactNode {
  return (
    <>
      <span className="popover-item-leading">
        {icon ? <span className="popover-item-icon">{icon}</span> : null}
      </span>
      {description ? (
        <span className="popover-item-label popover-item-label--rich">
          <span className="popover-item-title">{children}</span>
          <span className="popover-item-description">{description}</span>
        </span>
      ) : (
        <span className="popover-item-label">{children}</span>
      )}
      <span className="popover-item-trailing">
        {shortcut ? <span className="popover-item-shortcut">{shortcut}</span> : null}
        {indicator ??
          (withArrow ? (
            arrowDirection === 'down' ? (
              <ChevronDown
                className="popover-item-arrow"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            ) : arrowDirection === 'up' ? (
              <ChevronUp
                className="popover-item-arrow"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            ) : (
              <ChevronRight
                className="popover-item-arrow"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            )
          ) : null)}
      </span>
    </>
  )
}

function withOptionalTooltip(item: React.ReactElement, meta: React.ReactNode): React.ReactNode {
  if (!meta) return item
  return (
    <Tooltip
      align="center"
      className="popover-item-tooltip tw:w-max tw:wrap-anywhere"
      content={meta}
      side="right"
      sideOffset={10}
    >
      {item}
    </Tooltip>
  )
}

export function PopoverItem({
  children,
  active,
  description,
  disabled,
  icon,
  meta,
  selected,
  shortcut,
  withArrow,
  arrowDirection = 'right',
  withCheck,
  keepOpen,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props): React.ReactNode {
  const hasRichContent = Boolean(description)
  const item = (
    <DropdownMenu.Item
      className={buildItemClassName({ active, hasRichContent, selected })}
      disabled={disabled}
      onPointerEnter={onMouseEnter}
      onPointerLeave={onMouseLeave}
      onSelect={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        if (keepOpen) {
          event.preventDefault()
        }
        onClick?.()
      }}
    >
      <PopoverItemContent
        arrowDirection={arrowDirection}
        description={description}
        icon={icon}
        indicator={
          selected && withCheck ? (
            <Check
              className="popover-item-check"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          ) : undefined
        }
        shortcut={shortcut}
        withArrow={withArrow}
      >
        {children}
      </PopoverItemContent>
    </DropdownMenu.Item>
  )

  return withOptionalTooltip(item, meta)
}

export function PopoverCheckboxItem({
  children,
  active,
  checked,
  description,
  disabled,
  icon,
  meta,
  shortcut,
  withArrow,
  arrowDirection = 'right',
  keepOpen,
  onCheckedChange,
  onMouseEnter,
  onMouseLeave,
}: CheckboxProps): React.ReactNode {
  const hasRichContent = Boolean(description)
  const item = (
    <DropdownMenu.CheckboxItem
      checked={checked}
      className={buildItemClassName({ active, hasRichContent, selected: checked })}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      onPointerEnter={onMouseEnter}
      onPointerLeave={onMouseLeave}
      onSelect={(event) => {
        if (keepOpen) event.preventDefault()
      }}
    >
      <PopoverItemContent
        arrowDirection={arrowDirection}
        description={description}
        icon={icon}
        indicator={
          <DropdownMenu.ItemIndicator asChild>
            <Check
              className="popover-item-check"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </DropdownMenu.ItemIndicator>
        }
        shortcut={shortcut}
        withArrow={withArrow}
      >
        {children}
      </PopoverItemContent>
    </DropdownMenu.CheckboxItem>
  )
  return withOptionalTooltip(item, meta)
}

export function PopoverRadioGroup({
  children,
  value,
  onValueChange,
}: React.ComponentPropsWithoutRef<typeof DropdownMenu.RadioGroup>): React.ReactNode {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  )
}

export function PopoverRadioItem({
  children,
  active,
  description,
  disabled,
  icon,
  meta,
  shortcut,
  value,
  withArrow,
  arrowDirection = 'right',
  onMouseEnter,
  onMouseLeave,
}: RadioItemProps): React.ReactNode {
  const hasRichContent = Boolean(description)
  const item = (
    <DropdownMenu.RadioItem
      className={buildItemClassName({ active, hasRichContent })}
      disabled={disabled}
      value={value}
      onPointerEnter={onMouseEnter}
      onPointerLeave={onMouseLeave}
    >
      <PopoverItemContent
        arrowDirection={arrowDirection}
        description={description}
        icon={icon}
        indicator={
          <DropdownMenu.ItemIndicator asChild>
            <Check
              className="popover-item-check"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </DropdownMenu.ItemIndicator>
        }
        shortcut={shortcut}
        withArrow={withArrow}
      >
        {children}
      </PopoverItemContent>
    </DropdownMenu.RadioItem>
  )
  return withOptionalTooltip(item, meta)
}

export function PopoverGroup({
  children,
}: React.ComponentPropsWithoutRef<typeof DropdownMenu.Group>): React.ReactNode {
  return <DropdownMenu.Group>{children}</DropdownMenu.Group>
}

export function PopoverLabel({
  children,
  className = 'popover-section-title',
}: React.ComponentPropsWithoutRef<typeof DropdownMenu.Label>): React.ReactNode {
  return (
    <DropdownMenu.Label
      className={cx(className, 'tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-label')}
    >
      {children}
    </DropdownMenu.Label>
  )
}

export function PopoverSeparator({
  className = 'popover-divider',
}: React.ComponentPropsWithoutRef<typeof DropdownMenu.Separator>): React.ReactNode {
  return <DropdownMenu.Separator className={cx(className, 'tw:h-px tw:my-1 tw:bg-app-border')} />
}
