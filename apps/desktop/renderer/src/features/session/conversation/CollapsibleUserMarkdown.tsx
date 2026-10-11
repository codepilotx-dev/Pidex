import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from '../../../utils/Cx.js'

import { MarkdownMessage, type MarkdownMessageProps } from '../../markdown/index.js'
import { ConversationMarkdownErrorBoundary } from './ConversationTurnErrorBoundary.js'
import { useHeightTransition } from '../../../hooks/UseHeightTransition.js'

const DEFAULT_COLLAPSED_LINE_COUNT = 20
const FALLBACK_FONT_SIZE_PX = 13
const FALLBACK_LINE_HEIGHT_RATIO = 1.5
const HEIGHT_EPSILON_PX = 1
const FOCUSABLE_DESCENDANT_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

type CollapseState = 'uncollapsible' | 'collapsed' | 'expanded'

type TextMeasurement = {
  collapsedHeightPx: number
  contentHeightPx: number
}

export type CollapsibleUserMarkdownProps = {
  text: string
  inlinePrefix?: React.ReactNode
  cwd?: string | null
  collapsedLineCount?: number
  canCopyFileReferenceContents?: MarkdownMessageProps['canCopyFileReferenceContents']
  onCopyFileReferenceContents?: MarkdownMessageProps['onCopyFileReferenceContents']
  onOpenFileReference?: MarkdownMessageProps['onOpenFileReference']
}

export function CollapsibleUserMarkdown({
  text,
  inlinePrefix,
  cwd = null,
  collapsedLineCount = DEFAULT_COLLAPSED_LINE_COUNT,
  canCopyFileReferenceContents,
  onCopyFileReferenceContents,
  onOpenFileReference,
}: CollapsibleUserMarkdownProps): React.ReactNode {
  const [measurementElement, setMeasurementElement] = React.useState<HTMLDivElement | null>(null)
  const [measurement, setMeasurement] = React.useState<TextMeasurement | null>(null)
  const [expandedText, setExpandedText] = React.useState<string | null>(null)
  const clippedViewportRef = React.useRef<HTMLDivElement | null>(null)
  const contentId = React.useId()

  React.useLayoutEffect(() => {
    if (!measurementElement) return

    const updateMeasurement = (contentHeightPx: number): void => {
      const next = {
        collapsedHeightPx: measureCollapsedTextHeight(
          measurementElement,
          collapsedLineCount,
          FALLBACK_FONT_SIZE_PX,
        ),
        contentHeightPx: Math.ceil(contentHeightPx),
      }
      setMeasurement((current) =>
        isTextMeasurementCollapsible(current) === isTextMeasurementCollapsible(next)
          ? current
          : next,
      )
    }

    updateMeasurement(measurementElement.scrollHeight)
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      updateMeasurement(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(measurementElement)
    return () => observer.disconnect()
  }, [collapsedLineCount, measurementElement, text])

  const collapseState = resolveCollapseState(measurement, text, expandedText)
  const collapsed = collapseState === 'collapsed'
  const showsEllipsis = collapsed && collapsedLineCount > 2
  const visibleLineCount = collapsedLineCount - (showsEllipsis ? 1 : 0)
  const heightTransition = useHeightTransition([collapsed, text, showsEllipsis, visibleLineCount])

  React.useEffect(() => {
    if (!collapsed) return
    const viewport = clippedViewportRef.current
    if (!viewport) return
    return hideClippedFocusableDescendants(viewport)
  }, [collapsed, collapsedLineCount, text])

  return (
    <div className="user-message-markdown tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:items-end">
      <div
        className="user-message-markdown__body tw:relative tw:transition-[height] tw:duration-disclosure tw:ease-disclosure"
        ref={heightTransition.ref}
        style={heightTransition.style}
      >
        <div
          className={cx(
            'user-message-markdown__viewport',
            collapsed && 'is-collapsed',
            'tw:w-full tw:min-w-0',
            collapsed && 'tw:overflow-hidden',
          )}
          id={contentId}
          ref={clippedViewportRef}
          style={collapsed ? { maxHeight: `${visibleLineCount}lh` } : undefined}
        >
          <div
            className={cx(
              'user-message-markdown__measurement',
              inlinePrefix && 'has-inline-prefix',
              'tw:w-full tw:min-w-0',
            )}
            ref={setMeasurementElement}
          >
            {inlinePrefix}
            <ConversationMarkdownErrorBoundary contentKey={text}>
              <MarkdownMessage
                presentation="conversation"
                canCopyFileReferenceContents={canCopyFileReferenceContents}
                cwd={cwd}
                onCopyFileReferenceContents={onCopyFileReferenceContents}
                onOpenFileReference={onOpenFileReference}
                text={text}
              />
            </ConversationMarkdownErrorBoundary>
          </div>
        </div>
        {showsEllipsis ? (
          <span aria-hidden="true" className="user-message-markdown__ellipsis tw:block">
            …
          </span>
        ) : null}
      </div>
      {collapseState === 'uncollapsible' ? null : (
        <button
          aria-controls={contentId}
          aria-expanded={collapseState === 'expanded'}
          className="user-message-markdown__toggle tw:mt-2 tw:inline-flex tw:cursor-pointer tw:self-start tw:items-center tw:gap-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:type-caption tw:outline-none tw:hover:text-app-text tw:focus-visible:rounded-md tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
          onClick={() => {
            setExpandedText((current) => (current === text ? null : text))
          }}
          type="button"
        >
          <span>{collapseState === 'expanded' ? '收起' : '展开全文'}</span>
          <ChevronDown
            size={APP_ICON_SIZES.sm}
            className={cx(
              'tw:size-icon-sm tw:transition-transform tw:duration-[var(--cpx-sys-motion-micro)] tw:ease-standard',
              collapseState === 'expanded' && 'tw:rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  )
}

function isTextMeasurementCollapsible(measurement: TextMeasurement | null): boolean {
  return Boolean(
    measurement && measurement.contentHeightPx > measurement.collapsedHeightPx + HEIGHT_EPSILON_PX,
  )
}

export function resolveCollapseState(
  measurement: TextMeasurement | null,
  text: string,
  expandedText: string | null,
): CollapseState {
  if (!isTextMeasurementCollapsible(measurement)) {
    return 'uncollapsible'
  }
  return expandedText === text ? 'expanded' : 'collapsed'
}

function measureCollapsedTextHeight(
  element: HTMLElement,
  collapsedLineCount: number,
  fallbackFontSizePx: number,
): number {
  const computedStyle = window.getComputedStyle(element)
  const parsedFontSize = Number.parseFloat(computedStyle.fontSize)
  const fontSizePx = Number.isFinite(parsedFontSize) ? parsedFontSize : fallbackFontSizePx
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight)
  const lineHeightPx = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : fontSizePx * FALLBACK_LINE_HEIGHT_RATIO
  return Math.ceil(lineHeightPx * collapsedLineCount)
}

/*
 * The remaining helpers intentionally stay below the component so the resize
 * observer above only performs the minimum threshold calculation per frame.
 */

function hideClippedFocusableDescendants(viewport: HTMLElement): () => void {
  const trackedElements = new Map<HTMLElement, string | null>()
  const intersectionObserver =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const element = entry.target as HTMLElement
              if (!trackedElements.has(element)) continue
              setFocusableElementVisibility(
                element,
                entry.isIntersecting && entry.intersectionRatio >= 1,
                trackedElements.get(element) ?? null,
              )
            }
          },
          { root: viewport, rootMargin: '0px', threshold: 1 },
        )

  const scan = (): void => {
    for (const element of trackedElements.keys()) {
      if (viewport.contains(element)) continue
      intersectionObserver?.unobserve(element)
      trackedElements.delete(element)
    }

    for (const element of viewport.querySelectorAll<HTMLElement>(FOCUSABLE_DESCENDANT_SELECTOR)) {
      if (trackedElements.has(element) || element.hasAttribute('inert')) {
        continue
      }
      const previousAriaHidden = element.getAttribute('aria-hidden')
      trackedElements.set(element, previousAriaHidden)
      setFocusableElementVisibility(
        element,
        intersectionObserver === null && isElementFullyVisible(element, viewport),
        previousAriaHidden,
      )
      intersectionObserver?.observe(element)
    }
  }

  scan()
  const mutationObserver = new MutationObserver(scan)
  mutationObserver.observe(viewport, { childList: true, subtree: true })

  return () => {
    intersectionObserver?.disconnect()
    mutationObserver.disconnect()
    for (const [element, previousAriaHidden] of trackedElements) {
      setFocusableElementVisibility(element, true, previousAriaHidden)
    }
  }
}

export function setFocusableElementVisibility(
  element: Pick<HTMLElement, 'toggleAttribute' | 'setAttribute' | 'removeAttribute'>,
  visible: boolean,
  previousAriaHidden: string | null,
): void {
  element.toggleAttribute('inert', !visible)
  if (!visible) {
    element.setAttribute('aria-hidden', 'true')
    return
  }
  if (previousAriaHidden === null) {
    element.removeAttribute('aria-hidden')
  } else {
    element.setAttribute('aria-hidden', previousAriaHidden)
  }
}

function isElementFullyVisible(element: Element, viewport: Element): boolean {
  const elementRect = element.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  return (
    elementRect.top >= viewportRect.top &&
    elementRect.right <= viewportRect.right &&
    elementRect.bottom <= viewportRect.bottom &&
    elementRect.left >= viewportRect.left
  )
}
