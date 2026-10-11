import type React from 'react'
import { cx } from '../../utils/Cx.js'

export type SpinnerProps = {
  className?: string
  label?: string
  size?: 'small' | 'medium' | 'large'
}

export function Spinner({ className, label, size = 'small' }: SpinnerProps): React.ReactNode {
  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      className={cx(
        'ui-spinner tw:inline-block tw:shrink-0 tw:animate-spin tw:rounded-full tw:border-2 tw:border-current tw:border-r-transparent',
        size === 'medium'
          ? 'tw:size-icon-md'
          : size === 'large'
            ? 'tw:size-icon-lg'
            : 'tw:size-icon-sm',
        className,
      )}
      data-size={size}
      role={label ? 'status' : undefined}
    />
  )
}
