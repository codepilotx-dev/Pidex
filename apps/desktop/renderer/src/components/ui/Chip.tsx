import type { HTMLAttributes, ReactNode } from 'react'
import './Chip.css'

export type ChipVariant = 'accent' | 'success' | 'danger' | 'warning' | 'skill' | 'info'

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  accent: 'tw:bg-app-accent-subtle tw:border-app-accent-border tw:text-app-accent-fg',
  success: 'tw:bg-app-success-subtle tw:border-app-success-border tw:text-app-success-fg',
  danger: 'tw:bg-app-danger-subtle tw:border-app-danger-border tw:text-app-danger-fg',
  warning: 'tw:bg-app-warning-subtle tw:border-app-warning-border tw:text-app-warning-fg',
  skill: 'tw:bg-app-skill-subtle tw:border-app-skill-border tw:text-app-skill-fg',
  info: 'tw:bg-app-info-subtle tw:border-app-info-border tw:text-app-info-fg',
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant
  children?: ReactNode
}

export function Chip({ variant = 'accent', className, children, ...props }: ChipProps) {
  return (
    <span
      className={`chip-semantic ${VARIANT_CLASSES[variant]}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {children}
    </span>
  )
}
