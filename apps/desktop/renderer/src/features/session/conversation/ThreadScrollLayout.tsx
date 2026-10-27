import React from 'react'

import { cx } from '../../../utils/Cx.js'

export type ThreadScrollLayoutProps = {
  children: React.ReactNode
  footer: React.ReactNode
  scrollRef: React.RefObject<HTMLDivElement | null>
  footerRef: React.RefObject<HTMLElement | null>
  className?: string
  footerClassName?: string
}

const THREAD_FOOTER_GAP_PX = 16

/**
 * Owns the thread's only scrolling element and its sticky footer.
 *
 * Layout follows the single-scroller contract: the scroll container is bounded
 * by its parent, the content column keeps a `min-height: 100%` growth floor and
 * never shrinks, and the footer stays in normal flow at the bottom with
 * `position: sticky`. The last virtualized row is therefore never covered by the
 * composer, and the footer's measured height is exposed as a scroll padding token
 * for focus navigation and imperative scrolling.
 *
 * Measurement only publishes geometry. Follow/hold decisions belong to
 * `useThreadScrollController`, so a footer resize can never steal the reader's
 * position on its own.
 */
export function ThreadScrollLayout({
  children,
  footer,
  scrollRef,
  footerRef,
  className,
  footerClassName,
}: ThreadScrollLayoutProps): React.ReactNode {
  const measuredInsetRef = React.useRef(THREAD_FOOTER_GAP_PX)
  const writtenInsetRef = React.useRef<string | null>(null)
  const hasFooter = Boolean(footer)

  const writeMeasuredInset = React.useCallback(
    (focusWithin: boolean): void => {
      const value = focusWithin ? '0px' : `${measuredInsetRef.current}px`
      if (writtenInsetRef.current === value) return
      writtenInsetRef.current = value
      scrollRef.current?.style.setProperty('--thread-scroll-padding-bottom', value)
    },
    [scrollRef],
  )

  // The effect depends on `hasFooter` instead of the slot element itself: the
  // footer is inline JSX from the host, so a new node identity on every render
  // would rebuild the observer on each streaming frame.
  React.useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    const footerElement = footerRef.current
    if (!scrollElement) return
    if (!hasFooter || !footerElement) {
      writtenInsetRef.current = '0px'
      scrollElement.style.setProperty('--thread-scroll-footer-height', '0px')
      scrollElement.style.setProperty('--thread-scroll-padding-bottom', '0px')
      return
    }
    writtenInsetRef.current = null

    let measureFrame: number | null = null
    let observedFooterHeight: number | null = null
    let observedViewportHeight: number | null = null
    let appliedFooterHeight = -1
    let appliedViewportHeight = -1

    const measureLayout = (): void => {
      measureFrame = null
      const footerHeight = Math.ceil(
        observedFooterHeight ?? footerElement.getBoundingClientRect().height,
      )
      const viewportHeight = Math.ceil(observedViewportHeight ?? scrollElement.clientHeight)
      observedFooterHeight = null
      observedViewportHeight = null

      if (appliedFooterHeight !== footerHeight) {
        appliedFooterHeight = footerHeight
        measuredInsetRef.current = footerHeight + THREAD_FOOTER_GAP_PX
        writtenInsetRef.current = null
        scrollElement.style.setProperty('--thread-scroll-footer-height', `${footerHeight}px`)
      }
      if (appliedViewportHeight !== viewportHeight) {
        appliedViewportHeight = viewportHeight
        scrollElement.style.setProperty('--thread-scroll-viewport-height', `${viewportHeight}px`)
      }
      writeMeasuredInset(footerElement.contains(document.activeElement))
    }

    const scheduleMeasure = (entries: ResizeObserverEntry[]): void => {
      for (const entry of entries) {
        const blockSize = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (entry.target === footerElement) observedFooterHeight = blockSize
        if (entry.target === scrollElement) observedViewportHeight = blockSize
      }
      if (measureFrame !== null) return
      measureFrame = requestAnimationFrame(measureLayout)
    }

    measureLayout()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(footerElement)
    observer?.observe(scrollElement)

    return () => {
      observer?.disconnect()
      if (measureFrame !== null) cancelAnimationFrame(measureFrame)
    }
  }, [footerRef, hasFooter, scrollRef, writeMeasuredInset])

  const handleFooterFocusCapture = React.useCallback((): void => {
    writeMeasuredInset(true)
  }, [writeMeasuredInset])

  const handleFooterBlurCapture = React.useCallback((): void => {
    requestAnimationFrame(() => {
      const stillFocused = footerRef.current?.contains(document.activeElement)
      writeMeasuredInset(Boolean(stillFocused))
    })
  }, [footerRef, writeMeasuredInset])

  return (
    <div
      ref={scrollRef}
      className={[
        'thread-scroll-layout tw:relative tw:flex tw:min-w-0 tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:[overflow-anchor:none] tw:[scrollbar-gutter:stable] tw:[scroll-padding-block-end:var(--thread-scroll-padding-bottom)] ',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-component="thread-scroll-layout"
    >
      <div className="thread-scroll-layout__inner tw:flex tw:min-w-0 tw:min-h-full tw:shrink-0 tw:flex-col">
        <div className="thread-scroll-layout__content tw:flex tw:min-w-0 tw:shrink-0 tw:flex-col">
          {children}
        </div>
        {hasFooter ? (
          <footer
            ref={footerRef}
            className={cx(
              'thread-scroll-layout__footer tw:sticky tw:bottom-0 tw:isolate tw:z-3 tw:mt-auto tw:flex tw:w-full tw:shrink-0 tw:justify-center tw:pointer-events-none tw:[&>*]:pointer-events-auto',
              footerClassName ?? 'tw:px-4 tw:pb-4',
            )}
            onFocusCapture={handleFooterFocusCapture}
            onBlurCapture={handleFooterBlurCapture}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
