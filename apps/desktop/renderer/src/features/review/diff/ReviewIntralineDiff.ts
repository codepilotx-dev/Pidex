import { diffWordsWithSpace } from 'diff'
import type { DesktopReviewDiffHunk, DesktopReviewDiffLine } from '../../../../shared/Types.js'

export type ReviewIntralineRange = {
  start: number
  end: number
  tone: 'added' | 'removed'
}

export type ReviewIntralineByLineId = ReadonlyMap<string, readonly ReviewIntralineRange[]>

export type ReviewDiffLineAlignment =
  | {
      kind: 'change'
      removed: DesktopReviewDiffLine | null
      added: DesktopReviewDiffLine | null
    }
  | {
      kind: 'unchanged'
      line: DesktopReviewDiffLine
    }

export type ReviewIntralineOptions = {
  enabled?: boolean
  maxLineLength?: number
  maxEditLength?: number
}

const DEFAULT_MAX_LINE_LENGTH = 10_000
const DEFAULT_MAX_EDIT_LENGTH = 512

/**
 * Aligns each contiguous change block by relative index. Context and meta lines
 * remain individual entries and delimit change blocks.
 */
export function alignReviewDiffLines(
  lines: readonly DesktopReviewDiffLine[],
): ReviewDiffLineAlignment[] {
  const alignments: ReviewDiffLineAlignment[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line) {
      index += 1
      continue
    }

    if (line.type !== 'added' && line.type !== 'removed') {
      alignments.push({ kind: 'unchanged', line })
      index += 1
      continue
    }

    const removed: DesktopReviewDiffLine[] = []
    const added: DesktopReviewDiffLine[] = []
    while (index < lines.length) {
      const changedLine = lines[index]
      if (!changedLine || (changedLine.type !== 'added' && changedLine.type !== 'removed')) {
        break
      }
      if (changedLine.type === 'removed') {
        removed.push(changedLine)
      } else {
        added.push(changedLine)
      }
      index += 1
    }

    const pairCount = Math.max(removed.length, added.length)
    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      alignments.push({
        kind: 'change',
        removed: removed[pairIndex] ?? null,
        added: added[pairIndex] ?? null,
      })
    }
  }

  return alignments
}

/**
 * Derives UTF-16 string ranges for paired removed/added lines. Missing,
 * excessively long, or algorithmically expensive pairs intentionally produce
 * no entry so renderers can fall back to line-level highlighting.
 */
export function buildReviewIntralineByLineId(
  hunks: readonly Pick<DesktopReviewDiffHunk, 'lines'>[],
  options: ReviewIntralineOptions = {},
): ReviewIntralineByLineId {
  if (options.enabled === false) {
    return new Map()
  }

  const maxLineLength = normalizePositiveLimit(options.maxLineLength, DEFAULT_MAX_LINE_LENGTH)
  const maxEditLength = normalizePositiveLimit(options.maxEditLength, DEFAULT_MAX_EDIT_LENGTH)
  const rangesByLineId = new Map<string, readonly ReviewIntralineRange[]>()

  for (const hunk of hunks) {
    for (const alignment of alignReviewDiffLines(hunk.lines)) {
      if (alignment.kind !== 'change' || !alignment.removed || !alignment.added) {
        continue
      }

      const removedContent = alignment.removed.content
      const addedContent = alignment.added.content
      if (removedContent.length > maxLineLength || addedContent.length > maxLineLength) {
        continue
      }

      const changes = diffWordsWithSpace(removedContent, addedContent, {
        maxEditLength,
      })
      if (!changes) {
        continue
      }

      const removedRanges: ReviewIntralineRange[] = []
      const addedRanges: ReviewIntralineRange[] = []
      let removedOffset = 0
      let addedOffset = 0

      for (const change of changes) {
        const length = change.value.length
        if (change.removed) {
          appendRange(removedRanges, {
            start: removedOffset,
            end: removedOffset + length,
            tone: 'removed',
          })
          removedOffset += length
          continue
        }
        if (change.added) {
          appendRange(addedRanges, {
            start: addedOffset,
            end: addedOffset + length,
            tone: 'added',
          })
          addedOffset += length
          continue
        }
        removedOffset += length
        addedOffset += length
      }

      if (removedOffset !== removedContent.length || addedOffset !== addedContent.length) {
        continue
      }
      if (removedRanges.length > 0) {
        rangesByLineId.set(alignment.removed.id, removedRanges)
      }
      if (addedRanges.length > 0) {
        rangesByLineId.set(alignment.added.id, addedRanges)
      }
    }
  }

  return rangesByLineId
}

function appendRange(ranges: ReviewIntralineRange[], range: ReviewIntralineRange): void {
  if (range.end <= range.start) {
    return
  }
  const previous = ranges.at(-1)
  if (previous && previous.end === range.start && previous.tone === range.tone) {
    previous.end = range.end
    return
  }
  ranges.push(range)
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}
