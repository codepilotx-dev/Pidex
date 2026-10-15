import { forwardRef } from 'react'
import type React from 'react'

export const Toast = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { appearance?: 'action' }
>(function Toast({ className = '', appearance, ...props }, ref): React.ReactNode {
  return (
    <div
      {...props}
      ref={ref}
      className={`tw:inline-flex tw:items-center tw:gap-2 tw:rounded-[var(--cpx-sys-radius-xl)] tw:border tw:border-app-border-subtle tw:bg-app-glass tw:px-3 tw:py-2 tw:type-body tw:text-app-text tw:shadow-lg tw:backdrop-blur-[18px] tw:[-webkit-app-region:no-drag] ${appearance === 'action' ? 'tw:min-h-12' : 'tw:min-h-10'} ${className}`}
    />
  )
})

export function ToastDivider({ className = '' }: { className?: string } = {}): React.ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`tw:mx-0.5 tw:h-4 tw:w-px tw:shrink-0 tw:bg-app-border-subtle ${className}`}
    />
  )
}
