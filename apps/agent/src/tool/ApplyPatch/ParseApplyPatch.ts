import { AgentError } from '../../Domain'

export type ApplyPatchOperation =
  | {
      readonly type: 'add'
      readonly path: string
      readonly content: string
    }
  | {
      readonly type: 'update'
      readonly path: string
      readonly chunks: readonly ApplyPatchChunk[]
    }

export interface ApplyPatchChunk {
  readonly oldLines: readonly string[]
  readonly newLines: readonly string[]
  readonly additions: number
  readonly deletions: number
  readonly oldStartLine?: number
  readonly changeContext?: string
  readonly endOfFile?: boolean
  readonly patchLine: number
}

const BEGIN_MARKER = '*** Begin Patch'
const END_MARKER = '*** End Patch'
const ADD_PREFIX = '*** Add File:'
const DELETE_PREFIX = '*** Delete File:'
const UPDATE_PREFIX = '*** Update File:'
const MOVE_PREFIX = '*** Move to:'
const END_OF_FILE_MARKER = '*** End of File'
const UNIFIED_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:[ \t].*)?$/

const safePathLabel = (path: string) => {
  if (/^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(path)) {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '<workspace file>'
  }
  return path
}

const parseError = (line: number, message: string): never => {
  throw new AgentError(
    'PATCH_PARSE_ERROR',
    `补丁第 ${line} 行格式无效：${message}。本次补丁未修改任何文件`,
    400,
    { line },
  )
}

const unsupported = (line: number, operation: 'Delete File' | 'Move to'): never => {
  throw new AgentError(
    'PATCH_UNSUPPORTED_OPERATION',
    `补丁第 ${line} 行使用了暂不支持的 ${operation} 操作；当前仅支持 Add File 和 Update File。本次补丁未修改任何文件`,
    400,
    { line, operation },
  )
}

const operationPath = (line: string, prefix: string, lineNumber: number) => {
  const path = line.slice(prefix.length).trim()
  if (!path) parseError(lineNumber, `${prefix.slice(4, -1)} 路径不能为空`)
  return path
}

const pathKey = (path: string) => {
  const normalized = path
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const parseAdd = (lines: readonly string[], start: number, end: number) => {
  const content: string[] = []
  let index = start
  while (index < end && !lines[index]!.startsWith('***')) {
    const line = lines[index]!
    if (!line.startsWith('+')) parseError(index + 1, 'Add File 的每一行内容都必须以 + 开头')
    content.push(line.slice(1))
    index += 1
  }
  if (content.length === 0) parseError(start + 1, 'Add File 至少需要一行以 + 开头的内容')
  return { content: `${content.join('\n')}\n`, next: index }
}

const parseUnifiedHunkNumber = (value: string, line: number) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed))
    parseError(line, 'unified hunk 头中的行号或行数超出安全整数范围')
  return parsed
}

const parseUpdateChunk = (lines: readonly string[], start: number, end: number) => {
  const header = lines[start]!
  if (header !== '@@' && !header.startsWith('@@ '))
    parseError(start + 1, 'hunk 头必须是 @@ 或 @@ <精确上下文>')

  const unifiedHeader = UNIFIED_HUNK_HEADER.exec(header)
  let changeContext: string | undefined
  let oldStartLine: number | undefined
  let declaredOldLineCount: number | undefined
  let declaredNewLineCount: number | undefined
  if (unifiedHeader) {
    oldStartLine = parseUnifiedHunkNumber(unifiedHeader[1]!, start + 1)
    declaredOldLineCount = parseUnifiedHunkNumber(unifiedHeader[2] ?? '1', start + 1)
    parseUnifiedHunkNumber(unifiedHeader[3]!, start + 1)
    declaredNewLineCount = parseUnifiedHunkNumber(unifiedHeader[4] ?? '1', start + 1)
  } else if (/^@@ -\d/.test(header)) {
    parseError(
      start + 1,
      'unified hunk 头必须是 @@ -<旧起始行>[,<旧行数>] +<新起始行>[,<新行数>] @@',
    )
  } else if (header !== '@@') {
    changeContext = header.slice(3).trim()
    if (!changeContext) parseError(start + 1, '@@ 后的精确上下文不能为空')
  }

  const oldLines: string[] = []
  const newLines: string[] = []
  let additions = 0
  let deletions = 0
  let endOfFile = false
  let index = start + 1
  let diffLineCount = 0
  while (index < end && !lines[index]!.startsWith('@@')) {
    const line = lines[index]!
    if (line === END_OF_FILE_MARKER) {
      endOfFile = true
      index += 1
      if (index < end && !lines[index]!.startsWith('***') && !lines[index]!.startsWith('@@')) {
        parseError(index + 1, `${END_OF_FILE_MARKER} 后只能开始新的 hunk 或文件操作`)
      }
      break
    }
    if (line.startsWith('***')) break
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
      deletions += 1
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
      additions += 1
    } else {
      parseError(index + 1, 'hunk 内容必须以空格、+ 或 - 开头')
    }
    diffLineCount += 1
    index += 1
  }

  if (diffLineCount === 0) parseError(start + 1, 'hunk 至少需要一行上下文、删除或新增内容')
  if (declaredOldLineCount !== undefined && oldLines.length !== declaredOldLineCount) {
    parseError(
      start + 1,
      `unified hunk 头声明旧文件 ${declaredOldLineCount} 行，但内容实际为 ${oldLines.length} 行`,
    )
  }
  if (declaredNewLineCount !== undefined && newLines.length !== declaredNewLineCount) {
    parseError(
      start + 1,
      `unified hunk 头声明新文件 ${declaredNewLineCount} 行，但内容实际为 ${newLines.length} 行`,
    )
  }
  if (oldLines.length === 0 && !changeContext && !endOfFile) {
    parseError(
      start + 1,
      '仅新增内容的 hunk 必须通过 @@ <精确上下文> 或 *** End of File 指定插入位置',
    )
  }

  return {
    chunk: {
      oldLines,
      newLines,
      additions,
      deletions,
      ...(oldStartLine !== undefined ? { oldStartLine } : {}),
      ...(changeContext ? { changeContext } : {}),
      ...(endOfFile ? { endOfFile: true } : {}),
      patchLine: start + 1,
    } satisfies ApplyPatchChunk,
    next: index,
  }
}

const parseUpdate = (lines: readonly string[], start: number, end: number) => {
  const chunks: ApplyPatchChunk[] = []
  let index = start
  if (lines[index]?.startsWith(MOVE_PREFIX)) unsupported(index + 1, 'Move to')
  while (index < end && !lines[index]!.startsWith('***')) {
    if (!lines[index]!.startsWith('@@')) parseError(index + 1, 'Update File 后必须是 @@ hunk')
    const parsed = parseUpdateChunk(lines, index, end)
    chunks.push(parsed.chunk)
    index = parsed.next
  }
  if (chunks.length === 0) parseError(start + 1, 'Update File 至少需要一个 @@ hunk')
  return { chunks, next: index }
}

export const parseApplyPatch = (patchText: string): readonly ApplyPatchOperation[] => {
  if (!patchText) parseError(1, `补丁必须以 ${BEGIN_MARKER} 开始`)
  const normalized = patchText.replaceAll('\r\n', '\n')
  if (normalized.includes('\r')) parseError(1, '补丁包含不受支持的裸 CR 换行')
  const lines = normalized.split('\n')
  if (lines[0] !== BEGIN_MARKER) parseError(1, `第一行必须是 ${BEGIN_MARKER}`)

  const end = lines.indexOf(END_MARKER, 1)
  if (end < 0) parseError(lines.length, `缺少 ${END_MARKER}`)
  for (let index = end + 1; index < lines.length; index += 1) {
    if (lines[index] !== '') parseError(index + 1, `${END_MARKER} 后存在多余内容`)
  }

  const operations: ApplyPatchOperation[] = []
  const paths = new Map<string, { path: string; line: number }>()
  let index = 1
  while (index < end) {
    const line = lines[index]!
    let operation: ApplyPatchOperation | undefined
    let next = index
    if (line.startsWith(ADD_PREFIX)) {
      const path = operationPath(line, ADD_PREFIX, index + 1)
      const parsed = parseAdd(lines, index + 1, end)
      operation = { type: 'add', path, content: parsed.content }
      next = parsed.next
    } else if (line.startsWith(UPDATE_PREFIX)) {
      const path = operationPath(line, UPDATE_PREFIX, index + 1)
      const parsed = parseUpdate(lines, index + 1, end)
      operation = { type: 'update', path, chunks: parsed.chunks }
      next = parsed.next
    } else if (line.startsWith(DELETE_PREFIX)) {
      operationPath(line, DELETE_PREFIX, index + 1)
      unsupported(index + 1, 'Delete File')
    } else if (line.startsWith(MOVE_PREFIX)) {
      unsupported(index + 1, 'Move to')
    } else {
      parseError(index + 1, '只能使用 Add File 或 Update File 操作')
    }
    const parsedOperation = operation ?? parseError(index + 1, '无法解析文件操作')

    const key = pathKey(parsedOperation.path)
    const previous = paths.get(key)
    if (previous) {
      throw new AgentError(
        'PATCH_DUPLICATE_PATH',
        `补丁中的路径 "${safePathLabel(parsedOperation.path)}" 在第 ${previous.line} 行和第 ${index + 1} 行重复；每个文件只能出现一次。本次补丁未修改任何文件`,
        409,
        { firstLine: previous.line, secondLine: index + 1 },
      )
    }
    paths.set(key, { path: parsedOperation.path, line: index + 1 })
    operations.push(parsedOperation)
    index = next
  }

  if (operations.length === 0) parseError(2, '补丁至少需要一个 Add File 或 Update File 操作')
  return operations
}
