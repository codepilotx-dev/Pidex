import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import {
  DEFAULT_PERMISSION_CONFIG,
  formatStructuredPlanMarkdown,
  type StructuredPlan,
} from '@pidex/shared/thread'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { ThreadService } from '../src/session/ThreadService'
import { PlanApprovalService } from '../src/session/plan/PlanApprovalService'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'
import { ThreadForkWorkspaceService } from '../src/session/fork/ThreadForkWorkspaceService'
import { WorktreeRepository } from '../src/worktree/WorktreeRepository'
import { TaskExecutionBindingService } from '../src/worktree/TaskExecutionBindingService'
import { EnvironmentDeltaStore } from '../src/local-environment/EnvironmentDeltaStore'
import { ManagedProjectlessWorkspaceService } from '../src/workspace/ManagedProjectlessWorkspaceService'
import { ThreadWorkspaceResolver } from '../src/workspace/ThreadWorkspaceResolver'

const roots: string[] = []
const databases: AgentDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})
const model = Model.Ref.make({ providerID: Provider.ID.make('test'), id: Model.ID.make('model') })
const input = {
  content: '调查并计划',
  model,
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  taskMode: 'plan' as const,
  strategy: 'start' as const,
}

function client(
  db: AgentDatabase,
  root: string,
  onValidate?: () => Promise<void>,
  resolver?: ThreadWorkspaceResolver,
) {
  const hub = { publish: () => Effect.void }
  const threads = new ThreadService(
    db,
    hub as never,
    {
      resolve: async () => {
        await onValidate?.()
        return { capabilities: { tools: true } }
      },
    } as never,
    null as never,
    { setResumeHandler: () => undefined } as never,
    { clearTurnPermissionGrants: () => undefined } as never,
    { resolvedWaitCheckpoint: () => null, setParentResumeHandler: () => undefined } as never,
    null as never,
    { dataRoot: root, userHome: root },
    null as never,
    null as never,
    resolver ?? ({ resolve: async () => ({}) } as never),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  )
  // Exercise real admission/transaction/dispatch, but do not call a provider or start tools.
  const dispatched: string[] = []
  Object.defineProperty(threads, 'executeTurn', {
    value: async (_threadId: string, turnId: string) => {
      dispatched.push(turnId)
    },
  })
  const service = new PlanApprovalService(db, hub as never, threads)
  return { service, threads, dispatched }
}

async function fixture(onValidate?: () => Promise<void>, managedSource = false) {
  const root = await mkdtemp(join(tmpdir(), 'cpx-plan-approval-'))
  roots.push(root)
  const path = join(root, 'history.sqlite')
  const db = new AgentDatabase(path)
  databases.push(db)
  const documents = join(root, 'Documents')
  const managed = new ManagedProjectlessWorkspaceService(documents)
  let allocation
  if (managedSource) {
    await mkdir(documents)
    allocation = await managed.allocate({
      workspaceID: crypto.randomUUID(),
      threadID: crypto.randomUUID(),
    })
    await managed.activate(allocation)
  }
  const resolver = managedSource
    ? new ThreadWorkspaceResolver(
        db,
        managed,
        new TaskExecutionBindingService(new WorktreeRepository(db.sqlite)),
      )
    : undefined
  const { service, threads, dispatched } = client(db, root, onValidate, resolver)
  const thread = allocation
    ? db.createThread({
        id: allocation.threadID,
        workspace: {
          kind: 'projectless',
          workspaceRoot: allocation.sessionRoot,
          cwd: allocation.cwd,
          outputDirectory: allocation.outputDirectory,
        },
      })
    : db.createThread()
  const turn = db.createTurn(thread.id, input, 'running')
  const planId = crypto.randomUUID()
  db.upsertItem(thread.id, {
    id: planId,
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: 'plan',
    status: 'completed',
    data: { title: '真实计划', markdown: '修改 A，然后验证 B。' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  db.finalizeTurn({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    status: 'completed',
  })
  const approval = service.read(thread.id)!
  const params = {
    threadId: thread.id,
    approvalId: approval.id,
    expectedVersion: approval.version,
    operationId: crypto.randomUUID(),
  }
  return {
    db,
    root,
    path,
    service,
    threads,
    dispatched,
    thread,
    turn,
    approval,
    params,
    planId,
    resolver,
    allocation,
  }
}

async function freshFixture(
  worktree = false,
  onValidate?: () => Promise<void>,
  managedSource = false,
) {
  const value = await fixture(onValidate, managedSource)
  const repository = new WorktreeRepository(value.db.sqlite)
  const bindings = new TaskExecutionBindingService(repository)
  const environments = new EnvironmentDeltaStore(value.root)
  const project = worktree ? value.db.createProject({ rootPath: value.root }) : null
  if (project) {
    value.db.setProjectMembership(value.thread.id, project.id)
    repository.insertWorktree({
      id: 'plan-worktree',
      projectId: project.id,
      repositoryRoot: value.root,
      path: value.root,
      status: 'ready',
      branchName: 'codex/plan',
      baseCommit: 'base',
      headCommit: 'head',
      permanent: false,
      pinned: false,
      boundOnce: false,
      setupStatus: 'succeeded',
      environmentRevision: 0,
      continuedWithoutSetup: false,
      restoreSnapshotPath: null,
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: 1,
      deletedAt: null,
    })
    bindings.bindWorktree({
      threadId: value.thread.id,
      projectId: project.id,
      worktreeId: 'plan-worktree',
    })
  } else
    bindings.bindLocal({
      threadId: value.thread.id,
      projectId: null,
      cwd: value.allocation?.cwd ?? value.root,
    })
  const binding = bindings.read(value.thread.id)!
  const delta = await environments.replace(binding.bindingId, {
    set: { PLAN_ENV: 'retained' },
    unset: [],
  })
  bindings.updateEnvironmentRevision(value.thread.id, delta.revision)
  const resolver = {
    resolve: async () => ({
      ...(project
        ? { kind: 'project', projectID: project.id, outputDirectory: null }
        : { kind: 'projectless', projectID: null, outputDirectory: value.root }),
      workspaceRoot: value.root,
      cwd: value.root,
      runtimeWorkspaceRoots: [],
      instructionSources: [],
      executionBinding: bindings.read(value.thread.id)!,
    }),
  }
  const workspaces = new ThreadForkWorkspaceService(
    value.resolver ?? (resolver as never),
    bindings,
    repository,
    environments,
  )
  const service = new PlanApprovalService(
    value.db,
    { publish: () => Effect.void } as never,
    value.threads,
    workspaces,
  )
  return { ...value, service, bindings, environments, workspaces, project }
}

test('真实无项目目录在新聊天与原聊天删除后仍通过所有者校验', async () => {
  const value = await freshFixture(false, undefined, true)
  const result = await value.service.implementFresh(value.params)
  const sourceWorkspace = await value.resolver!.resolve(value.thread.id)
  const targetWorkspace = await value.resolver!.resolve(result.targetThreadId)
  expect(targetWorkspace.cwd).toBe(sourceWorkspace.cwd)
  expect(targetWorkspace.workspaceRoot).toBe(sourceWorkspace.workspaceRoot)
  expect(value.db.projectlessWorkspaceOwner(result.targetThreadId)).toBe(value.thread.id)
  value.db.sqlite.query('DELETE FROM threads WHERE id = ?').run(value.thread.id)
  expect((await value.resolver!.resolve(result.targetThreadId)).cwd).toBe(sourceWorkspace.cwd)
})

test('schema55 前向新增可空目录所有者，高版本缺列时原样保留并禁用 fresh', async () => {
  const value = await fixture()
  value.db.sqlite.exec(
    'ALTER TABLE threads DROP COLUMN workspace_owner_thread_id; PRAGMA user_version = 55',
  )
  value.db.close()
  databases.splice(databases.indexOf(value.db), 1)
  const upgraded = new AgentDatabase(value.path)
  databases.push(upgraded)
  expect(upgraded.sqlite.query('PRAGMA user_version').get()).toEqual({
    user_version: SCHEMA_VERSION,
  })
  expect(upgraded.projectlessWorkspaceOwner(value.thread.id)).toBe(value.thread.id)
  expect(upgraded.repositories.planApprovals.pending(value.thread.id)?.markdown).toBe(
    value.approval.markdown,
  )
  upgraded.sqlite.exec(
    'ALTER TABLE threads DROP COLUMN workspace_owner_thread_id; PRAGMA user_version = 99',
  )
  upgraded.close()
  databases.splice(databases.indexOf(upgraded), 1)
  const future = new AgentDatabase(value.path)
  databases.push(future)
  expect(future.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 99 })
  expect(filterAdvertisedCapabilities(future)).not.toContain('plan.approval.fresh.v1')
})

test.each([false, true])(
  '新聊天只携带批准计划，保留执行绑定和环境但无旧历史，worktree=%s',
  async (worktree) => {
    const value = await freshFixture(worktree)
    value.db.repositories.threadGoals.write({
      threadId: value.thread.id,
      objective: '原聊天目标',
      status: 'active',
      tokenBudget: 1000,
      expectedVersion: null,
    })
    const [result, concurrent] = await Promise.all([
      value.service.implementFresh(value.params),
      value.service.implementFresh(value.params),
    ])
    expect(concurrent.disposition).toBe('duplicate')
    expect(result.targetThreadId).not.toBe(value.thread.id)
    expect(result.approval.status).toBe('implemented')
    expect(value.dispatched).toEqual([result.nextTurnId])
    const target = value.db.getThread(result.targetThreadId)!
    expect(target.turns).toHaveLength(1)
    expect(target.turns.flatMap((turn) => turn.items).some((item) => item.type === 'plan')).toBe(
      false,
    )
    expect(target.settings.permissionConfig).toEqual(input.permissionConfig)
    expect(value.db.getTurnInput(result.nextTurnId)).toMatchObject({ model, taskMode: 'chat' })
    expect(value.db.getTurnInput(result.nextTurnId)?.content).toContain(value.approval.markdown)
    expect(value.db.getTurnInput(result.nextTurnId)?.content).toContain('重述用户目标')
    const binding = value.bindings.read(result.targetThreadId)!
    expect(binding.cwd).toBe(value.root)
    expect(binding.worktreeId).toBe(worktree ? 'plan-worktree' : null)
    expect(value.db.projectMembership(result.targetThreadId)).toBe(value.project?.id ?? null)
    expect((await value.environments.read(binding.bindingId)).set).toEqual({ PLAN_ENV: 'retained' })
    expect(value.db.repositories.threadGoals.get(result.targetThreadId)).toBeNull()
    const duplicate = await value.service.implementFresh(value.params)
    expect(duplicate).toMatchObject({
      targetThreadId: result.targetThreadId,
      nextTurnId: result.nextTurnId,
      disposition: 'duplicate',
    })
    expect(value.dispatched).toHaveLength(1)
    await expect(
      value.service.implementFresh({
        ...value.params,
        model: { ...model, variant: Model.Ref.fields.variant.from.make('low') },
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' })
    value.db.close()
    databases.splice(databases.indexOf(value.db), 1)
    const reopened = new AgentDatabase(value.path)
    databases.push(reopened)
    const restored = new PlanApprovalService(
      reopened,
      { publish: () => Effect.void } as never,
      value.threads,
      value.workspaces,
    )
    expect(await restored.implementFresh(value.params)).toMatchObject({
      targetThreadId: result.targetThreadId,
      disposition: 'duplicate',
    })
  },
)

test('新聊天事务失败或模型不可用保留原审批，不遗留目标聊天；过期版本拒绝', async () => {
  const value = await freshFixture()
  value.db.sqlite.exec(
    "CREATE TRIGGER reject_fresh_input BEFORE INSERT ON inputs BEGIN SELECT RAISE(ABORT, 'fresh transaction failure'); END",
  )
  await expect(value.service.implementFresh(value.params)).rejects.toThrow(
    'fresh transaction failure',
  )
  expect(value.db.repositories.planApprovals.get(value.approval.id)?.status).toBe('pending')
  expect(value.db.sqlite.query('SELECT count(*) AS count FROM threads').get()).toEqual({ count: 1 })
  expect(value.dispatched).toHaveLength(0)
  value.db.sqlite.exec('DROP TRIGGER reject_fresh_input')
  await expect(
    value.service.implementFresh({ ...value.params, expectedVersion: 99 }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await value.service.implementFresh(value.params)
  const unavailable = await freshFixture(false, async () => {
    throw new Error('unavailable')
  })
  await expect(unavailable.service.implementFresh(unavailable.params)).rejects.toMatchObject({
    code: 'MODEL_UNAVAILABLE',
  })
  expect(unavailable.db.repositories.planApprovals.get(unavailable.approval.id)?.status).toBe(
    'pending',
  )
  expect(unavailable.db.sqlite.query('SELECT count(*) AS count FROM threads').get()).toEqual({
    count: 1,
  })
})

test('完整计划在实时终态、快照和分页投影一致；未批准不启动轮次', async () => {
  const { db, thread, approval, dispatched } = await fixture()
  const projection = new ThreadProjection(db)
  expect(dispatched).toEqual([])
  expect(projection.snapshot(thread.id)?.pendingPlanApproval).toEqual(approval)
  expect(projection.historyPage(thread.id)?.pendingPlanApproval).toEqual(approval)
  expect(projection.list().find((item) => item.id === thread.id)?.pendingPlanApproval).toBe(true)
})

test('实施原子接纳且同操作重试/并发只启动一次；模型和权限保持', async () => {
  const { db, service, params, dispatched, approval, thread } = await fixture()
  const selected = { ...model, variant: Model.VariantID.make('high') }
  const request = { ...params, response: { action: 'implement' as const, model: selected } }
  const results = await Promise.all([service.respond(request), service.respond(request)])
  expect(results.map((result) => result.disposition)).toEqual(['applied', 'duplicate'])
  expect(dispatched).toHaveLength(1)
  expect(results[0]!.approval.status).toBe('implemented')
  const admitted = db.getTurnInput(results[0]!.approval.nextTurnId!)!
  expect(admitted.content).toContain(approval.markdown)
  expect(admitted.model).toEqual(selected)
  expect(admitted.permissionConfig).toEqual(DEFAULT_PERMISSION_CONFIG)
  expect(admitted.taskMode).toBe('chat')
  expect(service.read(thread.id)).toBeNull()
  await expect(
    service.respond({
      ...request,
      response: {
        action: 'implement',
        model: { ...selected, variant: Model.VariantID.make('low') },
      },
    }),
  ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' })
})

test('反馈创建 Plan 轮次；关闭不创建轮次且发设置事件；关闭记录重启不复活', async () => {
  const first = await fixture()
  const feedback = await first.service.respond({
    ...first.params,
    response: { action: 'feedback', feedback: '先处理 B' },
  })
  expect(first.db.getTurnInput(feedback.approval.nextTurnId!)?.taskMode).toBe('plan')
  expect(first.db.getTurnInput(feedback.approval.nextTurnId!)?.content).toContain('先处理 B')
  const second = await fixture()
  const closed = await second.service.respond({ ...second.params, response: { action: 'close' } })
  expect(closed.approval.status).toBe('closed')
  expect(closed.approval.nextTurnId).toBeNull()
  expect(second.dispatched).toHaveLength(0)
  expect(second.db.getThreadSettings(second.thread.id)?.taskMode).toBe('chat')
  const events = second.db.sqlite
    .query('SELECT method FROM events WHERE thread_id = ? ORDER BY id DESC LIMIT 1')
    .get(second.thread.id)
  expect(events).toMatchObject({ method: 'thread/settings/updated' })
  second.db.close()
  databases.splice(databases.indexOf(second.db), 1)
  const reopened = new AgentDatabase(second.path)
  databases.push(reopened)
  expect(reopened.repositories.planApprovals.pending(second.thread.id)).toBeNull()
  expect(reopened.repositories.planApprovals.get(closed.approval.id)?.status).toBe('closed')
})

test('异步校验期间出现新的输入会使旧计划失效，不能接纳旧计划', async () => {
  let intervene = () => {}
  const value = await fixture(async () => intervene())
  intervene = () => {
    value.db.createTurn(value.thread.id, { ...input, content: '新要求' }, 'queued')
  }
  await expect(
    value.service.respond({ ...value.params, response: { action: 'implement' } }),
  ).rejects.toMatchObject({ code: 'TURN_ACTIVE' })
  expect(value.dispatched).toHaveLength(0)
  expect(value.db.repositories.planApprovals.get(value.approval.id)?.status).toBe('superseded')
})

test('事务接纳失败回滚批准和设置；变更源计划/子代理不能执行', async () => {
  const value = await fixture()
  value.db.sqlite.exec(
    "CREATE TRIGGER reject_plan_input BEFORE INSERT ON inputs BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  )
  await expect(
    value.service.respond({ ...value.params, response: { action: 'implement' } }),
  ).rejects.toThrow('fixture failure')
  expect(value.db.repositories.planApprovals.get(value.approval.id)?.status).toBe('pending')
  expect(value.db.getThreadSettings(value.thread.id)?.taskMode).toBe('plan')
  expect(value.dispatched).toHaveLength(0)
  value.db.sqlite.exec('DROP TRIGGER reject_plan_input')
  value.db.sqlite.query("UPDATE items SET status = 'running' WHERE id = ?").run(value.planId)
  await expect(
    value.service.respond({ ...value.params, response: { action: 'implement' } }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  value.db.sqlite.query("UPDATE threads SET kind = 'subagent' WHERE id = ?").run(value.thread.id)
  await expect(
    value.service.respond({ ...value.params, response: { action: 'close' } }),
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
})

test('旧 schema43 升级恢复最新完整计划，保留历史数据与未知字段', async () => {
  const { db, path, thread, approval } = await fixture()
  db.sqlite.exec(
    "DROP TABLE plan_approvals; PRAGMA user_version = 43; CREATE TABLE future_fixture(value TEXT); INSERT INTO future_fixture VALUES ('retained')",
  )
  db.close()
  databases.splice(databases.indexOf(db), 1)
  const upgraded = new AgentDatabase(path)
  databases.push(upgraded)
  expect(upgraded.sqlite.query('PRAGMA user_version').get()).toEqual({
    user_version: SCHEMA_VERSION,
  })
  expect(upgraded.repositories.planApprovals.pending(thread.id)?.markdown).toBe(approval.markdown)
  expect(upgraded.sqlite.query('SELECT value FROM future_fixture').get()).toEqual({
    value: 'retained',
  })
  upgraded.repositories.planApprovals.recover()
  expect(upgraded.sqlite.query('SELECT count(*) as count FROM plan_approvals').get()).toEqual({
    count: 1,
  })
})

test('普通编码、失败/中断、空或未完成计划均不产生批准；只选择最后完整计划', async () => {
  const { db, thread, service } = await fixture()
  for (const scenario of [
    {
      mode: 'chat' as const,
      status: 'completed' as const,
      itemStatus: 'completed' as const,
      markdown: '不是 Plan',
    },
    {
      mode: 'plan' as const,
      status: 'failed' as const,
      itemStatus: 'completed' as const,
      markdown: '失败计划',
    },
    {
      mode: 'plan' as const,
      status: 'interrupted' as const,
      itemStatus: 'completed' as const,
      markdown: '中断计划',
    },
    {
      mode: 'plan' as const,
      status: 'completed' as const,
      itemStatus: 'running' as const,
      markdown: '片段',
    },
    {
      mode: 'plan' as const,
      status: 'completed' as const,
      itemStatus: 'completed' as const,
      markdown: '  ',
    },
  ]) {
    const turn = db.createTurn(thread.id, { ...input, taskMode: scenario.mode }, 'running')
    db.upsertItem(thread.id, {
      id: crypto.randomUUID(),
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'plan',
      status: scenario.itemStatus,
      data: { markdown: scenario.markdown },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: scenario.status,
    })
    expect(service.read(thread.id)).toBeNull()
  }
  const turn = db.createTurn(thread.id, input, 'running')
  for (const markdown of ['较早计划', '最终计划'])
    db.upsertItem(thread.id, {
      id: crypto.randomUUID(),
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'plan',
      status: 'completed',
      data: { markdown },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  db.finalizeTurn({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    status: 'completed',
  })
  expect(service.read(thread.id)?.markdown).toBe('最终计划')
})

test('结构化计划随计划项与审批投影，并优先于同 turn 的标签计划', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cpx-plan-structured-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'history.sqlite'))
  databases.push(db)
  const { service } = client(db, root)
  const thread = db.createThread()
  const turn = db.createTurn(thread.id, input, 'running')
  const structured: StructuredPlan = {
    title: '结构化计划交付',
    summary: '把最终方案升级为 submit_plan 提交。',
    changes: [{ area: '共享契约', items: ['新增 StructuredPlanSchema'] }],
    interfaceChanges: ['新增 plan.structured.v1'],
    tests: ['聚焦行为测试'],
    assumptions: [],
  }
  const markdown = formatStructuredPlanMarkdown(structured)
  // 先写入仅 Markdown 的标签计划，结构化计划随后提交且优先级更高。
  db.upsertItem(thread.id, {
    id: crypto.randomUUID(),
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: 'plan',
    status: 'completed',
    data: { title: '标签计划', markdown: '# 标签计划\n\n旧方案' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const itemId = `${turn.turnID}:plan`
  db.upsertItem(thread.id, {
    id: itemId,
    turnID: turn.turnID,
    agentID: turn.agentID,
    type: 'plan',
    status: 'completed',
    data: { title: structured.title, markdown, structured },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  db.finalizeTurn({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    status: 'completed',
  })

  const approval = service.read(thread.id)!
  expect(approval.planItemId).toBe(itemId)
  expect(approval.structured).toEqual(structured)
  expect(approval.markdown).toBe(markdown)

  const projection = new ThreadProjection(db)
  const snapshot = projection.snapshot(thread.id)!
  expect(snapshot.pendingPlanApproval?.structured).toEqual(structured)
  expect(projection.historyPage(thread.id)?.pendingPlanApproval?.structured).toEqual(structured)
  const planItems = snapshot.items.filter((item) => item.type === 'plan')
  expect(planItems.find((item) => item.id === itemId)?.structured).toEqual(structured)
  expect(planItems.find((item) => item.id !== itemId)?.structured).toBeUndefined()

  const admitted = await service.respond({
    ...approvalParams(approval, thread.id),
    response: { action: 'implement' },
  })
  expect(db.getTurnInput(admitted.approval.nextTurnId!)?.content).toContain(markdown)

  // 非法或旧的结构化对象只回退到 Markdown，不透传未经验证的对象。
  db.sqlite
    .query('UPDATE items SET data = ? WHERE id = ?')
    .run(
      JSON.stringify({ title: '坏数据', markdown: '仍可用', structured: { title: '缺字段' } }),
      itemId,
    )
  const fallback = projection.snapshot(thread.id)!.items.find((item) => item.id === itemId)
  expect(fallback?.type === 'plan' && fallback.structured).toBeUndefined()
  expect(fallback?.type === 'plan' && fallback.markdown).toBe('仍可用')
})

function approvalParams(approval: { id: string; version: number }, threadId: string) {
  return {
    threadId,
    approvalId: approval.id,
    expectedVersion: approval.version,
    operationId: crypto.randomUUID(),
  }
}

test('更高未知 schema 缺少新表时原样保留并禁用计划能力', async () => {
  const { db, path, thread } = await fixture()
  db.sqlite.exec('DROP TABLE plan_approvals; PRAGMA user_version = 99')
  db.close()
  databases.splice(databases.indexOf(db), 1)
  const future = new AgentDatabase(path)
  databases.push(future)
  expect(future.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 99 })
  expect(future.repositories.planApprovals.available()).toBe(false)
  expect(filterAdvertisedCapabilities(future)).not.toContain('plan.approval.v1')
  expect(new ThreadProjection(future).historyPage(thread.id)?.pendingPlanApproval).toBeNull()
  expect(() => future.repositories.planApprovals.requireThread(thread.id, true)).toThrow(
    '当前存储不支持计划批准',
  )
})

test('独立连接与协调器并发批准经过异步屏障后仍只接纳一个轮次', async () => {
  let reached = 0
  let release!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const validate = async () => {
    if (++reached === 2) release()
    await barrier
  }
  const first = await fixture(validate)
  const otherDb = new AgentDatabase(first.path)
  databases.push(otherDb)
  const second = client(otherDb, first.root, validate)
  const results = await Promise.allSettled([
    first.service.respond({ ...first.params, response: { action: 'implement' } }),
    second.service.respond({
      ...first.params,
      operationId: crypto.randomUUID(),
      response: { action: 'implement' },
    }),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  expect([...first.dispatched, ...second.dispatched]).toHaveLength(1)
  expect(
    first.db.sqlite
      .query('SELECT count(*) as count FROM turns WHERE thread_id = ?')
      .get(first.thread.id),
  ).toEqual({ count: 2 })
  expect(first.db.repositories.planApprovals.get(first.approval.id)?.status).toBe('implemented')
})
