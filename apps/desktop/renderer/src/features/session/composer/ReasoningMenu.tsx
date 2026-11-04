import React, { useState } from 'react'
import { Dropdown } from '../../../components/ui/floating/Dropdown.js'
import type { ThinkingOption } from './ThinkingLevelPopover.js'

export type ReasoningMenuProps = {
  trigger: React.ReactElement
  thinkingMode: string
  thinkingOptions: ThinkingOption[]
  onThinkingChange: (mode: string) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ReasoningMenu({
  trigger,
  thinkingMode,
  thinkingOptions,
  onThinkingChange,
  align = 'end',
  side = 'top',
  sideOffset = 6,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ReasoningMenuProps): React.ReactNode {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen

  const handleOpenChange = (nextOpen: boolean): void => {
    if (isControlled) {
      controlledOnOpenChange?.(nextOpen)
    } else {
      setInternalOpen(nextOpen)
    }
  }

  return (
    <Dropdown.Root value={thinkingMode} open={open} onOpenChange={handleOpenChange}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          size="sm"
          align={align}
          side={side}
          sideOffset={sideOffset}
          title="推理思考"
          className="composer-reasoning-menu-content"
          onClick={(event) => event.stopPropagation()}
        >
          {thinkingOptions.map((option) => (
            <Dropdown.Item
              key={option.value}
              value={option.value}
              onSelect={() => onThinkingChange(option.value)}
            >
              {option.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
