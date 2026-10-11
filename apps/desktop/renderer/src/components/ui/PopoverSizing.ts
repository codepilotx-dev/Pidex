import type React from 'react'

export type PopoverSize = 'sm' | 'md' | 'lg'
export type PopoverSizingProps = { size?: PopoverSize }

export const POPOVER_PRESET_WIDTHS = { sm: 220, md: 280, lg: 360 } as const

export function formatPopoverSize(size: PopoverSize): string {
  return `${POPOVER_PRESET_WIDTHS[size]}px`
}

export function buildPopoverSizingStyle({
  size = 'md',
}: Partial<PopoverSizingProps> = {}): React.CSSProperties & { '--popover-width': string } {
  return { '--popover-width': formatPopoverSize(size) }
}
