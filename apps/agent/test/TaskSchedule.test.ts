import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelRef } from '@pidex/shared/model'
import type { ScheduleExecution } from '@pidex/shared/schedule-draft'
import type { TaskSchedule } from '@pidex/shared/task-schedule'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { TaskScheduleService } from '../src/calendar/TaskScheduleService'
import { ScheduledTaskCoordinator } from '../src/calendar/ScheduledTaskCoordinator'
import { removeFixturePaths } from './FixtureCleanup'
import { SchedulePlanService } from '../src/calendar/SchedulePlanService'
import { taskScheduleCheckDefinition } from '../src/tool/TaskSchedule/Definitions'
const databases: AgentDatabase[] = []
const paths: string[] = []
afterEach(async () => {
  databases.splice(0).forEach((db) => db.close())
  await removeFixturePaths(paths.splice(0))
})
test('自动文件检查支持非空二进制文件和精确 Markdown 章节', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-task-check-'))
  paths.push(root)
  const file = join(root, 'result.md')
  const context = {
    workspace: { resolveExistingPath: async () => file },
  } as unknown as Parameters<typeof taskScheduleCheckDefinition.execute>[1]
  await writeFile(file, new Uint8Array([1, 2, 3]))
  expect(await taskScheduleCheckDefinition.execute({ file_path: file }, context)).toBe(true)
  await writeFile(file, '摘要\n## 验收结果 ##\n内容', 'utf8')
  expect(
    await taskScheduleCheckDefinition.execute({ file_path: file, section: '验收结果' }, context),
  ).toBe(true)
  expect(
    await taskScheduleCheckDefinition.execute({ file_path: file, section: '摘要' }, context),
  ).toBe(false)
  await writeFile(file, '', 'utf8')
  expect(await taskScheduleCheckDefinition.execute({ file_path: file }, context)).toBe(false)
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pidex-task-schedule-'))
  paths.push(root)
  const db = new AgentDatabase({
    historyPath: join(root, 'history.sqlite'),
    profilePath: join(root, 'profile.sqlite'),
  })
  databases.push(db)
  let now = 10_000,
    starts = 0,
    operation = 0,
    checkPassed = true
  const thread = db.createThread()
  const execution: ScheduleExecution = {
    kind: 'thread',
    projectId: null,
    targetThreadId: thread.id,
    environment: null,
    model: { providerID: 'openai', id: 'test' } as ModelRef,
    reasoningEffort: null,
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    },
  }
  const coordinator = new ScheduledTaskCoordinator(
    db.repositories.scheduledTasks,
    {
      start: async () => {
        starts++
        return null
      },
    },
    { now: () => now },
  )
  const service = new TaskScheduleService(db, coordinator, {
    now: () => now,
    check: async () => checkPassed,
  })
  const id = () => `operation:${++operation}`
  const create = (name = '任务') => service.save({ name, operationId: id() })
  const save = (task: TaskSchedule, patch: Partial<TaskSchedule>) =>
    service.save({
      id: task.id,
      expectedRevision: task.revision,
      name: task.name,
      definition: { ...task, ...patch },
      operationId: id(),
    })
  const ready = (task: TaskSchedule, at = 20_000) => {
    task = save(task, { trigger: { kind: 'once', at, timeZone: 'Asia/Shanghai' } })
    return service.plan({
      id: task.id,
      expectedRevision: task.revision,
      operationId: id(),
      content: '固定方案',
      threadId: thread.id,
      execution,
    })
  }
  return {
    db,
    service,
    create,
    save,
    ready,
    execution,
    id,
    root,
    thread,
    setCheckPassed: (value: boolean) => {
      checkPassed = value
    },
    setNow: (value: number) => {
      now = value
    },
    starts: () => starts,
  }
}
describe('任务安排与人工验收', () => {
  test('完整规划草案接入统一任务，自动检查与人工验收可以同时启用', async () => {
    const f = await fixture()
    const input = {
      content: '规划任务',
      model: f.execution.model,
      permissionConfig: f.execution.permissionConfig,
      strategy: 'start' as const,
      taskMode: 'plan' as const,
    }
    const turn = f.db.createTurn(f.thread.id, input)
    f.db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })
    const service = new SchedulePlanService(
      f.db,
      f.db.repositories.schedulePlanProposals,
      f.db.repositories.scheduleDrafts,
      f.db.repositories.scheduledTasks,
      f.db.repositories.automations,
      { now: () => 10_000, taskSchedules: f.service },
    )
    const draft = await service.submitDraft({
      threadId: f.thread.id,
      turnId: turn.turnID,
      toolCallId: 'tool:rich-draft',
      name: '完整任务',
      prompt: '执行方案',
      taskPlan: {
        source: 'pasted-text',
        sourceRef: null,
        structured: {
          title: '方案',
          summary: '说明',
          changes: [{ area: '任务', items: ['执行任务'] }],
          interfaceChanges: [],
          tests: [],
          assumptions: [],
        },
      },
      trigger: { kind: 'once', at: 20_000, timeZone: 'Asia/Shanghai' },
      conditions: { dependsOn: [], requireEnvironment: true, notBefore: 25_000, deadline: 30_000 },
      conditionFallback: 'wait',
      acceptance: { kind: 'automatic', checks: [{ kind: 'file-exists', path: 'result.md' }] },
      notificationPolicy: 'failures',
      missedRuns: 'catch-up',
      execution: f.execution,
    })
    const committed = await service.commitDraft({
      ...draft,
      id: draft.id,
      expectedRevision: draft.revision,
      operationId: f.id(),
      requireManualAcceptance: true,
    })
    expect(committed.createdRefs[0]?.kind).toBe('task-schedule')
    f.setNow(20_000)
    await f.service.tick()
    expect(f.starts()).toBe(0)
    f.setNow(25_000)
    await f.service.tick()
    await f.service.tick()
    expect(f.service.list().occurrences[0]!.status).toBe('awaiting-acceptance')
    expect(f.service.list().tasks[0]!.checks).toHaveLength(1)
  })
  test('自动检查失败不完成任务，也不跳过为人工验收通过', async () => {
    const f = await fixture()
    f.setCheckPassed(false)
    let task = f.ready(f.create())
    f.save(task, {
      checks: [{ kind: 'file-exists', path: 'result.md' }],
      requireManualAcceptance: false,
    })
    f.setNow(20_000)
    await f.service.tick()
    await f.service.tick()
    expect(f.service.list().occurrences[0]!.status).toBe('failed')
    expect(f.service.list().occurrences[0]!.attention).toBeNull()
  })
  test('时间草案可改时间、可取消，确认之外不创建任务', async () => {
    const f = await fixture()
    let proposal = f.service.propose({
      operationId: f.id(),
      items: [{ name: '时间任务', owner: 'human', at: 20_000, durationMinutes: 30 }],
      unscheduled: [{ name: '排不下的任务', owner: 'agent', reason: '时间不足' }],
    })
    proposal = f.service.propose({
      id: proposal.id,
      expectedRevision: proposal.revision,
      operationId: f.id(),
      items: [{ ...proposal.items[0]!, at: 30_000 }],
      unscheduled: proposal.unscheduled,
    })
    expect(proposal.revision).toBe(2)
    expect(f.service.list().tasks).toHaveLength(0)
    f.service.arrange({
      id: proposal.id,
      expectedRevision: proposal.revision,
      operationId: f.id(),
      decision: 'cancel',
    })
    expect(f.service.list().tasks).toHaveLength(0)
    expect(f.service.list().proposals[0]!.status).toBe('cancelled')
  })
  test('名称即可保存；到点缺方案只提醒，逾期补全不自动执行', async () => {
    const f = await fixture()
    let task = f.create()
    expect(task.plan).toBeNull()
    expect(task.execution).toBeNull()
    expect(task.requireManualAcceptance).toBe(true)
    task = f.save(task, { trigger: { kind: 'once', at: 20_000, timeZone: 'Asia/Shanghai' } })
    f.setNow(20_000)
    await f.service.tick()
    const occurrence = f.service.list().occurrences[0]!
    expect(occurrence.status).toBe('needs-plan')
    expect(occurrence.attention).toBe('needs-plan')
    expect(f.starts()).toBe(0)
    task = f.service.list().tasks[0]!
    task = f.service.plan({
      id: task.id,
      expectedRevision: task.revision,
      operationId: f.id(),
      content: '补充方案',
      execution: f.execution,
    })
    expect(task.autoExecute).toBe(false)
    await f.service.tick()
    expect(f.starts()).toBe(0)
    await f.service.start({
      id: task.id,
      expectedRevision: task.revision,
      operationId: f.id(),
      occurrenceId: occurrence.id,
    })
    await f.service.tick()
    expect(f.starts()).toBe(1)
  })
  test('提前选定方案自动执行；成功进入强提醒待验收，查看不完成，验收绑定版本', async () => {
    const f = await fixture()
    const task = f.ready(f.create())
    expect(task.autoExecute).toBe(true)
    f.setNow(20_000)
    await Promise.all([f.service.tick(), f.service.tick()])
    await f.service.tick()
    let occurrence = f.service.list().occurrences[0]!
    expect(f.starts()).toBe(1)
    expect(occurrence.executionSucceeded).toBe(true)
    expect(occurrence.status).toBe('awaiting-acceptance')
    expect(occurrence.attention).toBe('awaiting-acceptance')
    expect(f.service.list().occurrences[0]!.status).toBe('awaiting-acceptance')
    occurrence = f.service.notify({
      id: occurrence.id,
      reminderVersion: occurrence.reminderVersion,
    })
    expect(() =>
      f.service.notify({ id: occurrence.id, reminderVersion: occurrence.reminderVersion }),
    ).toThrow()
    occurrence = f.service.snooze({
      id: occurrence.id,
      expectedRevision: occurrence.revision,
      operationId: f.id(),
      until: 30_000,
    })
    expect(occurrence.status).toBe('awaiting-acceptance')
    expect(occurrence.attention).toBe('awaiting-acceptance')
    await expect(
      f.service.accept({
        id: occurrence.id,
        expectedRevision: occurrence.revision,
        resultVersion: 1,
        decision: 'pass',
        operationId: f.id(),
      }),
    ).rejects.toThrow()
    const accepted = await f.service.accept({
      id: occurrence.id,
      expectedRevision: occurrence.revision,
      resultVersion: occurrence.resultVersion,
      decision: 'pass',
      operationId: f.id(),
    })
    expect(accepted.status).toBe('completed')
    expect(accepted.attention).toBeNull()
  })
  test('人工任务提交结果进入待验收；退回不重跑，关闭人工验收可完成', async () => {
    const f = await fixture()
    let task = f.save(f.create(), { owner: 'human' })
    let occurrence = await f.service.start({
      id: task.id,
      expectedRevision: task.revision,
      operationId: f.id(),
    })
    occurrence = await f.service.submitResult({
      id: occurrence.id,
      expectedRevision: occurrence.revision,
      resultVersion: occurrence.resultVersion,
      operationId: f.id(),
      result: '人工成果',
    })
    expect(occurrence.status).toBe('awaiting-acceptance')
    occurrence = await f.service.accept({
      id: occurrence.id,
      expectedRevision: occurrence.revision,
      resultVersion: occurrence.resultVersion,
      decision: 'rework',
      feedback: '修改结果',
      operationId: f.id(),
    })
    expect(occurrence.status).toBe('rework')
    expect(f.starts()).toBe(0)
    task = f.save(task, { requireManualAcceptance: false })
    const second = await f.service.start({
      id: task.id,
      expectedRevision: task.revision,
      operationId: f.id(),
    })
    const result = await f.service.submitResult({
      id: second.id,
      expectedRevision: second.revision,
      resultVersion: second.resultVersion,
      operationId: f.id(),
      result: '新结果',
    })
    expect(result.status).toBe('completed')
  })
  test('验收依赖未通过不启动；成功依赖可以启动，循环依赖拒绝', async () => {
    const f = await fixture()
    const parent = f.ready(f.create('前置'))
    let downstream = f.ready(f.create('下游'))
    downstream = f.save(downstream, { trigger: { kind: 'acceptance-passed', taskId: parent.id } })
    expect(() =>
      f.save(parent, { conditions: { ...parent.conditions, dependsOn: [downstream.id] } }),
    ).toThrow('循环')
    f.setNow(20_000)
    await f.service.tick()
    await f.service.tick()
    expect(f.starts()).toBe(1)
    const parentRun = f.service.list().occurrences.find((o) => o.taskId === parent.id)!
    await f.service.accept({
      id: parentRun.id,
      expectedRevision: parentRun.revision,
      resultVersion: parentRun.resultVersion,
      operationId: f.id(),
      decision: 'pass',
    })
    await f.service.tick()
    expect(f.starts()).toBe(2)
  })
  test('排程只保存草案；确认原子校验版本；幂等创建不重复', async () => {
    const f = await fixture()
    const input = { name: '唯一任务', operationId: f.id() }
    const task = f.service.save(input)
    expect(f.service.save(input).id).toBe(task.id)
    expect(() => f.service.save({ ...input, name: '其他任务' })).toThrow()
    const proposal = f.service.propose({
      operationId: f.id(),
      items: [
        { taskId: task.id, expectedRevision: task.revision, at: 20_000, durationMinutes: 30 },
      ],
      unscheduled: [],
    })
    expect(f.service.list().tasks[0]!.trigger).toBeNull()
    f.service.arrange({ id: proposal.id, expectedRevision: proposal.revision, operationId: f.id() })
    expect(f.service.list().tasks[0]!.trigger?.kind).toBe('once')
  })
  test('schema 60 迁移只增加新表，保留旧记录与未知表', async () => {
    const f = await fixture()
    const original = f.db.createThread()
    f.db.sqlite.exec(
      "CREATE TABLE unknown_task_data (value TEXT); INSERT INTO unknown_task_data VALUES ('preserved')",
    )
    f.db.sqlite.exec(
      'DROP TABLE task_schedule_operations; DROP TABLE task_schedule_proposals; DROP TABLE task_schedule_links; DROP TABLE task_schedule_occurrences; DROP TABLE task_schedule_definitions; PRAGMA user_version = 60',
    )
    f.db.close()
    databases.splice(databases.indexOf(f.db), 1)
    const db = new AgentDatabase({
      historyPath: join(f.root, 'history.sqlite'),
      profilePath: join(f.root, 'profile.sqlite'),
    })
    databases.push(db)
    expect(db.repositories.taskSchedules.available()).toBe(true)
    expect(db.getThread(original.id)).not.toBeNull()
    expect(db.sqlite.query('SELECT value FROM unknown_task_data').get()).toEqual({
      value: 'preserved',
    })
    expect(db.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 61 })
  })
  test('纯时间草案可以先保存新任务名字，确认前不创建任务；重排消除旧到期提醒', async () => {
    const f = await fixture()
    const proposal = f.service.propose({
      operationId: f.id(),
      items: [{ name: '先排时间', owner: 'agent', at: 20_000, durationMinutes: 30 }],
      unscheduled: [],
    })
    expect(f.service.list().tasks).toHaveLength(0)
    f.service.arrange({ id: proposal.id, expectedRevision: proposal.revision, operationId: f.id() })
    f.setNow(20_000)
    await f.service.tick()
    const task = f.service.list().tasks[0]!
    expect(f.service.list().occurrences[0]!.attention).toBe('needs-plan')
    f.save(task, { trigger: { kind: 'once', at: 30_000, timeZone: 'Asia/Shanghai' } })
    expect(f.service.list().occurrences[0]!.attention).toBeNull()
    expect(f.service.list().occurrences[0]!.status).toBe('cancelled')
  })
  test('周期任务各自待验收，不因上一轮未验收阻止下一轮', async () => {
    const f = await fixture()
    let task = f.ready(f.create())
    task = f.save(task, {
      trigger: {
        kind: 'recurring',
        schedule: { mode: 'hourly', intervalMinutes: 60 },
        timeZone: 'Asia/Shanghai',
      },
    })
    f.setNow(task.nextRunAt!)
    await f.service.tick()
    await f.service.tick()
    expect(f.service.list().occurrences[0]!.status).toBe('awaiting-acceptance')
    task = f.service.list().tasks[0]!
    f.setNow(task.nextRunAt!)
    await f.service.tick()
    await f.service.tick()
    expect(f.starts()).toBe(2)
    expect(f.service.list().occurrences.every((o) => o.status === 'awaiting-acceptance')).toBe(true)
  })
})
