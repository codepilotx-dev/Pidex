import { describe, expect, test } from 'bun:test'
import type { Automation, AutomationRun } from '@pidex/shared/automation'
import type { EventEnvelope } from '@pidex/agent-protocol'
import { AutomationNotificationDispatcher } from '../src/features/notifications/AutomationNotificationDispatcher'
import {
  TaskNotificationDispatcher,
  type TaskNotificationSendRequest,
} from '../src/features/notifications/TaskNotificationDispatcher'
import type { DesktopAutomationApi } from '../src/services/desktop-client/Types'

const automation = (policy: Automation['notificationPolicy']): Automation => ({
  id: 'automation:1',
  revision: 1,
  kind: 'thread',
  name: '每日检查',
  prompt: '检查项目',
  status: 'active',
  projectId: null,
  targetThreadId: 'thread:1',
  execution: null,
  model: { providerID: 'openai', id: 'gpt-5' },
  reasoningEffort: null,
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    approvalsReviewer: 'auto_review',
  },
  schedule: { mode: 'daily', time: '09:00' },
  canonicalRrule: 'FREQ=DAILY;BYHOUR=9',
  timeZone: 'Asia/Shanghai',
  notificationPolicy: policy,
  nextRunAt: 2,
  pendingCatchUp: false,
  activeRunId: 'run:1',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
})
const run = (status: AutomationRun['status']): AutomationRun => ({
  id: 'run:1',
  automationId: 'automation:1',
  trigger: 'scheduled',
  scheduledFor: 1,
  status,
  threadId: 'thread:1',
  turnId: 'turn:1',
  worktreeId: null,
  readAt: null,
  safeErrorCode: null,
  createdAt: 1,
  startedAt: 1,
  completedAt: status === 'running' ? null : 2,
})
const event = (status: AutomationRun['status']) =>
  ({
    type: 'automation/runChanged',
    payload: { automationId: 'automation:1', runId: 'run:1', status, changedAt: 2 },
  }) as unknown as EventEnvelope

describe('AutomationNotificationDispatcher', () => {
  for (const [policy, status, expected] of [
    ['all', 'completed', 1],
    ['failures', 'completed', 0],
    ['failures', 'failed', 1],
    ['off', 'failed', 0],
  ] as const)
    test(`${policy} / ${status}`, async () => {
      let current = run('running')
      const definition = automation(policy)
      const api = {
        listAutomations: async () => ({ automations: [definition] }),
        readAutomation: async () => ({ automation: definition }),
        listAutomationRuns: async () => ({ runs: [current] }),
      } as unknown as DesktopAutomationApi
      const sent: TaskNotificationSendRequest[] = []
      const ordinary = new TaskNotificationDispatcher(() => undefined)
      const dispatcher = new AutomationNotificationDispatcher(api, ordinary, (request) =>
        sent.push(request),
      )
      await dispatcher.initialize()
      current = run(status)
      await dispatcher.ingest([event(status)])
      expect(sent).toHaveLength(expected)
      if (expected) expect(sent[0]?.threadId).toBe('thread:1')
    })
})
