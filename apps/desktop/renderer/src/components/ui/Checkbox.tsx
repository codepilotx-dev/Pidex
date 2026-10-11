import { APP_ICON_SIZES } from './IconTokens.js'
import React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cx } from '../../utils/Cx.js'

export type CheckboxProps = {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean | 'indeterminate') => void
  children?: React.ReactNode
  ariaLabel?: string
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  required?: boolean
}

export function Checkbox({
  checked,
  onCheckedChange,
  children,
  ariaLabel,
  disabled = false,
  className,
  ...rootProps
}: CheckboxProps): React.ReactNode {
  const control = (
    <CheckboxPrimitive.Root
      {...rootProps}
      aria-label={ariaLabel}
      checked={checked}
      className={cx(
        'ui-checkbox-control tw:inline-grid tw:size-4 tw:shrink-0 tw:place-items-center tw:rounded-compact tw:border tw:border-app-border-strong tw:bg-app-control tw:p-0 tw:text-app-on-accent',
        'tw:transition-[background-color,border-color] tw:duration-feedback tw:ease-standard',
        'tw:data-[state=checked]:border-app-accent tw:data-[state=checked]:bg-app-accent',
        'tw:data-[state=indeterminate]:border-app-accent tw:data-[state=indeterminate]:bg-app-accent',
        'tw:focus-visible:border-app-focus tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
        // forced-colors 高亮来自 base.css 的 token 重映射（border-strong / selected → Highlight）。
        'tw:forced-colors:data-[state=checked]:border-app-border-strong tw:forced-colors:data-[state=checked]:bg-app-selected tw:forced-colors:data-[state=checked]:forced-color-adjust-none',
        'tw:forced-colors:data-[state=indeterminate]:border-app-border-strong tw:forced-colors:data-[state=indeterminate]:bg-app-selected tw:forced-colors:data-[state=indeterminate]:forced-color-adjust-none',
        children ? undefined : className,
      )}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator tw:size-icon-sm [&_svg]:tw:size-icon-sm">
        {checked === 'indeterminate' ? (
          <Minus size={APP_ICON_SIZES.sm} aria-hidden="true" />
        ) : (
          <Check size={APP_ICON_SIZES.sm} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  return children ? (
    <label
      className={cx(
        'ui-checkbox tw:inline-flex tw:items-center tw:gap-2 tw:min-w-0 tw:cursor-pointer tw:select-none tw:text-app-text',
        'tw:data-[disabled]:cursor-default tw:data-[disabled]:text-app-text-disabled tw:data-[disabled]:opacity-55',
        className,
      )}
      data-disabled={disabled || undefined}
    >
      {control}
      <span className="ui-checkbox-label tw:type-row-title">{children}</span>
    </label>
  ) : (
    control
  )
}
