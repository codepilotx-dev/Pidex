import type React from 'react'
import { useState } from 'react'
import { CalendarClock, Database, Folder, GitBranch, User } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/IconTokens.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import {
  SidebarHoverCard,
  type SidebarHoverCardOverlayRenderProps,
} from '../layout/sidebar/SidebarHoverCard.js'
import {
  SidebarHoverCardFrame,
  SidebarHoverCardHeader,
  SidebarHoverCardRow,
} from '../layout/sidebar/SidebarHoverCardLayout.js'
import { SidebarHoverCardSurface } from '../layout/sidebar/SidebarHoverCardSurface.js'

export type GitBoardCommitHoverCardModel = {
  subject: string
  author: string
  authoredAt: string
  shortSha: string
  projectName: string
  /** 当前查看分支：HEAD 表示仓库当前分支，否则是用户在列头选中的分支。 */
  branchLabel: string
}

export function formatGitBoardCommitTime(authoredAt: string | number): string {
  // Agent 返回的是毫秒时间戳（协议声明为字符串），两种形态都按毫秒解释。
  const raw = typeof authoredAt === 'string' ? Number(authoredAt.trim()) : authoredAt
  const date = new Date(Number.isFinite(raw) ? raw : Number.NaN)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 与悬浮卡共用同一份信息模型，便于测试断言展示内容。 */
export function buildGitBoardCommitHoverCardModel(input: {
  subject: string
  author: string
  authoredAt: string
  shortSha: string
  projectName: string
  branchLabel: string
}): GitBoardCommitHoverCardModel {
  return {
    subject: input.subject.trim() || '(无提交标题)',
    author: input.author.trim() || '(未知作者)',
    authoredAt: formatGitBoardCommitTime(input.authoredAt),
    shortSha: input.shortSha,
    projectName: input.projectName,
    branchLabel: input.branchLabel,
  }
}

function GitBoardCommitHoverCardOverlay({
  model,
  ariaLabel,
  ...interactionProps
}: SidebarHoverCardOverlayRenderProps & {
  model: GitBoardCommitHoverCardModel
  ariaLabel: string
}): React.ReactNode {
  const { t } = useLocale()
  const metaRowClassName =
    'sidebar-commit-hover-card-row tw:grid-cols-[var(--sidebar-hover-leading-width)_minmax(0,1fr)] tw:text-app-text-meta tw:type-caption'
  return (
    <SidebarHoverCardSurface
      {...interactionProps}
      ariaLabel={ariaLabel}
      className="sidebar-commit-hover-card tw:min-w-[200px] tw:max-w-[280px] tw:px-3 tw:py-2"
      positionOutsideSidebar
    >
      <SidebarHoverCardFrame className="sidebar-commit-hover-card-content tw:flex tw:min-w-0 tw:flex-col tw:gap-2">
        <SidebarHoverCardHeader className="sidebar-commit-hover-card-header tw:grid-cols-[minmax(0,1fr)] tw:items-start">
          <span className="sidebar-commit-hover-card-title tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:type-row-title tw:line-clamp-2 tw:wrap-anywhere tw:[word-break:break-word]">
            {model.subject}
          </span>
        </SidebarHoverCardHeader>
        <div className="sidebar-commit-hover-card-meta tw:flex tw:min-w-0 tw:flex-col tw:gap-1">
          <SidebarHoverCardRow className={metaRowClassName}>
            <User
              aria-hidden="true"
              className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-commit-hover-card-row-content tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
              {model.author}
            </span>
          </SidebarHoverCardRow>
          <SidebarHoverCardRow className={metaRowClassName}>
            <CalendarClock
              aria-hidden="true"
              className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-commit-hover-card-row-content tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:tabular-nums">
              {model.authoredAt}
            </span>
          </SidebarHoverCardRow>
          <SidebarHoverCardRow className={metaRowClassName}>
            <Database
              aria-hidden="true"
              className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-commit-hover-card-row-content tw:min-w-0 tw:overflow-hidden tw:font-mono tw:text-ellipsis tw:whitespace-nowrap">
              {model.shortSha}
            </span>
          </SidebarHoverCardRow>
          <SidebarHoverCardRow className={metaRowClassName}>
            <Folder
              aria-hidden="true"
              className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-commit-hover-card-row-content tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
              {model.projectName}
            </span>
          </SidebarHoverCardRow>
          <SidebarHoverCardRow className={metaRowClassName}>
            <GitBranch
              aria-hidden="true"
              className="tw:size-[var(--inline-icon-size,1em)] tw:text-app-text-meta"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="sidebar-commit-hover-card-row-content tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1">
              <span className="tw:flex-none tw:text-app-text-meta">{t('查看分支')}</span>
              <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {model.branchLabel}
              </span>
            </span>
          </SidebarHoverCardRow>
        </div>
      </SidebarHoverCardFrame>
    </SidebarHoverCardSurface>
  )
}

/**
 * 提交行悬浮信息卡：仍复用侧栏 `SidebarHoverCard` 的打开/关闭延迟与焦点语义。
 * 该组件只由 Git 看板侧栏渲染，外层已有 `SidebarHoverCardProvider`。
 */
export function GitBoardCommitHoverCard({
  children,
  ariaLabel,
  model,
}: {
  children: React.ReactElement
  ariaLabel: string
  model: GitBoardCommitHoverCardModel
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <SidebarHoverCard
      open={open}
      onOpenChange={setOpen}
      renderOverlay={(interactionProps) => (
        <GitBoardCommitHoverCardOverlay {...interactionProps} ariaLabel={ariaLabel} model={model} />
      )}
    >
      {children}
    </SidebarHoverCard>
  )
}
