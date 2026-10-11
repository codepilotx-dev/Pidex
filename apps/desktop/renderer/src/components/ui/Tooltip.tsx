import type React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'

type TooltipVariant = 'default' | 'unstyled'

type Props = {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  delay?: number
  delayDuration?: number
  className?: string
  variant?: TooltipVariant
  sideOffset?: number
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function TooltipProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  )
}

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  delay,
  delayDuration,
  className = '',
  variant = 'default',
  sideOffset = 6,
  open,
  defaultOpen,
  onOpenChange,
}: Props): React.ReactNode {
  return (
    <RadixTooltip.Root
      open={open}
      defaultOpen={defaultOpen}
      delayDuration={delayDuration ?? delay}
      onOpenChange={onOpenChange}
    >
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          align={align}
          className={
            variant === 'unstyled'
              ? ['tooltip-presence', className].filter(Boolean).join(' ')
              : [
                  'tooltip-presence',
                  'tooltip-content',
                  'tw:z-tooltip',
                  'tw:max-w-[min(20rem,calc(100vw-2rem))]',
                  'tw:rounded-sm',
                  'tw:border',
                  'tw:border-app-border-subtle',
                  'tw:bg-app-raised',
                  'tw:shadow-lg',
                  'tw:px-2',
                  'tw:py-1',
                  'tw:select-none',
                  'tw:type-caption',
                  'tw:text-app-text-soft',
                  className,
                ]
                  .filter(Boolean)
                  .join(' ')
          }
          side={side}
          sideOffset={sideOffset}
        >
          {content}
          {variant === 'default' ? <RadixTooltip.Arrow className="tooltip-arrow" /> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
