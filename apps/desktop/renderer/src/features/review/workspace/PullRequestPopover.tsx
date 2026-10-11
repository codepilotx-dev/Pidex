import React from 'react'
import { formatReviewCount } from '../diff/ReviewFormat.js'
import { ArrowUpRight, ChevronDown, ExternalLink, GitFork, X } from 'lucide-react'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'

import type { PopoverSizingProps } from '../../../components/ui/PopoverSizing.js'
import { Popover } from '../../../components/ui/floating/Popover.js'

type Props = {
  additions: number
  anchorRef: React.RefObject<HTMLElement>
  branchName: string | null
  defaultBranch: string | null
  deletions: number
  open: boolean
  onClose: () => void
  onCreateDraftPR: (title: string, body: string, pushFirst: boolean) => void
  onCreatePR: (title: string, body: string, pushFirst: boolean) => void
  onOpenPR: () => void
} & PopoverSizingProps

export function PullRequestPopover({
  additions,
  anchorRef,
  branchName,
  defaultBranch,
  deletions,
  open,
  size,
  onClose,
  onCreateDraftPR,
  onCreatePR,
  onOpenPR,
}: Props): React.ReactNode {
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [pushFirst, setPushFirst] = React.useState(true)
  React.useEffect(() => {
    if (open) {
      setTitle(branchName ?? '')
      setBody('')
      setPushFirst(true)
    }
  }, [branchName, open])

  const branchLabel = branchName ?? '当前分支'
  const targetLabel = defaultBranch ?? 'main'

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Popover.Portal>
        <Popover.Content
          anchor={anchorRef}
          side="bottom"
          align="end"
          size={size}
          aria-label="创建拉取请求"
          className="review-popover pr-popover tw:flex tw:flex-col tw:gap-2 tw:font-sans"
          role="dialog"
        >
          <header className="review-popover-header tw:flex tw:items-center tw:gap-2 tw:text-app-text tw:type-row-title">
            <span className="review-popover-branch tw:inline-flex tw:items-center tw:gap-1 tw:text-app-text">
              <span className="review-popover-branch-name tw:max-w-40 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                {branchLabel}
              </span>
              <ArrowUpRight size={APP_ICON_SIZE} />
              <span>{targetLabel}</span>
              <ChevronDown size={APP_ICON_SIZES.sm} />
            </span>
            <span className="review-popover-counts tw:ml-auto tw:inline-flex tw:items-center tw:gap-1 tw:type-weight-label tw:tabular-nums">
              <strong className="tw:text-app-success tw:type-weight-label">
                +{formatPanelNumber(additions)}
              </strong>
              <em className="tw:text-app-danger tw:not-italic tw:type-weight-label">
                -{formatPanelNumber(deletions)}
              </em>
            </span>
            <Button
              isIconOnly
              iconSize="sm"
              className="review-popover-close"
              color="ghostSecondary"
              size="toolbar"
              title="关闭"
              type="button"
              onClick={onClose}
            >
              <X size={APP_ICON_SIZES.sm} />
            </Button>
          </header>

          <label className="review-popover-field tw:flex tw:flex-col tw:gap-1 tw:text-app-text-soft tw:type-body-sm">
            <span className="tw:type-weight-label">标题</span>
            <input
              className="tw:w-full tw:px-2 tw:py-1 tw:border tw:border-app-border-subtle tw:rounded-md tw:bg-app-canvas tw:text-app-text tw:type-control tw:resize-none"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  onCreateDraftPR(title, body, pushFirst)
                }
              }}
            />
          </label>

          <label className="review-popover-field tw:flex tw:flex-col tw:gap-1 tw:text-app-text-soft tw:type-body-sm">
            <span className="tw:type-weight-label">描述（留空将自动生成）</span>
            <textarea
              className="tw:min-h-16 tw:w-full tw:px-2 tw:py-1 tw:border tw:border-app-border-subtle tw:rounded-md tw:bg-app-canvas tw:text-app-text tw:type-control tw:resize-y"
              placeholder="描述（留空将自动生成）..."
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  onCreateDraftPR(title, body, pushFirst)
                }
              }}
            />
          </label>

          <label className="review-popover-check tw:flex tw:items-center tw:gap-2 tw:text-app-text-soft tw:type-control">
            <input
              checked={pushFirst}
              type="checkbox"
              onChange={(event) => setPushFirst(event.target.checked)}
            />
            <span>先推送当前分支</span>
          </label>

          <div className="review-popover-actions tw:flex tw:flex-col tw:gap-1 tw:border-t tw:border-app-border tw:pt-1">
            <Button
              color="primary"
              className="tw:w-full tw:justify-between"
              onClick={() => onCreateDraftPR(title, body, pushFirst)}
            >
              <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
                <GitFork size={APP_ICON_SIZE} />
                创建草稿 PR
              </span>
              <span className="shortcut">Ctrl+Enter</span>
            </Button>
            <Button
              color="primary"
              className="tw:w-full tw:justify-between"
              onClick={() => onCreatePR(title, body, pushFirst)}
            >
              <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
                <GitFork size={APP_ICON_SIZE} />
                创建拉取请求
              </span>
            </Button>
            <Button
              color="primary"
              className="tw:w-full tw:justify-between"
              onClick={() => onOpenPR()}
            >
              <span className="review-popover-action-label tw:inline-flex tw:items-center tw:gap-2">
                <ExternalLink size={APP_ICON_SIZE} />
                在浏览器中打开 PR
              </span>
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}
