import { AgentError } from '../../Domain'

type MatchRange = {
  start: number
  end: number
}

export type EditOperation = {
  oldText: string
  newText: string
}

type NormalizedText = {
  text: string
  rawOffsets: number[]
}

const normalizeLineEndings = (value: string): NormalizedText => {
  let text = ''
  const rawOffsets = [0]
  for (let index = 0; index < value.length;) {
    if (value[index] === '\r' && value[index + 1] === '\n') {
      text += '\n'
      index += 2
    } else {
      text += value[index]
      index += 1
    }
    rawOffsets.push(index)
  }
  return { text, rawOffsets }
}

const findMatchRanges = (content: string, oldString: string): MatchRange[] => {
  const findNext = (offset: number) => {
    let index = content.indexOf(oldString, offset)
    while (index >= 0 && oldString.startsWith('\n') && index > 0 && content[index - 1] === '\r') {
      index = content.indexOf(oldString, index + 1)
    }
    return index
  }

  const first = findNext(0)
  if (first < 0) return []
  if (findNext(first + 1) >= 0) {
    throw new AgentError('PATCH_CONTEXT_AMBIGUOUS', '编辑上下文不唯一；请提供更多唯一上下文', 409)
  }
  return [{ start: first, end: first + oldString.length }]
}

const resolveMatchRange = (content: string, oldString: string): MatchRange => {
  const exact = findMatchRanges(content, oldString)
  if (exact.length > 0) return exact[0]!

  const normalizedContent = normalizeLineEndings(content)
  const normalizedOldString = normalizeLineEndings(oldString).text
  const normalizedRanges = findMatchRanges(normalizedContent.text, normalizedOldString)
  if (normalizedRanges.length === 0) {
    throw new AgentError('PATCH_CONTEXT_NOT_FOUND', '编辑上下文未找到', 409)
  }
  const normalizedRange = normalizedRanges[0]!
  return {
    start: normalizedContent.rawOffsets[normalizedRange.start]!,
    end: normalizedContent.rawOffsets[normalizedRange.end]!,
  }
}

const lineEndingAt = (content: string, lineFeedIndex: number): '\r\n' | '\n' =>
  lineFeedIndex > 0 && content[lineFeedIndex - 1] === '\r' ? '\r\n' : '\n'

const lineEndingInside = (content: string, range: MatchRange) => {
  const index = content.indexOf('\n', range.start)
  return index >= 0 && index < range.end ? lineEndingAt(content, index) : null
}

const nearestLineEnding = (content: string, range: MatchRange): '\r\n' | '\n' | null => {
  const before = content.lastIndexOf('\n', Math.max(0, range.start - 1))
  const after = content.indexOf('\n', range.end)
  if (before < 0 && after < 0) return null
  if (before < 0) return lineEndingAt(content, after)
  if (after < 0) return lineEndingAt(content, before)
  return range.start - before <= after - range.end
    ? lineEndingAt(content, before)
    : lineEndingAt(content, after)
}

const adaptReplacementLineEndings = (content: string, range: MatchRange, replacement: string) => {
  const lineEnding = lineEndingInside(content, range) ?? nearestLineEnding(content, range) ?? '\n'
  return replacement.replace(/\r\n|\n/g, lineEnding)
}

export const applyEditsText = (content: string, edits: readonly EditOperation[]) => {
  if (edits.length === 0) throw new AgentError('INVALID_TOOL_INPUT', 'edits 至少需要一项编辑', 400)
  const resolved = edits
    .map((edit, index) => {
      if (!edit.oldText)
        throw new AgentError(
          'INVALID_TOOL_INPUT',
          `第 ${index + 1} 项 oldText 必须是非空字符串`,
          400,
        )
      const range = resolveMatchRange(content, edit.oldText)
      return {
        ...range,
        index,
        replacement: adaptReplacementLineEndings(content, range, edit.newText),
      }
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)

  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1]!
    const current = resolved[index]!
    if (current.start < previous.end) {
      throw new AgentError(
        'PATCH_OVERLAPPING_HUNKS',
        `第 ${previous.index + 1} 项和第 ${current.index + 1} 项编辑范围重叠；请合并为一项唯一编辑`,
        409,
      )
    }
  }

  let updated = content
  for (let index = resolved.length - 1; index >= 0; index -= 1) {
    const edit = resolved[index]!
    updated = `${updated.slice(0, edit.start)}${edit.replacement}${updated.slice(edit.end)}`
  }
  return updated
}
