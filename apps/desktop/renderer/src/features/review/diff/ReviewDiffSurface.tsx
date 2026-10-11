import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { CheckCircle2, MessageSquarePlus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import type {
  DesktopDiffMarkerStyle,
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewScope,
  DesktopReviewSide,
} from '../../../../shared/Types.js'
import { syntaxTokenStyle } from '../../syntax/CodeBlock.js'
import { normalizeSyntaxLanguage, resolveLanguageFromPath } from '../../syntax/Language.js'
import { HIGHLIGHT_THEMES, resolveThemeId } from '../../syntax/Theme.js'
import type { SyntaxToken } from '../../syntax/Types.js'
import { useHighlightedCode } from '../../syntax/UseHighlightedCode.js'
import { useDesktopTheme } from '../../theme/ThemeContext.js'
import { cx } from '../../../utils/Cx.js'
import {
  alignReviewDiffLines,
  buildReviewIntralineByLineId,
  type ReviewIntralineByLineId,
  type ReviewIntralineRange,
} from './ReviewIntralineDiff.js'

export type CommentAnchor = {
  filePath: string
  side: DesktopReviewSide
  lineNumber: number
  lineContent: string
}

export type CommentDraft = CommentAnchor & {
  body: string
}

export type ReviewSplitRow = {
  id: string
  left: ReviewCell
  right: ReviewCell
  paired: boolean
}

export type ReviewCell = {
  line: DesktopReviewDiffLine | null
  side: DesktopReviewSide
  number: number | null
  content: string
  tone: 'removed' | 'added' | 'context' | 'meta' | 'empty'
}

export type DiffPaneRow =
  | {
      id: string
      kind: 'hunk'
      hunk: DesktopReviewDiffHunk
      unmodifiedLines: number
    }
  | {
      id: string
      kind: 'line'
      cell: ReviewCell
    }

export type ReviewSyntaxByLineId = ReadonlyMap<string, readonly SyntaxToken[]>
export type ReviewDiffSyntaxState = 'loading' | 'ready' | 'plain'
export type ReviewDiffSyntax = {
  byLineId: ReviewSyntaxByLineId
  state: ReviewDiffSyntaxState
}

export type ReviewDiffBodyProps = {
  attachedComments: Map<string, DesktopReviewComment[]>
  diffMarkerStyle: DesktopDiffMarkerStyle
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  intralineByLineId: ReviewIntralineByLineId
  pending: boolean
  scope: DesktopReviewScope
  syntaxThemeId?: string
  wrapLines: boolean
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
  ) => void
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}

export type ReviewDiffReadOnlySplitProps = {
  file: DesktopReviewDiffFile
  diffMarkerStyle: DesktopDiffMarkerStyle
  syntaxThemeId?: string
  showWordDiff: boolean
  wrapLines: boolean
  ariaLabel: string
}

export type ReviewDiffReadOnlyInlineProps = Omit<ReviewDiffReadOnlySplitProps, 'ariaLabel'> & {
  ariaLabel?: string
}

const EMPTY_COMMENTS = new Map<string, DesktopReviewComment[]>()
const NOOP = (): void => {}
const NOOP_DRAFT = (_draft: CommentDraft): void => {}
const NOOP_OPERATION = (
  _action: 'stage' | 'unstage' | 'revert',
  _target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
): void => {}

export function ReviewDiffReadOnlySplit({
  file,
  diffMarkerStyle,
  syntaxThemeId,
  showWordDiff,
  wrapLines,
  ariaLabel,
}: ReviewDiffReadOnlySplitProps): React.ReactNode {
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
  )

  return (
    <ReviewDiffSplit
      ariaLabel={ariaLabel}
      attachedComments={EMPTY_COMMENTS}
      diffMarkerStyle={diffMarkerStyle}
      draft={null}
      file={file}
      intralineByLineId={intralineByLineId}
      pending={false}
      readOnly
      scope="unstaged"
      syntaxThemeId={syntaxThemeId}
      wrapLines={wrapLines}
      onApplyOperation={NOOP_OPERATION}
      onCancelDraft={NOOP}
      onCreateDraft={NOOP_DRAFT}
      onDeleteComment={NOOP}
      onResolveComment={NOOP}
      onSaveDraft={NOOP}
    />
  )
}

export function ReviewDiffReadOnlyInline({
  file,
  diffMarkerStyle,
  syntaxThemeId,
  showWordDiff,
  wrapLines,
  ariaLabel,
}: ReviewDiffReadOnlyInlineProps): React.ReactNode {
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
  )

  return (
    <ReviewDiffInline
      ariaLabel={ariaLabel}
      attachedComments={EMPTY_COMMENTS}
      diffMarkerStyle={diffMarkerStyle}
      draft={null}
      file={file}
      intralineByLineId={intralineByLineId}
      pending={false}
      readOnly
      scope="unstaged"
      syntaxThemeId={syntaxThemeId}
      wrapLines={wrapLines}
      onApplyOperation={NOOP_OPERATION}
      onCancelDraft={NOOP}
      onCreateDraft={NOOP_DRAFT}
      onDeleteComment={NOOP}
      onResolveComment={NOOP}
      onSaveDraft={NOOP}
    />
  )
}

export function ReviewDiffInline({
  ariaLabel,
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  intralineByLineId,
  pending,
  scope,
  syntaxThemeId,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
  mutationsDisabled = false,
  readOnly = false,
}: ReviewDiffBodyProps & {
  ariaLabel?: string
  mutationsDisabled?: boolean
  readOnly?: boolean
}): React.ReactNode {
  const rows = buildUnifiedDiffRows(file)
  const syntax = useReviewDiffSyntax(file, syntaxThemeId)
  return (
    <pre
      aria-label={ariaLabel}
      className="review-codex-diff"
      data-diff=""
      data-diff-type="single"
      data-indicators={diffMarkerStyle === 'symbol' ? 'classic' : 'bars'}
      data-overflow={wrapLines ? 'wrap' : 'scroll'}
      data-review-syntax-state={syntax.state}
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        pane="unified"
        pending={pending}
        mutationsDisabled={mutationsDisabled}
        readOnly={readOnly}
        rows={rows}
        scope={scope}
        syntaxByLineId={syntax.byLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    </pre>
  )
}

export function ReviewDiffSplit({
  ariaLabel,
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  intralineByLineId,
  pending,
  mutationsDisabled = false,
  readOnly = false,
  scope,
  syntaxThemeId,
  wrapLines,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: ReviewDiffBodyProps & {
  ariaLabel?: string
  mutationsDisabled?: boolean
  readOnly?: boolean
}): React.ReactNode {
  const { leftRows, rightRows } = React.useMemo(() => buildSplitDiffRows(file), [file])
  const syntax = useReviewDiffSyntax(file, syntaxThemeId)
  const rowSpan = Math.max(leftRows.length, 1)

  return (
    <pre
      aria-label={ariaLabel}
      className="review-codex-diff"
      data-diff=""
      data-diff-type="split"
      data-indicators={diffMarkerStyle === 'symbol' ? 'classic' : 'bars'}
      data-overflow={wrapLines ? 'wrap' : 'scroll'}
      data-review-syntax-state={syntax.state}
      style={
        {
          '--review-diff-row-count': rowSpan,
        } as React.CSSProperties
      }
    >
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        pane="deletions"
        pending={pending}
        mutationsDisabled={mutationsDisabled}
        readOnly={readOnly}
        rows={leftRows}
        scope={scope}
        syntaxByLineId={syntax.byLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
      <ReviewDiffCodePane
        attachedComments={attachedComments}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        pane="additions"
        pending={pending}
        mutationsDisabled={mutationsDisabled}
        readOnly={readOnly}
        rows={rightRows}
        scope={scope}
        syntaxByLineId={syntax.byLineId}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    </pre>
  )
}

export function ReviewDiffCodePane({
  attachedComments,
  draft,
  file,
  intralineByLineId,
  pane,
  pending,
  mutationsDisabled = false,
  readOnly = false,
  rows,
  scope,
  syntaxByLineId,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: Omit<ReviewDiffBodyProps, 'diffMarkerStyle' | 'syntaxThemeId' | 'wrapLines'> & {
  pane: 'unified' | 'deletions' | 'additions'
  mutationsDisabled?: boolean
  readOnly?: boolean
  rows: DiffPaneRow[]
  syntaxByLineId: ReviewSyntaxByLineId
}): React.ReactNode {
  const rowSpan = Math.max(rows.length, 1)
  const columnStyle = {
    gridRow: `1 / span ${rowSpan}`,
  } as React.CSSProperties

  return (
    <code
      className="review-codex-diff__code"
      data-code=""
      data-unified={pane === 'unified' ? '' : undefined}
      data-deletions={pane === 'deletions' ? '' : undefined}
      data-additions={pane === 'additions' ? '' : undefined}
      style={
        {
          '--review-diff-row-count': rowSpan,
        } as React.CSSProperties
      }
    >
      <div className="review-codex-diff__gutter" data-gutter="" style={columnStyle}>
        {rows.map((row) => {
          if (row.kind === 'hunk') {
            return (
              <div
                className="review-codex-diff__hunk review-codex-diff__hunk--gutter"
                data-separator="line-info"
                key={`gutter-${row.id}`}
              />
            )
          }

          const { cell } = row
          const anchor = buildAnchor(file.path, cell.side, cell.number, cell.content)
          return (
            <ReviewDiffLineNumber
              anchor={anchor}
              cellTone={cell.tone}
              key={`gutter-${row.id}`}
              lineNumber={cell.number}
              readOnly={readOnly}
              onCreateDraft={onCreateDraft}
            />
          )
        })}
      </div>

      <div className="review-codex-diff__content" data-content="" style={columnStyle}>
        {rows.map((row) => {
          if (row.kind === 'hunk') {
            return (
              <div
                className="review-codex-diff__hunk review-codex-diff__hunk--content"
                data-separator="line-info"
                key={`content-${row.id}`}
              >
                <div data-separator-wrapper="">
                  <span data-separator-content="">
                    {formatUnmodifiedLines(row.unmodifiedLines)}
                  </span>
                  {readOnly || mutationsDisabled || pane === 'additions' ? null : (
                    <ReviewHunkActions
                      file={file}
                      hunk={row.hunk}
                      pending={pending}
                      scope={scope}
                      onApplyOperation={onApplyOperation}
                    />
                  )}
                </div>
              </div>
            )
          }

          const { cell } = row
          const anchor = buildAnchor(file.path, cell.side, cell.number, cell.content)
          const comments =
            !readOnly && anchor ? (attachedComments.get(commentKey(anchor)) ?? []) : []
          return (
            <ReviewDiffLineContent
              anchor={anchor}
              cellTone={cell.tone}
              comments={comments}
              draft={readOnly ? null : draft}
              key={`content-${row.id}`}
              readOnly={readOnly}
              onCancelDraft={onCancelDraft}
              onDeleteComment={onDeleteComment}
              onResolveComment={onResolveComment}
              onSaveDraft={onSaveDraft}
            >
              <span className="review-codex-diff__line-text">
                {cell.tone === 'empty' ? (
                  ' '
                ) : (
                  <ReviewSyntaxText
                    content={cell.content}
                    line={cell.line}
                    ranges={cell.line ? intralineByLineId.get(cell.line.id) : undefined}
                    syntaxByLineId={syntaxByLineId}
                  />
                )}
              </span>
            </ReviewDiffLineContent>
          )
        })}
      </div>
    </code>
  )
}

export function ReviewDiffLineNumber({
  anchor,
  cellTone,
  lineNumber,
  readOnly = false,
  onCreateDraft,
}: {
  anchor: CommentAnchor | null
  cellTone: ReviewCell['tone']
  lineNumber: number | null
  readOnly?: boolean
  onCreateDraft: (draft: CommentDraft) => void
}): React.ReactNode {
  return (
    <div
      className="review-codex-diff__number tw:group/line-number"
      data-column-number={lineNumber ?? ''}
      data-line-type={diffLineType(cellTone)}
    >
      {readOnly ? null : (
        <LineCommentButton anchor={anchor} disabled={!anchor} onCreateDraft={onCreateDraft} />
      )}
      <span data-line-number-content="">{lineNumber ?? ''}</span>
    </div>
  )
}

export function ReviewDiffLineContent({
  anchor,
  cellTone,
  children,
  comments,
  draft,
  readOnly = false,
  onCancelDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  anchor: CommentAnchor | null
  cellTone: ReviewCell['tone']
  children: React.ReactNode
  comments: DesktopReviewComment[]
  draft: CommentDraft | null
  readOnly?: boolean
  onCancelDraft: () => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  return (
    <div className="review-codex-diff__line" data-line="" data-line-type={diffLineType(cellTone)}>
      {children}
      {readOnly ? null : (
        <LineComments
          comments={comments}
          draft={draft}
          anchor={anchor}
          onCancelDraft={onCancelDraft}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          onSaveDraft={onSaveDraft}
        />
      )}
    </div>
  )
}

export function buildUnifiedDiffRows(file: DesktopReviewDiffFile): DiffPaneRow[] {
  const rows: DiffPaneRow[] = []
  let previousHunk: DesktopReviewDiffHunk | null = null
  for (const hunk of file.hunks) {
    rows.push({
      id: `hunk:${hunk.id}`,
      kind: 'hunk',
      hunk,
      unmodifiedLines: countUnmodifiedLinesBeforeHunk(hunk, previousHunk),
    })
    for (const line of hunk.lines) {
      const side = line.type === 'removed' ? 'left' : 'right'
      rows.push({
        id: `line:${line.id}`,
        kind: 'line',
        cell: {
          line,
          side,
          number: line.type === 'removed' ? line.oldLine : line.newLine,
          content: line.content,
          tone: line.type,
        },
      })
    }
    previousHunk = hunk
  }
  return rows
}

export function useReviewDiffSyntax(
  file: DesktopReviewDiffFile,
  syntaxThemeId?: string,
): ReviewDiffSyntax {
  const { activeTheme, codeThemeId } = useDesktopTheme()
  const requestedThemeId = syntaxThemeId ?? codeThemeId
  const requestedThemeVariant =
    HIGHLIGHT_THEMES.find((candidate) => candidate.slug === requestedThemeId)?.variant ??
    activeTheme.variant
  const theme = resolveThemeId(requestedThemeId, requestedThemeVariant)
  const language = normalizeSyntaxLanguage(resolveLanguageFromPath(file.path))
  const lines = React.useMemo(() => file.hunks.flatMap((hunk) => hunk.lines), [file.hunks])
  const code = React.useMemo(() => lines.map((line) => line.content).join('\n'), [lines])
  const presentation = useHighlightedCode({
    code,
    language,
    theme,
  })

  return React.useMemo(() => {
    const highlighted = presentation.highlighted
    const matchesRequest =
      highlighted?.code === code &&
      highlighted.requestedLanguage === language &&
      highlighted.requestedTheme === theme
    if (!highlighted || !matchesRequest) {
      return {
        byLineId: new Map<string, readonly SyntaxToken[]>(),
        state: 'loading',
      }
    }

    const byLineId = new Map<string, readonly SyntaxToken[]>()
    for (const [index, line] of lines.entries()) {
      const lineTokens = highlighted.tokens[index] ?? []
      if (lineTokens.map((token) => token.content).join('') === line.content) {
        byLineId.set(line.id, lineTokens)
      }
    }
    return {
      byLineId,
      state: highlighted.language === 'text' ? 'plain' : 'ready',
    }
  }, [code, language, lines, presentation.highlighted, theme])
}

export function ReviewSyntaxText({
  content,
  line,
  ranges,
  syntaxByLineId,
}: {
  content: string
  line: DesktopReviewDiffLine | null
  ranges?: readonly ReviewIntralineRange[]
  syntaxByLineId: ReviewSyntaxByLineId
}): React.ReactNode {
  const tokens = line ? syntaxByLineId.get(line.id) : undefined
  const syntaxTokens =
    tokens?.length && tokens.map((token) => token.content).join('') === content ? tokens : undefined
  const validRanges = normalizeReviewIntralineRanges(ranges, content.length)
  if (validRanges.length === 0) {
    if (!syntaxTokens) return content || ' '

    return syntaxTokens.map((token, index) => (
      <span key={`${line?.id ?? 'line'}:${index}`} style={syntaxTokenStyle(token)}>
        {token.content}
      </span>
    ))
  }

  const segments: React.ReactNode[] = []
  let offset = 0
  const sourceSegments = syntaxTokens ?? [{ content }]

  for (const [tokenIndex, token] of sourceSegments.entries()) {
    const tokenStart = offset
    const tokenEnd = tokenStart + token.content.length
    offset = tokenEnd
    const boundaries = new Set([tokenStart, tokenEnd])
    for (const range of validRanges) {
      if (range.start > tokenStart && range.start < tokenEnd) {
        boundaries.add(range.start)
      }
      if (range.end > tokenStart && range.end < tokenEnd) {
        boundaries.add(range.end)
      }
    }
    const sortedBoundaries = [...boundaries].sort((left, right) => left - right)
    for (let index = 0; index < sortedBoundaries.length - 1; index++) {
      const start = sortedBoundaries[index] ?? tokenStart
      const end = sortedBoundaries[index + 1] ?? tokenEnd
      if (end <= start) continue
      const tone = validRanges.find((range) => start < range.end && end > range.start)?.tone
      segments.push(
        <span
          className={tone ? 'review-diff-word' : undefined}
          data-tone={tone}
          key={`${line?.id ?? 'line'}:${tokenIndex}:${start}`}
          style={syntaxTokens ? syntaxTokenStyle(token as SyntaxToken) : undefined}
        >
          {token.content.slice(start - tokenStart, end - tokenStart)}
        </span>,
      )
    }
  }

  return segments.length > 0 ? segments : content || ' '
}

export function normalizeReviewIntralineRanges(
  ranges: readonly ReviewIntralineRange[] | undefined,
  contentLength: number,
): ReviewIntralineRange[] {
  if (!ranges || contentLength <= 0) return []
  return ranges
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(contentLength, range.start)),
      end: Math.max(0, Math.min(contentLength, range.end)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

export function buildSplitDiffRows(file: DesktopReviewDiffFile): {
  leftRows: DiffPaneRow[]
  rightRows: DiffPaneRow[]
} {
  const leftRows: DiffPaneRow[] = []
  const rightRows: DiffPaneRow[] = []
  let previousHunk: DesktopReviewDiffHunk | null = null
  for (const hunk of file.hunks) {
    const hunkId = `hunk:${hunk.id}`
    const unmodifiedLines = countUnmodifiedLinesBeforeHunk(hunk, previousHunk)
    leftRows.push({
      id: hunkId,
      kind: 'hunk',
      hunk,
      unmodifiedLines,
    })
    rightRows.push({
      id: hunkId,
      kind: 'hunk',
      hunk,
      unmodifiedLines,
    })
    for (const row of splitDiffLines(hunk.lines)) {
      const rowId = `line:${row.id}`
      leftRows.push({ id: rowId, kind: 'line', cell: row.left })
      rightRows.push({ id: rowId, kind: 'line', cell: row.right })
    }
    previousHunk = hunk
  }
  return { leftRows, rightRows }
}

export function diffLineType(cell: ReviewCell['tone']): string {
  if (cell === 'added') return 'change-addition'
  if (cell === 'removed') return 'change-deletion'
  if (cell === 'empty') return 'buffer'
  if (cell === 'meta') return 'metadata'
  return 'context'
}

export function ReviewHunkActions({
  file,
  hunk,
  pending,
  scope,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile
  hunk: DesktopReviewDiffHunk
  pending: boolean
  scope: DesktopReviewScope
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'hunk'; path: string; hunkId: string },
  ) => void
}): React.ReactNode {
  return (
    <div
      className="review-hunk-actions tw:hidden tw:items-center tw:gap-2 tw:px-2 tw:py-1"
      role="toolbar"
      aria-label="Hunk 操作"
    >
      {scope === 'unstaged' ? (
        <>
          <Button
            size="compact"
            disabled={pending}
            type="button"
            onClick={() =>
              onApplyOperation('stage', {
                type: 'hunk',
                path: file.path,
                hunkId: hunk.id,
              })
            }
          >
            暂存 hunk
          </Button>
          <Button
            size="compact"
            disabled={pending}
            type="button"
            onClick={() =>
              onApplyOperation('revert', {
                type: 'hunk',
                path: file.path,
                hunkId: hunk.id,
              })
            }
          >
            还原
          </Button>
        </>
      ) : (
        <Button
          size="compact"
          disabled={pending}
          type="button"
          onClick={() =>
            onApplyOperation('unstage', {
              type: 'hunk',
              path: file.path,
              hunkId: hunk.id,
            })
          }
        >
          取消暂存
        </Button>
      )}
    </div>
  )
}

export function LineCommentButton({
  anchor,
  disabled,
  onCreateDraft,
}: {
  anchor: CommentAnchor | null
  disabled: boolean
  onCreateDraft: (draft: CommentDraft) => void
}): React.ReactNode {
  return (
    <button
      aria-label="添加行内评论"
      className="review-line-comment-button tw:absolute tw:top-0 tw:right-0 tw:z-4 tw:inline-flex tw:size-5 tw:min-w-5 tw:items-center tw:justify-center tw:rounded-md tw:bg-app-accent tw:text-app-canvas tw:opacity-0 tw:group-hover/line-number:opacity-100 tw:group-focus-within/line-number:opacity-100"
      disabled={disabled || !anchor}
      type="button"
      onClick={() => {
        if (!anchor) return
        onCreateDraft({ ...anchor, body: '' })
      }}
    >
      <MessageSquarePlus className="tw:size-icon-sm" size={APP_ICON_SIZE} />
    </button>
  )
}

export function LineComments({
  anchor,
  comments,
  draft,
  onCancelDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  anchor: CommentAnchor | null
  comments: DesktopReviewComment[]
  draft: CommentDraft | null
  onCancelDraft: () => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  const draftMatches = anchor && draft ? commentKey(anchor) === commentKey(draft) : false
  if (comments.length === 0 && !draftMatches) return null
  return (
    <div className="review-line-comments tw:col-span-full tw:flex tw:flex-col tw:gap-2 tw:whitespace-normal">
      {comments.map((comment) => (
        <ReviewComment
          comment={comment}
          key={comment.id}
          onDelete={() => onDeleteComment(comment.id)}
          onResolve={() => onResolveComment(comment.id)}
        />
      ))}
      {draftMatches ? (
        <CommentDraftEditor
          initialBody={draft?.body ?? ''}
          key={draft ? commentKey(draft) : 'draft'}
          onCancel={onCancelDraft}
          onSave={onSaveDraft}
        />
      ) : null}
    </div>
  )
}

function CommentDraftEditor({
  initialBody,
  onCancel,
  onSave,
}: {
  initialBody: string
  onCancel: () => void
  onSave: (body: string) => void
}): React.ReactNode {
  const [body, setBody] = React.useState(initialBody)
  return (
    <div className="review-comment draft tw:flex tw:flex-col tw:gap-1 tw:p-2 tw:border tw:border-app-border-subtle tw:rounded-lg tw:bg-app-raised tw:text-app-text tw:type-reading tw:shadow-none">
      <textarea
        autoFocus
        className="tw:w-full tw:min-h-[5.385em] tw:resize-y tw:px-2 tw:py-1 tw:border tw:border-app-border-subtle tw:rounded-md tw:bg-app-canvas tw:text-app-text tw:type-reading"
        placeholder="写下这行的问题或修改建议"
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="review-comment-actions tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
        <Button size="compact" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button size="compact" disabled={!body.trim()} type="button" onClick={() => onSave(body)}>
          保存
        </Button>
      </div>
    </div>
  )
}

export function ReviewComment({
  comment,
  stale = false,
  onDelete,
  onResolve,
}: {
  comment: DesktopReviewComment
  stale?: boolean
  onDelete: () => void
  onResolve: () => void
}): React.ReactNode {
  return (
    <div
      className={cx(
        'review-comment tw:flex tw:flex-col tw:gap-1 tw:p-2 tw:border tw:border-app-border-subtle tw:rounded-lg tw:bg-app-raised tw:text-app-text tw:type-reading tw:shadow-none',
        comment.status === 'resolved' ? 'resolved tw:opacity-68' : 'open',
        stale && 'stale tw:border-dashed',
      )}
    >
      <div className="review-comment-meta tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
        <span>
          {comment.filePath}:{comment.lineNumber}
        </span>
        <span>{comment.side === 'left' ? '旧行' : '新行'}</span>
      </div>
      <div className="review-comment-body tw:text-app-text tw:type-reading tw:whitespace-pre-wrap">
        {comment.body}
      </div>
      <div className="review-comment-actions tw:flex tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
        {comment.status === 'open' ? (
          <Button size="compact" type="button" onClick={onResolve}>
            <CheckCircle2 size={APP_ICON_SIZES.sm} />
            解决
          </Button>
        ) : null}
        <Button size="compact" color="danger" type="button" onClick={onDelete}>
          <Trash2 size={APP_ICON_SIZES.sm} />
          删除
        </Button>
      </div>
    </div>
  )
}

export function splitDiffLines(lines: DesktopReviewDiffLine[]): ReviewSplitRow[] {
  return alignReviewDiffLines(lines).map((alignment) => {
    if (alignment.kind === 'unchanged') {
      const { line } = alignment
      return {
        id: line.id,
        left: reviewCellFromLine(line, 'left'),
        right: reviewCellFromLine(line, 'right'),
        paired: true,
      }
    }

    const { added, removed } = alignment
    return {
      id:
        removed && added
          ? `${removed.id}-${added.id}`
          : (removed?.id ?? added?.id ?? 'empty-change'),
      left: removed ? reviewCellFromLine(removed, 'left') : emptyCell('left'),
      right: added ? reviewCellFromLine(added, 'right') : emptyCell('right'),
      paired: Boolean(removed && added),
    }
  })
}

export function reviewCellFromLine(
  line: DesktopReviewDiffLine,
  side: DesktopReviewSide,
): ReviewCell {
  return {
    line,
    side,
    number: side === 'left' ? line.oldLine : line.newLine,
    content: line.content,
    tone: line.type,
  }
}

export function emptyCell(side: DesktopReviewSide): ReviewCell {
  return {
    line: null,
    side,
    number: null,
    content: '',
    tone: 'empty',
  }
}

export function countUnmodifiedLinesBeforeHunk(
  hunk: DesktopReviewDiffHunk,
  previousHunk: DesktopReviewDiffHunk | null,
): number {
  const previousOldEnd = previousHunk ? previousHunk.oldStart + previousHunk.oldLines : 1
  const previousNewEnd = previousHunk ? previousHunk.newStart + previousHunk.newLines : 1
  return Math.max(0, Math.min(hunk.oldStart - previousOldEnd, hunk.newStart - previousNewEnd))
}

export function formatUnmodifiedLines(count: number): string {
  return `${count.toLocaleString('en-US')} unmodified ${count === 1 ? 'line' : 'lines'}`
}

export function buildAnchor(
  filePath: string,
  side: DesktopReviewSide,
  lineNumber: number | null,
  lineContent: string,
): CommentAnchor | null {
  if (lineNumber === null) return null
  return { filePath, side, lineNumber, lineContent }
}

export function commentKey(anchor: CommentAnchor): string {
  return `${anchor.filePath}\u0000${anchor.side}\u0000${anchor.lineNumber}\u0000${anchor.lineContent}`
}
