import { AgentError } from '../../Domain'
import type { ApplyPatchChunk } from './ParseApplyPatch'

type SourceLine = {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly eol: '\r\n' | '\n' | ''
}

type Replacement = {
  readonly start: number
  readonly end: number
  readonly value: string
  readonly startLine: number
  readonly endLine: number
  readonly hunk: number
}

export interface AppliedPatchText {
  readonly content: string
  readonly changes: readonly {
    readonly hunk: number
    readonly startLine: number
    readonly endLine: number
  }[]
}

const safePathLabel = (path: string) => {
  if (/^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(path)) {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '<workspace file>'
  }
  return path
}

const sourceLines = (content: string): SourceLine[] => {
  const lines: SourceLine[] = []
  let start = 0
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\n') continue
    const crlf = index > start && content[index - 1] === '\r'
    lines.push({
      text: content.slice(start, crlf ? index - 1 : index),
      start,
      end: index + 1,
      eol: crlf ? '\r\n' : '\n',
    })
    start = index + 1
  }
  if (start < content.length) {
    lines.push({ text: content.slice(start), start, end: content.length, eol: '' })
  }
  return lines
}

const matchesAt = (lines: readonly SourceLine[], pattern: readonly string[], offset: number) =>
  pattern.every((line, index) => lines[offset + index]?.text === line)

const matchingOffsets = (
  lines: readonly SourceLine[],
  pattern: readonly string[],
  start: number,
  endOfFile = false,
) => {
  if (pattern.length === 0) return []
  if (endOfFile) {
    const offset = lines.length - pattern.length
    return offset >= start && matchesAt(lines, pattern, offset) ? [offset] : []
  }
  const offsets: number[] = []
  for (let offset = start; offset <= lines.length - pattern.length; offset += 1) {
    if (matchesAt(lines, pattern, offset)) offsets.push(offset)
  }
  return offsets
}

const disambiguateWithLineHint = (offsets: readonly number[], oldStartLine: number | undefined) => {
  if (offsets.length <= 1 || oldStartLine === undefined || oldStartLine < 1) return offsets
  const hintedOffset = oldStartLine - 1
  return offsets.includes(hintedOffset) ? [hintedOffset] : offsets
}

const lineEndingNear = (
  lines: readonly SourceLine[],
  start: number,
  count: number,
): '\r\n' | '\n' => {
  for (let index = start; index < Math.min(lines.length, start + count); index += 1) {
    const eol = lines[index]?.eol
    if (eol) return eol
  }
  for (let index = start - 1; index >= 0; index -= 1) {
    const eol = lines[index]?.eol
    if (eol) return eol
  }
  for (let index = start + count; index < lines.length; index += 1) {
    const eol = lines[index]?.eol
    if (eol) return eol
  }
  return '\n'
}

const uniqueOffset = (
  path: string,
  hunk: number,
  kind: 'change context' | 'expected lines',
  offsets: readonly number[],
): number => {
  const label = safePathLabel(path)
  if (offsets.length === 0) {
    throw new AgentError(
      'PATCH_CONTEXT_NOT_FOUND',
      `无法应用 "${label}" 的第 ${hunk} 个 hunk：未找到精确 ${kind}。请先 Read 该文件并基于最新原文重新生成 hunk。本次补丁未修改任何文件`,
      409,
      { hunk },
    )
  }
  if (offsets.length > 1) {
    throw new AgentError(
      'PATCH_CONTEXT_AMBIGUOUS',
      `无法应用 "${label}" 的第 ${hunk} 个 hunk：精确 ${kind} 命中 ${offsets.length} 处。请增加唯一上下文后重试。本次补丁未修改任何文件`,
      409,
      { hunk, matches: offsets.length },
    )
  }
  return offsets[0]!
}

const overlaps = (left: Replacement, right: Replacement) => {
  if (left.startLine === left.endLine && right.startLine === right.endLine) {
    return left.startLine === right.startLine
  }
  if (left.startLine === left.endLine) {
    return left.startLine > right.startLine && left.startLine < right.endLine
  }
  if (right.startLine === right.endLine) {
    return right.startLine > left.startLine && right.startLine < left.endLine
  }
  return Math.max(left.startLine, right.startLine) < Math.min(left.endLine, right.endLine)
}

const overlapError = (path: string, first: number, second: number): never => {
  throw new AgentError(
    'PATCH_OVERLAPPING_HUNKS',
    `无法应用 "${safePathLabel(path)}"：第 ${first} 个和第 ${second} 个 hunk 重叠或顺序冲突。请合并或重新排序这些 hunk。本次补丁未修改任何文件`,
    409,
    { firstHunk: first, secondHunk: second },
  )
}

const replacementValue = (
  content: string,
  lines: readonly SourceLine[],
  startLine: number,
  oldLineCount: number,
  newLines: readonly string[],
) => {
  const eol = lineEndingNear(lines, startLine, oldLineCount)
  if (oldLineCount > 0) {
    const last = lines[startLine + oldLineCount - 1]!
    return newLines.length === 0 ? '' : `${newLines.join(eol)}${last.eol ? eol : ''}`
  }
  if (newLines.length === 0) return ''
  if (startLine < lines.length) return `${newLines.join(eol)}${eol}`
  if (content.length === 0 || lines.at(-1)?.eol) return `${newLines.join(eol)}${eol}`
  return `${eol}${newLines.join(eol)}${eol}`
}

export const applyPatchText = (
  path: string,
  chunks: readonly ApplyPatchChunk[],
  original: string,
): AppliedPatchText => {
  const hasBom = original.startsWith('\uFEFF')
  const content = hasBom ? original.slice(1) : original
  const lines = sourceLines(content)
  const replacements: Replacement[] = []
  let cursor = 0

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!
    const hunk = index + 1
    let searchStart = cursor
    if (chunk.changeContext) {
      const candidates = matchingOffsets(lines, [chunk.changeContext], cursor)
      if (candidates.length === 0) {
        const earlier = matchingOffsets(lines, [chunk.changeContext], 0)
        if (earlier.some((offset) => offset < cursor)) {
          overlapError(path, replacements.at(-1)?.hunk ?? Math.max(1, hunk - 1), hunk)
        }
      }
      searchStart = uniqueOffset(path, hunk, 'change context', candidates) + 1
    }

    let startLine: number
    if (chunk.oldLines.length === 0) {
      startLine = chunk.endOfFile ? lines.length : searchStart
    } else {
      const candidates = matchingOffsets(lines, chunk.oldLines, searchStart, chunk.endOfFile)
      if (candidates.length === 0) {
        const earlier = matchingOffsets(lines, chunk.oldLines, 0, chunk.endOfFile)
        if (earlier.some((offset) => offset < cursor && offset + chunk.oldLines.length > 0)) {
          overlapError(path, replacements.at(-1)?.hunk ?? Math.max(1, hunk - 1), hunk)
        }
      }
      startLine = uniqueOffset(
        path,
        hunk,
        'expected lines',
        disambiguateWithLineHint(candidates, chunk.oldStartLine),
      )
    }

    const endLine = startLine + chunk.oldLines.length
    const rawStart = startLine < lines.length ? lines[startLine]!.start : content.length
    const rawEnd = chunk.oldLines.length > 0 ? lines[endLine - 1]!.end : rawStart
    const replacement: Replacement = {
      start: rawStart,
      end: rawEnd,
      value: replacementValue(content, lines, startLine, chunk.oldLines.length, chunk.newLines),
      startLine,
      endLine,
      hunk,
    }
    const conflict = replacements.find((existing) => overlaps(existing, replacement))
    if (conflict) overlapError(path, conflict.hunk, hunk)
    replacements.push(replacement)
    cursor = Math.max(cursor, endLine)
  }

  let updated = content
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const replacement = replacements[index]!
    updated = `${updated.slice(0, replacement.start)}${replacement.value}${updated.slice(replacement.end)}`
  }
  return {
    content: hasBom ? `\uFEFF${updated}` : updated,
    changes: replacements.map(({ hunk, startLine, endLine }) => ({
      hunk,
      startLine: startLine + 1,
      endLine: Math.max(startLine + 1, endLine),
    })),
  }
}
