import { useState } from 'react'
import type React from 'react'
import { Check, MoreHorizontal, Play, Trash2, X } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'

import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/Cx.js'
import type {
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopUserMessageInput,
} from '../../../shared/Types.js'

export type SessionFollowUpDockProps = {
  items: DesktopQueuedFollowUp[]
  pauseReason?: DesktopQueuePauseReason | null
  onEdit: (followUpId: string, input: DesktopUserMessageInput) => void
  onRemove: (followUpId: string) => void
  onResume: () => void
}

/*
 * The queue dock sits on the composer edge and anchors itself to the composer
 * width: it is absolutely positioned above the input, needs a negative bottom
 * offset to overlap the surface seam, and collapses to a 12px inset below
 * 560px of composer width.
 */
const DOCK_CLASS = cx(
  'session-follow-up-dock tw:pointer-events-auto tw:absolute tw:z-2 tw:right-9 tw:[bottom:calc(100%-1px)] tw:left-9',
  'tw:flex tw:max-h-[30vh] tw:flex-col tw:gap-1 tw:border-0 tw:bg-transparent tw:p-0',
  'tw:@max-[560px]:right-3 tw:@max-[560px]:left-3',
)
const HEADER_CLASS =
  'session-follow-up-header tw:flex tw:items-center tw:justify-between tw:gap-2 tw:p-1 tw:text-app-text-meta tw:type-caption'
const PAUSED_CLASS =
  'session-follow-up-paused tw:rounded-md tw:bg-app-canvas tw:px-2 tw:py-1 tw:text-app-text-soft tw:type-secondary'
const LIST_CLASS =
  'session-follow-up-list tw:flex tw:max-h-[inherit] tw:min-w-0 tw:flex-col tw:gap-1 tw:overflow-y-auto'
const ITEM_CLASS = cx(
  'session-follow-up-item tw:relative tw:grid tw:min-h-13.5 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-3',
  'tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:px-3 tw:py-2 tw:shadow-none',
  'tw:transition-[border-color,background] tw:duration-state tw:ease-standard',
  'tw:hover:border-app-border tw:hover:bg-app-hover',
)
const PREVIEW_CLASS =
  'session-follow-up-preview tw:block tw:w-fit tw:max-w-[min(40rem,100%)] tw:min-w-0 tw:truncate tw:type-row-title tw:text-app-text'
const ACTIONS_CLASS =
  'session-follow-up-actions tw:flex tw:min-w-max tw:shrink-0 tw:items-center tw:gap-1'
const EDIT_INPUT_CLASS = cx(
  'session-follow-up-edit-input tw:min-w-0 tw:flex-1 tw:rounded-control tw:border tw:border-app-border',
  'tw:bg-app-raised tw:px-2 tw:py-1 tw:text-app-text tw:[font:inherit]',
  'tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus tw:focus-visible:outline-offset-1',
)

export function SessionFollowUpDock({
  items,
  pauseReason = null,
  onEdit,
  onRemove,
  onResume,
}: SessionFollowUpDockProps): React.ReactNode {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  if (items.length === 0) return null

  function beginEdit(item: DesktopQueuedFollowUp): void {
    setEditingId(item.id)
    setEditingText(item.input.text)
  }

  function finishEdit(item: DesktopQueuedFollowUp): void {
    const text = editingText.trim()
    if (!text) return
    onEdit(item.id, { ...item.input, text })
    setEditingId(null)
    setEditingText('')
  }

  return (
    <section aria-label="消息队列" className={DOCK_CLASS}>
      {pauseReason ? (
        <div className={HEADER_CLASS}>
          <span>已排队 {items.length} 条</span>
          <Button color="primary" className="session-follow-up-resume" onClick={onResume}>
            <Play aria-hidden="true" size={APP_ICON_SIZE} />
            继续队列
          </Button>
        </div>
      ) : null}
      {pauseReason ? (
        <div className={PAUSED_CLASS} role="status">
          {pauseReason === 'interrupted'
            ? '队列因你中断了任务而暂停'
            : '队列因上一项执行失败而暂停'}
        </div>
      ) : null}
      <div className={LIST_CLASS} role="list">
        {items.map((item, index) => {
          const isEditing = editingId === item.id
          return (
            <div
              aria-label={`排队消息 ${index + 1}：${item.previewText}`}
              className={ITEM_CLASS}
              key={item.id}
              role="listitem"
            >
              {isEditing ? (
                <input
                  aria-label="编辑排队消息"
                  autoFocus
                  className={EDIT_INPUT_CLASS}
                  onChange={(event) => setEditingText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      finishEdit(item)
                    } else if (event.key === 'Escape') {
                      setEditingId(null)
                    }
                  }}
                  value={editingText}
                />
              ) : (
                <span className={PREVIEW_CLASS} title={item.previewText}>
                  {item.previewText}
                </span>
              )}
              <div aria-label="队列操作" className={ACTIONS_CLASS}>
                {isEditing ? (
                  <>
                    <Button
                      isIconOnly
                      aria-label="保存编辑"
                      className="session-follow-up-action"
                      color="ghostSecondary"
                      disabled={!editingText.trim()}
                      onClick={() => finishEdit(item)}
                      size="iconMd"
                      title="保存编辑"
                    >
                      <Check size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                    <Button
                      isIconOnly
                      aria-label="取消编辑"
                      className="session-follow-up-action"
                      color="ghostSecondary"
                      onClick={() => setEditingId(null)}
                      size="iconMd"
                      title="取消编辑"
                    >
                      <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      isIconOnly
                      aria-label="移除排队消息"
                      className="session-follow-up-action"
                      color="ghostSecondary"
                      onClick={() => onRemove(item.id)}
                      size="iconMd"
                      title="移除"
                    >
                      <Trash2 size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </Button>
                    <Button
                      isIconOnly
                      aria-label="编辑排队消息"
                      className="session-follow-up-action"
                      color="ghostSecondary"
                      onClick={() => beginEdit(item)}
                      size="iconMd"
                      title="更多：编辑消息"
                    >
                      <MoreHorizontal
                        size={APP_ICON_SIZES.sm}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
