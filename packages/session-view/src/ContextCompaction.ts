import type { ContextCompactionOperation, Item } from '@pidex/shared/thread'
import type { EventEnvelope } from '@pidex/agent-protocol'

export function contextCompactionItem(
  payload: Extract<EventEnvelope, { type: 'context/compacted' }>['payload'],
  anchor: { turnId: string; agentId: string; createdAt: number },
): Extract<Item, { type: 'activity' }> {
  const itemId = `activity:context-compression:${payload.compactionId}`
  const detailParts = [
    `消息 ${payload.beforeCount} → ${payload.afterCount}`,
    `Token ${payload.beforeTokens} → ${payload.afterTokens}`,
  ]
  if (payload.trigger) detailParts.push(`触发方式：${payload.trigger}`)
  if (payload.afterTokensSource) {
    detailParts.push(`压缩后用量来源：${payload.afterTokensSource}`)
  }
  return {
    id: itemId,
    messageID: itemId,
    turnId: anchor.turnId,
    agentId: anchor.agentId,
    type: 'activity',
    activity: 'context-compression',
    title: payload.trigger === 'manual' ? '上下文已压缩' : '上下文已自动压缩',
    compaction: {
      source: payload.trigger ?? 'automatic',
      startedAt: anchor.createdAt,
      standalone: false,
    },
    contextTokens: payload.afterTokens,
    detail: detailParts.join('；'),
    status: 'completed',
    createdAt: anchor.createdAt,
  }
}

export function contextCompactionOperationItem(
  operation: ContextCompactionOperation,
  anchor: { turnId: string; agentId: string; standalone?: boolean },
  result?: Extract<Item, { type: 'activity' }>,
): Extract<Item, { type: 'activity' }> {
  const id = `activity:context-compression-operation:${operation.operationId}`
  const active = operation.status === 'queued' || operation.status === 'running'
  const completed = operation.status === 'completed'
  return {
    ...result,
    id,
    messageID: id,
    turnId: anchor.turnId,
    agentId: anchor.agentId,
    type: 'activity',
    activity: 'context-compression',
    title: active
      ? '正在压缩上下文'
      : completed
        ? operation.trigger === 'manual'
          ? '上下文已压缩'
          : '上下文已自动压缩'
        : '压缩已中断',
    status: active ? 'running' : completed ? 'completed' : 'interrupted',
    compaction: {
      source: operation.trigger,
      startedAt: operation.createdAt,
      standalone:
        operation.trigger === 'manual' && (operation.turnId === null || anchor.standalone === true),
    },
    createdAt: operation.createdAt,
  }
}
