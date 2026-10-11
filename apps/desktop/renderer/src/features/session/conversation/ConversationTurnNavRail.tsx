import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { Virtualizer, type VirtualizerHandle } from 'virtua'
import { Bookmark } from 'lucide-react'
import { useScrollEdgeState } from '../../../hooks/UseScrollEdgeState.js'
import { Popover } from '../../../components/ui/floating/Popover.js'
import { Button } from '../../../components/ui/Button.js'
import { FileTypeIcon } from '../../layout/FileTypeIcon.js'
import { MarkdownMessage } from '../../markdown/index.js'
import { parseMarkdown } from '../../markdown/Parser.js'
import type { MarkdownToken } from '../../markdown/Types.js'
import type { ConversationTurnNavItem } from './TurnNavigationModel.js'
import type { ConversationTurnVisibilityStore } from './UseConversationTurnRowVisibility.js'

export type TurnNavigationReason = 'activate' | 'scrub' | 'shortcut'

type Props = {
  items: ConversationTurnNavItem[]
  onNavigate: (item: ConversationTurnNavItem, reason: TurnNavigationReason) => void
  visibilityStore: ConversationTurnVisibilityStore
  onInlineClearanceChange?: (available: boolean) => void
  /** null 表示未协商到书签 capability 或尚未读取完成，此时隐藏书签 UI。 */
  bookmarkedInputIds?: ReadonlySet<string> | null
  onToggleBookmark?: (inputId: string, bookmarked: boolean) => Promise<void>
}

export const MIN_TURN_NAV_ITEMS = 4
export const MIN_TURN_NAV_INLINE_CLEARANCE_PX = 48
export const TURN_NAV_HOVER_DELAY_MS = 150
export const TURN_NAV_HANDOFF_WINDOW_MS = 300
export const TURN_NAV_PREVIEW_CLOSE_DELAY_MS = 150

const TURN_NAV_BUTTON_SELECTOR = '[data-turn-navigation-item-id]'

type ScrubSession = {
  captureTarget: HTMLButtonElement
  itemId: string
  moved: boolean
  pointerId: number
}

function fileName(path: string): string {
  const parts = path.replace(/\\/gu, '/').split('/')
  return parts.at(-1) || path
}

function collectMarkdownText(
  token: MarkdownToken | Record<string, unknown>,
  output: string[],
): void {
  const candidate = token as Record<string, unknown>
  if (candidate.type === 'space') return

  if (Array.isArray(candidate.tokens)) {
    for (const child of candidate.tokens) {
      collectMarkdownText(child as Record<string, unknown>, output)
    }
    return
  }

  if (Array.isArray(candidate.items)) {
    for (const item of candidate.items) {
      collectMarkdownText(item as Record<string, unknown>, output)
    }
    return
  }

  if (candidate.type === 'table') {
    const cells = [
      ...(Array.isArray(candidate.header) ? candidate.header : []),
      ...(Array.isArray(candidate.rows) ? candidate.rows.flat() : []),
    ]
    for (const cell of cells) {
      collectMarkdownText(cell as Record<string, unknown>, output)
    }
    return
  }

  if (typeof candidate.text === 'string' && candidate.type !== 'html' && candidate.text.trim()) {
    output.push(candidate.text)
  }
}

export function markdownToTurnPreview(text: string): string {
  const source = text.trim()
  if (!source) return ''
  const output: string[] = []
  for (const token of parseMarkdown(source).tokens) {
    collectMarkdownText(token, output)
  }
  return output.join(' ').replace(/\s+/gu, ' ').trim()
}

export function shouldShowTurnNavigation(itemCount: number, inlineClearance: number): boolean {
  return itemCount >= MIN_TURN_NAV_ITEMS && inlineClearance >= MIN_TURN_NAV_INLINE_CLEARANCE_PX
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      [
        'input',
        'textarea',
        'select',
        "[contenteditable]:not([contenteditable='false'])",
        "[role='textbox']",
        '[data-codex-composer]',
        '.chat-composer',
        '.desktop-sidebar',
      ].join(','),
    ),
  )
}

type PreviewCardProps = {
  item: ConversationTurnNavItem
  bookmarked: boolean
  bookmarksAvailable: boolean
  onToggleBookmark?: (inputId: string, bookmarked: boolean) => Promise<void>
  /** 书签按钮上 Shift+Tab 时把焦点还给触发刻度。 */
  onBookmarkFocusBack?: () => void
}

function PreviewCard({
  item,
  bookmarked,
  bookmarksAvailable,
  onToggleBookmark,
  onBookmarkFocusBack,
}: PreviewCardProps): React.ReactNode {
  const assistantPreview = React.useMemo(
    () => markdownToTurnPreview(item.assistantText ?? ''),
    [item.assistantText],
  )
  const displayedOutputs = item.outputs.slice(0, 2)
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'error'>('idle')

  const handleToggleBookmark = React.useCallback((): void => {
    if (!onToggleBookmark || saveState === 'saving') return
    setSaveState('saving')
    void onToggleBookmark(item.id, !bookmarked).then(
      () => setSaveState('idle'),
      () => setSaveState('error'),
    )
  }, [bookmarked, item.id, onToggleBookmark, saveState])

  return (
    <div
      className="conversation-turn-preview-card tw:box-border tw:w-80 tw:max-w-[calc(100vw-16px)] tw:rounded-xl tw:border-[0.5px] tw:border-app-border tw:bg-app-raised tw:p-2 tw:text-app-text tw:type-caption tw:shadow-lg"
      data-thread-user-message-navigation-tooltip-preview
    >
      <span className="tw:sr-only">
        {`用户消息：${item.userText || '无内容'}${
          assistantPreview ? `。助手回复：${assistantPreview}` : ''
        }`}
      </span>
      <div className="tw:flex tw:items-start tw:gap-1">
        <div aria-hidden="true" inert className="tw:min-w-0 tw:flex-1">
          <div className="preview-card-user-text tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:type-label">
            {item.userText || '（无内容）'}
          </div>
        </div>
        {bookmarksAvailable && onToggleBookmark ? (
          <Button
            aria-label={bookmarked ? '取消书签' : '添加书签'}
            aria-pressed={bookmarked}
            className="tw:-mr-1 tw:-mt-0.5 tw:flex-none"
            color="ghost"
            data-bookmark-toggle=""
            disabled={saveState === 'saving'}
            isIconOnly
            onClick={handleToggleBookmark}
            onKeyDown={(event) => {
              if (event.shiftKey && event.key === 'Tab') {
                event.preventDefault()
                onBookmarkFocusBack?.()
              }
            }}
            size="iconSm"
            title={bookmarked ? '取消书签' : '添加书签'}
            variant="ghost"
          >
            <Bookmark
              aria-hidden="true"
              className="tw:size-3.5 tw:flex-none"
              fill={bookmarked ? 'currentColor' : 'none'}
              strokeWidth={2}
            />
          </Button>
        ) : null}
      </div>
      <div aria-hidden="true" inert>
        {assistantPreview ? (
          <div className="preview-card-assistant-text tw:mt-1 tw:text-app-text-meta tw:type-caption tw:line-clamp-3">
            <MarkdownMessage
              allowWideBlocks={false}
              externalResourcePolicy={{
                allowExternalLinks: false,
                allowRemoteMedia: false,
              }}
              text={item.assistantText ?? ''}
            />
          </div>
        ) : (
          <div className="tw:mt-1 tw:text-app-text-meta tw:type-caption">
            {item.isRunning ? '正在回复' : '暂无回复'}
          </div>
        )}
        {displayedOutputs.length > 0 ? (
          <div className="preview-card-outputs tw:mt-2 tw:flex tw:min-w-0 tw:items-center tw:gap-3 tw:overflow-hidden tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
            {displayedOutputs.map((output) => (
              <span
                className="preview-card-output tw:inline-flex tw:min-w-0 tw:max-w-42 tw:flex-[0_1_auto] tw:items-center tw:gap-2"
                key={`${output.type}:${output.path}`}
              >
                <FileTypeIcon
                  aria-hidden="true"
                  className="preview-card-output-icon tw:size-icon tw:flex-none tw:opacity-70"
                  path={output.path}
                  size={APP_ICON_SIZE}
                />
                <span className="preview-card-output-label tw:max-w-36 tw:overflow-hidden tw:text-ellipsis">
                  {output.label || fileName(output.path)}
                </span>
              </span>
            ))}
            {item.outputs.length > displayedOutputs.length ? (
              <span className="preview-card-output-more tw:flex-none">
                +{item.outputs.length - displayedOutputs.length}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {saveState === 'error' ? (
        <div className="tw:mt-1 tw:text-app-text-meta tw:type-caption" role="alert">
          保存失败，请重试
        </div>
      ) : null}
    </div>
  )
}

export function ConversationTurnNavRail({
  items,
  onNavigate,
  visibilityStore,
  onInlineClearanceChange,
  bookmarkedInputIds = null,
  onToggleBookmark,
}: Props): React.ReactNode {
  const visibleItemIds = visibilityStore.getSnapshot()
  const anchorRef = React.useRef<HTMLElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const virtualizerRef = React.useRef<VirtualizerHandle | null>(null)
  const [interactionItemId, setInteractionItemId] = React.useState<string | null>(null)
  const [focusedItemId, setFocusedItemId] = React.useState<string | null>(null)
  const [capturedItemId, setCapturedItemId] = React.useState<string | null>(null)
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const currentItemIdRef = React.useRef<string | null>(null)
  const itemsRef = React.useRef(items)
  itemsRef.current = items
  const hoverTimerRef = React.useRef<number | null>(null)
  const hoveredItemIdRef = React.useRef<string | null>(null)
  const focusedItemIdRef = React.useRef<string | null>(null)
  const pointerInsideRailRef = React.useRef(false)
  const scrubSessionRef = React.useRef<ScrubSession | null>(null)
  const suppressClickRef = React.useRef(false)
  const lastPreviewCloseAtRef = React.useRef(Number.NEGATIVE_INFINITY)
  const previewAnchorRef = React.useRef<HTMLElement | null>(null)
  const previewCloseTimerRef = React.useRef<number | null>(null)
  const previewCardRef = React.useRef<HTMLDivElement | null>(null)
  const [hasInlineClearance, setHasInlineClearance] = React.useState(false)
  const [previewItemId, setPreviewItemId] = React.useState<string | null>(null)
  const [scrubItemId, setScrubItemId] = React.useState<string | null>(null)
  const edges = useScrollEdgeState(listRef, { version: `${hasInlineClearance}:${items.length}` })
  const indexes = React.useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items],
  )
  const visualIndex = indexes.get(scrubItemId ?? focusedItemId ?? interactionItemId ?? '')
  const previewItem = previewItemId
    ? (items.find((item) => item.id === previewItemId) ?? null)
    : null
  const keepMounted = [focusedItemId, capturedItemId].flatMap((id) =>
    id && indexes.has(id) ? [indexes.get(id)!] : [],
  )
  const clearHoverTimer = React.useCallback((): void => {
    if (hoverTimerRef.current === null) return
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  const closePreview = React.useCallback((): void => {
    clearHoverTimer()
    setPreviewItemId((current) => {
      if (current !== null) lastPreviewCloseAtRef.current = performance.now()
      return null
    })
  }, [clearHoverTimer])

  const cancelPreviewClose = React.useCallback((): void => {
    if (previewCloseTimerRef.current === null) return
    window.clearTimeout(previewCloseTimerRef.current)
    previewCloseTimerRef.current = null
  }, [])

  /** 离开刻度或卡片后延迟关闭，让鼠标能从刻度移入预览卡而不断开。 */
  const schedulePreviewClose = React.useCallback((): void => {
    cancelPreviewClose()
    previewCloseTimerRef.current = window.setTimeout(() => {
      previewCloseTimerRef.current = null
      closePreview()
    }, TURN_NAV_PREVIEW_CLOSE_DELAY_MS)
  }, [cancelPreviewClose, closePreview])

  const openPreview = React.useCallback(
    (itemId: string, immediate: boolean): void => {
      clearHoverTimer()
      cancelPreviewClose()
      previewAnchorRef.current = buttonRefs.current.get(itemId) ?? null
      const isHandoff =
        performance.now() - lastPreviewCloseAtRef.current <= TURN_NAV_HANDOFF_WINDOW_MS
      if (immediate || isHandoff) {
        setPreviewItemId(itemId)
        return
      }
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null
        if (hoveredItemIdRef.current === itemId) {
          setPreviewItemId(itemId)
        }
      }, TURN_NAV_HOVER_DELAY_MS)
    },
    [cancelPreviewClose, clearHoverTimer],
  )

  React.useEffect(
    () => () => {
      clearHoverTimer()
      cancelPreviewClose()
    },
    [cancelPreviewClose, clearHoverTimer],
  )

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const frame = anchor?.parentElement
    if (!frame) return
    const resolveContent = (): HTMLElement | null =>
      frame.querySelector<HTMLElement>('.canonical-turn') ??
      frame.querySelector<HTMLElement>('.canonical-turn-error') ??
      frame.querySelector<HTMLElement>('.workflow-page__composer-inner') ??
      frame.querySelector<HTMLElement>('.session-timeline-container')
    const observedContent = resolveContent()
    if (!observedContent) return

    let frameId: number | null = null
    const updateVisibility = (): void => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const content = resolveContent()
        if (!content) return
        const frameRect = frame.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        const scale = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1
        const inlineClearance = (contentRect.left - frameRect.left) / (scale > 0 ? scale : 1)
        setHasInlineClearance(inlineClearance >= MIN_TURN_NAV_INLINE_CLEARANCE_PX)
      })
    }

    updateVisibility()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateVisibility)
    observer?.observe(frame)
    observer?.observe(observedContent)
    const styleHost = frame.closest<HTMLElement>('.workflow-page__main')
    const styleObserver =
      typeof MutationObserver === 'undefined' || !styleHost
        ? null
        : new MutationObserver(updateVisibility)
    if (styleObserver && styleHost) {
      styleObserver.observe(styleHost, {
        attributeFilter: ['style'],
        attributes: true,
      })
    }
    observedContent.addEventListener('transitionend', updateVisibility)
    window.addEventListener('resize', updateVisibility)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      observer?.disconnect()
      styleObserver?.disconnect()
      observedContent.removeEventListener('transitionend', updateVisibility)
      window.removeEventListener('resize', updateVisibility)
    }
  }, [items.length])

  React.useEffect(() => {
    onInlineClearanceChange?.(hasInlineClearance)
  }, [hasInlineClearance, onInlineClearanceChange])

  React.useLayoutEffect(() => {
    const updateVisibleMarkers = (): void => {
      const nextVisibleIds = visibilityStore.getSnapshot()
      for (const [itemId, button] of buttonRefs.current) {
        if (nextVisibleIds.has(itemId)) {
          button.setAttribute('aria-current', 'true')
        } else {
          button.removeAttribute('aria-current')
        }
      }
      const currentItemId =
        itemsRef.current.find((item) => nextVisibleIds.has(item.id))?.id ??
        itemsRef.current.at(-1)?.id ??
        null
      currentItemIdRef.current = currentItemId
      const list = listRef.current
      const index = currentItemId ? indexes.get(currentItemId) : undefined
      if (
        !list ||
        index === undefined ||
        pointerInsideRailRef.current ||
        focusedItemIdRef.current ||
        scrubSessionRef.current
      )
        return
      const top = index * 10
      if (top < list.scrollTop) {
        virtualizerRef.current?.scrollToIndex(index, { align: 'start' })
      } else if (top + 10 > list.scrollTop + list.clientHeight) {
        virtualizerRef.current?.scrollToIndex(index, { align: 'end' })
      }
    }
    updateVisibleMarkers()
    return visibilityStore.subscribe(updateVisibleMarkers)
  }, [indexes, hasInlineClearance, visibilityStore])

  React.useEffect(() => {
    if (!hasInlineClearance || items.length < MIN_TURN_NAV_ITEMS) return
    const handleShortcut = (event: KeyboardEvent): void => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
        isEditableShortcutTarget(event.target)
      ) {
        return
      }
      const currentIndex = Math.max(
        0,
        items.findIndex((item) => item.id === currentItemIdRef.current),
      )
      const nextIndex =
        event.key === 'ArrowUp'
          ? Math.max(0, currentIndex - 1)
          : Math.min(items.length - 1, currentIndex + 1)
      if (nextIndex === currentIndex) return
      event.preventDefault()
      onNavigate(items[nextIndex]!, 'shortcut')
    }
    document.addEventListener('keydown', handleShortcut, true)
    return () => document.removeEventListener('keydown', handleShortcut, true)
  }, [hasInlineClearance, items, onNavigate])

  const itemFromElement = React.useCallback(
    (element: Element | null): ConversationTurnNavItem | null => {
      const button = element?.closest<HTMLButtonElement>(TURN_NAV_BUTTON_SELECTOR)
      if (!button || !listRef.current?.contains(button)) return null
      return items.find((item) => item.id === button.dataset.turnNavigationItemId) ?? null
    },
    [items],
  )

  const endScrub = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const session = scrubSessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      scrubSessionRef.current = null
      setCapturedItemId(null)
      setScrubItemId(null)
      if (session.captureTarget.hasPointerCapture?.(event.pointerId)) {
        session.captureTarget.releasePointerCapture?.(event.pointerId)
      }
      if (session.moved) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      if (!pointerInsideRailRef.current && focusedItemIdRef.current === null) {
        closePreview()
      }
    },
    [closePreview],
  )

  if (!hasInlineClearance || items.length < MIN_TURN_NAV_ITEMS) {
    return <span ref={anchorRef} aria-hidden="true" hidden />
  }

  return (
    <nav
      ref={anchorRef}
      aria-label="用户消息导航"
      className="conversation-turn-nav-rail tw:absolute tw:top-1/2 tw:left-[var(--conversation-rail-inline-start,var(--cpx-sys-space-2))] tw:z-5 tw:w-9 tw:max-h-[min(70vh,640px)] tw:-translate-y-1/2"
      data-visible="true"
    >
      <div
        ref={listRef}
        className="conversation-turn-nav-list tw:w-9 tw:max-h-[min(70vh,640px)] tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:[scrollbar-width:none]"
        data-fade-start={!edges.atStart || undefined}
        data-fade-end={!edges.atEnd || undefined}
        data-scrubbing={scrubItemId !== null ? '' : undefined}
        onLostPointerCapture={endScrub}
        onPointerCancelCapture={endScrub}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return
          const item = itemFromElement(event.target instanceof Element ? event.target : null)
          const button = item ? buttonRefs.current.get(item.id) : null
          if (!item || !button) return
          pointerInsideRailRef.current = true
          scrubSessionRef.current = {
            captureTarget: button,
            itemId: item.id,
            moved: false,
            pointerId: event.pointerId,
          }
          setScrubItemId(item.id)
          setCapturedItemId(item.id)
          openPreview(item.id, true)
          button.setPointerCapture?.(event.pointerId)
        }}
        onPointerEnter={() => {
          pointerInsideRailRef.current = true
        }}
        onPointerLeave={() => {
          pointerInsideRailRef.current = false
          setInteractionItemId(null)
          if (scrubSessionRef.current === null && focusedItemIdRef.current === null) {
            hoveredItemIdRef.current = null
            schedulePreviewClose()
          }
        }}
        onPointerMove={(event) => {
          const session = scrubSessionRef.current
          if (!session || session.pointerId !== event.pointerId) return
          if (event.buttons % 2 === 0) {
            endScrub(event)
            return
          }
          const list = event.currentTarget
          const rect = list.getBoundingClientRect()
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            Math.max(rect.top, Math.min(event.clientY, rect.bottom - 1)),
          )
          const item = itemFromElement(hit)
          if (!item || item.id === session.itemId) return
          session.itemId = item.id
          session.moved = true
          hoveredItemIdRef.current = item.id
          setScrubItemId(item.id)
          openPreview(item.id, true)
          onNavigate(item, 'scrub')
        }}
        onPointerUpCapture={endScrub}
      >
        <Virtualizer
          ref={virtualizerRef}
          data={items}
          scrollRef={listRef}
          itemSize={10}
          bufferSize={60}
          keepMounted={keepMounted}
        >
          {(item, index) => {
            const isBookmarked = bookmarkedInputIds?.has(item.id) ?? false
            return (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) buttonRefs.current.set(item.id, node)
                  else buttonRefs.current.delete(item.id)
                }}
                aria-current={visibleItemIds.has(item.id) ? 'true' : undefined}
                aria-label={`跳转到第 ${index + 1} 条用户消息${
                  isBookmarked ? '（已添加书签）' : ''
                }`}
                aria-posinset={index + 1}
                aria-setsize={items.length}
                className="conversation-turn-nav-item tw:relative tw:flex tw:h-2.5 tw:min-h-2.5 tw:w-9 tw:min-w-9 tw:shrink-0 tw:items-center tw:justify-start tw:border-none tw:bg-transparent tw:p-0 tw:cursor-pointer tw:outline-none tw:focus-visible:rounded-md tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus"
                data-neighbor-distance={
                  visualIndex === undefined ? undefined : Math.abs(index - visualIndex)
                }
                data-running={item.isRunning || undefined}
                data-interaction-target={visualIndex === index || undefined}
                data-scrub-target={scrubItemId === item.id ? '' : undefined}
                data-turn-navigation-item-id={item.id}
                onBlur={() => {
                  if (focusedItemIdRef.current === item.id) {
                    focusedItemIdRef.current = null
                    setFocusedItemId(null)
                  }
                  if (scrubSessionRef.current === null) schedulePreviewClose()
                }}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    return
                  }
                  openPreview(item.id, true)
                  onNavigate(item, 'activate')
                }}
                onFocus={() => {
                  focusedItemIdRef.current = item.id
                  setFocusedItemId(item.id)
                  openPreview(item.id, true)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closePreview()
                    return
                  }
                  // Tab 从刻度进入预览卡内的书签按钮；书签按钮 Shift+Tab 返回刻度。
                  if (
                    event.key === 'Tab' &&
                    !event.shiftKey &&
                    previewItemId === item.id &&
                    onToggleBookmark &&
                    bookmarkedInputIds
                  ) {
                    const bookmarkButton =
                      previewCardRef.current?.querySelector<HTMLButtonElement>(
                        '[data-bookmark-toggle]',
                      )
                    if (bookmarkButton) {
                      event.preventDefault()
                      bookmarkButton.focus()
                    }
                  }
                }}
                onPointerEnter={() => {
                  hoveredItemIdRef.current = item.id
                  setInteractionItemId(item.id)
                  openPreview(item.id, false)
                }}
                onPointerLeave={() => {
                  if (hoveredItemIdRef.current === item.id) {
                    hoveredItemIdRef.current = null
                    setInteractionItemId(null)
                  }
                  if (focusedItemIdRef.current !== item.id && scrubSessionRef.current === null) {
                    schedulePreviewClose()
                  }
                }}
                type="button"
              >
                <span
                  className="conversation-turn-nav-marker"
                  data-bookmarked={isBookmarked || undefined}
                />
                {isBookmarked ? <span className="conversation-turn-nav-bookmark-dot" /> : null}
              </button>
            )
          }}
        </Virtualizer>
      </div>
      <Popover.Root
        onOpenChange={(open) => {
          if (!open) closePreview()
        }}
        open={previewItemId !== null}
      >
        <Popover.Portal>
          <Popover.Content
            align="center"
            anchor={previewAnchorRef}
            aria-label="用户消息预览"
            className="conversation-turn-preview-tooltip tw:animate-none tw:w-auto tw:border-0 tw:bg-transparent tw:p-0 tw:shadow-none"
            onBlurCapture={schedulePreviewClose}
            onFocusCapture={cancelPreviewClose}
            onOpenAutoFocus={(event) => {
              // 悬停打开不抢焦点；键盘由刻度上的 Tab 进入书签按钮。
              event.preventDefault()
            }}
            onPointerEnter={cancelPreviewClose}
            onPointerLeave={schedulePreviewClose}
            side="right"
            sideOffset={8}
            style={{ backdropFilter: 'none' }}
          >
            {previewItem ? (
              <div ref={previewCardRef}>
                <PreviewCard
                  key={previewItem.id}
                  bookmarked={bookmarkedInputIds?.has(previewItem.id) ?? false}
                  bookmarksAvailable={bookmarkedInputIds !== null}
                  item={previewItem}
                  onBookmarkFocusBack={() => previewAnchorRef.current?.focus()}
                  onToggleBookmark={onToggleBookmark}
                />
              </div>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </nav>
  )
}
