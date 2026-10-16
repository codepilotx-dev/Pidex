import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../utils/Cx.js'

const TITLE_SCROLL_MIN_SECONDS = 4
const TITLE_SCROLL_PIXELS_PER_SECOND = 20

export function OverflowTitle({
  active,
  children,
  presentation = 'compact',
  reducedMotion,
}: {
  active: boolean
  children: React.ReactNode
  presentation?: 'compact' | 'workspace-meta' | 'activity'
  reducedMotion: boolean
}): React.ReactNode {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [overflowDistance, setOverflowDistance] = useState<number | null>(null)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    const updateOverflowDistance = (): void => {
      const distance =
        viewport.clientWidth > 0
          ? Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth))
          : 0
      const nextDistance = distance > 0 ? distance : null
      setOverflowDistance((current) => (current === nextDistance ? current : nextDistance))
    }

    updateOverflowDistance()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateOverflowDistance)
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [children])

  const scrolling = active && overflowDistance !== null && !reducedMotion
  const style =
    overflowDistance === null
      ? undefined
      : ({
          '--sidebar-title-scroll-distance': `${overflowDistance}px`,
          '--sidebar-title-scroll-duration': `${Math.max(
            TITLE_SCROLL_MIN_SECONDS,
            overflowDistance / TITLE_SCROLL_PIXELS_PER_SECOND,
          ).toFixed(2)}s`,
        } as React.CSSProperties)

  return (
    <span
      aria-live="polite"
      className={cx(
        'sidebar-session-title tw:block tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text',
        presentation !== 'compact'
          ? 'tw:flex-none tw:type-body'
          : 'tw:grow tw:shrink tw:basis-auto tw:type-row-title',
      )}
      data-overflowing={overflowDistance !== null || undefined}
      data-scrolling={scrolling || undefined}
      ref={viewportRef}
      style={style}
    >
      <span
        className="sidebar-session-title-track tw:inline-flex tw:min-w-max tw:items-center tw:gap-1 tw:data-[scrolling]:[transform:translateX(calc(-1*var(--sidebar-title-scroll-distance)))] tw:data-[scrolling]:[transition:transform_var(--sidebar-title-scroll-duration)_var(--cpx-sys-ease-linear)_var(--cpx-sys-motion-micro)]"
        data-scrolling={scrolling || undefined}
        ref={trackRef}
      >
        {children}
      </span>
    </span>
  )
}
