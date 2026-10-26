import type React from 'react'
import { useMemo } from 'react'
import { FolderOpen, MessageSquare, Pin, PinOff, Settings } from 'lucide-react'
import type { DesktopWorkspace, ProjectAppearance } from '../../../shared/Types.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'

import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import { cx } from '../../utils/Cx.js'
import { ProjectAppearanceGlyph } from './ProjectAppearance.js'
import {
  SidebarHoverCardFrame,
  SidebarHoverCardHeader,
  SidebarHoverCardRow,
} from '../layout/sidebar/SidebarHoverCardLayout.js'

/* 悬浮卡内的行内动作（文件夹、编辑项目）：26px 行、12px 前置图标、无边框。 */
const PROJECT_HOVER_CARD_ACTION_CLASS =
  'tw:grid tw:h-auto tw:min-h-[26px] tw:w-full tw:cursor-pointer tw:grid-cols-[var(--sidebar-hover-leading-width)_minmax(0,1fr)] tw:items-center tw:justify-start tw:gap-x-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-0 tw:py-1 tw:text-left tw:text-app-text-meta tw:type-caption tw:shadow-none tw:hover:bg-app-hover tw:hover:text-app-text tw:hover:shadow-none tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus tw:[&_svg]:size-[var(--inline-icon-size,1em)] tw:[&_svg]:text-app-text-soft'

type Props = {
  appearance: ProjectAppearance
  conversationCount: number
  openCount: number
  unreadCount: number
  pinLabel?: string
  pinIcon?: React.ReactNode
  isPinned: boolean
  isUnavailable: boolean
  project: DesktopWorkspace
  pinRef?: React.Ref<HTMLButtonElement>
  onEdit: () => void
  onOpenFolder: (path: string) => void
  onTogglePinned: () => void
}

export function ProjectDetailsCard({
  appearance,
  conversationCount,
  openCount,
  unreadCount,
  pinLabel,
  pinIcon,
  isPinned,
  isUnavailable,
  project,
  pinRef,
  onEdit,
  onOpenFolder,
  onTogglePinned,
}: Props): React.ReactNode {
  const folders = useMemo(
    () =>
      project.folders?.length
        ? [...project.folders].sort(
            (left, right) => left.order - right.order || left.name.localeCompare(right.name),
          )
        : [
            {
              id: `path:${project.path}`,
              name: project.name,
              path: project.path,
              role: 'primary' as const,
              availability: 'available' as const,
              order: 0,
              createdAt: 0,
              updatedAt: 0,
            },
          ],
    [project],
  )

  return (
    <SidebarHoverCardFrame
      className="sidebar-project-hover-card-content tw:flex tw:min-w-0 tw:flex-col tw:gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <SidebarHoverCardHeader className="sidebar-project-hover-card-header tw:grid-cols-[var(--sidebar-hover-leading-width)_minmax(0,1fr)_auto]">
        <ProjectAppearanceGlyph
          size={APP_ICON_SIZE}
          appearance={appearance}
          className="tw:inline-flex tw:size-[var(--sidebar-hover-leading-width)] tw:items-center tw:justify-center tw:[&>svg]:block"
        />
        <strong
          className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text tw:type-row-title"
          title={project.name}
        >
          {project.name}
        </strong>
        <Tooltip content={pinLabel ?? (isPinned ? '取消置顶项目' : '置顶项目')}>
          <Button
            nativeTitle={false}
            isIconOnly
            iconSize="sm"
            className="sidebar-project-hover-card-pin tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:justify-self-end"
            color={pinLabel ? 'text' : isPinned ? 'ghostActive' : 'ghostSecondary'}
            ref={pinRef}
            size="toolbar"
            title={pinLabel ?? (isPinned ? '取消置顶项目' : '置顶项目')}
            onClick={() => {
              onTogglePinned()
            }}
          >
            {pinIcon ??
              (isPinned ? <PinOff size={APP_ICON_SIZES.sm} /> : <Pin size={APP_ICON_SIZES.sm} />)}
          </Button>
        </Tooltip>
      </SidebarHoverCardHeader>
      <SidebarHoverCardRow className="sidebar-project-hover-card-stats tw:text-app-text-meta tw:type-caption">
        <MessageSquare
          aria-hidden="true"
          className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
          size="var(--inline-icon-size, 1em)"
        />
        <span className="sidebar-project-hover-card-stats-content tw:inline-flex tw:flex-wrap tw:items-center tw:gap-1">
          <span>{conversationCount} 个任务</span>
          {unreadCount > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="sidebar-project-hover-card-stat-separator tw:text-app-text-meta"
              >
                ·
              </span>
              <span>{unreadCount} 条未读</span>
            </>
          ) : null}
          <span
            aria-hidden="true"
            className="sidebar-project-hover-card-stat-separator tw:text-app-text-meta"
          >
            ·
          </span>
          <span>{openCount} 个已开启</span>
        </span>
      </SidebarHoverCardRow>
      <div className="sidebar-project-hover-card-folders tw:mt-1 tw:flex tw:flex-col tw:gap-1">
        {folders.map((folder) =>
          folder.path ? (
            <Tooltip key={folder.id} content={folder.path}>
              <button
                className={cx('sidebar-project-hover-card-folder', PROJECT_HOVER_CARD_ACTION_CLASS)}
                disabled={isUnavailable || folder.availability === 'missing'}
                type="button"
                onClick={() => {
                  onOpenFolder(folder.path)
                }}
              >
                <FolderOpen aria-hidden="true" size="var(--inline-icon-size, 1em)" />
                <span className="sidebar-project-hover-card-folder-path tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                  {folder.path}
                </span>
              </button>
            </Tooltip>
          ) : null,
        )}
      </div>
      <Button
        color="ghostSecondary"
        className={cx('sidebar-project-hover-card-edit tw:mt-1', PROJECT_HOVER_CARD_ACTION_CLASS)}
        size="compact"
        onClick={() => {
          onEdit()
        }}
      >
        <Settings aria-hidden="true" size={APP_ICON_SIZES.sm} />
        <span>编辑项目</span>
      </Button>
    </SidebarHoverCardFrame>
  )
}
