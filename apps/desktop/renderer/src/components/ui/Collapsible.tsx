import React from 'react'
import * as Primitive from '@radix-ui/react-collapsible'
import { cx } from '../../utils/Cx.js'
import { usePrefersReducedMotion } from '../../hooks/UsePrefersReducedMotion.js'

export const Collapsible = Primitive.Root
export const CollapsibleTrigger = Primitive.Trigger

export function CollapsibleContent({
  className,
  contentClassName,
  children,
  expanded,
  ...props
}: React.ComponentProps<typeof Primitive.Content> & {
  expanded: boolean
  contentClassName?: string
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <Primitive.Content
      {...props}
      aria-hidden={!expanded}
      inert={!expanded ? true : undefined}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className={cx('ui-collapsible-content tw:min-w-0 tw:overflow-hidden', className)}
    >
      {/* Keep content spacing inside Radix's measured animation layer. */}
      <div className={cx('tw:min-w-0', contentClassName)}>{children}</div>
    </Primitive.Content>
  )
}
