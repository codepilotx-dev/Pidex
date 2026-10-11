import type React from 'react'
import { Dropdown as DropdownMenu } from '../../../components/ui/floating/Dropdown.js'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DesktopReviewSource } from '../../../../shared/Types.js'
import {
  PopoverItem,
  PopoverRadioGroup,
  PopoverRadioItem,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { buildPopoverSizingStyle } from '../../../components/ui/PopoverSizing.js'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import {
  pickDefaultReviewBaseBranch,
  reviewSourceLabel,
  type ReviewBranch,
  type ReviewCommit,
} from './ReviewAgentClient.js'

type ReviewSourceMenuProps = {
  supportsUncommitted?: boolean
  branches: readonly ReviewBranch[]
  commits: readonly ReviewCommit[]
  open: boolean
  source: DesktopReviewSource
  sourceOptionsState: 'idle' | 'loading' | 'ready' | 'error'
  onOpenChange: (open: boolean) => void
  onRetry: () => void
  onSelectLastTurn: () => void
  onSelectSource: (source: DesktopReviewSource) => void
}

export function ReviewSourceMenu({
  supportsUncommitted = false,
  branches,
  commits,
  open,
  source,
  sourceOptionsState,
  onOpenChange,
  onRetry,
  onSelectLastTurn,
  onSelectSource,
}: ReviewSourceMenuProps): React.ReactNode {
  const defaultBaseBranch =
    source.kind === 'branch' ? source.baseBranch : pickDefaultReviewBaseBranch(branches)

  return (
    <PopoverMenu
      align="start"
      avoidCollisions={false}
      className="popover-review-scope popover-menu--flex tw:block"
      open={open}
      side="bottom"
      sideOffset={4}
      size="sm"
      trigger={
        <button
          aria-label="切换变更范围"
          className="review-scope-trigger tw:inline-flex tw:min-h-8 tw:min-w-0 tw:shrink tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-compact tw:border-0 tw:bg-transparent tw:px-2 tw:text-left tw:text-app-text tw:type-weight-label tw:hover:bg-app-hover tw:data-[state=open]:bg-app-hover tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
          type="button"
        >
          <span className="review-scope-trigger-label tw:min-w-[54px] tw:text-left">
            {reviewSourceLabel(source)}
          </span>
          <ChevronDown size={APP_ICON_SIZES.sm} />
        </button>
      }
      onOpenChange={onOpenChange}
    >
      <PopoverRadioGroup
        value={source.kind === 'last-turn' ? 'last-turn' : ''}
        onValueChange={onSelectLastTurn}
      >
        <PopoverRadioItem value="last-turn">上一轮</PopoverRadioItem>
      </PopoverRadioGroup>
      <DropdownMenu.Separator className="review-source-menu-separator tw:my-1 tw:h-px tw:bg-app-border-subtle" />
      {supportsUncommitted ? (
        <PopoverRadioGroup
          value={source.kind === 'uncommitted' ? 'uncommitted' : ''}
          onValueChange={() => onSelectSource({ kind: 'uncommitted' })}
        >
          <PopoverRadioItem value="uncommitted">未提交</PopoverRadioItem>
        </PopoverRadioGroup>
      ) : null}
      <PopoverRadioGroup
        value={source.kind === 'unstaged' || source.kind === 'staged' ? source.kind : ''}
        onValueChange={(kind) => onSelectSource({ kind: kind as 'unstaged' | 'staged' })}
      >
        <PopoverRadioItem value="unstaged">未暂存</PopoverRadioItem>
        <PopoverRadioItem value="staged">已暂存</PopoverRadioItem>
      </PopoverRadioGroup>
      <DropdownMenu.Separator className="review-source-menu-separator tw:my-1 tw:h-px tw:bg-app-border-subtle" />
      <ReviewCommitSourceSubmenu>
        {sourceOptionsState === 'loading' ? (
          <div className="review-source-submenu-message tw:p-2 tw:text-app-text-soft tw:type-body-sm">
            正在加载提交…
          </div>
        ) : sourceOptionsState === 'error' ? (
          <>
            <div className="review-source-submenu-message tw:p-2 tw:text-app-text-soft tw:type-body-sm">
              无法加载提交记录
            </div>
            <PopoverItem onClick={onRetry}>重试</PopoverItem>
          </>
        ) : commits.length === 0 ? (
          <div className="review-source-submenu-message tw:p-2 tw:text-app-text-soft tw:type-body-sm">
            分支上暂无提交记录
          </div>
        ) : (
          <PopoverRadioGroup
            value={source.kind === 'commit' ? source.commitSha : ''}
            onValueChange={(commitSha) =>
              onSelectSource({
                kind: 'commit',
                commitSha,
              })
            }
          >
            <div className="review-source-commit-list tw:max-h-80 tw:overflow-x-hidden tw:overflow-y-auto">
              {commits.map((commit) => (
                <PopoverRadioItem key={`commit:${commit.sha}`} value={commit.sha}>
                  <span
                    className="review-source-commit-row tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2"
                    title={commit.subject || commit.shortSha}
                  >
                    <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                      {commit.subject || '无提交信息'}
                    </span>
                    <small className="tw:flex-none tw:whitespace-nowrap tw:text-app-text-meta tw:type-caption">
                      {formatRelativeCommitTime(commit.authoredAt)}
                    </small>
                  </span>
                </PopoverRadioItem>
              ))}
            </div>
          </PopoverRadioGroup>
        )}
      </ReviewCommitSourceSubmenu>
      <PopoverRadioGroup
        value={source.kind === 'branch' ? 'branch' : ''}
        onValueChange={() => {
          if (!defaultBaseBranch) return
          onSelectSource({ kind: 'branch', baseBranch: defaultBaseBranch })
        }}
      >
        <PopoverRadioItem disabled={defaultBaseBranch === null} value="branch">
          分支
        </PopoverRadioItem>
      </PopoverRadioGroup>
    </PopoverMenu>
  )
}

function ReviewCommitSourceSubmenu({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="popover-item popover-sub-trigger" tabIndex={-1}>
        <span className="popover-item-label">已提交</span>
        <span className="popover-item-trailing">
          <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          size="lg"
          data-theme-component="dropdown-surface"
          className="popover-surface popover popover-sub-content popover-review-commits popover-menu--flex tw:max-h-[min(320px,calc(100vh-96px))] tw:overflow-hidden"
          collisionPadding={6}
          sideOffset={4}
          style={buildPopoverSizingStyle({ size: 'lg' })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

function formatRelativeCommitTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const elapsed = Math.max(0, Date.now() - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (elapsed < minute) return '刚刚'
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`
  return `${Math.floor(elapsed / day)} 天前`
}
