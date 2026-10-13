import { afterEach, describe, expect, test } from 'bun:test'
import type { ModelRef } from '@pidex/shared/model'
import type { PermissionConfig } from '@pidex/shared/thread'
import type { ScheduleDraftSubmitInput } from '../src/calendar/SchedulePlanService'
import { SchedulePlanService } from '../src/calendar/SchedulePlanService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'

const databases: AgentDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
})

const model = { providerID: 'openai', id: 'codex' } as unknown as ModelRef
const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
} as unknown as PermissionConfig

const structuredPlan = {
  title: '登录页面改进',
  summary: '改善登录页的可用性与错误提示。',
  changes: [{ area: '桌面展示', items: ['调整登录表单布局'] }],
  interfaceChanges: [],
  tests: ['人工验收登录流程'],
  assumptions: [],
}

const rowCount = (db: AgentDatabase, table: 'scheduled_tasks' | 'automations') =>
  (db.sqlite.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pidex-schedule-draft-'))
  paths.push(root)
  const db = new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
  databases.push(db)
  const thread = db.createThread()
  const input = {
    content: '规划并安排',
    model,
    permissionConfig,
    strategy: 'start' as const,
    taskMode: 'plan' as const,
  }
  const turn = db.createTurn(thread.id, input)
  db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
  const drafts = db.repositories.scheduleDrafts
  const service = new SchedulePlanService(
    db,
    db.repositories.schedulePlanProposals,
    drafts,
    db.repositories.scheduledTasks,
    db.repositories.automations,
    {
      threadSettings: () => ({ permissionConfig }),
      threads: {
        withPlanAdmission: async (_threadId, operation) => {
          const feedbackTurn = db.createTurn(thread.id, {
            content: '把验收改成人工确认',
            model,
            permissionConfig,
            strategy: 'start',
            taskMode: 'plan',
          })
          return operation(
            async (_value, _inputId, transition) => {
              transition.beforeCreate()
              transition.afterCreate(feedbackTurn.turnID)
              return { turnID: feedbackTurn.turnID }
            },
            () => undefined,
          )
        },
      },
    },
  )
  const submit = (overrides: Partial<ScheduleDraftSubmitInput> = {}) =>
    service.submitDraft({
      threadId: thread.id,
      turnId: turn.turnID,
      toolCallId: `${turn.turnID}:schedule-draft`,
      name: '登录页面改进',
      prompt: '按已确认的计划改进登录页面',
      taskPlan: {
        source: 'current-plan-item',
        sourceRef: `${turn.turnID}:plan`,
        structured: structuredPlan,
      },
      trigger: { kind: 'once', at: 1_000_000, timeZone: 'Asia/Shanghai' },
      conditions: { dependsOn: [], requireEnvironment: false, notBefore: null, deadline: null },
      conditionFallback: 'skip',
      acceptance: { kind: 'manual' },
      notificationPolicy: 'failures',
      missedRuns: 'catch-up',
      execution: {
        kind: 'thread',
        projectId: null,
        targetThreadId: thread.id,
        environment: null,
        model,
        reasoningEffort: null,
        permissionConfig,
      },
      ...overrides,
    })
  return { db, thread, turn, service, submit }
}

describe('任务规划草案', () => {
  test('执行权限来自宿主会话配置，不继承 Plan 调查的临时只读上限', async () => {
    const { submit, thread } = await fixture()
    const draft = await submit({
      execution: {
        kind: 'thread',
        projectId: null,
        targetThreadId: thread.id,
        environment: null,
        model,
        reasoningEffort: null,
        permissionConfig: { ...permissionConfig, sandboxMode: 'read-only' },
      },
    })
    expect(draft.execution.permissionConfig.sandboxMode).toBe('workspace-write')
    expect(draft.execution.permissionConfig.approvalPolicy).toBe('never')
  })
  test('未接入的安排能保存与读取，但确认失败后仍为草案且没有执行任务', async () => {
    const cases: Partial<ScheduleDraftSubmitInput>[] = [
      { trigger: { kind: 'task-succeeded', taskId: 'upstream' } },
      { trigger: { kind: 'acceptance-passed', taskId: 'upstream' } },
      { acceptance: { kind: 'automatic', checks: [{ kind: 'file-exists', path: 'a.txt' }] } },
      ...[
        { dependsOn: ['upstream'] },
        { requireEnvironment: true },
        { notBefore: 1 },
        { deadline: 2 },
      ].map((condition) => ({
        conditions: {
          dependsOn: [],
          requireEnvironment: false,
          notBefore: null,
          deadline: null,
          ...condition,
        },
      })),
      { conditionFallback: 'wait' },
      { missedRuns: 'skip' },
    ]
    for (const arrangement of cases) {
      const { db, submit, service } = await fixture()
      const draft = await submit(arrangement)
      expect(service.readDraft(draft.id)).toEqual(draft)
      await expect(
        service.commitDraft({
          ...draft,
          expectedRevision: draft.revision,
          operationId: 'unsupported',
        }),
      ).rejects.toThrow('当前版本还不支持')
      expect(service.readDraft(draft.id)).toEqual(draft)
      expect(rowCount(db, 'scheduled_tasks')).toBe(0)
      expect(rowCount(db, 'automations')).toBe(0)
    }
  })

  test('提交只落盘待审阅草案，固定计划快照且不激活任何调度', async () => {
    const { db, thread, submit } = await fixture()
    const draft = await submit()
    expect(draft.status).toBe('pending')
    expect(draft.revision).toBe(1)
    expect(draft.taskPlan.contentHash).toHaveLength(64)
    expect(draft.taskPlan.structured.title).toBe('登录页面改进')
    expect(db.repositories.scheduleDrafts.pending(thread.id)?.id).toBe(draft.id)
    // 只有确认才会创建任务：提交后既没有计划任务，也没有自动化。
    expect(rowCount(db, 'scheduled_tasks')).toBe(0)
    expect(rowCount(db, 'automations')).toBe(0)
    // 重复提交同一个 tool call 幂等返回同一份草案。
    const again = await submit()
    expect(again.id).toBe(draft.id)
    expect(db.repositories.scheduleDrafts.pending(thread.id)?.revision).toBe(1)
  })

  test('同一聊天只保留一份待确认草案；新草案取代旧草案', async () => {
    const { db, thread, turn, service, submit } = await fixture()
    const first = await submit()
    const second = await service.submitDraft({
      ...(await submitInput(thread.id, turn.turnID)),
      toolCallId: `${turn.turnID}:schedule-draft-2`,
      name: '第二轮安排',
    })
    expect(second.id).not.toBe(first.id)
    expect(db.repositories.scheduleDrafts.get(first.id)?.status).toBe('cancelled')
    expect(db.repositories.scheduleDrafts.pending(thread.id)?.id).toBe(second.id)
  })

  test('确认一次性触发原子创建任务并写入固定计划与验收标准', async () => {
    const { db, submit, service } = await fixture()
    const draft = await submit()
    const committed = await service.commitDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      operationId: 'commit:1',
      trigger: draft.trigger,
      conditions: draft.conditions,
      conditionFallback: draft.conditionFallback,
      acceptance: draft.acceptance,
      notificationPolicy: draft.notificationPolicy,
      missedRuns: draft.missedRuns,
      execution: draft.execution,
    })
    expect(committed.status).toBe('committed')
    expect(committed.createdRefs).toHaveLength(1)
    const tasks = db.sqlite.query('SELECT id, prompt FROM scheduled_tasks').all() as Array<{
      id: string
      prompt: string
    }>
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.prompt).toContain('## 已确认的任务计划（固定上下文，不要重新规划）')
    expect(tasks[0]!.prompt).toContain('改善登录页的可用性与错误提示。')
    expect(tasks[0]!.prompt).toContain('人工验收')
    expect(tasks[0]!.prompt).toContain('先简短重述用户目标和试图解决的问题')
    // 重试同一个 operationId 只返回同一份结果，不会产生第二组任务。
    const retried = await service.commitDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      operationId: 'commit:1',
      trigger: draft.trigger,
      conditions: draft.conditions,
      conditionFallback: draft.conditionFallback,
      acceptance: draft.acceptance,
      notificationPolicy: draft.notificationPolicy,
      missedRuns: draft.missedRuns,
      execution: draft.execution,
    })
    expect(retried.id).toBe(committed.id)
    expect(rowCount(db, 'scheduled_tasks')).toBe(1)
  })

  test('确认拒绝尚未接入的触发与验收，以及未接入的依赖', async () => {
    const { submit, service } = await fixture()
    const draft = await submit()
    const commit = (overrides: Record<string, unknown>) =>
      service.commitDraft({
        id: draft.id,
        expectedRevision: draft.revision,
        operationId: `commit:${JSON.stringify(overrides)}`,
        trigger: draft.trigger,
        conditions: draft.conditions,
        conditionFallback: draft.conditionFallback,
        acceptance: draft.acceptance,
        notificationPolicy: draft.notificationPolicy,
        missedRuns: draft.missedRuns,
        execution: draft.execution,
        ...overrides,
      } as never)
    await expect(
      commit({ trigger: { kind: 'task-succeeded', taskId: 'scheduled-task:missing' } }),
    ).rejects.toThrow('不支持按任务成功或验收通过触发执行')
    await expect(
      commit({
        acceptance: { kind: 'automatic', checks: [{ kind: 'file-exists', path: 'a.txt' }] },
      }),
    ).rejects.toThrow('不支持自动验收')
    await expect(
      commit({
        conditions: {
          dependsOn: ['scheduled-task:missing'],
          requireEnvironment: false,
          notBefore: null,
          deadline: null,
        },
      }),
    ).rejects.toThrow('不支持执行依赖')
    // 版本不匹配时拒绝，避免确认已被取代的草案。
    await expect(
      service.commitDraft({
        id: draft.id,
        expectedRevision: draft.revision + 5,
        operationId: 'commit:stale',
        trigger: draft.trigger,
        conditions: draft.conditions,
        conditionFallback: draft.conditionFallback,
        acceptance: draft.acceptance,
        notificationPolicy: draft.notificationPolicy,
        missedRuns: draft.missedRuns,
        execution: draft.execution,
      }),
    ).rejects.toThrow('版本或状态已变化')
  })

  test('反馈保存用户原话、失效旧草案并幂等开启一个规划回合', async () => {
    const { db, thread, submit, service } = await fixture()
    const draft = await submit()
    const result = await service.feedbackDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      operationId: 'feedback:1',
      feedback: '把验收改成人工确认',
    })
    // 旧草案立即失效，不能带着未提交意见确认旧安排。
    expect(result.status).toBe('cancelled')
    const latestTurnId = (
      db.sqlite
        .query(
          'SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
        )
        .get(thread.id) as { id: string }
    ).id
    // 反馈输入本身保存为用户原话，并开启一个 Plan 回合。
    expect(db.getTurnInput(latestTurnId)?.content).toBe('把验收改成人工确认')
    expect(db.getTurnInput(latestTurnId)?.taskMode).toBe('plan')
    // 源草案按关联重建，供 ThreadService 注入固定上下文。
    expect(db.repositories.scheduleDrafts.feedbackSource(latestTurnId)?.id).toBe(draft.id)
    const turnsBefore = (
      db.sqlite.query('SELECT COUNT(*) AS count FROM turns').get() as {
        count: number
      }
    ).count
    // 同一个 operationId 重试不会再开一个回合。
    const retried = await service.feedbackDraft({
      id: draft.id,
      expectedRevision: draft.revision,
      operationId: 'feedback:1',
      feedback: '把验收改成人工确认',
    })
    expect(retried.id).toBe(draft.id)
    expect(
      (db.sqlite.query('SELECT COUNT(*) AS count FROM turns').get() as { count: number }).count,
    ).toBe(turnsBefore)
  })

  test('重启恢复只保留最新 turn 上的待确认草案', async () => {
    const { db, thread, turn, submit } = await fixture()
    const draft = await submit()
    db.createTurn(thread.id, {
      content: '新要求',
      model,
      permissionConfig,
      strategy: 'start',
      taskMode: 'plan',
    })
    db.repositories.scheduleDrafts.recover(thread.id)
    expect(db.repositories.scheduleDrafts.get(draft.id)?.status).toBe('cancelled')
    expect(db.repositories.scheduleDrafts.pending(thread.id)).toBeNull()
    expect(turn.turnID).toBeTruthy()
  })
})

async function submitInput(threadId: string, turnId: string): Promise<ScheduleDraftSubmitInput> {
  return {
    threadId,
    turnId,
    toolCallId: `${turnId}:schedule-draft`,
    name: '登录页面改进',
    prompt: '按已确认的计划改进登录页面',
    taskPlan: {
      source: 'current-plan-item',
      sourceRef: `${turnId}:plan`,
      structured: structuredPlan,
    },
    trigger: { kind: 'once', at: 1_000_000, timeZone: 'Asia/Shanghai' },
    conditions: { dependsOn: [], requireEnvironment: false, notBefore: null, deadline: null },
    conditionFallback: 'skip',
    acceptance: { kind: 'manual' },
    notificationPolicy: 'failures',
    missedRuns: 'catch-up',
    execution: {
      kind: 'thread',
      projectId: null,
      targetThreadId: threadId,
      environment: null,
      model,
      reasoningEffort: null,
      permissionConfig,
    },
  }
}
