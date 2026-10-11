import { describe, expect, test } from 'bun:test'
import {
  alignReviewDiffLines,
  buildReviewIntralineByLineId,
  type ReviewIntralineByLineId,
} from '../src/features/review/diff/ReviewIntralineDiff.js'
import type {
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewLineType,
} from '../shared/Types.js'

describe('review intraline diff', () => {
  test('计算单行替换的新旧范围', () => {
    const removed = line('r1', 'removed', 'const selected = oldValue;')
    const added = line('a1', 'added', 'const selected = newValue;')
    const ranges = buildReviewIntralineByLineId([hunk([removed, added])])

    expect(changedText(ranges, removed)).toBe('oldValue')
    expect(changedText(ranges, added)).toBe('newValue')
    expect(ranges.get(removed.id)?.[0]?.tone).toBe('removed')
    expect(ranges.get(added.id)?.[0]?.tone).toBe('added')
  })

  test('连续多删多增块按相对索引配对', () => {
    const removedOne = line('r1', 'removed', 'first old')
    const removedTwo = line('r2', 'removed', 'second before')
    const addedOne = line('a1', 'added', 'first new')
    const addedTwo = line('a2', 'added', 'second after')
    const context = line('c1', 'context', 'unchanged')
    const alignments = alignReviewDiffLines([removedOne, removedTwo, addedOne, addedTwo, context])

    expect(alignments).toEqual([
      { kind: 'change', removed: removedOne, added: addedOne },
      { kind: 'change', removed: removedTwo, added: addedTwo },
      { kind: 'unchanged', line: context },
    ])

    const ranges = buildReviewIntralineByLineId([
      hunk([removedOne, removedTwo, addedOne, addedTwo, context]),
    ])
    expect(changedText(ranges, removedOne)).toBe('old')
    expect(changedText(ranges, addedOne)).toBe('new')
    expect(changedText(ranges, removedTwo)).toBe('before')
    expect(changedText(ranges, addedTwo)).toBe('after')
  })

  test('不对称或单侧变更只保留整行高亮', () => {
    const removedOne = line('r1', 'removed', 'paired old')
    const removedOnly = line('r2', 'removed', 'removed only')
    const addedOne = line('a1', 'added', 'paired new')
    const addedOnly = line('a2', 'added', 'added only')

    const asymmetric = alignReviewDiffLines([removedOne, removedOnly, addedOne])
    expect(asymmetric).toEqual([
      { kind: 'change', removed: removedOne, added: addedOne },
      { kind: 'change', removed: removedOnly, added: null },
    ])

    const ranges = buildReviewIntralineByLineId([
      hunk([removedOne, removedOnly, addedOne]),
      hunk([addedOnly]),
    ])
    expect(ranges.has(removedOne.id)).toBe(true)
    expect(ranges.has(addedOne.id)).toBe(true)
    expect(ranges.has(removedOnly.id)).toBe(false)
    expect(ranges.has(addedOnly.id)).toBe(false)
  })

  test('保留空白、标点和中文的精确字符范围', () => {
    const whitespaceRemoved = line('wr', 'removed', 'call(foo,  bar);')
    const whitespaceAdded = line('wa', 'added', 'call(foo, baz);')
    const chineseRemoved = line('cr', 'removed', '你好，世界！')
    const chineseAdded = line('ca', 'added', '你好，主题！')
    const ranges = buildReviewIntralineByLineId([
      hunk([whitespaceRemoved, whitespaceAdded]),
      hunk([chineseRemoved, chineseAdded]),
    ])

    expect(changedText(ranges, whitespaceRemoved)).toBe('  bar')
    expect(changedText(ranges, whitespaceAdded)).toBe(' baz')
    expect(changedText(ranges, chineseRemoved)).toBe('世界')
    expect(changedText(ranges, chineseAdded)).toBe('主题')
  })

  test('长行和超过编辑距离上限时安全退化', () => {
    const longRemoved = line('lr', 'removed', 'prefix old suffix')
    const longAdded = line('la', 'added', 'prefix new suffix')
    const expensiveRemoved = line('er', 'removed', 'one two three four')
    const expensiveAdded = line('ea', 'added', 'five six seven eight')

    const longRanges = buildReviewIntralineByLineId([hunk([longRemoved, longAdded])], {
      maxLineLength: 8,
    })
    const expensiveRanges = buildReviewIntralineByLineId(
      [hunk([expensiveRemoved, expensiveAdded])],
      { maxEditLength: 1 },
    )

    expect(longRanges.size).toBe(0)
    expect(expensiveRanges.size).toBe(0)
  })

  test('关闭文字差异时不生成任何局部范围', () => {
    const ranges = buildReviewIntralineByLineId(
      [hunk([line('r1', 'removed', 'old'), line('a1', 'added', 'new')])],
      { enabled: false },
    )

    expect(ranges.size).toBe(0)
  })
})

function line(id: string, type: DesktopReviewLineType, content: string): DesktopReviewDiffLine {
  return {
    id,
    type,
    oldLine: type === 'added' ? null : 1,
    newLine: type === 'removed' ? null : 1,
    content,
    raw: content,
  }
}

function hunk(lines: DesktopReviewDiffLine[]): Pick<DesktopReviewDiffHunk, 'lines'> {
  return { lines }
}

function changedText(ranges: ReviewIntralineByLineId, diffLine: DesktopReviewDiffLine): string {
  return (ranges.get(diffLine.id) ?? [])
    .map((range) => diffLine.content.slice(range.start, range.end))
    .join('')
}
