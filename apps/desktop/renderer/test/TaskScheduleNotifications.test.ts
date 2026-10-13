import { expect, test } from 'bun:test'
import { defaultTaskSchedule, type TaskOccurrence } from '@pidex/shared/task-schedule'
import { sendTaskScheduleNotifications } from '../src/features/notifications/TaskScheduleNotifications'
import type { DesktopClient } from '../src/services/desktop-client/Types'

test('待验收保持会话完成通知抑制，查看和关闭通知不解除；验收后解除', async () => {
  const task = {
    ...defaultTaskSchedule('验收结果'),
    id: 'task',
    revision: 1,
    readyAt: null,
    nextRunAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
  const occurrence: TaskOccurrence = {
    id: 'occurrence',
    taskId: task.id,
    revision: 1,
    scheduledFor: 1,
    status: 'awaiting-acceptance',
    executionSucceeded: true,
    resultVersion: 1,
    result: '结果',
    feedback: '',
    snapshot: task,
    scheduledTaskId: null,
    threadId: 'thread',
    attention: 'awaiting-acceptance',
    reminderAt: 1,
    reminderVersion: 1,
    notifiedVersion: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  const tracked: string[] = []
  const released: string[] = []
  const dispatcher = {
    trackAutomationRun: (id: string, threadId: string) => {
      tracked.push(`${id}:${threadId}`)
    },
    releaseAutomationRun: (id: string) => {
      released.push(id)
    },
  }
  const client = {
    getRuntimeCapabilities: async () => ['task.schedule.v1'],
    taskSchedule: async () => ({ occurrences: [occurrence], tasks: [task], links: [] }),
  } as unknown as Pick<DesktopClient, 'getRuntimeCapabilities' | 'taskSchedule'>
  const pending = await sendTaskScheduleNotifications(client, undefined, dispatcher)
  expect(pending.attention).toHaveLength(1)
  expect(tracked).toEqual(['task-schedule:occurrence:thread'])
  expect(released).toHaveLength(0)
  occurrence.status = 'completed'
  occurrence.attention = null
  expect(
    (await sendTaskScheduleNotifications(client, undefined, dispatcher)).attention,
  ).toHaveLength(0)
  expect(released).toEqual(['task-schedule:occurrence'])
})
