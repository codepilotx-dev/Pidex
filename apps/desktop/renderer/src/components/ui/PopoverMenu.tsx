import type React from 'react'
import { Dropdown } from './Dropdown.js'
import type { PopoverSizingProps } from './PopoverSizing.js'

type Props = {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
  open: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  collisionPadding?: number
  avoidCollisions?: boolean
  trigger: React.ReactElement
  textMode?: 'nowrap' | 'wrap'
  onOpenChange: (open: boolean) => void
} & PopoverSizingProps

export function PopoverMenu({
  children,
  align = 'start',
  className = '',
  open,
  side,
  sideOffset = 4,
  collisionPadding,
  avoidCollisions,
  trigger,
  textMode = 'nowrap',
  size,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <Dropdown
      align={align}
      className={className}
      open={open}
      side={side ?? 'bottom'}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      avoidCollisions={avoidCollisions}

      textMode={textMode}
      trigger={trigger}
      size={size}

      onOpenChange={onOpenChange}
    >
      {children}
    </Dropdown>
  )
}
