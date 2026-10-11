import { FULL_ACCESS_PERMISSION_CONFIG } from '@pidex/shared/thread'
import type { Automation, AutomationRun, AutomationSchedule } from '@pidex/shared/automation'
import type { DesktopSessionListItem } from '../../../shared/Types.js'

export type AutomationFilter = 'all' | 'active' | 'paused' | 'completed'
export type AutomationTemplateId = 'daily-brief' | 'weekly-review' | 'follow-up-monitor'

export type AutomationTemplate = {
  id: AutomationTemplateId
  name: string
  description: string
  prompt: string
  schedule: AutomationSchedule
  tone: 'info' | 'skill' | 'success'
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'daily-brief',
    name: '每日简报',
    description: '以日历、未读邮件和优先事项摘要开启每个工作日',
    prompt: '为我整理晨间简报，包括今天的日历、重要未读邮件，以及今天需要我关注的事项。',
    schedule: { mode: 'weekdays', time: '08:00' },
    tone: 'info',
  },
  {
    id: 'weekly-review',
    name: '每周回顾',
    description: '每周五把最近的工作整理成简明的状态更新',
    prompt: '回顾我本周处理的工作，并起草一份简短的状态更新。',
    schedule: { mode: 'weekly', weekdays: ['FR'], time: '16:00' },
    tone: 'skill',
  },
  {
    id: 'follow-up-monitor',
    name: '跟进监控',
    description: '查看最近的邮件和日历活动，并标记需要关注的事项',
    prompt: '查看最近的邮件和日历活动，突出有意义的变化，并标记需要我关注的事项。',
    schedule: { mode: 'weekdays', time: '09:00' },
    tone: 'success',
  },
]

export type AutomationDraft = Pick<
  Automation,
  | 'kind'
  | 'name'
  | 'prompt'
  | 'projectId'
  | 'targetThreadId'
  | 'execution'
  | 'model'
  | 'reasoningEffort'
  | 'permissionConfig'
  | 'schedule'
  | 'timeZone'
  | 'notificationPolicy'
>

export function defaultAutomationDraft(input: {
  projectId: string | null
  model: Automation['model']
  template?: AutomationTemplateId
}): AutomationDraft {
  const template = AUTOMATION_TEMPLATES.find((item) => item.id === input.template)
  return {
    kind: 'standalone',
    name: template?.name ?? '',
    prompt: template?.prompt ?? '',
    projectId: input.projectId,
    targetThreadId: null,
    execution: { kind: 'local' },
    model: input.model,
    reasoningEffort: null,
    permissionConfig: {
      ...FULL_ACCESS_PERMISSION_CONFIG,
      sandboxMode: 'workspace-write',
    },
    schedule: template?.schedule ?? { mode: 'daily', time: '09:00' },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    notificationPolicy: 'all',
  }
}

export function hasActiveAutomationRun(
  automationId: string,
  runs: readonly AutomationRun[],
): boolean {
  return runs.some(
    (run) =>
      run.automationId === automationId &&
      ['claimed', 'preparing', 'queued', 'running'].includes(run.status),
  )
}

export function isCompletedAutomation(
  automation: Automation,
  runs: readonly AutomationRun[],
): boolean {
  return (
    automation.status === 'active' &&
    automation.nextRunAt === null &&
    !hasActiveAutomationRun(automation.id, runs)
  )
}

export function automationToDraft(value: Automation): AutomationDraft {
  return {
    kind: value.kind,
    name: value.name,
    prompt: value.prompt,
    projectId: value.projectId,
    targetThreadId: value.targetThreadId,
    execution: value.execution,
    model: value.model,
    reasoningEffort: value.reasoningEffort,
    permissionConfig: value.permissionConfig,
    schedule: value.schedule,
    timeZone: value.timeZone,
    notificationPolicy: value.notificationPolicy,
  }
}

export function validateAutomationDraft(draft: AutomationDraft): string | null {
  if (!draft.name.trim()) return '请输入自动化名称。'
  if (!draft.prompt.trim()) return '请输入要执行的任务。'
  if (draft.kind === 'standalone' && !draft.projectId) return '请选择项目。'
  if (draft.kind === 'thread' && !draft.targetThreadId) return '请选择目标聊天。'
  if (draft.execution?.kind === 'new-worktree' && !draft.execution.branchName.trim()) {
    return '请输入 Worktree 的基础分支。'
  }
  if (draft.schedule.mode === 'custom' && !draft.schedule.rrule.trim()) return '请输入 RRULE。'
  return null
}

export function automationScheduleSummary(schedule: AutomationSchedule): string {
  if (schedule.mode === 'hourly') return `每 ${schedule.intervalMinutes} 分钟`
  if (schedule.mode === 'daily') return `每天 ${schedule.time}`
  if (schedule.mode === 'weekdays') return `工作日 ${schedule.time}`
  if (schedule.mode === 'weekly') {
    const labels: Record<string, string> = {
      MO: '周一',
      TU: '周二',
      WE: '周三',
      TH: '周四',
      FR: '周五',
      SA: '周六',
      SU: '周日',
    }
    return `${schedule.weekdays.map((day) => labels[day] ?? day).join('、')} ${schedule.time}`
  }
  return schedule.rrule
}

export function automationTargetLabel(
  automation: Pick<Automation, 'kind' | 'projectId' | 'targetThreadId'>,
  projectNames: ReadonlyMap<string, string>,
  sessions: readonly DesktopSessionListItem[],
): string {
  if (automation.kind === 'standalone') {
    return automation.projectId
      ? (projectNames.get(automation.projectId) ?? '项目已移除')
      : '未选择项目'
  }
  const thread = sessions.find((item) => item.id === automation.targetThreadId)
  return thread?.customTitle ?? thread?.aiTitle ?? thread?.sessionName ?? '聊天已不可用'
}

export function formatAutomationTime(value: number | null): string {
  if (value === null) return '未安排'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

export function formatAutomationRelativeTime(value: number | null): string {
  if (value === null) return '未安排'
  const minutes = Math.round((value - Date.now()) / 60_000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  return formatter.format(Math.round(hours / 24), 'day')
}

export function runStatusLabel(status: AutomationRun['status']): string {
  return {
    claimed: '已领取',
    preparing: '准备中',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    interrupted: '已中断',
  }[status]
}

export function runTriggerLabel(trigger: AutomationRun['trigger']): string {
  return {
    scheduled: '计划运行',
    'startup-catch-up': '启动补跑',
    'overlap-catch-up': '重叠补跑',
    manual: '手动运行',
  }[trigger]
}
