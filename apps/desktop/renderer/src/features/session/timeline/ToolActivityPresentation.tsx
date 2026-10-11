import React from 'react'
import {
  BookOpen,
  Clock,
  Files,
  Globe2,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { Item, ToolActivityTarget } from '@pidex/shared/thread'

import { useConversationItemContext } from './ConversationItemContext.js'

type ToolItem = Extract<Item, { type: 'tool' }>

export type ToolSemanticKind =
  'file-change' | 'exploration' | 'command' | 'web-search' | 'integration' | 'loaded-tool' | 'tool'

export type ToolActivityIconKind =
  | 'read'
  | 'skill'
  | 'search'
  | 'list-files'
  | 'file-change'
  | 'command'
  | 'current-time'
  | 'web-search'
  | 'integration'
  | 'tool'

export type ToolActivitySegment =
  | { kind: 'verb' | 'text' | 'target' | 'duration'; text: string }
  | { kind: 'file'; text: string; workspacePath?: string }

export type ToolSemanticSummary = {
  collapsedLabel: string
  expandedLabel: string
  iconKind: ToolActivityIconKind
  kind: ToolSemanticKind
  segments: readonly ToolActivitySegment[]
  toolLabel: string
}

const isActiveToolState = (state: ToolItem['state']): boolean =>
  state === 'pending' || state === 'waiting-permission' || state === 'running'

const oneLine = (value: string | null | undefined): string | null =>
  value?.replace(/\s+/g, ' ').trim() || null

const stateVerb = (
  item: ToolItem,
  labels: { completed: string; error: string; interrupted: string; running: string },
): string =>
  item.state === 'completed'
    ? labels.completed
    : item.state === 'error'
      ? labels.error
      : item.state === 'interrupted'
        ? labels.interrupted
        : labels.running

const summary = (
  segments: readonly ToolActivitySegment[],
  iconKind: ToolActivityIconKind,
  kind: ToolSemanticKind,
  toolLabel: string,
): ToolSemanticSummary => {
  const collapsedLabel = segments.map((segment) => segment.text).join('')
  return {
    collapsedLabel,
    expandedLabel: collapsedLabel,
    iconKind,
    kind,
    segments,
    toolLabel,
  }
}

const targetSegment = (target: ToolActivityTarget): ToolActivitySegment => ({
  kind: 'file',
  text: target.displayLabel,
  ...(target.workspacePath ? { workspacePath: target.workspacePath } : {}),
})

export function formatToolDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.ceil(Math.max(0, durationMs) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainSec = seconds % 60
  return remainSec === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainSec} 秒`
}

function commandDuration(item: ToolItem, nowMs?: number): string | null {
  if (!isActiveToolState(item.state) && item.durationMs !== null) {
    return formatToolDuration(item.durationMs)
  }
  const duration =
    isActiveToolState(item.state) && item.startedAt !== null && nowMs !== undefined
      ? Math.max(0, nowMs - item.startedAt)
      : null
  return duration !== null && duration >= 1_000 ? formatToolDuration(duration) : null
}

export function cleanCommandSummary(command: string): string {
  const trimmed = command.trim()
  const cdPattern = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i
  const stripped = trimmed.replace(cdPattern, '').trim()
  return stripped || trimmed
}

function commandStateSegments(
  item: ToolItem,
  target: readonly ToolActivitySegment[],
  duration: string | null,
): ToolActivitySegment[] {
  const verb = stateVerb(item, {
    completed: '已运行',
    error: '运行失败',
    interrupted: '已停止执行',
    running: '正在运行',
  })
  const segments: ToolActivitySegment[] = []
  if (verb) {
    segments.push({ kind: 'verb', text: `${verb} ` })
  }
  segments.push(...target)
  if (duration) segments.push({ kind: 'duration', text: ` · ${duration}` })
  return segments
}

export function buildToolSemanticSummary(
  item: ToolItem,
  options: { nowMs?: number } = {},
): ToolSemanticSummary {
  const activity = item.activity
  if (!activity) {
    const rawCommand = oneLine(item.command)
    if (rawCommand) {
      const command = cleanCommandSummary(rawCommand)
      const duration = commandDuration(item, options.nowMs)
      const segments = commandStateSegments(item, [{ kind: 'target', text: command }], duration)
      return summary(segments, 'command', 'command', '命令')
    }
    const verb = stateVerb(item, {
      completed: '已调用工具',
      error: '工具调用失败',
      interrupted: '已停止调用工具',
      running: '正在调用工具',
    })
    return summary(
      [
        { kind: 'verb', text: `${verb} ` },
        { kind: 'target', text: item.tool },
      ],
      'tool',
      'tool',
      '工具',
    )
  }

  switch (activity.type) {
    case 'read': {
      const skill = activity.subject === 'skill'
      const verb = stateVerb(item, {
        completed: '已读取',
        error: '读取失败',
        interrupted: '已停止读取',
        running: '正在读取',
      })
      const segments: ToolActivitySegment[] = [{ kind: 'verb', text: verb }]
      if (activity.target) {
        segments.push({ kind: 'text', text: ' ' }, targetSegment(activity.target))
      }
      if (skill) segments.push({ kind: 'text', text: ' 技能' })
      else if (!activity.target) segments.push({ kind: 'text', text: '文件' })
      return summary(
        segments,
        skill ? 'skill' : 'read',
        skill ? 'loaded-tool' : 'exploration',
        skill ? '技能' : '文件读取',
      )
    }
    case 'search': {
      const query = oneLine(activity.query)
      if (activity.filesOnly) {
        const verb = stateVerb(item, {
          completed: '已搜索文件',
          error: '搜索文件失败',
          interrupted: '已停止搜索文件',
          running: '正在搜索文件',
        })
        return summary([{ kind: 'verb', text: verb }], 'search', 'exploration', '文件搜索')
      }
      const verb = stateVerb(
        item,
        activity.path
          ? {
              completed: '已在',
              error: '在',
              interrupted: '已停止在',
              running: '正在',
            }
          : {
              completed: '已搜索',
              error: '搜索失败',
              interrupted: '已停止搜索',
              running: '正在搜索',
            },
      )
      const segments: ToolActivitySegment[] = [{ kind: 'verb', text: verb }]
      if (activity.path) {
        segments.push({ kind: 'text', text: ' ' }, targetSegment(activity.path), {
          kind: 'text',
          text: item.state === 'error' ? ' 中搜索失败' : ' 中搜索',
        })
      }
      if (query) segments.push({ kind: 'target', text: `“${query}”` })
      return summary(segments, 'search', 'exploration', '内容搜索')
    }
    case 'list_files': {
      const verb = stateVerb(item, {
        completed: '已列出',
        error: '列出失败',
        interrupted: '已停止列出',
        running: '正在列出',
      })
      const segments: ToolActivitySegment[] = [{ kind: 'verb', text: verb }]
      if (activity.path) {
        segments.push({ kind: 'text', text: ' ' }, targetSegment(activity.path), {
          kind: 'text',
          text: ' 中的文件',
        })
      } else {
        segments.push({ kind: 'text', text: '文件' })
      }
      return summary(segments, 'list-files', 'exploration', '文件列表')
    }
    case 'file_change': {
      const verb = stateVerb(item, {
        completed: '已编辑文件',
        error: '编辑文件失败',
        interrupted: '已停止编辑文件',
        running: '正在编辑文件',
      })
      return summary([{ kind: 'verb', text: verb }], 'file-change', 'file-change', '文件编辑')
    }
    case 'command': {
      const special = activity.kind === 'current_time'
      const skillScript = activity.kind === 'skill_script'
      let segments: ToolActivitySegment[]
      if (special) {
        const verb = stateVerb(item, {
          completed: '已检查当前日期和时间',
          error: '检查当前日期和时间失败',
          interrupted: '已停止检查当前日期和时间',
          running: '正在检查当前日期和时间',
        })
        segments = [{ kind: 'verb', text: verb }]
      } else if (skillScript) {
        const target: ToolActivitySegment[] = []
        if (activity.skillName) {
          target.push(
            { kind: 'target', text: activity.skillName },
            { kind: 'text', text: ' 技能中的脚本 ' },
          )
        } else {
          target.push({ kind: 'text', text: '技能脚本 ' })
        }
        target.push({
          kind: 'target',
          text: activity.scriptName ?? cleanCommandSummary(oneLine(item.command) ?? item.tool),
        })
        segments = commandStateSegments(item, target, commandDuration(item, options.nowMs))
      } else {
        segments = commandStateSegments(
          item,
          [{ kind: 'target', text: cleanCommandSummary(oneLine(item.command) ?? item.tool) }],
          commandDuration(item, options.nowMs),
        )
      }
      if (special) {
        const duration = commandDuration(item, options.nowMs)
        if (duration) segments.push({ kind: 'duration', text: ` · ${duration}` })
      }
      return summary(
        segments,
        special ? 'current-time' : 'command',
        'command',
        special ? '时间' : '命令',
      )
    }
    case 'web_search': {
      const verb = stateVerb(item, {
        completed: '已搜索网页',
        error: '搜索网页失败',
        interrupted: '已停止搜索网页',
        running: '正在搜索网页',
      })
      return summary([{ kind: 'verb', text: verb }], 'web-search', 'web-search', '网页搜索')
    }
    case 'integration': {
      const verb = stateVerb(item, {
        completed: '已使用',
        error: '使用失败',
        interrupted: '已停止使用',
        running: '正在使用',
      })
      const segments: ToolActivitySegment[] = [{ kind: 'verb', text: verb }]
      if (activity.source)
        segments.push({ kind: 'text', text: ' ' }, { kind: 'target', text: activity.source })
      else segments.push({ kind: 'text', text: '集成' })
      return summary(segments, 'integration', 'integration', activity.source ?? '集成')
    }
    case 'tool': {
      const loading = activity.mode === 'load'
      const searching = activity.mode === 'search'
      const verb = stateVerb(
        item,
        searching
          ? {
              completed: '已搜索工具',
              error: '搜索工具失败',
              interrupted: '已停止搜索工具',
              running: '正在搜索工具',
            }
          : loading
            ? {
                completed: '已加载工具',
                error: '加载工具失败',
                interrupted: '已停止加载工具',
                running: '正在加载工具',
              }
            : {
                completed: '已调用工具',
                error: '工具调用失败',
                interrupted: '已停止调用工具',
                running: '正在调用工具',
              },
      )
      const segments: ToolActivitySegment[] = [{ kind: 'verb', text: verb }]
      if (activity.name && !searching)
        segments.push({ kind: 'text', text: ' ' }, { kind: 'target', text: activity.name })
      return summary(
        segments,
        loading ? 'skill' : 'tool',
        loading ? 'loaded-tool' : 'tool',
        loading ? '工具加载' : '工具',
      )
    }
  }
}

export function toolSemanticIcon(kind: ToolActivityIconKind | ToolSemanticKind): LucideIcon {
  switch (kind) {
    case 'read':
      return BookOpen
    case 'search':
    case 'exploration':
      return Search
    case 'list-files':
      return Files
    case 'file-change':
      return Pencil
    case 'current-time':
      return Clock
    case 'command':
      return SquareTerminal
    case 'web-search':
      return Globe2
    case 'skill':
    case 'loaded-tool':
    case 'integration':
    case 'tool':
      return Wrench
  }
}

export function isExplorationToolActivity(item: ToolItem): boolean {
  return (
    (item.activity?.type === 'read' && item.activity.subject === 'file') ||
    item.activity?.type === 'search' ||
    item.activity?.type === 'list_files'
  )
}

export function ToolActivityHeader({
  canExpand,
  children,
  contentId,
  expanded,
  label,
  onToggle,
}: {
  canExpand: boolean
  children: React.ReactNode
  contentId: string
  expanded: boolean
  label: string
  onToggle: () => void
}): React.ReactNode {
  return (
    <div className="cpx-agent-activity__item-header cpx-agent-activity__item-header--tool tw:relative tw:isolate">
      <button
        aria-controls={canExpand ? contentId : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={label}
        className="cpx-agent-activity__item-toggle"
        disabled={!canExpand}
        onClick={onToggle}
        type="button"
      />
      {children}
    </div>
  )
}

function ToolActivityFileLink({ path, text }: { path: string; text: string }): React.ReactNode {
  const { onOpenFileReference } = useConversationItemContext()
  return (
    <button
      aria-label={`打开文件 ${text}`}
      className="cpx-agent-activity__file-link"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpenFileReference({ path }, { preview: true })
      }}
      title={text}
      type="button"
    >
      {text}
    </button>
  )
}

export function ToolActivityLabel({
  summary: value,
}: {
  summary: ToolSemanticSummary
}): React.ReactNode {
  return (
    <span className="cpx-agent-activity__label">
      {value.segments.map((segment, index) => {
        const key = `${segment.kind}:${index}:${segment.text}`
        if (segment.kind === 'file' && segment.workspacePath) {
          return <ToolActivityFileLink key={key} path={segment.workspacePath} text={segment.text} />
        }
        return (
          <span
            className={
              segment.kind === 'verb'
                ? 'cpx-agent-activity__verb'
                : segment.kind === 'file'
                  ? 'cpx-agent-activity__target'
                  : segment.kind === 'target'
                    ? 'cpx-agent-activity__target'
                    : segment.kind === 'duration'
                      ? 'cpx-agent-activity__duration'
                      : undefined
            }
            key={key}
          >
            {segment.text}
          </span>
        )
      })}
    </span>
  )
}
