import type React from 'react'
import { Popover as Popover } from '../../../components/ui/floating/Popover.js'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { cx } from '../../../utils/Cx.js'
import type { SidebarHoverCardOverlayRenderProps } from './SidebarHoverCard.js'

type VirtualAnchor = {
  getBoundingClientRect: () => DOMRect
}

type Props = SidebarHoverCardOverlayRenderProps & {
  ariaLabel: string
  children: React.ReactNode
  className: string
  focusRef?: React.RefObject<HTMLElement | null>
  focusRequest?: number
  onFocusRequestHandled?: () => void
  positionOutsideSidebar?: boolean
}

export function SidebarHoverCardSurface({
  anchorRef,
  ariaLabel,
  children,
  className,
  closeAfterDelay,
  contentId,
  focusRef,
  focusRequest = 0,
  keepOpen,
  onFocusRequestHandled,
  positionOutsideSidebar = false,
  requestOpenChange,
  returnFocusToAnchor,
}: Props): React.ReactNode {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const sidebarEdgeRef = useMemo<{ current: VirtualAnchor }>(
    () => ({
      current: {
        getBoundingClientRect: () => {
          const anchor = anchorRef.current
          const anchorRect = anchor?.getBoundingClientRect()
          if (!anchorRect || !positionOutsideSidebar) {
            return anchorRect ?? new DOMRect()
          }
          const sidebarRect = anchor
            .closest<HTMLElement>('.desktop-sidebar')
            ?.getBoundingClientRect()
          if (!sidebarRect) return anchorRect
          return new DOMRect(sidebarRect.right, anchorRect.top, 0, anchorRect.height)
        },
      },
    }),
    [anchorRef, positionOutsideSidebar],
  )

  useLayoutEffect(() => {
    if (focusRequest <= 0) return
    const frame = requestAnimationFrame(() => {
      if (!focusRef?.current) return
      focusRef.current.focus()
      if (
        focusRef.current instanceof HTMLInputElement ||
        focusRef.current instanceof HTMLTextAreaElement
      ) {
        focusRef.current.select()
      }
      onFocusRequestHandled?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRef, focusRequest, onFocusRequestHandled])

  return (
    <Popover.Root open onOpenChange={requestOpenChange}>
      <Popover.Anchor
        virtualRef={
          (positionOutsideSidebar ? sidebarEdgeRef : anchorRef) as React.RefObject<{
            getBoundingClientRect: () => DOMRect
          }>
        }
      />
      <Popover.Portal>
        <Popover.Content
          size="md"
          asChild
          align="start"
          aria-label={ariaLabel}
          collisionPadding={6}
          id={contentId}
          ref={contentRef}
          side="right"
          sideOffset={4}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            ) {
              return
            }
            closeAfterDelay()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            requestOpenChange(false)
            returnFocusToAnchor()
          }}
          onFocusCapture={keepOpen}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return
            const focusable = getFocusableChildren(event.currentTarget)
            const first = focusable[0]
            const last = focusable.at(-1)
            if (
              (event.shiftKey && event.target === first) ||
              (!event.shiftKey && event.target === last)
            ) {
              event.preventDefault()
              requestOpenChange(false)
              if (event.shiftKey) {
                returnFocusToAnchor()
              } else {
                const target = nextTabbableAfter(anchorRef.current)
                requestAnimationFrame(() => target?.focus())
              }
            }
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onPointerEnter={keepOpen}
          onPointerLeave={closeAfterDelay}
        >
          <div
            className={cx(
              'sidebar-hover-card-surface tw:z-tooltip tw:p-1 tw:text-left tw:text-app-text tw:pointer-events-auto tw:forced-colors:border tw:forced-colors:border-[CanvasText]',
              className,
            )}
          >
            {children}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableChildren(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter(isTabbable)
}

function nextTabbableAfter(anchor: HTMLElement | null): HTMLElement | null {
  if (!anchor) return null
  const tabbable = [...document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter(isTabbable)
  const index = tabbable.indexOf(anchor)
  return index >= 0 ? (tabbable[index + 1] ?? null) : null
}

function isTabbable(element: HTMLElement): boolean {
  return (
    element.getAttribute('aria-hidden') !== 'true' &&
    element.tabIndex >= 0 &&
    element.getClientRects().length > 0
  )
}
