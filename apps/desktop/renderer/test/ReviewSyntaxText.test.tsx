import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ReviewSyntaxText,
  type ReviewSyntaxByLineId,
} from '../src/features/review/diff/ReviewDiffSurface.js'
import type { DesktopReviewDiffLine } from '../shared/Types.js'

const line: DesktopReviewDiffLine = {
  id: 'syntax-line',
  type: 'added',
  oldLine: null,
  newLine: 1,
  content: 'const value = true',
  raw: '+const value = true',
}

describe('ReviewSyntaxText', () => {
  test('保留与当前行内容匹配的语法 token', () => {
    const syntaxByLineId: ReviewSyntaxByLineId = new Map([
      [
        line.id,
        [
          { content: 'const', color: '#ff79c6' },
          { content: ' value = ', color: '#f8f8f2' },
          { content: 'true', color: '#50fa7b' },
        ],
      ],
    ])

    const html = renderToStaticMarkup(
      <ReviewSyntaxText content={line.content} line={line} syntaxByLineId={syntaxByLineId} />,
    )

    expect(html).toContain('color:#ff79c6')
    expect(html).toContain('color:#50fa7b')
  })

  test('token 内容与当前行不匹配时仅回退该行纯文本', () => {
    const syntaxByLineId: ReviewSyntaxByLineId = new Map([
      [line.id, [{ content: 'stale value', color: '#ff79c6' }]],
    ])

    const html = renderToStaticMarkup(
      <ReviewSyntaxText content={line.content} line={line} syntaxByLineId={syntaxByLineId} />,
    )

    expect(html).toBe('const value = true')
    expect(html).not.toContain('#ff79c6')
  })

  test('行内差异范围与语法 token 同时生效', () => {
    const syntaxByLineId: ReviewSyntaxByLineId = new Map([
      [
        line.id,
        [
          { content: 'const', color: '#ff79c6' },
          { content: ' value = ', color: '#f8f8f2' },
          { content: 'true', color: '#50fa7b' },
        ],
      ],
    ])

    const html = renderToStaticMarkup(
      <ReviewSyntaxText
        content={line.content}
        line={line}
        ranges={[{ start: 14, end: 18, tone: 'added' }]}
        syntaxByLineId={syntaxByLineId}
      />,
    )

    expect(html).toContain('class="review-diff-word"')
    expect(html).toContain('data-tone="added"')
    expect(html).toContain('color:#50fa7b')
  })
})
