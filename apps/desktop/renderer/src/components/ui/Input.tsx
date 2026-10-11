import { forwardRef } from 'react'
import type React from 'react'
import { cx } from '../../utils/Cx.js'

export type InputSize = 'sm' | 'md' | 'compact'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  invalid?: boolean
  size?: InputSize
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'tw:type-secondary',
  md: 'tw:type-control',
  compact: 'tw:type-control',
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, invalid = false, readOnly = false, size = 'md', ...inputProps },
  ref,
): React.ReactNode {
  return (
    <input
      {...inputProps}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        'ui-input tw:min-w-0 tw:border tw:border-app-border-subtle tw:rounded-md tw:bg-app-control tw:text-app-text tw:shadow-none',
        'tw:py-control-block tw:px-control-inline',
        'tw:transition-[background-color,border-color,color,opacity] tw:duration-feedback tw:ease-standard',
        'tw:enabled:hover:border-app-border-strong',
        'tw:focus-visible:border-app-focus tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
        'tw:disabled:cursor-default tw:disabled:bg-app-panel tw:disabled:text-app-text-disabled tw:disabled:opacity-55',
        SIZE_CLASSES[size],
        className,
      )}
      data-size={size}
      readOnly={readOnly}
    />
  )
})
