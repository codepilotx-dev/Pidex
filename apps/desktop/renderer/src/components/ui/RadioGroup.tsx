import React from 'react'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { cx } from '../../utils/Cx.js'

export type RadioGroupProps = {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
  className?: string
  name?: string
  orientation?: 'horizontal' | 'vertical'
}

export function RadioGroup({
  value,
  onValueChange,
  children,
  ariaLabel,
  disabled = false,
  className,
  orientation = 'vertical',
  name,
}: RadioGroupProps): React.ReactNode {
  return (
    <RadioGroupPrimitive.Root
      aria-label={ariaLabel}
      className={cx(
        'ui-radio-group tw:flex tw:gap-2',
        orientation === 'vertical' ? 'tw:flex-col' : 'tw:flex-row tw:flex-wrap',
        className,
      )}
      disabled={disabled}
      name={name}
      orientation={orientation}
      value={value}
      onValueChange={onValueChange}
    >
      {children}
    </RadioGroupPrimitive.Root>
  )
}

export type RadioItemProps = {
  value: string
  label?: React.ReactNode
  detail?: React.ReactNode
  icon?: React.ReactNode
  children?: React.ReactNode
  variant?: 'default' | 'card'
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function RadioItem({
  value,
  label,
  detail,
  icon,
  children,
  variant = 'default',
  disabled = false,
  className,
  ariaLabel,
}: RadioItemProps): React.ReactNode {
  return (
    <label
      className={cx(
        'ui-radio-item tw:inline-flex tw:min-w-0 tw:cursor-pointer tw:select-none tw:gap-2 tw:text-app-text',
        variant === 'card'
          ? 'tw:items-start tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-control tw:p-3 tw:has-[[data-state=checked]]:border-app-focus tw:has-[[data-state=checked]]:bg-app-selected'
          : 'tw:items-center',
        'tw:data-[disabled]:cursor-default tw:data-[disabled]:text-app-text-disabled tw:data-[disabled]:opacity-55',
        className,
      )}
      data-disabled={disabled || undefined}
      data-variant={variant}
    >
      <RadioGroupPrimitive.Item
        aria-label={ariaLabel}
        className={cx(
          'ui-radio-control tw:inline-grid tw:size-4 tw:shrink-0 tw:place-items-center tw:rounded-pill tw:border tw:border-app-border-strong tw:bg-app-control tw:p-0 tw:text-app-on-accent',
          'tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard',
          'tw:data-[state=checked]:border-app-accent tw:data-[state=checked]:bg-app-accent',
          'tw:focus-visible:border-app-focus tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
          // forced-colors 高亮来自 base.css 的 token 重映射（border-strong / selected → Highlight）。
          'tw:forced-colors:data-[state=checked]:border-app-border-strong tw:forced-colors:data-[state=checked]:bg-app-selected tw:forced-colors:data-[state=checked]:forced-color-adjust-none',
        )}
        disabled={disabled}
        value={value}
      >
        <RadioGroupPrimitive.Indicator className="ui-radio-indicator tw:size-2 tw:rounded-pill tw:bg-current" />
      </RadioGroupPrimitive.Item>
      {icon ? (
        <span aria-hidden="true" className="ui-radio-icon tw:inline-flex tw:text-app-text-soft">
          {icon}
        </span>
      ) : null}
      <span className="ui-radio-copy tw:grid tw:min-w-0 tw:gap-1">
        <span className="ui-radio-label tw:type-row-title">{label ?? children}</span>
        {detail ? (
          <span className="ui-radio-detail tw:text-app-text-soft tw:type-body-sm">{detail}</span>
        ) : null}
      </span>
    </label>
  )
}
