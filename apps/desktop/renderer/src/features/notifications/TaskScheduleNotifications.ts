import type { DesktopClient } from '../../services/desktop-client/Types.js'
import type { DesktopNotificationIpcBridge } from '@pidex/shared/desktop-notification-ipc'
import type { TaskOccurrence, TaskSchedule, TaskScheduleLink } from '@pidex/shared/task-schedule'
import type { TaskNotificationDispatcher } from './TaskNotificationDispatcher.js'
export type TaskNotificationState = {
  attention: TaskOccurrence[]
  tasks: readonly TaskSchedule[]
  links: readonly TaskScheduleLink[]
}

export async function sendTaskScheduleNotifications(
  client: Pick<DesktopClient, 'getRuntimeCapabilities' | 'taskSchedule'>,
  bridge: DesktopNotificationIpcBridge | undefined,
  dispatcher?: Pick<TaskNotificationDispatcher, 'trackAutomationRun' | 'releaseAutomationRun'>,
): Promise<TaskNotificationState> {
  if (!(await client.getRuntimeCapabilities()).includes('task.schedule.v1'))
    return { attention: [], tasks: [], links: [] }
  const { occurrences, tasks, links } = await client.taskSchedule('task-schedule/list', {})
  for (const occurrence of occurrences) {
    const runId = `task-schedule:${occurrence.id}`
    const threadId = occurrence.threadId ?? occurrence.snapshot.execution?.targetThreadId
    if (
      threadId &&
      ['dispatching', 'running', 'checking', 'awaiting-acceptance'].includes(occurrence.status)
    )
      dispatcher?.trackAutomationRun(runId, threadId)
    else dispatcher?.releaseAutomationRun(runId)
  }
  const attention = occurrences.filter((occurrence) => occurrence.attention)
  if (!bridge) return { attention, tasks, links }
  for (const occurrence of occurrences) {
    if (
      !occurrence.attention ||
      occurrence.reminderAt === null ||
      occurrence.reminderAt > Date.now() ||
      occurrence.notifiedVersion >= occurrence.reminderVersion
    )
      continue
    try {
      await client.taskSchedule('task-schedule/notify', {
        id: occurrence.id,
        reminderVersion: occurrence.reminderVersion,
      })
      await bridge.showDesktopNotification({
        notificationId: `task-attention:${occurrence.id}:${occurrence.reminderVersion}`,
        taskId: occurrence.taskId,
        occurrenceId: occurrence.id,
        kind: occurrence.attention === 'awaiting-acceptance' ? 'task-acceptance' : 'task-due',
        body: occurrence.snapshot.name.slice(0, 200),
        visibility: 'always',
      })
    } catch {
      // 另一窗口已领取或用户已处理时，不重复发送。
    }
  }
  return { attention, tasks, links }
}
