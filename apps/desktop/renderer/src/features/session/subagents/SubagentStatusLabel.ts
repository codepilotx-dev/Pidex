export function subagentStatusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已停止'
  if (status === 'interrupted') return '已中断'
  if (status === 'queued') return '排队中'
  if (status === 'waiting-question') return '等待回答'
  if (status === 'waiting-permission') return '等待审批'
  if (status === 'steering') return '调整中'
  return '运行中'
}
