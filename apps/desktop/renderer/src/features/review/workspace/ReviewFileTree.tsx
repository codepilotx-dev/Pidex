import React from 'react'
import {
  ChevronRight,
  Copy,
  MessageSquare,
  SquareArrowRight,
  SquareDashed,
  SquareDot,
  SquareMinus,
  SquarePlus,
  type LucideIcon,
} from 'lucide-react'
import type { DesktopReviewDiffFile } from '../../../../shared/Types.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { cx } from '../../../utils/Cx.js'
import { FileTypeIcon, FolderTypeIcon } from '../../layout/FileTypeIcon.js'
import type { ReviewFileTreeRow as ReviewFileTreeRowModel } from './BuildReviewFileTree.js'
import {
  normalizeReviewFileStatus,
  reviewFileStatusLabel,
  type ReviewFileStatusKind,
} from './ReviewFileStatus.js'

type Props = {
  commentCountsByPath?: Readonly<Record<string, number>>
  row: ReviewFileTreeRowModel
  collapsedDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
  selectedPath: string | null
}

export function ReviewFileTreeRow({
  commentCountsByPath,
  row,
  collapsedDirs,
  onSelectFile,
  onToggleDir,
  selectedPath,
}: Props): React.ReactNode {
  if (row.kind === 'file') {
    return (
      <ReviewFileRow
        active={row.file.path === selectedPath}
        commentCount={commentCountsByPath?.[row.file.path] ?? 0}
        depth={row.depth}
        file={row.file}
        onSelect={onSelectFile}
      />
    )
  }

  const { node } = row
  const collapsed = collapsedDirs.has(node.dirPath)
  const dirCommentCount = commentCountsByPath?.[node.dirPath] ?? 0
  return (
    <button
      aria-expanded={!collapsed}
      aria-level={row.depth + 1}
      className="review-file-tree-dir tw:relative tw:flex tw:h-[29px] tw:min-h-[29px] tw:w-full tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:rounded-lg tw:py-0 tw:pr-2 tw:pl-0 tw:text-left tw:text-app-text-soft tw:type-control tw:cursor-pointer tw:transition-[color,background-color] tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover tw:hover:text-app-text tw:active:bg-app-selected tw:[&>svg]:flex-none"
      role="treeitem"
      style={{ paddingLeft: `${16 + row.depth * 14}px` }}
      type="button"
      onClick={() => onToggleDir(node.dirPath)}
    >
      <ChevronRight
        aria-hidden="true"
        className={cx(
          'tw:transition-transform tw:duration-state tw:ease-standard',
          collapsed ? 'tw:rotate-0' : 'is-expanded tw:rotate-90',
        )}
        size={APP_ICON_SIZES.sm}
      />
      <FolderTypeIcon
        aria-hidden="true"
        expanded={!collapsed}
        path={node.dirPath}
        size={APP_ICON_SIZE}
      />
      <span className="review-file-tree-dir-label tw:min-w-0 tw:flex-auto tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
        {node.dirLabel}
      </span>
      <span className="review-file-tree-trailing tw:ml-auto tw:inline-flex tw:min-w-5 tw:flex-none tw:items-center tw:justify-end tw:gap-2">
        {dirCommentCount > 0 ? (
          <span className="review-comment-badge tw:ml-auto tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-full tw:bg-app-selected tw:px-2 tw:py-1 tw:text-app-text tw:[&>svg]:flex-none">
            {dirCommentCount}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="review-file-tree-directory-status tw:inline-flex tw:size-5 tw:flex-none tw:items-center tw:justify-center"
        />
      </span>
    </button>
  )
}

function ReviewFileRow({
  active,
  commentCount,
  depth,
  file,
  onSelect,
}: {
  active: boolean
  commentCount: number
  depth: number
  file: DesktopReviewDiffFile
  onSelect: (path: string) => void
}): React.ReactNode {
  const displayName = basenameOf(file.path)
  const status = normalizeReviewFileStatus(file)
  const statusLabel = reviewFileStatusLabel(status)
  return (
    <button
      aria-level={depth + 1}
      aria-selected={active}
      className={cx(
        'review-file-tree-row tw:relative tw:flex tw:h-[29px] tw:min-h-[29px] tw:w-full tw:items-center tw:gap-2 tw:rounded-lg tw:border-0 tw:bg-transparent tw:py-0 tw:pr-2 tw:pl-0 tw:text-left tw:text-app-text-soft tw:type-body-sm tw:cursor-pointer tw:transition-[color,background-color] tw:duration-feedback tw:ease-standard tw:not-aria-selected:hover:bg-app-hover tw:not-aria-selected:hover:text-app-text tw:not-aria-selected:active:bg-app-selected tw:aria-selected:bg-app-selected tw:aria-selected:text-app-text tw:[&>svg]:flex-none',
        active ? 'active' : false,
      )}
      role="treeitem"
      style={{ paddingLeft: `${16 + depth * 14}px` }}
      title={`${file.path} · ${statusLabel}`}
      type="button"
      onClick={() => onSelect(file.path)}
    >
      <FileTypeIcon
        aria-hidden="true"
        associationMode="extension-only"
        path={file.path}
        size={APP_ICON_SIZE}
      />
      <span className="review-file-path tw:min-w-0 tw:flex-auto tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text-meta tw:type-body-sm tw:[direction:ltr] tw:text-start">
        {displayName}
      </span>
      <span className="review-file-tree-trailing tw:ml-auto tw:inline-flex tw:min-w-5 tw:flex-none tw:items-center tw:justify-end tw:gap-2">
        {commentCount > 0 ? (
          <span className="review-comment-badge tw:ml-0 tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-full tw:bg-app-selected tw:px-2 tw:py-1 tw:text-app-text tw:[&>svg]:flex-none">
            <MessageSquare size={APP_ICON_SIZE} />
            {commentCount}
          </span>
        ) : null}
        <ReviewFileStatusIcon status={status} />
      </span>
    </button>
  )
}

const REVIEW_FILE_STATUS_ICONS: Record<ReviewFileStatusKind, LucideIcon> = {
  added: SquarePlus,
  deleted: SquareMinus,
  modified: SquareDot,
  renamed: SquareArrowRight,
  copied: Copy,
  unknown: SquareDashed,
}

function ReviewFileStatusIcon({ status }: { status: ReviewFileStatusKind }): React.ReactNode {
  const Icon = REVIEW_FILE_STATUS_ICONS[status]
  const label = reviewFileStatusLabel(status)
  return (
    <span
      aria-label={`Git 状态：${label}`}
      className="review-file-tree-status tw:inline-flex tw:size-5 tw:flex-none tw:items-center tw:justify-center tw:data-[git-status=added]:text-app-success tw:data-[git-status=deleted]:text-app-danger tw:data-[git-status=modified]:text-app-warning tw:data-[git-status=renamed]:text-app-warning tw:data-[git-status=copied]:text-app-warning tw:data-[git-status=unknown]:text-app-text-meta"
      data-git-status={status}
      title={label}
    >
      <Icon
        aria-hidden="true"
        className="tw:size-icon-sm tw:[stroke-width:var(--cpx-sys-icon-stroke-width)]"
        size={APP_ICON_SIZES.sm}
      />
    </span>
  )
}

function basenameOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index >= 0 ? path.slice(index + 1) : path
}
