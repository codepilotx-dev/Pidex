import { basename, isAbsolute, relative, resolve } from 'node:path'
import {
  ToolActivityDescriptorSchema,
  type ToolActivityDescriptor,
  type ToolActivityFileChange,
  type ToolActivityTarget,
} from '@pidex/shared/thread'
import { Schema } from 'effect'

import type { WorkspaceService } from '../workspace/WorkspaceService'
import { shellCommandSegments } from './Shell/CommandSyntax'

type ToolActivityInput = {
  tool: string
  input: unknown
  command?: string | null
  details?: unknown
  integrationSource?: string
  workspace?: WorkspaceService
}

const isToolActivityDescriptor = Schema.is(ToolActivityDescriptorSchema)
const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const textOf = (record: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}
const countOf = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined
const toolLeaf = (tool: string) => tool.trim().toLowerCase().split(/[./]/).at(-1) ?? ''
const normalizedTool = (tool: string) => tool.trim().toLowerCase()

const safeRelative = (value: string) => {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\/+/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (!normalized || parts.includes('..')) return undefined
  return normalized
}

export const toolActivityTarget = (
  value: string | undefined,
  workspace?: WorkspaceService,
): ToolActivityTarget | undefined => {
  const raw = value?.trim()
  if (!raw) return undefined
  if (raw.startsWith('@')) return { displayLabel: raw }

  if (workspace) {
    const absolute = isAbsolute(raw) ? resolve(raw) : resolve(workspace.rootPath, raw)
    const owner = workspace.rootForPath(absolute)
    if (owner) {
      const child = relative(owner.path, absolute).replaceAll('\\', '/') || '.'
      if (owner.path === workspace.rootPath) {
        return { displayLabel: child, workspacePath: child }
      }
      return {
        displayLabel: child === '.' ? basename(owner.path) : `${basename(owner.path)}/${child}`,
      }
    }
  }

  if (!workspace) return { displayLabel: basename(raw) || '<workspace-file>' }
  if (isAbsolute(raw)) return { displayLabel: basename(raw) || '<workspace-file>' }
  const path = safeRelative(raw)
  return path
    ? { displayLabel: path, workspacePath: path }
    : { displayLabel: basename(raw) || '<workspace-file>' }
}

const shellWords = (command: string): string[] => {
  const words: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  const push = () => {
    if (!current) return
    words.push(current)
    current = ''
  }
  const source = command.trim()
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    const next = source[index + 1]
    if (character === '\\' && quote !== "'" && next && /[\s\\'\"]/.test(next)) {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else current += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) push()
    else current += character
  }
  if (escaped) current += '\\'
  push()
  return words
}

const commandArguments = (segment: string) => {
  const words = shellWords(segment.replace(/^&\s+/, '').replace(/^sudo\s+/i, ''))
  return words.slice(1)
}
const hasFlag = (args: readonly string[], ...flags: string[]) =>
  args.some((arg) => flags.includes(arg.toLowerCase()))
const optionValue = (args: readonly string[], ...options: string[]) => {
  const names = new Set(options.map((option) => option.toLowerCase()))
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]?.toLowerCase()
    if (current && names.has(current)) return args[index + 1]
    const assignment = options.find((option) => current?.startsWith(`${option.toLowerCase()}=`))
    if (assignment) return args[index]?.slice(assignment.length + 1)
  }
  return undefined
}

const positionalArguments = (args: readonly string[]) => {
  const optionsWithValues = new Set([
    '-a',
    '-b',
    '-c',
    '-d',
    '-e',
    '-f',
    '-g',
    '-m',
    '-t',
    '--after-context',
    '--before-context',
    '--context',
    '--encoding',
    '--file',
    '--glob',
    '--iglob',
    '--include',
    '--max-count',
    '--type',
    '-filter',
    '-include',
    '-literalpath',
    '-path',
    '-pattern',
  ])
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const lower = arg.toLowerCase()
    if (optionsWithValues.has(lower)) {
      index += 1
      continue
    }
    if (arg.startsWith('-')) continue
    values.push(arg)
  }
  return values
}

const shellPath = (
  args: readonly string[],
  workspace?: WorkspaceService,
): ToolActivityTarget | undefined => {
  const explicit = optionValue(args, '-LiteralPath', '-Path')
  const positional = positionalArguments(args)
  return toolActivityTarget(explicit ?? positional.at(-1), workspace)
}

const shellSearch = (
  executable: string,
  args: readonly string[],
  workspace?: WorkspaceService,
): ToolActivityDescriptor => {
  if (executable === 'rg' && hasFlag(args, '--files')) {
    return { type: 'list_files', path: shellPath(args, workspace) }
  }
  const positional = positionalArguments(args)
  const query = optionValue(args, '-Pattern', '-e', '--regexp') ?? positional[0]
  const pathValue = query === positional[0] ? positional[1] : positional[0]
  return {
    type: 'search',
    ...(query ? { query } : {}),
    ...(pathValue ? { path: toolActivityTarget(pathValue, workspace) } : {}),
  }
}

const interpreterNames = new Set([
  'bash',
  'bun',
  'deno',
  'node',
  'perl',
  'php',
  'python',
  'python3',
  'pwsh',
  'ruby',
  'sh',
])
const skillScriptActivity = (executable: string, args: readonly string[], forced: boolean) => {
  if (!forced && !interpreterNames.has(executable)) return undefined
  const script = args.find((arg) => !arg.startsWith('-'))
  const normalized = script?.replaceAll('\\', '/')
  const match = normalized?.match(/(?:^|\/)skills\/([^/]+)\/scripts\/([^/]+)$/i)
  if (!forced && !match) return undefined
  return {
    type: 'command' as const,
    kind: 'skill_script' as const,
    ...(match?.[1] ? { skillName: match[1] } : {}),
    ...(match?.[2] ? { scriptName: match[2] } : {}),
  }
}

const formatters = new Set(['black', 'gofmt', 'prettier', 'rustfmt'])
const linters = new Set(['eslint', 'shellcheck', 'stylelint'])
const testRunners = new Set(['jest', 'pytest', 'vitest'])
const displayPipeCommands = new Set([
  'format-list',
  'format-table',
  'head',
  'more',
  'out-string',
  'select-object',
  'sort',
  'sort-object',
  'tail',
  'uniq',
  'where-object',
])

const commandKind = (
  executable: string,
  args: readonly string[],
): Extract<ToolActivityDescriptor, { type: 'command' }>['kind'] => {
  if (
    executable === 'true' ||
    (executable === 'test' && ['-n', '-z'].includes(args[0]?.toLowerCase() ?? '')) ||
    (executable === '[' && ['-n', '-z'].includes(args[0]?.toLowerCase() ?? ''))
  )
    return 'noop'
  if (
    formatters.has(executable) ||
    (executable === 'biome' && args[0]?.toLowerCase() === 'format') ||
    (executable === 'ruff' && args[0]?.toLowerCase() === 'format')
  )
    return 'format'
  if (linters.has(executable) || executable === 'ruff') return 'lint'
  if (testRunners.has(executable)) return 'test'
  if (['bun', 'npm', 'pnpm', 'yarn'].includes(executable)) {
    const scripts = new Set(args.map((arg) => arg.toLowerCase()))
    if (scripts.has('test')) return 'test'
    if (scripts.has('lint')) return 'lint'
    if (scripts.has('format') || scripts.has('fmt')) return 'format'
  }
  if (['cargo', 'dotnet', 'go'].includes(executable) && args[0]?.toLowerCase() === 'test')
    return 'test'
  return 'generic'
}

const classifyShell = (
  command: string,
  input: Record<string, unknown>,
  workspace?: WorkspaceService,
): ToolActivityDescriptor => {
  const segments = shellCommandSegments(command)
  const first = segments[0]
  if (!first?.executable) return { type: 'command', kind: 'generic' }
  if (segments.some((segment) => segment.separatorBefore && segment.separatorBefore !== '|')) {
    return { type: 'command', kind: 'generic' }
  }
  if (segments.some((segment) => /(?:^|[^<])>{1,2}|<(?!=)/.test(segment.text))) {
    return { type: 'command', kind: 'generic' }
  }
  if (
    segments
      .slice(1)
      .some((segment) => !segment.executable || !displayPipeCommands.has(segment.executable))
  ) {
    return { type: 'command', kind: 'generic' }
  }

  const executable = first.executable
  const args = commandArguments(first.text)
  const skillScript = skillScriptActivity(executable, args, input.__skillScript === true)
  if (skillScript) return skillScript
  if (executable === 'date' || executable === 'get-date') {
    return { type: 'command', kind: 'current_time' }
  }
  if (['rg', 'grep', 'ag', 'ack', 'findstr', 'select-string'].includes(executable)) {
    return shellSearch(executable, args, workspace)
  }
  if (['ls', 'dir', 'get-childitem', 'gci', 'fd', 'fdfind'].includes(executable)) {
    return { type: 'list_files', path: shellPath(args, workspace) }
  }
  if (['cat', 'type', 'get-content', 'gc', 'head', 'tail'].includes(executable)) {
    return { type: 'read', subject: 'file', target: shellPath(args, workspace) }
  }
  if (
    executable === 'sed' &&
    hasFlag(args, '-n', '--quiet', '--silent') &&
    !hasFlag(args, '-i', '--in-place')
  ) {
    return { type: 'read', subject: 'file', target: shellPath(args, workspace) }
  }
  return { type: 'command', kind: commandKind(executable, args) }
}

const fileOperation = (value: unknown, fallback: ToolActivityFileChange['operation']) =>
  value === 'create' || value === 'update' || value === 'delete' || value === 'write'
    ? value
    : fallback

const fileChanges = (
  tool: string,
  input: Record<string, unknown>,
  details: unknown,
  workspace?: WorkspaceService,
): ToolActivityFileChange[] => {
  const leaf = toolLeaf(tool)
  const fallback: ToolActivityFileChange['operation'] = leaf === 'edit' ? 'update' : 'write'
  const candidates = Array.isArray(input.affectedPaths) ? input.affectedPaths : [input]
  const changes = new Map<string, ToolActivityFileChange>()
  const add = (candidate: unknown, defaultOperation = fallback) => {
    const record = recordOf(candidate)
    const rawPath = textOf(record, 'path', 'file_path', 'filePath')
    const target = toolActivityTarget(rawPath, workspace)
    if (!target) return
    const key = target.displayLabel.toLowerCase()
    const current = changes.get(key)
    const additions = countOf(record.additions) ?? current?.additions
    const deletions = countOf(record.deletions) ?? current?.deletions
    changes.set(key, {
      path: current?.path ?? target.displayLabel,
      operation: fileOperation(
        record.mutation ?? record.operation,
        current?.operation ?? defaultOperation,
      ),
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
    })
  }
  for (const candidate of candidates) add(candidate)
  const result = recordOf(details)
  const resultCandidates = Array.isArray(result.files) ? result.files : [result]
  for (const candidate of resultCandidates) add(candidate)
  return [...changes.values()]
}

const selectedToolName = (input: Record<string, unknown>, details: unknown) => {
  const detail = recordOf(details)
  const added = Array.isArray(detail.addedToolNames)
    ? detail.addedToolNames.find(
        (value): value is string => typeof value === 'string' && Boolean(value.trim()),
      )
    : undefined
  return (
    added?.trim() ??
    textOf(input, 'query')
      ?.match(/^select:(.+)$/i)?.[1]
      ?.trim()
  )
}

export const classifyToolActivity = ({
  tool,
  input,
  command,
  details,
  integrationSource,
  workspace,
}: ToolActivityInput): ToolActivityDescriptor => {
  const record = recordOf(input)
  const normalized = normalizedTool(tool)
  const leaf = toolLeaf(tool)
  if (normalized.startsWith('mcp__')) {
    const source = integrationSource?.trim() || tool.split('__')[1]?.trim()
    return { type: 'integration', ...(source ? { source } : {}) }
  }
  if (
    normalized.startsWith('web__') ||
    normalized === 'web.run' ||
    normalized.endsWith('.web.run')
  ) {
    return { type: 'web_search' }
  }
  if (leaf === 'read') {
    const skillName = textOf(recordOf(recordOf(details).skill), 'name')
    if (skillName) return { type: 'read', subject: 'skill', target: { displayLabel: skillName } }
    return {
      type: 'read',
      subject: 'file',
      target: toolActivityTarget(textOf(record, 'file_path', 'filePath', 'path'), workspace),
    }
  }
  if (leaf === 'grep') {
    const query = textOf(record, 'pattern', 'query')
    const path = toolActivityTarget(textOf(record, 'path'), workspace)
    return { type: 'search', ...(query ? { query } : {}), ...(path ? { path } : {}) }
  }
  if (leaf === 'glob') {
    return { type: 'list_files', path: toolActivityTarget(textOf(record, 'path'), workspace) }
  }
  if (leaf === 'write' || leaf === 'edit' || leaf === 'apply_patch') {
    return { type: 'file_change', changes: fileChanges(tool, record, details, workspace) }
  }
  if (leaf === 'skill_read') {
    const name = textOf(record, 'name')
    return {
      type: 'read',
      subject: 'skill',
      ...(name ? { target: { displayLabel: name } } : {}),
    }
  }
  if (normalized === 'toolsearch' || normalized === 'tool_search' || normalized === 'tool.search') {
    const selected = selectedToolName(record, details)
    return selected
      ? { type: 'tool', mode: 'load', name: selected }
      : { type: 'tool', mode: 'search', name: textOf(record, 'query') }
  }
  const rawCommand = command?.trim() || textOf(record, 'command')
  if (
    rawCommand &&
    (leaf === 'bash' ||
      leaf === 'powershell' ||
      normalized === 'bash' ||
      normalized === 'powershell')
  ) {
    return classifyShell(rawCommand, record, workspace)
  }
  return { type: 'tool', mode: 'call', name: tool.trim() || undefined }
}

export const storedToolActivity = (value: unknown): ToolActivityDescriptor | undefined =>
  isToolActivityDescriptor(value) ? value : undefined
