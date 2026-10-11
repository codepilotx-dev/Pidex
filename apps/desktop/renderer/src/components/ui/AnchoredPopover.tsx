import type React from 'react'
import { Popover } from './floating/Popover.js'
import { cx } from '../../utils/Cx.js'
import { useFloatingFocusModality } from '../../utils/FloatingFocus.js'
import { buildPopoverSizingStyle, type PopoverSizingProps } from './PopoverSizing.js'

export type AnchoredPopoverProps = PopoverSizingProps & {
  arrow?: boolean
  align?: 'start' | 'center' | 'end'
  children: React.ReactNode
  className?: string
  collisionPadding?: number
  contentLabel?: string
  contentRole?: 'dialog'
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  onCloseAutoFocus?: React.ComponentProps<typeof Popover.Content>['onCloseAutoFocus']
  open?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  trigger: React.ReactElement
}

export function AnchoredPopover({
  align = 'start',
  arrow = false,
  children,
  className,
  collisionPadding = 6,
  contentLabel,
  contentRole,
  defaultOpen,
  onOpenChange,
  onCloseAutoFocus,
  open,
  side = 'bottom',
  sideOffset = 4,
  trigger,
  size,
}: AnchoredPopoverProps): React.ReactNode {
  const focusModality = useFloatingFocusModality()
  return (
    <Popover.Root
      defaultOpen={defaultOpen}

      open={open}
      onOpenChange={onOpenChange}
    >
      <Popover.Trigger asChild {...focusModality.triggerInteractionProps}>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          size={size ?? 'md'}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event)
            if (!event.defaultPrevented) focusModality.suppressFocusRingOnClose(event)
          }}
          aria-label={contentLabel}
          align={align}
          className={cx('popover-surface', 'popover', 'tw:text-app-text', className)}
          collisionPadding={collisionPadding}
          role={contentRole}
          side={side}
          sideOffset={sideOffset}
          style={buildPopoverSizingStyle({ size })}
        >
          {children}
          {arrow ? <Popover.Arrow /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
