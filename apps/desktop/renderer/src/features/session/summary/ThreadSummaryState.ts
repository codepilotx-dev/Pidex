import * as React from 'react'

/** Agent 全部结束后延迟自动折叠该分区的等待时间。 */
export const THREAD_SUMMARY_AGENTS_AUTO_COLLAPSE_DELAY_MS = 30_000

export type ThreadSummaryAgentsCollapseDecision = 'idle' | 'reset-override' | 'schedule-collapse'

/**
 * Agent 分区自动折叠决策：有活动 Agent 时清除手动覆盖；全部结束后若用户没有
 * 手动操作过该分区，则安排延迟折叠。手动折叠选择始终优先。
 */
export function resolveThreadSummaryAgentsAutoCollapse(input: {
  activeCount: number
  manualOverride: boolean
  totalCount: number
}): ThreadSummaryAgentsCollapseDecision {
  if (input.totalCount === 0) return 'idle'
  if (input.activeCount > 0) return 'reset-override'
  if (input.manualOverride) return 'idle'
  return 'schedule-collapse'
}

export function useThreadSummaryController() {
  const [isPopoverOpen, setPopoverOpen] = React.useState(false)
  return { isPopoverOpen, setPopoverOpen }
}
