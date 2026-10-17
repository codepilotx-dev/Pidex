import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../../utils/Cx.js'

const TITLE_SCROLL_MIN_SECONDS = 4
const TITLE_SCROLL_PIXELS_PER_SECOND = 20

/*
 * Surfaces that truncate one label into a fixed slot measure their own overflow
 * here and publish the distance and duration as custom properties on the
 * viewport. Each variant owns its class names, its custom properties and its
 * fade/scroll rules, because a gradient mask and a runtime distance cannot be
 * static utilities.
 */
export type OverflowTitleVariant = 'sidebar' | 'composer'
type OverflowTitlePresentation = 'compact' | 'workspace-meta' | 'activity'

const ROOT_CLASS = 'tw:block tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text'
const TRACK_CLASS = 'tw:inline-flex tw:min-w-max tw:items-center tw:gap-1'
/* The model row constrains the name slot itself, so only the fills and the tight tracking are left. */
const COMPOSER_EXTRA_CLASS = 'tw:grow tw:shrink tw:basis-auto tw:tracking-[-0.01em]'
const SIDEBAR_PRESENTATION_CLASS: Record<OverflowTitlePresentation, string> = {
  compact: 'tw:grow tw:shrink tw:basis-auto tw:type-row-title',
  'workspace-meta': 'tw:flex-none tw:type-body',
  activity: 'tw:flex-none tw:type-body',
}

function overflowStyle(
  variant: OverflowTitleVariant,
  overflowDistance: number | null,
): React.CSSProperties | undefined {
  if (overflowDistance === null) return undefined
  const distance = `${overflowDistance}px`
  const duration = `${Math.max(
    TITLE_SCROLL_MIN_SECONDS,
    overflowDistance / TITLE_SCROLL_PIXELS_PER_SECOND,
  ).toFixed(2)}s`
  if (variant === 'sidebar') {
    return {
      '--sidebar-title-scroll-distance': distance,
      '--sidebar-title-scroll-duration': duration,
    } as React.CSSProperties
  }
  return {
    '--composer-model-name-scroll-distance': distance,
    '--composer-model-name-scroll-duration': duration,
  } as React.CSSProperties
}

export function OverflowTitle({
  active,
  children,
  presentation = 'compact',
  reducedMotion,
  variant = 'sidebar',
}: {
  active: boolean
  children: React.ReactNode
  presentation?: OverflowTitlePresentation
  reducedMotion: boolean
  variant?: OverflowTitleVariant
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
  const rootClassName = variant === 'sidebar' ? 'sidebar-session-title' : 'composer-model-name'

  return (
    <span
      /* Session titles regenerate asynchronously, so only they are announced. */
      aria-live={variant === 'sidebar' ? 'polite' : undefined}
      className={cx(
        rootClassName,
        ROOT_CLASS,
        variant === 'sidebar' ? SIDEBAR_PRESENTATION_CLASS[presentation] : COMPOSER_EXTRA_CLASS,
      )}
      data-overflowing={overflowDistance !== null || undefined}
      data-scrolling={scrolling || undefined}
      ref={viewportRef}
      style={overflowStyle(variant, overflowDistance)}
    >
      <span
        className={cx(`${rootClassName}-track`, TRACK_CLASS)}
        data-scrolling={scrolling || undefined}
        ref={trackRef}
      >
        {children}
      </span>
    </span>
  )
}
