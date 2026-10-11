import { forwardRef } from 'react'
import type React from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../utils/Cx.js'
import { APP_ICON_STROKE_WIDTH, APP_ICON_SIZES } from './IconTokens.js'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  label: string
  active?: boolean
  title: string
}

export const MetaChip = forwardRef<HTMLButtonElement, Props>(function MetaChip(
  { icon, label, active, title, type = 'button', className, ...buttonProps },
  ref,
): React.ReactNode {
  return (
    <button
      {...buttonProps}
      ref={ref}
      aria-expanded={active}
      className={cx(
        'meta-chip tw:inline-flex tw:w-auto tw:min-h-row-composer tw:max-w-55 tw:appearance-none tw:items-center tw:gap-row-gap tw:rounded-full tw:border-0 tw:bg-transparent tw:py-0 tw:px-row-inline tw:text-app-text-meta tw:type-caption tw:shadow-none tw:outline-none',
        'tw:cursor-pointer tw:[&>svg]:block tw:[&>svg]:size-icon-sm tw:[&>svg]:shrink-0',
        'tw:hover:bg-app-hover tw:hover:text-app-text',
        'tw:active:bg-app-selected tw:active:text-app-text tw:aria-expanded:bg-app-selected tw:aria-expanded:text-app-text',
        'tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus',
        'tw:disabled:cursor-default tw:disabled:text-app-text-disabled tw:disabled:opacity-55',
        className,
      )}
      title={title}
      type={type}
    >
      {icon}
      <span className="tw:min-w-0 tw:truncate tw:tabular-nums">{label}</span>
      <ChevronDown size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
    </button>
  )
})
