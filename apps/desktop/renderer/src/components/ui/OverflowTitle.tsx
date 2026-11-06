import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../utils/Cx.js'

const TITLE_SCROLL_MIN_SECONDS = 4
const TITLE_SCROLL_PIXELS_PER_SECOND = 20
/* Shortcut band = measured shortcut width + one 16px fade, see styles/popover.css. */
const MENU_LABEL_FADE_PX = 16

/*
 * Surfaces that truncate one label into a fixed slot measure their own overflow
 * here and publish the distance and duration as custom properties on the
 * viewport. Each variant owns its class names, its custom properties and its
 * fade/scroll rules, because a gradient mask and a runtime distance cannot be
 * static utilities.
 */
export type OverflowTitleVariant = 'sidebar' | 'composer' | 'menu'
type OverflowTitlePresentation = 'compact' | 'workspace-meta' | 'activity'
type MeasuredPresentation = Exclude<OverflowTitleVariant, 'menu'>

const ROOT_CLASS = 'tw:block tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text'
/* Menu labels inherit the row color, so they must never paint their own foreground. */
const MENU_ROOT_CLASS = 'tw:block tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap'
const TRACK_CLASS = 'tw:inline-flex tw:min-w-max tw:items-center tw:gap-1'
const MENU_TRACK_CLASS = 'menu-item-label-track'
/* The model row constrains the name slot itself, so only the fills and the tight tracking are left. */
const COMPOSER_EXTRA_CLASS = 'tw:grow tw:shrink tw:basis-auto tw:tracking-[-0.01em]'
const SIDEBAR_PRESENTATION_CLASS: Record<OverflowTitlePresentation, string> = {
  compact: 'tw:grow tw:shrink tw:basis-auto tw:type-row-title',
  'workspace-meta': 'tw:flex-none tw:type-body',
  activity: 'tw:flex-none tw:type-body',
}

function scrollSeconds(distance: number): string {
  return `${Math.max(
    TITLE_SCROLL_MIN_SECONDS,
    distance / TITLE_SCROLL_PIXELS_PER_SECOND,
  ).toFixed(2)}s`
}

function overflowStyle(
  variant: MeasuredPresentation,
  overflowDistance: number | null,
): React.CSSProperties | undefined {
  if (overflowDistance === null) return undefined
  const distance = `${overflowDistance}px`
  const duration = scrollSeconds(overflowDistance)
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

/*
 * Menu rows measure three boxes: the label viewport, its text track and the
 * shortcut rendered on the row edge. The shortcut contributes its own width plus
 * one fade to the scroll distance so a revealed hint never covers the end of the
 * label. Scrolling is driven by row hover/highlight selectors, so menu rows do
 * not need React hover state.
 */
type MenuOverflowMetrics = {
  distance: number
  durationSeconds: number
  overflowing: boolean
  reserve: number
}

function menuOverflowStyle(metrics: MenuOverflowMetrics): React.CSSProperties {
  return {
    '--menu-label-scroll-distance': `${metrics.distance}px`,
    '--menu-label-scroll-duration': `${metrics.durationSeconds.toFixed(2)}s`,
    '--menu-label-reserve': `${metrics.reserve}px`,
  } as React.CSSProperties
}

function sameMenuMetrics(
  current: MenuOverflowMetrics | null,
  next: MenuOverflowMetrics | null,
): boolean {
  if (current === null || next === null) return current === next
  return (
    current.distance === next.distance &&
    current.reserve === next.reserve &&
    current.overflowing === next.overflowing
  )
}

export function OverflowTitle({
  active = false,
  children,
  className,
  presentation = 'compact',
  reducedMotion = false,
  variant = 'sidebar',
}: {
  active?: boolean
  children: React.ReactNode
  className?: string
  presentation?: OverflowTitlePresentation
  reducedMotion?: boolean
  variant?: OverflowTitleVariant
}): React.ReactNode {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [overflowDistance, setOverflowDistance] = useState<number | null>(null)
  const [menuMetrics, setMenuMetrics] = useState<MenuOverflowMetrics | null>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return

    if (variant === 'menu') {
      const row = viewport.closest<HTMLElement>('[role^="menuitem"], [role="option"]')
      const shortcut = row?.querySelector<HTMLElement>('[data-menu-shortcut]') ?? null
      const updateMenuMetrics = (): void => {
        const viewportWidth = viewport.clientWidth
        if (viewportWidth <= 0) {
          setMenuMetrics(null)
          return
        }
        const trackWidth = track.scrollWidth
        const reserve = (shortcut?.offsetWidth ?? 0) + MENU_LABEL_FADE_PX
        const distance = Math.ceil(trackWidth - (viewportWidth - reserve))
        const next: MenuOverflowMetrics | null =
          distance > 0
            ? {
                distance,
                overflowing: trackWidth > viewportWidth,
                reserve,
                durationSeconds: Math.max(
                  TITLE_SCROLL_MIN_SECONDS,
                  distance / TITLE_SCROLL_PIXELS_PER_SECOND,
                ),
              }
            : null
        setMenuMetrics((current) => (sameMenuMetrics(current, next) ? current : next))
      }

      if (typeof ResizeObserver === 'undefined') {
        updateMenuMetrics()
        return
      }

      const menuObserver = new ResizeObserver(updateMenuMetrics)
      menuObserver.observe(viewport)
      menuObserver.observe(track)
      if (shortcut) menuObserver.observe(shortcut)
      return () => menuObserver.disconnect()
    }

    const updateOverflowDistance = (): void => {
      const distance =
        viewport.clientWidth > 0
          ? Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth))
          : 0
      const nextDistance = distance > 0 ? distance : null
      setOverflowDistance((current) => (current === nextDistance ? current : nextDistance))
    }

    if (typeof ResizeObserver === 'undefined') {
      updateOverflowDistance()
      return
    }

    const observer = new ResizeObserver(updateOverflowDistance)
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [children, variant])

  const scrolling = active && overflowDistance !== null && !reducedMotion
  const rootClassName =
    variant === 'sidebar'
      ? 'sidebar-session-title'
      : variant === 'composer'
        ? 'composer-model-name'
        : 'menu-item-label'
  const trackClassName = variant === 'menu' ? MENU_TRACK_CLASS : `${rootClassName}-track`
  const scrollable = variant === 'menu' && menuMetrics !== null

  return (
    <span
      /* Session titles regenerate asynchronously, so only they are announced. */
      aria-live={variant === 'sidebar' ? 'polite' : undefined}
      className={cx(
        rootClassName,
        variant === 'menu' ? MENU_ROOT_CLASS : ROOT_CLASS,
        variant === 'sidebar'
          ? SIDEBAR_PRESENTATION_CLASS[presentation]
          : variant === 'composer'
            ? COMPOSER_EXTRA_CLASS
            : undefined,
        className,
      )}
      data-overflowing={
        variant === 'menu'
          ? menuMetrics?.overflowing || undefined
          : overflowDistance !== null || undefined
      }
      data-scrollable={scrollable || undefined}
      data-scrolling={variant === 'menu' ? undefined : scrolling || undefined}
      ref={viewportRef}
      style={
        variant === 'menu'
          ? menuMetrics
            ? menuOverflowStyle(menuMetrics)
            : undefined
          : overflowStyle(variant, overflowDistance)
      }
    >
      <span
        className={cx(trackClassName, TRACK_CLASS)}
        data-scrollable={scrollable || undefined}
        data-scrolling={variant === 'menu' ? undefined : scrolling || undefined}
        ref={trackRef}
      >
        {children}
      </span>
    </span>
  )
}
