import type React from 'react'
import { forwardRef } from 'react'
import { cx } from '../../../utils/Cx.js'

type ComposerFrameProps = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

/*
 * Transparent placement frame for a composer or approval surface.
 * The child owns every visual surface property; this wrapper only owns width,
 * pointer-event restoration and the transition ref used by the shell.
 *
 * The frame is also the composer's inline-size container, and it normalises the
 * nested surface widths so the composer always fills the frame even when a host
 * page constrains `.composer` itself.
 */
const FRAME_CLASS = cx(
  'composer-frame tw:flex tw:min-w-0 tw:flex-col tw:gap-2.5 tw:bg-transparent tw:p-0 tw:pointer-events-auto tw:shadow-none',
  'tw:[container-type:inline-size] tw:transition-[height] tw:duration-panel tw:ease-standard',
  'tw:[&>.composer-stack]:w-full tw:[&>.composer-stack]:max-w-none',
  'tw:[&>.composer-stack>.composer]:w-full tw:[&>.composer-stack>.composer]:max-w-none',
)

export const ComposerFrame = forwardRef<HTMLDivElement, ComposerFrameProps>(function ComposerFrame(
  { children, className, style },
  ref,
) {
  const hasCustomWidth =
    className?.includes('workflow-page__composer-inner') ||
    className?.includes('tw:w-') ||
    className?.includes('tw:w-[')
  return (
    <div
      ref={ref}
      className={cx(FRAME_CLASS, !hasCustomWidth && 'tw:w-full', className)}
      style={style}
    >
      {children}
    </div>
  )
})

// Temporary source-compatible alias for extension code that imports the old
// name. It remains a transparent frame and no longer renders a card surface.
export const ComposerSurface = ComposerFrame
