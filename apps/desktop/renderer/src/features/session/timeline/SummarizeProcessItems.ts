import type { Item, TurnStatus } from '@pidex/shared/thread'

import { buildToolSemanticSummary, type ToolSemanticKind } from './ToolActivityPresentation.js'

export type ProcessSemanticKind = ToolSemanticKind | 'thinking' | 'failed'

export type ProcessSummary = {
  active: boolean
  failed: boolean
  kind: ProcessSemanticKind
  label: string
  summaryKey: string
}

export type TurnWorkSummary = {
  kind: 'working' | 'worked' | 'stopped'
  label: string
}

type ItemActivity = 'running' | 'completed' | 'failed'
type AggregateKind =
  | 'integration'
  | 'loaded-tool'
  | 'tool'
  | 'file-change'
  | 'stopped-file-creation'
  | 'exploration'
  | 'command'
  | 'web-search'
  | 'dynamic-tool'

type Aggregate = {
  key: string
  kind: AggregateKind
  label: string
  semanticKind: ToolSemanticKind
}

const AGGREGATE_ORDER: readonly AggregateKind[] = [
  'integration',
  'loaded-tool',
  'tool',
  'file-change',
  'stopped-file-creation',
  'exploration',
  'command',
  'web-search',
  'dynamic-tool',
]

function itemActivity(item: Item): ItemActivity {
  switch (item.type) {
    case 'tool':
      if (item.state === 'error' || item.state === 'interrupted') return 'failed'
      if (
        item.state === 'pending' ||
        item.state === 'waiting-permission' ||
        item.state === 'running'
      )
        return 'running'
      return 'completed'
    case 'reasoning':
      if (item.status === 'interrupted') return 'failed'
      return item.status === 'streaming' ? 'running' : 'completed'
    case 'activity':
      if (item.status === 'error' || item.status === 'interrupted') return 'failed'
      return item.status === 'running' ? 'running' : 'completed'
    case 'text':
      if (item.status === 'interrupted') return 'failed'
      return item.status === 'streaming' ? 'running' : 'completed'
    case 'subagent':
      if (item.status === 'stopped') return 'failed'
      if (
        item.status === 'running' ||
        item.status === 'queued' ||
        item.status === 'preparing' ||
        item.status === 'steering'
      )
        return 'running'
      return 'completed'
    default:
      return 'completed'
  }
}

export function processItemPathState(item: Item): ItemActivity {
  return itemActivity(item)
}

export function isProcessItemActive(item: Item): boolean {
  return itemActivity(item) === 'running'
}

function isActiveTurn(status: TurnStatus): boolean {
  return (
    status === 'running' ||
    status === 'waiting-permission' ||
    status === 'waiting-question' ||
    status === 'waiting-subagents'
  )
}

const aggregateForTool = (item: Extract<Item, { type: 'tool' }>): Aggregate => {
  const descriptor = item.activity
  if (descriptor?.type === 'integration') {
    const source = descriptor.source?.trim()
    return {
      key: `integration:${source ?? 'unknown'}`,
      kind: 'integration',
      label: source ? `使用 ${source}` : '使用集成',
      semanticKind: 'integration',
    }
  }
  if (
    (descriptor?.type === 'read' && descriptor.subject === 'skill') ||
    (descriptor?.type === 'tool' && descriptor.mode === 'load')
  ) {
    return {
      key: 'loaded-tool',
      kind: 'loaded-tool',
      label: '加载工具',
      semanticKind: 'loaded-tool',
    }
  }
  if (descriptor?.type === 'file_change') {
    const stoppedCreate =
      item.state === 'interrupted' &&
      descriptor.changes.some((change) => change.operation === 'create')
    return stoppedCreate
      ? {
          key: 'stopped-file-creation',
          kind: 'stopped-file-creation',
          label: '停止创建文件',
          semanticKind: 'file-change',
        }
      : { key: 'file-change', kind: 'file-change', label: '编辑文件', semanticKind: 'file-change' }
  }
  if (descriptor?.type === 'tool') {
    const unnamed = descriptor.mode === 'call' && !descriptor.name
    return unnamed
      ? { key: 'tool', kind: 'tool', label: '调用工具', semanticKind: 'tool' }
      : { key: 'dynamic-tool', kind: 'dynamic-tool', label: '调用工具', semanticKind: 'tool' }
  }
  const value = buildToolSemanticSummary(item)
  switch (value.kind) {
    case 'exploration':
      return {
        key: 'exploration',
        kind: 'exploration',
        label: '读取文件',
        semanticKind: 'exploration',
      }
    case 'command':
      return { key: 'command', kind: 'command', label: '运行命令', semanticKind: 'command' }
    case 'web-search':
      return {
        key: 'web-search',
        kind: 'web-search',
        label: '搜索网页',
        semanticKind: 'web-search',
      }
    case 'file-change':
      return {
        key: 'file-change',
        kind: 'file-change',
        label: '编辑文件',
        semanticKind: 'file-change',
      }
    case 'integration':
      return {
        key: 'integration:unknown',
        kind: 'integration',
        label: '使用集成',
        semanticKind: 'integration',
      }
    case 'loaded-tool':
      return {
        key: 'loaded-tool',
        kind: 'loaded-tool',
        label: '加载工具',
        semanticKind: 'loaded-tool',
      }
    case 'tool':
      return { key: 'tool', kind: 'tool', label: '调用工具', semanticKind: 'tool' }
  }
}

function completedAggregates(items: readonly Item[]): Aggregate[] {
  const values = new Map<string, Aggregate>()
  for (const item of items) {
    if (item.type === 'tool') {
      const value = aggregateForTool(item)
      values.set(value.key, value)
      continue
    }
    if (item.type === 'activity' && item.activity === 'file-edit') {
      values.set('file-change', {
        key: 'file-change',
        kind: 'file-change',
        label: '编辑文件',
        semanticKind: 'file-change',
      })
    }
    if (item.type === 'activity' && item.activity === 'build') {
      values.set('command', {
        key: 'command',
        kind: 'command',
        label: '运行命令',
        semanticKind: 'command',
      })
    }
    if (item.type === 'subagent') {
      values.set('tool', { key: 'tool', kind: 'tool', label: '调用工具', semanticKind: 'tool' })
    }
  }
  return [...values.values()].sort(
    (left, right) => AGGREGATE_ORDER.indexOf(left.kind) - AGGREGATE_ORDER.indexOf(right.kind),
  )
}

export function summarizeTurnProcessItems(
  items: readonly Item[],
  turnStatus: TurnStatus,
): ProcessSummary {
  const active = isActiveTurn(turnStatus)
  const parts = completedAggregates(items)
  const failed = items.some((item) => itemActivity(item) === 'failed')
  const label = parts.length > 0 ? parts.map((part) => part.label).join('、') : '处理过程'

  if (active) {
    return {
      active: true,
      failed: false,
      kind: parts[0]?.semanticKind ?? 'tool',
      label,
      summaryKey: `active:${items.map((item) => item.id).join('|') || 'thinking'}:${label}`,
    }
  }

  return {
    active: false,
    failed,
    kind: parts[0]?.semanticKind ?? (failed ? 'failed' : 'tool'),
    label,
    summaryKey: `completed:${failed ? 'failed' : 'ok'}:${parts.map((part) => part.key).join('|') || 'processed'}`,
  }
}

export function formatProcessElapsed(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  if (totalSeconds <= 0) return ''
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const remainSeconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (remainSeconds > 0) parts.push(`${remainSeconds}s`)
  return parts.join(' ')
}

export function summarizeTurnWork(
  turnStatus: TurnStatus,
  elapsedSeconds: number,
): TurnWorkSummary | null {
  if (turnStatus === 'queued') return null
  const elapsed = formatProcessElapsed(elapsedSeconds)
  if (turnStatus === 'stopped' || turnStatus === 'interrupted' || turnStatus === 'cancelled') {
    return { kind: 'stopped', label: elapsed ? `你在 ${elapsed} 后停止了` : '你停止了' }
  }
  if (isActiveTurn(turnStatus)) {
    return { kind: 'working', label: elapsed ? `已处理 ${elapsed}` : '处理中' }
  }
  return { kind: 'worked', label: elapsed ? `已处理 ${elapsed}` : '已处理' }
}
