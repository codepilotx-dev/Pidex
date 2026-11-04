import type { SubagentStatus } from '@pidex/shared/thread'

export function subagentStatusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已停止'
  if (status === 'interrupted') return '已中断'
  if (status === 'queued') return '排队中'
  if (status === 'preparing') return '准备中'
  if (status === 'waiting-question') return '等待回答'
  if (status === 'waiting-permission') return '等待审批'
  if (status === 'steering') return '调整中'
  return '运行中'
}

const TERMINAL_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  'completed',
  'failed',
  'stopped',
  'interrupted',
])

export function isTerminalSubagentStatus(status: SubagentStatus | null | undefined): boolean {
  return Boolean(status && TERMINAL_STATUSES.has(status))
}

/** 状态词只在需要用户注意时展示；completed 不额外加状态词。 */
export function subagentAttentionLabel(status: SubagentStatus): string | null {
  if (status === 'waiting-question' || status === 'waiting-permission') {
    return subagentStatusLabel(status)
  }
  if (status === 'failed' || status === 'stopped' || status === 'interrupted') {
    return subagentStatusLabel(status)
  }
  return null
}
