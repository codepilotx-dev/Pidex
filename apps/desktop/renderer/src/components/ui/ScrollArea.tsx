import React from 'react'
import { cx } from '../../utils/Cx.js'
import { useScrollEdgeState } from '../../hooks/UseScrollEdgeState.js'
import { mergeRefs } from './floating/Primitives.js'

type ScrollAreaProps = {
  children: React.ReactNode
  className?: string
  contentClassName?: string
  style?: React.CSSProperties
  direction?: 'y' | 'x'
  viewportRef?: React.Ref<HTMLDivElement>
  fade?: boolean
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'dir' | 'color'>

export function ScrollArea({
  children,
  className,
  contentClassName,
  direction = 'y',
  style,
  viewportRef,
  fade = direction === 'y',
  ...rest
}: ScrollAreaProps): React.ReactNode {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdgeState(rootRef, { contentRef })
  const ref = React.useMemo(() => mergeRefs(rootRef, viewportRef), [viewportRef])
  const rootClassName = cx(
    'scroll-area tw:relative tw:overflow-hidden',
    direction === 'x' ? 'tw:overflow-x-auto' : 'tw:overflow-y-auto',
    className,
  )
  const contentClass = cx('scroll-area__content tw:w-full tw:min-w-0', contentClassName)

  return (
    <div
      className={rootClassName}
      data-scroll-direction={direction}
      data-scroll-fade={fade && direction === 'y' ? true : undefined}
      data-scroll-at-start={edges.atStart}
      data-scroll-at-end={edges.atEnd}
      ref={ref}
      style={style}
      {...rest}
    >
      <div className={contentClass} ref={contentRef}>
        {children}
      </div>
    </div>
  )
}
