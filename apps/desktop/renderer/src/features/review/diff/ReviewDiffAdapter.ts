import type { DesktopReviewDiffHunk, DesktopReviewDiffLine } from '../../../../shared/Types.js'

export type UnifiedDiffHunk = {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
}

export function unifiedPatchToDesktopHunks(
  patch: string,
  hunks: readonly UnifiedDiffHunk[],
): DesktopReviewDiffHunk[] {
  const parsedByHeader = parsePatchLines(patch)
  return hunks.map((hunk, index) => {
    const parsed = parsedByHeader[index]
    return {
      ...hunk,
      lines: parsed?.lines ?? [],
    }
  })
}

export function expandReviewContext(
  hunks: DesktopReviewDiffHunk[],
  contextPatch: string | undefined,
): DesktopReviewDiffHunk[] {
  if (!contextPatch || hunks.length === 0) return hunks
  const context = parsePatchLines(contextPatch)
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type === 'context')
  return hunks.map((hunk, index) => {
    const start = index === 0 ? 1 : hunks[index - 1]!.oldStart + hunks[index - 1]!.oldLines
    const prefix = context.filter((line) => line.oldLine! >= start && line.oldLine! < hunk.oldStart)
    const suffix =
      index === hunks.length - 1
        ? context.filter((line) => line.oldLine! >= hunk.oldStart + hunk.oldLines)
        : []
    const lines = [...prefix, ...hunk.lines, ...suffix]
    return {
      ...hunk,
      oldStart: prefix[0]?.oldLine ?? hunk.oldStart,
      newStart: prefix[0]?.newLine ?? hunk.newStart,
      oldLines: lines.filter((line) => line.type !== 'added').length,
      newLines: lines.filter((line) => line.type !== 'removed').length,
      lines: lines.map((line, row) => ({ ...line, id: `${hunk.id}:context:${row}` })),
    }
  })
}

export function hideImportOnlyHunks(hunks: DesktopReviewDiffHunk[]): DesktopReviewDiffHunk[] {
  // shortcut: only complete JS/TS imports; use a syntax parser if other languages are needed.
  const importsOnly = (text: string) => {
    let rest = text.trim()
    while (rest) {
      if (!/^import\s/u.test(rest)) return false
      const quoteIndex = rest.search(/['"]/u)
      if (quoteIndex < 0) return false
      const clause = rest.slice(6, quoteIndex).trim()
      if (clause && (!clause.endsWith('from') || !/^[\w$*{},\s]+$/u.test(clause.slice(0, -4))))
        return false
      const end = rest.indexOf(rest[quoteIndex]!, quoteIndex + 1)
      if (end < 0 || !/^[^'"\r\n]+$/u.test(rest.slice(quoteIndex + 1, end))) return false
      rest = rest.slice(end + 1).trimStart()
      if (rest.startsWith(';')) rest = rest.slice(1).trimStart()
    }
    return true
  }
  return hunks.filter((hunk) => {
    const changed = hunk.lines.filter((line) => line.type !== 'context')
    if (changed.length === 0) return true
    return !(['added', 'removed'] as const).every((type) => {
      const text = changed
        .filter((line) => line.type === type)
        .map((line) => line.content)
        .join('\n')
      return !text.trim() || importsOnly(text)
    })
  })
}

function parsePatchLines(patch: string): Array<{ header: string; lines: DesktopReviewDiffLine[] }> {
  const result: Array<{ header: string; lines: DesktopReviewDiffLine[] }> = []
  let current: { header: string; lines: DesktopReviewDiffLine[] } | null = null
  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split(/\r?\n/u)) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw)
    if (match) {
      oldLine = Number(match[1])
      newLine = Number(match[2])
      current = { header: raw, lines: [] }
      result.push(current)
      continue
    }
    if (!current || raw.startsWith('\\ No newline')) continue
    const prefix = raw[0]
    if (prefix !== ' ' && prefix !== '+' && prefix !== '-') continue
    const type = prefix === '+' ? 'added' : prefix === '-' ? 'removed' : 'context'
    current.lines.push({
      id: `${result.length}:${current.lines.length}`,
      type,
      oldLine: prefix === '+' ? null : oldLine,
      newLine: prefix === '-' ? null : newLine,
      content: raw.slice(1),
      raw,
    })
    if (prefix !== '+') oldLine += 1
    if (prefix !== '-') newLine += 1
  }
  return result
}
