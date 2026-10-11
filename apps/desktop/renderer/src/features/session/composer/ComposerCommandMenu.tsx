import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { VList, type VListHandle } from 'virtua'
import { cx } from '../../../utils/Cx.js'
import type { ComposerCommand } from './ComposerSlashCommands.js'
import { composerMenuScrollTop } from './ComposerSuggestionMenu.js'
export { filterComposerMenuItems } from './ComposerSuggestionMenu.js'

export type ComposerMenuItem = {
  key: string
  section?: string
  label: string
  description?: string
  meta?: string
  icon: React.ReactNode
  matchText: string
  searchPath?: string
  isActive?: boolean
  disabled?: boolean
  disabledReason?: string
  status?: 'loading' | 'error' | 'empty'
  completion?: 'category' | 'directory' | 'submenu'
  category?: string
  categoryOnly?: boolean
  onSelect: () => void
  command?: ComposerCommand
}

/*
 * Suggestion menu shell. The section title is sticky inside the scrolling menu,
 * and the scroll-mask variants drive the top/bottom fade through data attributes
 * the component already tracks.
 */
const MENU_CLASS = cx(
  'chat-input__suggestion-menu tw:max-h-[calc(var(--composer-suggestion-max-height)-var(--cpx-sys-space-4))]',
  'tw:overflow-auto tw:overscroll-contain',
)
const SECTION_TITLE_CLASS = cx(
  'chat-input__dropdown-section-title tw:sticky tw:top-0 tw:z-sticky tw:bg-app-raised',
  'tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-label',
)
const STATUS_ROW_CLASS = 'chat-input__dropdown-status tw:p-2 tw:text-app-text-meta tw:type-caption'
const MENU_ITEM_CLASS = cx(
  'chat-input__dropdown-item tw:grid tw:grid-cols-[16px_minmax(0,1fr)_max-content] tw:gap-x-2',
  'tw:border-0 tw:type-control',
)
const MENU_ITEM_IDLE_CLASS = 'tw:bg-transparent'
const MENU_ITEM_KEYBOARD_CLASS = 'is-keyboard-active tw:bg-app-hover'
const MENU_ITEM_DISABLED_CLASS =
  'is-disabled tw:cursor-not-allowed tw:pointer-events-none tw:text-app-text-meta tw:opacity-58'
const ITEM_LEADING_CLASS = cx(
  'chat-input__dropdown-leading tw:inline-flex tw:size-4 tw:items-center tw:justify-center tw:text-app-text',
  'tw:[&>svg]:block tw:[&>svg]:size-icon',
)
const ITEM_COPY_CLASS =
  'chat-input__dropdown-copy tw:flex tw:min-w-0 tw:items-baseline tw:gap-2 tw:overflow-hidden'
const ITEM_LABEL_CLASS = 'chat-input__dropdown-label tw:flex-none'
const ITEM_HINT_CLASS =
  'chat-input__dropdown-hint tw:min-w-0 tw:truncate tw:text-app-text-meta tw:type-caption'
const ITEM_META_CLASS =
  'chat-input__dropdown-meta tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption'
const EMPTY_CLASS =
  'chat-input__dropdown-empty tw:p-2 tw:text-center tw:text-app-text-meta tw:type-secondary'
const VLIST_CLASS = 'chat-input__suggestion-vlist'

type Props = {
  id: string
  items: ComposerMenuItem[]
  keyword: string
  emptyLabel?: string
  activeKey: string | null
  onActiveKeyChange: (key: string) => void
  onItemSelect: (item: ComposerMenuItem) => void
}

type MenuRow = { key: string; section: string } | { key: string; item: ComposerMenuItem }

export function composerMenuItemId(menuId: string, key: string): string {
  return `${menuId}-item-${encodeURIComponent(key)}`
}

export function ComposerCommandMenu({
  id,
  items,
  keyword,
  emptyLabel = '无匹配项',
  activeKey,
  onActiveKeyChange,
  onItemSelect,
}: Props): React.ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<VListHandle>(null)
  const [mask, setMask] = useState('none')
  const rows: MenuRow[] = []
  let previousSection: string | undefined
  for (const item of items) {
    if (item.section && item.section !== previousSection)
      rows.push({ key: `header:${item.section}`, section: item.section })
    rows.push({ key: item.key, item })
    previousSection = item.section
  }
  const virtual = rows.length > 50
  function updateMask(): void {
    const root = rootRef.current
    const list = listRef.current
    const offset = virtual ? (list?.scrollOffset ?? 0) : (root?.scrollTop ?? 0)
    const size = virtual ? (list?.scrollSize ?? 0) : (root?.scrollHeight ?? 0)
    const viewport = virtual ? (list?.viewportSize ?? 0) : (root?.clientHeight ?? 0)
    const top = offset > 1
    const bottom = size - viewport - offset > 1
    setMask(top && bottom ? 'both' : top ? 'top' : bottom ? 'bottom' : 'none')
  }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    updateMask()
    const observer = new ResizeObserver(updateMask)
    observer.observe(root)
    return () => observer.disconnect()
  }, [items, virtual])
  useLayoutEffect(() => {
    const index = rows.findIndex((row) => row.key === activeKey)
    if (index < 0) return
    if (virtual) listRef.current?.scrollToIndex(index, { align: 'nearest' })
    else {
      const root = rootRef.current
      const item = document.getElementById(composerMenuItemId(id, activeKey!))
      if (!root || !item) return
      const viewport = root.getBoundingClientRect()
      const row = item.getBoundingClientRect()
      root.scrollTop = composerMenuScrollTop(
        root.scrollTop,
        root.clientHeight,
        row.top - viewport.top,
        row.bottom - viewport.top,
      )
    }
  }, [activeKey, items, virtual, id])

  function renderRow(row: MenuRow): React.ReactNode {
    if ('section' in row)
      return (
        <div className={SECTION_TITLE_CLASS} role="presentation">
          {row.section}
        </div>
      )
    const item = row.item
    if (item.status)
      return (
        <div className={STATUS_ROW_CLASS} role="status">
          {item.label}
          {item.description ? `：${item.description}` : ''}
        </div>
      )
    return (
      <button
        aria-disabled={item.disabled || undefined}
        aria-selected={item.key === activeKey}
        className={cx(
          MENU_ITEM_CLASS,
          item.isActive && 'is-active',
          item.key === activeKey ? MENU_ITEM_KEYBOARD_CLASS : MENU_ITEM_IDLE_CLASS,
          item.disabled && MENU_ITEM_DISABLED_CLASS,
        )}
        id={composerMenuItemId(id, item.key)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!item.disabled) onItemSelect(item)
        }}
        onMouseMove={() => {
          if (!item.disabled) onActiveKeyChange(item.key)
        }}
        role="option"
        tabIndex={-1}
        title={item.disabled ? item.disabledReason : item.description}
        type="button"
      >
        <span className={ITEM_LEADING_CLASS}>{item.icon}</span>
        <span className={ITEM_COPY_CLASS}>
          <span className={ITEM_LABEL_CLASS}>{item.label}</span>
          {item.description ? <span className={ITEM_HINT_CLASS}>{item.description}</span> : null}
        </span>
        {item.meta ? <span className={ITEM_META_CLASS}>{item.meta}</span> : null}
      </button>
    )
  }

  return (
    <div
      aria-label="Composer 菜单"
      className={MENU_CLASS}
      data-scroll-mask={mask}
      id={id}
      ref={rootRef}
      role="listbox"
      onScroll={virtual ? undefined : updateMask}
    >
      {!items.some((item) => !item.status) && !items.some((item) => item.status === 'loading') ? (
        <div className={EMPTY_CLASS} role="status">
          {keyword ? emptyLabel : '暂无可用项'}
        </div>
      ) : null}
      {virtual ? (
        <VList
          className={VLIST_CLASS}
          style={{
            height: 'calc(var(--composer-suggestion-max-height, 320px) - var(--cpx-sys-space-4))',
          }}
          data={rows}
          ref={listRef}
          onScroll={updateMask}
        >
          {(row) => <div key={row.key}>{renderRow(row)}</div>}
        </VList>
      ) : (
        rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
      )}
    </div>
  )
}
