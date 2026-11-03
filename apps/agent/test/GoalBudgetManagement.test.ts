import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import {
  computeConvergenceReserve,
  buildDynamicGoalDirective,
  createGoalExecutionSection,
  createDynamicDirectiveMessage,
  isDynamicDirectiveMessage,
  buildContinuationPrompt,
  getRootThreadId,
  GoalBudgetLimitError,
} from '../src/session/GoalDirectiveService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { ThreadService } from '../src/session/ThreadService'
import { WorkspaceService } from '../src/workspace/WorkspaceService'
import { SubagentService } from '../src/subagent/SubagentService'
import { AgentError } from '../src/Domain'
import type { ThreadGoal } from '@pidex/shared/thread'

test('computeConvergenceReserve: 阈值与计算边界测试', () => {
  expect(computeConvergenceReserve(0)).toBe(0)
  expect(computeConvergenceReserve(-100)).toBe(0)
  // 小预算：预算小于 4096 时返回全部预算
  expect(computeConvergenceReserve(1000)).toBe(1000)
  expect(computeConvergenceReserve(4000)).toBe(4000)
  // 中等预算：20% 小于 4096，保底 4096
  expect(computeConvergenceReserve(10000)).toBe(4096)
  expect(computeConvergenceReserve(20000)).toBe(4096)
  // 大预算：20% 大于 4096，取 20%
  expect(computeConvergenceReserve(50000)).toBe(10000)
  expect(computeConvergenceReserve(100000)).toBe(20000)
})

test('静态与动态提示词指令：无预算与有预算各阶段指令', () => {
  const goal: ThreadGoal = {
    id: 'goal-1',
    threadId: 'thread-1',
    objective: '重构目标预算管理系统并编写完整测试',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 1500,
    timeUsedSeconds: 30,
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
  }

  // 1. 静态指令保持 session-stable，只陈述不变规则，不把当前 objective 当快照事实
  const staticSection = createGoalExecutionSection(goal)
  expect(staticSection.id).toBe('thread.goal')
  expect(staticSection.cache).toBe('session-stable')
  expect(staticSection.content).not.toContain('重构目标预算管理系统')
  expect(staticSection.content).toContain('Planning and effort')
  expect(staticSection.content).toContain('Scope floor')
  expect(staticSection.content).toContain('Completion audit')
  expect(staticSection.content).toContain('Blocked audit')
  expect(staticSection.content).toContain('at least three consecutive goal turns')
  expect(staticSection.content).toContain('status="complete"')
  expect(buildContinuationPrompt(goal)).toContain('status="complete"')

  // 2. 动态指令 - 无预算模式：不削减范围，完整交付全部必需项与可选项
  const noBudgetDirective = buildDynamicGoalDirective(goal, 1500)
  expect(noBudgetDirective).toContain('<objective>重构目标预算管理系统并编写完整测试</objective>')
  expect(noBudgetDirective).toContain('Token budget: none')
  expect(noBudgetDirective).toContain('Unlimited budget')

  // 3. 动态指令 - 有预算充裕阶段
  const budgetedGoal: ThreadGoal = {
    ...goal,
    tokenBudget: 50000,
    tokensUsed: 10000,
  }
  const ampleDirective = buildDynamicGoalDirective(budgetedGoal, 10000)
  expect(ampleDirective).toContain('Token budget: 50000')
  expect(ampleDirective).toContain('Tokens remaining: 40000')
  expect(ampleDirective).toContain('Normal progress')

  // 4. 动态指令 - 收尾阶段（剩余 <= 预留）
  const convergenceDirective = buildDynamicGoalDirective(budgetedGoal, 42000)
  expect(convergenceDirective).toContain('Convergence')
  expect(convergenceDirective).toContain('Stop expanding optional scope')

  // 5. 动态消息生成与识别
  const msg = createDynamicDirectiveMessage(budgetedGoal, 10000)
  expect(isDynamicDirectiveMessage(msg)).toBe(true)
  expect(isDynamicDirectiveMessage({ role: 'user', content: 'hello' } as never)).toBe(false)
})

test('getRootThreadId 沿子任务树正确向上遍历至根会话', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-root-thread-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))

  const rootThread = db.createThread()
  const childThread1 = db.createThread()
  const childThread2 = db.createThread()

  // 允许外键临时跳过以进行纯路径单元测试
  db.sqlite.run('PRAGMA foreign_keys = OFF;')

  db.sqlite
    .query(
      `
    INSERT INTO subagent_tasks (id, parent_thread_id, parent_turn_id, parent_agent_id, child_thread_id, display_name, profile, task, permission_ceiling, workspace_mode, status, created_at, updated_at)
    VALUES ('task-1', ?, 'turn-0', 'agent-0', ?, 'worker 1', 'worker', 'child 1', '{"mode":"default"}', 'shared', 'running', 100, 100)
  `,
    )
    .run(rootThread.id, childThread1.id)

  db.sqlite
    .query(
      `
    INSERT INTO subagent_tasks (id, parent_thread_id, parent_turn_id, parent_agent_id, child_thread_id, display_name, profile, task, permission_ceiling, workspace_mode, status, created_at, updated_at)
    VALUES ('task-2', ?, 'turn-1', 'agent-1', ?, 'worker 2', 'worker', 'child 2', '{"mode":"default"}', 'shared', 'running', 200, 200)
  `,
    )
    .run(childThread1.id, childThread2.id)

  expect(getRootThreadId(db, childThread2.id)).toBe(rootThread.id)
  expect(getRootThreadId(db, childThread1.id)).toBe(rootThread.id)
  expect(getRootThreadId(db, rootThread.id)).toBe(rootThread.id)
})

const defaultTurnInput = {
  content: '测试任务',
  model: { providerID: 'test', id: 'test' } as never,
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
  strategy: 'queue' as const,
  taskMode: 'chat' as const,
}

test('预算耗尽时 Subagent 拒绝创建，并在恢复预算后恢复正常', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-subagent-budget-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const hub = { publish: () => Effect.void }
  const goalService = new ThreadGoalService(db, hub as never)

  const thread = db.createThread()
  await goalService.set({
    threadId: thread.id,
    objective: '测试子 Agent 预算耗尽保护',
    tokenBudget: 5000,
    expectedVersion: null,
    operationId: 'goal-subagent-1',
  })

  // 记录用量达到 5000
  const ledger = db.repositories.threadGoalLedger
  const goal = ledger.visibleGoal(thread.id)!
  ledger.recordUsage([
    {
      threadId: thread.id,
      goalId: goal.id,
      agentId: 'agent-root',
      sourceEntryId: 'text-1',
      inputTokens: 3000,
      outputTokens: 2000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  ])
  ledger.refreshMeasurement(thread.id)

  const subagentService = new SubagentService(
    db,
    hub as never,
    { getModel: async () => ({}) } as never,
    { setAgentStatusHandler: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
  )

  // 创建根执行记录
  const turn = db.createTurn(thread.id, defaultTurnInput, 'running')
  const rootAgent = db.getAgentExecution(turn.agentID)!

  // 尝试创建子 Agent 应被拒绝
  let error: unknown
  try {
    await subagentService.spawn(
      {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: rootAgent.id,
        taskMode: 'chat',
        model: { providerID: 'test', id: 'test' } as never,
        permissionConfig: defaultTurnInput.permissionConfig,
        workspaceRoot: root,
      },
      [{ profile: 'worker', task: 'subtask 1' }],
    )
  } catch (err) {
    error = err
  }

  expect(error).toBeInstanceOf(AgentError)
  expect((error as AgentError).code).toBe('GOAL_BUDGET_EXHAUSTED')

  // 提高预算后可以正常通过该检查（抛出的后续错误是 mock 依赖引发，证明预算检查已放行）
  await goalService.set({
    threadId: thread.id,
    objective: '测试子 Agent 预算耗尽保护',
    tokenBudget: 20000,
    expectedVersion: 2,
    operationId: 'goal-subagent-2',
  })

  let secondError: unknown
  try {
    await subagentService.spawn(
      {
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: rootAgent.id,
        taskMode: 'chat',
        model: { providerID: 'test', id: 'test' } as never,
        permissionConfig: defaultTurnInput.permissionConfig,
        workspaceRoot: root,
      },
      [{ profile: 'worker', task: 'subtask 1' }],
    )
  } catch (err) {
    secondError = err
  }
  expect((secondError as AgentError).code).not.toBe('GOAL_BUDGET_EXHAUSTED')
})

test('提高受限预算恢复 active 并解挂队列，缺核验证据不机械续跑', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-resume-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const hub = { publish: () => Effect.void }
  const goalService = new ThreadGoalService(db, hub as never)

  const thread = db.createThread()
  await goalService.set({
    threadId: thread.id,
    objective: '测试受限预算恢复',
    tokenBudget: 2000,
    expectedVersion: null,
    operationId: 'goal-resume-init',
  })

  const ledger = db.repositories.threadGoalLedger
  const goal = ledger.visibleGoal(thread.id)!

  // 达到预算并设为 budget-limited
  ledger.recordUsage([
    {
      threadId: thread.id,
      goalId: goal.id,
      agentId: 'agent-1',
      sourceEntryId: 'item-1',
      inputTokens: 1500,
      outputTokens: 600,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  ])
  ledger.refreshMeasurement(thread.id)

  const limitedGoal = goalService.get(thread.id).goal!
  expect(limitedGoal.status).toBe('budget-limited')

  // 模拟因受限而中断的 turn 与 paused 队列
  const turn = db.createTurn(thread.id, defaultTurnInput, 'running')
  db.sqlite.query("UPDATE turns SET status = 'interrupted' WHERE id = ?").run(turn.turnID)
  db.sqlite
    .query(
      "UPDATE agent_executions SET status = 'interrupted', error = 'budget-limited' WHERE id = ?",
    )
    .run(turn.agentID)
  db.sqlite
    .query("UPDATE threads SET queue_pause_reason = 'interrupted' WHERE id = ?")
    .run(thread.id)

  expect(db.queueStateMeta(thread.id)?.pauseReason).toBe('interrupted')

  // 验证用户在不显式传 status 的情况下提高预算自动恢复 active
  const updatedWithoutStatus = await goalService.set({
    threadId: thread.id,
    tokenBudget: 10000,
    expectedVersion: limitedGoal.version,
    operationId: 'goal-resume-boost-auto',
  })
  expect(updatedWithoutStatus.goal.status).toBe('active')
  expect(db.queueStateMeta(thread.id)?.pauseReason).toBeNull()

  // 验证 continuation prompt
  const continuationPrompt = buildContinuationPrompt(updatedWithoutStatus.goal)
  expect(continuationPrompt).toContain('take the next concrete action')
  expect(continuationPrompt).toContain('测试受限预算恢复')

  // 验证 resumeGoalContinuation 能成功从 interrupted + error='budget-limited' 的 Turn 恢复创建 continuation Turn
  const threadService = new ThreadService(
    db,
    hub as never,
    {
      resolve: async () => ({ providerID: 'test', id: 'test' }),
      getModel: async () => ({}),
    } as never,
    {} as never,
    { setResumeHandler: () => {} } as never,
    {
      toolExposure: () => ({ exposed: [] }),
      clearTurnPermissionGrants: () => {},
      abort: async () => {},
      run: async () => ({ status: 'completed', output: 'ok' }),
    } as never,
    {
      setParentResumeHandler: () => {},
      resolvedWaitCheckpoint: () => null,
      collaboration: { saved: () => null, available: false },
      deferCompletion: async () => false,
      reconcileCompletions: async () => {},
      delegationFor: () => undefined,
      stopChildrenForParent: async () => {},
    } as never,
    { listByBinding: async () => [] } as never,
    { dataRoot: root, userHome: root },
    { recall: () => [], enqueue: () => null } as never,
    { load: () => {}, run: async () => [] } as never,
    {
      resolve: async () => ({
        kind: 'projectless',
        workspaceRoot: root,
        cwd: root,
        outputDirectory: root,
      }),
    } as never,
  )

  await threadService.resumeGoalContinuation(thread.id)
  const continuations = db.sqlite
    .query('SELECT * FROM thread_goal_continuations WHERE thread_id = ?')
    .all(thread.id) as Array<{ continuation_turn_id: string; trigger_reason: string }>
  expect(continuations.length).toBe(0)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(goalService.get(thread.id).goal?.status).toBe('paused')
})

test('finalizeTurn: 准入拦截中断时保留 budget-limited 状态，不被覆盖为 paused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-finalize-status-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const hub = { publish: () => Effect.void }
  const goalService = new ThreadGoalService(db, hub as never)

  const thread = db.createThread()
  await goalService.set({
    threadId: thread.id,
    objective: '测试准入受限状态保留',
    tokenBudget: 50000,
    expectedVersion: null,
    operationId: 'goal-admission-init',
  })

  // 创建运行中的 Turn
  const turn = db.createTurn(thread.id, defaultTurnInput, 'running')

  // 准入拦截将目标标记为 budget-limited
  const goal = db.repositories.threadGoals.get(thread.id)!
  db.sqlite
    .query("UPDATE thread_goals SET status = 'budget-limited', updated_at = ? WHERE id = ?")
    .run(Date.now(), goal.id)

  // finalizeTurn 结束该回合，确认保留 budget-limited 而未被覆盖为 paused
  db.finalizeTurn({
    threadID: thread.id,
    turnID: turn.turnID,
    agentID: turn.agentID,
    status: 'interrupted',
    message: 'budget-limited',
    pauseReason: 'interrupted',
  })

  const settledGoal = db.repositories.threadGoals.get(thread.id)!
  expect(settledGoal.status).toBe('budget-limited')

  // 调高预算至 100000 并显式或自动恢复 active
  const raised = await goalService.set({
    threadId: thread.id,
    status: 'active',
    tokenBudget: 100000,
    expectedVersion: settledGoal.version,
    operationId: 'goal-admission-raise',
  })
  expect(raised.goal.status).toBe('active')
})

test('ThreadGoalService.set: 显式 paused 与 complete 不受预算调整覆盖，不足额提高维持 budget-limited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-overrides-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const hub = { publish: () => Effect.void }
  const goalService = new ThreadGoalService(db, hub as never)

  const thread = db.createThread()
  const init = await goalService.set({
    threadId: thread.id,
    objective: '测试状态覆盖',
    tokenBudget: 2000,
    expectedVersion: null,
    operationId: 'goal-cov-init',
  })

  // 1. 记账 2500，进入 budget-limited
  const ledger = db.repositories.threadGoalLedger
  ledger.recordUsage([
    {
      threadId: thread.id,
      goalId: init.goal.id,
      agentId: 'agent-1',
      sourceEntryId: 'item-1',
      inputTokens: 2500,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    },
  ])
  ledger.refreshMeasurement(thread.id)

  const limited = goalService.get(thread.id).goal!
  expect(limited.status).toBe('budget-limited')

  // 2. 提高预算但仍低于已用量（从 2000 提到 2200，但已用 2500），应维持 budget-limited
  const stillLimited = await goalService.set({
    threadId: thread.id,
    tokenBudget: 2200,
    expectedVersion: limited.version,
    operationId: 'goal-cov-insufficient',
  })
  expect(stillLimited.goal.status).toBe('budget-limited')

  // 没有用户排队项时也必须恢复，不能依赖 queue_pause_reason。
  expect(db.queueStateMeta(thread.id)?.pauseReason).toBeNull()

  // 3. 人工暂停后，即使预算大幅提高，仍保留 paused
  const paused = await goalService.set({
    threadId: thread.id,
    status: 'paused',
    expectedVersion: stillLimited.goal.version,
    operationId: 'goal-cov-pause',
  })
  expect(paused.goal.status).toBe('paused')

  const boostWhilePaused = await goalService.set({
    threadId: thread.id,
    tokenBudget: 50000,
    expectedVersion: paused.goal.version,
    operationId: 'goal-cov-boost-paused',
  })
  expect(boostWhilePaused.goal.status).toBe('paused')

  // 4. 取消上限是放宽；不限额之后不能再重新设有限上限。
  const unlimited = await goalService.set({
    threadId: thread.id,
    tokenBudget: null,
    expectedVersion: boostWhilePaused.goal.version,
    operationId: 'goal-cov-unlimited',
  })
  expect(unlimited.goal).toMatchObject({ status: 'paused', tokenBudget: null })
  await expect(
    goalService.set({
      threadId: thread.id,
      tokenBudget: 2200,
      expectedVersion: unlimited.goal.version,
      operationId: 'goal-cov-limited-again',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  expect(goalService.get(thread.id).goal).toEqual(unlimited.goal)
})

test('ThreadGoalService.set: 仅编辑正文不得解除预估准入造成的 budget-limited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-edit-limited-'))
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const hub = { publish: () => Effect.void }
  const goalService = new ThreadGoalService(db, hub as never)

  const thread = db.createThread()
  const init = await goalService.set({
    threadId: thread.id,
    objective: '预估准入受限',
    tokenBudget: 3000,
    expectedVersion: null,
    operationId: 'edit-limited-init',
  })

  // 零用量、预估下一请求超预算：只在准入时发布 budget-limited。
  const ledger = db.repositories.threadGoalLedger
  const limited = db.transaction(() => ledger.refreshMeasurement(thread.id, 'budget-limited'))
  expect(limited?.goal).toMatchObject({ status: 'budget-limited', tokensUsed: 0 })
  expect(db.queueStateMeta(thread.id)?.pauseReason).toBeNull()

  // 只改正文、不传 tokenBudget：必须保留受限，否则面板会退回“进行中的目标”。
  const edited = await goalService.set({
    threadId: thread.id,
    objective: '预估准入受限（正文已改）',
    expectedVersion: init.goal.version + 1,
    operationId: 'edit-limited-objective',
  })
  expect(edited.goal.status).toBe('budget-limited')
  expect(edited.goal.tokenBudget).toBe(3000)

  // 显式清空预算才是解除受限的路径。
  const resumed = await goalService.set({
    threadId: thread.id,
    tokenBudget: null,
    expectedVersion: edited.goal.version,
    operationId: 'edit-limited-resume',
  })
  expect(resumed.goal.status).toBe('active')
  db.close()
})
