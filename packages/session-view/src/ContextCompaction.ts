import type { Item } from '@pidex/shared/thread'
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
    title: '上下文已压缩',
    contextTokens: payload.afterTokens,
    detail: detailParts.join('；'),
    status: 'completed',
    createdAt: anchor.createdAt,
  }
}
