import { describe, expect, test } from 'bun:test'
import type { Automation, AutomationRun } from '@pidex/shared/automation'
import type { ModelRef } from '@pidex/shared/model'
import { ThreadAutomationRunExecutor } from '../src/automation/ThreadAutomationRunExecutor'
import type { ThreadService } from '../src/session/ThreadService'
import type { AutomationRepository } from '../src/storage/repositories/AutomationRepository'
import type { ManagedWorktreeService } from '../src/worktree/ManagedWorktreeService'
import type { ThreadExecutionPreparationService } from '../src/worktree/ThreadExecutionPreparationService'

const model = { providerID: 'openai', id: 'codex' } as unknown as ModelRef
const base: Automation = {
  id: 'automation:1',
  revision: 1,
  kind: 'standalone',
  name: '检查',
  prompt: '执行检查',
  status: 'active',
  projectId: 'project:1',
  targetThreadId: null,
  execution: { kind: 'local' },
  model,
  reasoningEffort: null,
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
  },
  schedule: { mode: 'daily', time: '09:00' },
  canonicalRrule: 'FREQ=DAILY',
  timeZone: 'Asia/Shanghai',
  notificationPolicy: 'all',
  nextRunAt: null,
  pendingCatchUp: false,
  activeRunId: 'run:1',
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
}
const run: AutomationRun = {
  id: 'run:1',
  automationId: base.id,
  trigger: 'manual',
  scheduledFor: 1,
  status: 'claimed',
  threadId: null,
  turnId: null,
  worktreeId: null,
  readAt: null,
  safeErrorCode: null,
  createdAt: 1,
  startedAt: null,
  completedAt: null,
}

describe('ThreadAutomationRunExecutor', () => {
  test('独立任务复用 execution prepare/bind/reconcile 和 ThreadService', async () => {
    const calls: string[] = []
    const threads = {
      create: async (input: { bindExecution?: (id: string) => void }) => {
        calls.push('create')
        input.bindExecution?.('thread:1')
        return { id: 'thread:1' }
      },
      startTurn: async () => {
        calls.push('turn')
        return { turnID: 'turn:1' }
      },
    } as unknown as ThreadService
    const preparation = {
      prepare: async () => ({
        bind: () => calls.push('bind'),
        abort: async () => {},
        reconcile: async () => {
          calls.push('reconcile')
          return null
        },
      }),
    } as unknown as ThreadExecutionPreparationService
    const executor = new ThreadAutomationRunExecutor(
      { targetThreadAvailable: () => true } as unknown as AutomationRepository,
      threads,
      {} as ManagedWorktreeService,
      preparation,
    )
    expect(await executor.start(base, run)).toEqual({
      threadId: 'thread:1',
      turnId: 'turn:1',
      worktreeId: null,
    })
    expect(calls).toEqual(['create', 'bind', 'reconcile', 'turn'])
  })

  test('固定聊天任务使用 follow-up queue 并拒绝不可用目标', async () => {
    const threads = {
      enqueueFollowUp: async () => ({ turnID: 'turn:queue' }),
    } as unknown as ThreadService
    const threadAutomation: Automation = {
      ...base,
      kind: 'thread',
      projectId: null,
      targetThreadId: 'thread:target',
      execution: null,
    }
    const executor = new ThreadAutomationRunExecutor(
      { targetThreadAvailable: () => true } as unknown as AutomationRepository,
      threads,
      {} as ManagedWorktreeService,
      {} as ThreadExecutionPreparationService,
    )
    expect(await executor.start(threadAutomation, run)).toEqual({
      threadId: 'thread:target',
      turnId: 'turn:queue',
      worktreeId: null,
    })
    const unavailable = new ThreadAutomationRunExecutor(
      { targetThreadAvailable: () => false } as unknown as AutomationRepository,
      threads,
      {} as ManagedWorktreeService,
      {} as ThreadExecutionPreparationService,
    )
    expect(unavailable.start(threadAutomation, run)).rejects.toThrow()
  })
})
