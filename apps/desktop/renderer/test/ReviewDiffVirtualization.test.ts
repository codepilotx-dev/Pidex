import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'
import {
  countReviewDiffLines,
  ReviewDiffFilePreview,
  shouldVirtualizeReviewFile,
} from '../src/features/review/diff/WorkspaceReviewDiff.js'
import type { DesktopReviewDiffFile, DesktopReviewDiffLine } from '../shared/Types.js'

describe('review diff virtualization', () => {
  test('小文件不启用文件内虚拟化', () => {
    const file = reviewFile('src/small.ts', 80)

    expect(countReviewDiffLines([file])).toBe(80)
    expect(shouldVirtualizeReviewFile(file)).toBe(false)
  })

  test('单个文件超过 800 行时启用文件内虚拟化', () => {
    const file = reviewFile('src/large.ts', 801)

    expect(countReviewDiffLines([file])).toBe(801)
    expect(shouldVirtualizeReviewFile(file)).toBe(true)
  })

  test('多个小文件累计超过 800 行不改变各文件判定', () => {
    const files = [
      reviewFile('src/first.ts', 300),
      reviewFile('src/second.ts', 300),
      reviewFile('src/third.ts', 300),
    ]

    expect(countReviewDiffLines(files)).toBe(900)
    expect(files.map(shouldVirtualizeReviewFile)).toEqual([false, false, false])
  })

  test('文件摘要 disclosure 与文件操作保持 sibling', () => {
    const file = reviewFile('src/example.ts', 1)
    const disclosureStore = createKeyedDisclosureStore({
      initialExpandedKeys: [file.path],
    })
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ReviewDiffFilePreview, {
          active: false,
          attachedComments: new Map(),
          disclosureStore,
          diffMarkerStyle: 'color',
          draft: null,
          file,
          fileLoadState: { status: 'loaded' },
          largeWorkspaceMode: false,
          pending: false,
          previewHeight: 100,
          renderBody: false,
          scope: 'unstaged',
          sectionRef: () => {},
          showWordDiff: false,
          summaryLoadState: 'success',
          view: 'inline',
          workspacePath: null,
          wrapLines: false,
          onApplyOperation: () => {},
          onCancelDraft: () => {},
          onCreateDraft: () => {},
          onDeleteComment: () => {},
          onDiffExpandedChange: () => {},
          onResolveComment: () => {},
          onRetryFile: () => {},
          onSaveDraft: () => {},
        }),
      ),
    )
    const summaryStart = html.indexOf('class="review-file-summary')
    const summaryTagStart = html.lastIndexOf('<button', summaryStart)
    const summaryTagEnd = html.indexOf('>', summaryStart)
    const summaryEnd = html.indexOf('</button>', summaryStart)
    const actionsStart = html.indexOf('class="review-file-actions review-file-actions-primary')
    const controls = html
      .slice(summaryTagStart, summaryTagEnd)
      .match(/aria-controls="([^"]+)"/)?.[1]

    expect(summaryStart).toBeGreaterThan(-1)
    expect(summaryEnd).toBeGreaterThan(summaryStart)
    expect(actionsStart).toBeGreaterThan(summaryEnd)
    expect(html).not.toContain('class="review-file-row preview-header" role="button"')
    expect(html).toContain('aria-expanded="true"')
    expect(controls).toBeTruthy()
    expect(html).toContain(`class="review-diff-file-body tw:contents" id="${controls}"`)
  })
})

function reviewFile(path: string, lineCount: number): DesktopReviewDiffFile {
  return {
    path,
    status: 'modified',
    additions: 0,
    deletions: 0,
    isUntracked: false,
    hunks: [
      {
        id: `${path}:hunk`,
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldLines: lineCount,
        newStart: 1,
        newLines: lineCount,
        patch: '',
        lines: Array.from({ length: lineCount }, (_, index) => reviewLine(path, index)),
      },
    ],
  }
}

function reviewLine(path: string, index: number): DesktopReviewDiffLine {
  const lineNumber = index + 1
  const content = `line ${lineNumber}`
  return {
    id: `${path}:${lineNumber}`,
    type: 'context',
    oldLine: lineNumber,
    newLine: lineNumber,
    content,
    raw: ` ${content}`,
  }
}
