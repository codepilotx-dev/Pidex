import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { WorkspaceService } from '../workspace/WorkspaceService'

const MAX_ENTRIES = 10_000
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_MATCH_TEXT = 8_000

const TYPE_GLOBS: Record<string, readonly string[]> = {
  ts: ['*.ts', '*.tsx'],
  typescript: ['*.ts', '*.tsx'],
  js: ['*.js', '*.jsx', '*.mjs', '*.cjs'],
  javascript: ['*.js', '*.jsx', '*.mjs', '*.cjs'],
  json: ['*.json'],
  py: ['*.py'],
  python: ['*.py'],
  rust: ['*.rs'],
  go: ['*.go'],
  java: ['*.java'],
  c: ['*.c', '*.h'],
  cpp: ['*.cc', '*.cpp', '*.cxx', '*.h', '*.hpp'],
  markdown: ['*.md', '*.mdx'],
  md: ['*.md', '*.mdx'],
}

type SearchContext = {
  workspace: WorkspaceService
  signal: AbortSignal
}

type GrepInput = {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-A'?: number
  '-B'?: number
  '-C'?: number
  context?: number
  '-n'?: boolean
  '-i'?: boolean
  head_limit?: number
  offset?: number
  multiline?: boolean
}

const checkBudget = (signal: AbortSignal, deadline: number) => {
  if (signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
  if (Date.now() >= deadline)
    throw new AgentError('WORKSPACE_SEARCH_TIMEOUT', '工作区搜索超过 10 秒预算', 408)
}

const expandBraces = (pattern: string): string[] => {
  const match = pattern.match(/^(.*?)\{([^{}]+)\}(.*)$/)
  if (!match) return [pattern]
  return match[2]!.split(',').flatMap((part) => expandBraces(`${match[1]}${part}${match[3]}`))
}

const globRegex = (pattern: string) => {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else {
      source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`, 'i')
}

const globMatcher = (patterns: readonly string[]) => {
  const normalized = patterns.flatMap((pattern) => expandBraces(pattern.replaceAll('\\', '/')))
  const matchers = normalized.map((pattern) => ({
    basenameOnly: !pattern.includes('/'),
    expression: globRegex(pattern),
  }))
  return (path: string) =>
    matchers.some(({ basenameOnly, expression }) =>
      expression.test(basenameOnly ? basename(path) : path),
    )
}

const relativeToTarget = (path: string, target: string) => {
  if (target === '.') return path
  const prefix = `${target.replace(/\/$/, '')}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

const listDirectory = async (workspace: WorkspaceService, directory: string, root: boolean) => {
  try {
    return await workspace.listEditorFiles(directory)
  } catch (cause) {
    if (root || (cause instanceof AgentError && cause.code === 'RUN_ABORTED')) throw cause
    return []
  }
}

export const nativeGlobWorkspace = async (
  input: { pattern: string; limit?: number },
  context: SearchContext,
  target: string,
) => {
  const deadline = Date.now() + TIMEOUT_MS
  const matchesPattern = globMatcher([input.pattern])
  const queue = [target]
  const matches: string[] = []
  let visited = 0
  let exhausted = true

  while (queue.length) {
    checkBudget(context.signal, deadline)
    const directory = queue.shift()!
    for (const entry of await listDirectory(context.workspace, directory, directory === target)) {
      checkBudget(context.signal, deadline)
      if (visited >= MAX_ENTRIES) {
        exhausted = false
        break
      }
      visited += 1
      if (entry.type === 'directory') {
        queue.push(entry.path)
      } else if (matchesPattern(relativeToTarget(entry.path, target))) {
        matches.push(entry.path)
      }
    }
    if (!exhausted) break
  }

  matches.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const limit = input.limit ?? 200
  return {
    matches: matches.slice(0, limit),
    truncated: !exhausted || matches.length > limit,
    visited: Math.min(visited, MAX_ENTRIES),
    engine: 'native-fallback' as const,
  }
}

export const nativeGrepWorkspace = async (
  input: GrepInput,
  context: SearchContext,
  target: string,
) => {
  let expression: RegExp
  try {
    expression = new RegExp(
      input.pattern,
      `${input['-i'] ? 'i' : ''}${input.multiline ? 'ms' : 'm'}g`,
    )
  } catch {
    throw new AgentError('INVALID_TOOL_INPUT', 'pattern 不是有效的正则表达式', 400)
  }

  const type = input.type?.toLowerCase()
  const typePatterns = type ? TYPE_GLOBS[type] : undefined
  if (type && !typePatterns) {
    throw new AgentError(
      'WORKSPACE_SEARCH_FALLBACK_UNSUPPORTED',
      `离线搜索不支持 ripgrep 文件类型 ${input.type}`,
      400,
      { type: input.type },
    )
  }
  const matchesFile = input.glob
    ? globMatcher([input.glob])
    : typePatterns
      ? globMatcher(typePatterns)
      : () => true
  const deadline = Date.now() + TIMEOUT_MS
  const queue = [target]
  const files: Array<{
    path: string
    count: number
    matches: Array<{ line?: number; text: string; before?: string[]; after?: string[] }>
  }> = []
  const offset = input.offset ?? 0
  const limit = input.head_limit ?? 200
  const wanted = offset + limit + 1
  const before = input['-B'] ?? input['-C'] ?? input.context ?? 0
  const after = input['-A'] ?? input['-C'] ?? input.context ?? 0
  let visited = 0
  let bytes = 0
  let exhausted = true
  const collected = () =>
    input.output_mode === 'content'
      ? files.reduce((sum, file) => sum + file.matches.length, 0)
      : files.length

  while (queue.length && collected() < wanted) {
    checkBudget(context.signal, deadline)
    const directory = queue.shift()!
    for (const entry of await listDirectory(context.workspace, directory, directory === target)) {
      checkBudget(context.signal, deadline)
      if (entry.type === 'directory') {
        queue.push(entry.path)
        continue
      }
      if (visited >= MAX_ENTRIES) {
        exhausted = false
        break
      }
      visited += 1
      if (!matchesFile(relativeToTarget(entry.path, target))) continue
      try {
        const metadata = await stat(resolve(context.workspace.rootPath, entry.path))
        if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) continue
        if (bytes + metadata.size > MAX_TOTAL_BYTES) {
          exhausted = false
          break
        }
        const file = await context.workspace.readEditorFile(entry.path)
        if (file.sizeBytes > MAX_FILE_BYTES) continue
        if (bytes + file.sizeBytes > MAX_TOTAL_BYTES) {
          exhausted = false
          break
        }
        bytes += file.sizeBytes
        expression.lastIndex = 0
        const matches: Array<{ line?: number; text: string; before?: string[]; after?: string[] }> =
          []
        let count = 0

        if (input.multiline) {
          for (const match of file.content.matchAll(expression)) {
            count += 1
            if (input.output_mode === 'content' && collected() + matches.length < wanted) {
              matches.push({
                ...(input['-n'] === false
                  ? {}
                  : { line: file.content.slice(0, match.index).split(/\r?\n/).length }),
                text: match[0].slice(0, MAX_MATCH_TEXT),
              })
            }
          }
        } else {
          const lines = file.content.split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            expression.lastIndex = 0
            const line = lines[index]!
            const occurrences = Array.from(line.matchAll(expression)).length
            if (!occurrences) continue
            count += occurrences
            if (input.output_mode !== 'content') continue
            for (
              let occurrence = 0;
              occurrence < occurrences && collected() + matches.length < wanted;
              occurrence += 1
            ) {
              matches.push({
                ...(input['-n'] === false ? {} : { line: index + 1 }),
                text: line.slice(0, MAX_MATCH_TEXT),
                ...(before ? { before: lines.slice(Math.max(0, index - before), index) } : {}),
                ...(after ? { after: lines.slice(index + 1, index + 1 + after) } : {}),
              })
            }
          }
        }
        if (count) files.push({ path: entry.path, count, matches })
      } catch (cause) {
        if (
          cause instanceof AgentError &&
          (cause.code === 'RUN_ABORTED' || cause.code === 'WORKSPACE_SEARCH_TIMEOUT')
        )
          throw cause
        // Unreadable, binary, oversized, and files changed during traversal are skipped.
      }
      if (collected() >= wanted) break
    }
    if (!exhausted) break
  }

  if (input.output_mode === 'files_with_matches') {
    const values = files.map((file) => file.path)
    return {
      files: values.slice(offset, offset + limit),
      truncated: !exhausted || values.length > offset + limit,
      visited: Math.min(visited, MAX_ENTRIES),
      bytes,
      engine: 'native-fallback' as const,
    }
  }
  if (input.output_mode === 'count') {
    const values = files.map(({ path, count }) => ({ path, count }))
    return {
      counts: values.slice(offset, offset + limit),
      truncated: !exhausted || values.length > offset + limit,
      visited: Math.min(visited, MAX_ENTRIES),
      bytes,
      engine: 'native-fallback' as const,
    }
  }
  const values = files.flatMap((file) =>
    file.matches.map((match) => ({ path: file.path, ...match })),
  )
  return {
    matches: values.slice(offset, offset + limit),
    truncated: !exhausted || values.length > offset + limit,
    visited: Math.min(visited, MAX_ENTRIES),
    bytes,
    engine: 'native-fallback' as const,
  }
}
