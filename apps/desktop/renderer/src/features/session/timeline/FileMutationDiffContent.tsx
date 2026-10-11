import React from 'react'
import type { DesktopDiffMarkerStyle, DesktopReviewDiffFile } from '../../../../shared/Types.js'

import { ReviewDiffReadOnlyInline } from '../../review/diff/ReviewDiffSurface.js'
import {
  flattenDiffRows,
  ReviewVirtualDiffRows,
  shouldVirtualizeReviewFile,
} from '../../review/diff/WorkspaceReviewDiff.js'
import { buildReviewIntralineByLineId } from '../../review/diff/ReviewIntralineDiff.js'
import { unifiedPatchToDesktopHunks } from '../../review/diff/ReviewDiffAdapter.js'
import type { ThreadPatchDiff } from './FileMutationDiffBody.js'

const EMPTY_COMMENTS = new Map()
const NOOP = (): void => {}
const NOOP_DRAFT = (): void => {}
const NOOP_OPERATION = (): void => {}

export function threadPatchDiffToDesktopFile(diff: ThreadPatchDiff): DesktopReviewDiffFile {
  const hunks = diff.renderable ? unifiedPatchToDesktopHunks(diff.patch, diff.hunks) : []
  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'added') additions += 1
      if (line.type === 'removed') deletions += 1
    }
  }
  return {
    path: diff.path,
    status:
      diff.operation === 'create' ? 'added' : diff.operation === 'delete' ? 'deleted' : 'modified',
    additions,
    deletions,
    isUntracked: false,
    hunks,
    renderable: diff.renderable,
    tooLargeReason: diff.tooLargeReason,
  }
}

export function FileMutationDiffContent({
  diff,
  diffMarkerStyle,
}: {
  diff: ThreadPatchDiff
  diffMarkerStyle: DesktopDiffMarkerStyle
}): React.ReactNode {
  if (!diff.renderable) {
    return (
      <div
        className="canonical-file-mutation__message tw:flex tw:min-h-[72px] tw:items-center tw:justify-center tw:gap-2 tw:p-3 tw:text-app-text-soft"
        role="status"
      >
        本次差异过大，无法在时间线内展示
      </div>
    )
  }

  const file = threadPatchDiffToDesktopFile(diff)
  if (!file.hunks.some((hunk) => hunk.lines.length > 0)) {
    return (
      <div
        className="canonical-file-mutation__message tw:flex tw:min-h-[72px] tw:items-center tw:justify-center tw:gap-2 tw:p-3 tw:text-app-text-soft"
        role="status"
      >
        本次编辑未产生可显示的行变化
      </div>
    )
  }

  if (shouldVirtualizeReviewFile(file)) {
    return (
      <div className="canonical-file-mutation__virtual-diff tw:h-[420px] tw:min-h-[180px]">
        <ReviewVirtualDiffRows
          attachedComments={EMPTY_COMMENTS}
          diffMarkerStyle={diffMarkerStyle}
          draft={null}
          file={file}
          flattenedRows={flattenDiffRows(file, 'inline')}
          intralineByLineId={buildReviewIntralineByLineId(file.hunks, { enabled: true })}
          pending={false}
          readOnly
          scope="unstaged"
          view="inline"
          onApplyOperation={NOOP_OPERATION}
          onCancelDraft={NOOP}
          onCreateDraft={NOOP_DRAFT}
          onDeleteComment={NOOP}
          onResolveComment={NOOP}
          onSaveDraft={NOOP}
        />
      </div>
    )
  }

  return (
    <ReviewDiffReadOnlyInline
      ariaLabel={`${file.path} 本次编辑差异`}
      diffMarkerStyle={diffMarkerStyle}
      file={file}
      showWordDiff
      wrapLines
    />
  )
}
