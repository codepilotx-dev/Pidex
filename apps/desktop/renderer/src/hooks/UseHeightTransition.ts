import React from 'react'

import { getEffectiveReducedMotion } from './UsePrefersReducedMotion.js'

export function useHeightTransition(dependencies: React.DependencyList): {
  ref: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
} {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const previousHeight = React.useRef<number | null>(null)
  const [height, setHeight] = React.useState<number | null>(null)
  const [transitioning, setTransitioning] = React.useState(false)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const startHeight =
      height === null
        ? (previousHeight.current ?? el.getBoundingClientRect().height)
        : el.getBoundingClientRect().height
    const targetHeight = outerContentHeight(el)
    previousHeight.current = targetHeight

    if (Math.abs(startHeight - targetHeight) < 1 || getEffectiveReducedMotion()) {
      setHeight(null)
      setTransitioning(false)
      return
    }

    let frame = 0
    let timer = 0
    let finished = false

    const finishTransition = (event?: TransitionEvent) => {
      if (finished || (event && (event.target !== el || event.propertyName !== 'height'))) {
        return
      }

      finished = true
      window.clearTimeout(timer)
      el.removeEventListener('transitionend', finishTransition)
      el.removeEventListener('transitioncancel', finishTransition)
      setHeight(null)
      setTransitioning(false)
    }

    setHeight(startHeight)
    setTransitioning(true)

    frame = window.requestAnimationFrame(() => {
      el.addEventListener('transitionend', finishTransition)
      el.addEventListener('transitioncancel', finishTransition)
      setHeight(targetHeight)
      timer = window.setTimeout(finishTransition, maximumTransitionTime(el) + 50)
    })

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      el.removeEventListener('transitionend', finishTransition)
      el.removeEventListener('transitioncancel', finishTransition)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies)

  return {
    ref,
    style: {
      height: height === null ? undefined : `${height}px`,
      overflow: transitioning ? 'hidden' : undefined,
    },
  }
}

function maximumTransitionTime(element: HTMLElement): number {
  const style = window.getComputedStyle(element)
  const durations = style.transitionDuration.split(',').map(parseCssTime)
  const delays = style.transitionDelay.split(',').map(parseCssTime)
  const count = Math.max(durations.length, delays.length)
  let maximum = 0

  for (let index = 0; index < count; index += 1) {
    const duration = durations[index % durations.length] ?? 0
    const delay = delays[index % delays.length] ?? 0
    maximum = Math.max(maximum, duration + delay)
  }

  return maximum
}

function parseCssTime(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return 0
  return value.trim().endsWith('ms') ? parsed : parsed * 1_000
}

function outerContentHeight(el: HTMLElement): number {
  const style = window.getComputedStyle(el)
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0
  const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0
  if (style.boxSizing === 'border-box') {
    return el.scrollHeight + borderTop + borderBottom
  }
  return el.scrollHeight
}
