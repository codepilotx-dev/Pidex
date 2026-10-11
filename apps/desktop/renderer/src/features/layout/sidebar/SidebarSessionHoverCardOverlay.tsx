import type React from 'react'
import { Folder, GitBranch, Laptop } from 'lucide-react'
import { SkeletonBlock } from '../../../components/ui/Skeleton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import type { SidebarHoverCardOverlayRenderProps } from './SidebarHoverCard.js'
import {
  SidebarHoverCardFrame,
  SidebarHoverCardHeader,
  SidebarHoverCardRow,
} from './SidebarHoverCardLayout.js'
import { SidebarHoverCardSurface } from './SidebarHoverCardSurface.js'
import type { SidebarSessionHoverCardModel } from './SidebarSessionHoverCard.js'

type Props = SidebarHoverCardOverlayRenderProps & {
  editing: boolean
  focusRequest: number
  inputRef: React.RefObject<HTMLInputElement | null>
  model: SidebarSessionHoverCardModel
  regeneratingTitle: boolean
  renameValue: string
  saving: boolean
  onCancelRename: () => void
  onFocusRequestHandled: () => void
  onRenameValueChange: (value: string) => void
  onSaveRename: () => void
  onStartRename: () => void
}

export function SidebarSessionHoverCardOverlay({
  editing,
  focusRequest,
  inputRef,
  model,
  regeneratingTitle,
  renameValue,
  saving,
  onCancelRename,
  onFocusRequestHandled,
  onRenameValueChange,
  onSaveRename,
  onStartRename,
  ...interactionProps
}: Props): React.ReactNode {
  return (
    <SidebarHoverCardSurface
      {...interactionProps}
      ariaLabel="会话详情"
      className="sidebar-session-hover-card tw:min-w-[200px] tw:max-w-[280px] tw:px-3 tw:py-2"
      focusRef={editing ? inputRef : undefined}
      focusRequest={editing ? focusRequest : 0}
      onFocusRequestHandled={onFocusRequestHandled}
      positionOutsideSidebar
    >
      <SidebarHoverCardFrame className="sidebar-session-hover-card-content tw:flex tw:min-w-0 tw:flex-col tw:gap-2">
        <SidebarHoverCardHeader className="sidebar-session-hover-card-header tw:grid-cols-[minmax(0,1fr)_auto] tw:items-start">
          {editing ? (
            <input
              aria-label="任务名称"
              aria-busy={saving}
              className="sidebar-session-hover-card-rename-input tw:col-span-full tw:h-6 tw:w-full tw:min-w-0 tw:rounded-md tw:border tw:border-app-focus tw:bg-app-control tw:px-2 tw:py-1 tw:text-app-text tw:type-row-title tw:outline-none"
              maxLength={160}
              readOnly={saving}
              ref={inputRef}
              value={renameValue}
              onBlur={onCancelRename}
              onChange={(event) => onRenameValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSaveRename()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelRename()
                  interactionProps.returnFocusToAnchor()
                }
              }}
            />
          ) : (
            <button
              aria-busy={regeneratingTitle}
              aria-live="polite"
              className="sidebar-session-hover-card-title-group tw:col-start-1 tw:inline-flex tw:min-w-0 tw:items-start tw:justify-start tw:gap-2 tw:text-left tw:cursor-pointer"
              disabled={regeneratingTitle}
              title="单击重命名"
              type="button"
              onClick={onStartRename}
            >
              {regeneratingTitle ? (
                <>
                  <SkeletonBlock className="sidebar-session-hover-card-title__skeleton tw:h-[var(--cpx-sys-font-size-md)] tw:max-h-[var(--cpx-sys-font-size-md)] tw:min-h-[var(--cpx-sys-font-size-md)] tw:w-34 tw:flex-none tw:rounded-sm" />
                  <span className="tw:sr-only">正在更新会话标题</span>
                </>
              ) : (
                <span className="sidebar-session-hover-card-title tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:type-row-title tw:line-clamp-2 tw:wrap-anywhere tw:[word-break:break-word]">
                  {model.title}
                </span>
              )}
            </button>
          )}
          <span className="sidebar-session-hover-card-trailing tw:col-start-2 tw:inline-flex tw:items-center tw:gap-1 tw:pt-1">
            <Laptop
              aria-hidden="true"
              className="sidebar-session-hover-card-device-icon tw:flex-none tw:text-app-text-meta"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-session-hover-card-time tw:flex-none tw:text-app-text-meta tw:type-caption tw:tabular-nums tw:whitespace-nowrap">
              {model.relativeTime}
            </span>
            {model.isRunning ? (
              <>
                <span
                  aria-hidden="true"
                  className="sidebar-session-hover-card-time-dot tw:flex-none tw:text-app-text-meta tw:type-caption"
                >
                  ·
                </span>
                <span
                  aria-label="运行中"
                  className="sidebar-session-running-dot tw:size-1.5 tw:flex-none tw:rounded-full tw:bg-app-accent"
                />
              </>
            ) : null}
            {model.unread ? (
              <span
                aria-hidden="true"
                className="sidebar-unread-dot tw:size-1.5 tw:flex-none tw:rounded-full tw:bg-app-accent"
              />
            ) : null}
          </span>
        </SidebarHoverCardHeader>
        <div className="sidebar-session-hover-card-meta tw:flex tw:min-w-0 tw:flex-col tw:gap-1">
          <SidebarHoverCardRow className="sidebar-session-hover-card-row tw:grid-cols-[var(--sidebar-hover-leading-width)_minmax(0,1fr)] tw:text-app-text-meta tw:type-caption">
            <Folder
              aria-hidden="true"
              className="tw:size-icon-sm tw:text-app-text-meta"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-session-hover-card-row-content tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1">
              <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {model.projectLabel}
              </span>
              {model.gitBranch ? (
                <>
                  <span
                    aria-hidden="true"
                    className="sidebar-session-hover-card-stat-separator tw:text-app-text-meta"
                  >
                    ·
                  </span>
                  <GitBranch
                    aria-hidden="true"
                    className="tw:flex-none tw:basis-3"
                    size={APP_ICON_SIZES.sm}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                    {model.gitBranch}
                  </span>
                </>
              ) : null}
            </span>
          </SidebarHoverCardRow>
        </div>
      </SidebarHoverCardFrame>
    </SidebarHoverCardSurface>
  )
}
