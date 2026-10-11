import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { DEFAULT_GOAL_TOKEN_BUDGET, ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadGoalLedgerRepository } from '../src/storage/repositories/ThreadGoalLedgerRepository'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-ledger-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  return { db, service }
}

const submit = (content: string) => ({
  content,
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
  permissionConfig: {
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'on-request' as const,
    approvalsReviewer: 'user' as const,
  },
  strategy: 'queue' as const,
  taskMode: 'chat' as const,
})

const insertUsageItem = (
  db: AgentDatabase,
  input: {
    id: string
    threadId: string
    turnId: string
    agentId: string
    ordinal: number
    usage: Record<string, number>
    createdAt?: number
  },
) => {
  const timestamp = input.createdAt ?? Date.now()
  db.sqlite
    .query(
      `
    INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'text', 'completed', ?, ?, ?, ?)
  `,
    )
    .run(
      input.id,
      input.threadId,
      input.turnId,
      input.agentId,
      JSON.stringify({ usage: input.usage }),
      input.ordinal,
      timestamp,
      timestamp,
    )
}

const goalEvents = (db: AgentDatabase) =>
  db.sqlite
    .query("SELECT method FROM events WHERE method = 'thread/goal/updated' ORDER BY id")
    .all()

describe('ThreadGoal ledger', () => {
  test('累计主 Agent 与多层子代理 token，重放不重复计费', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('计量线程')
    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '统计用量',
        tokenBudget: 1_000_000,
        expectedVersion: null,
        operationId: 'goal:set:ledger',
      })
    ).goal

    const main = db.createTurn(thread.id, submit('主任务'))
    const childThread = db.createThread('子代理线程')
    const child = db.createTurn(childThread.id, submit('子任务'))
    // Model the subagent execution as a child of the main agent, living in its own thread.
    db.sqlite
      .query('UPDATE agent_executions SET parent_agent_id = ?, depth = 1 WHERE id = ?')
      .run(main.agentID, child.agentID)

    insertUsageItem(db, {
      id: 'item:main:1',
      threadId: thread.id,
      turnId: main.turnID,
      agentId: main.agentID,
      ordinal: 0,
      usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 10, reasoning: 5 },
    })
    insertUsageItem(db, {
      id: 'item:child:1',
      threadId: childThread.id,
      turnId: child.turnID,
      agentId: child.agentID,
      ordinal: 0,
      usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 1 },
    })

    const measured = service.measureTurn({ threadId: thread.id, turnId: main.turnID })
    // input + output + cacheRead + cacheWrite on both levels; reasoning is audit-only.
    expect(measured?.goal.tokensUsed).toBe(100 + 20 + 30 + 10 + 7 + 3)
    expect(measured?.goal.id).toBe(goal.id)

    // Replaying the same terminal turn must not bill again.
    service.measureTurn({ threadId: thread.id, turnId: main.turnID })
    const ledgerRows = db.sqlite
      .query('SELECT COUNT(*) AS count FROM thread_goal_usage_ledger')
      .get() as { count: number }
    expect(ledgerRows.count).toBe(2)
    expect(db.repositories.threadGoals.get(thread.id)?.tokensUsed).toBe(170)
    db.close()
  })

  test('并行运行区间只计算一次墙钟时间，未关闭区间不计入', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('时间线程')
    await service.set({
      threadId: thread.id,
      objective: '统计时间',
      expectedVersion: null,
      operationId: 'goal:set:intervals',
    })

    let clock = 1_000
    const ledger = new ThreadGoalLedgerRepository(db, () => clock)
    clock = 1_000
    ledger.openInterval({ threadId: thread.id, agentId: 'agent:a' })
    clock = 1_500
    ledger.openInterval({ threadId: thread.id, agentId: 'agent:b' })
    // a: 1000–4000, b: 1500–3000; the union is 1000–4000.
    ledger.closeAgentIntervals('agent:b', 3_000)
    ledger.closeAgentIntervals('agent:a', 4_000)
    ledger.refreshMeasurement(thread.id)
    expect(db.repositories.threadGoals.get(thread.id)?.timeUsedSeconds).toBe(3)

    // An interval left open by a crash contributes nothing until it is closed.
    clock = 10_000
    ledger.openInterval({ threadId: thread.id, agentId: 'agent:c' })
    ledger.refreshMeasurement(thread.id)
    expect(db.repositories.threadGoals.get(thread.id)?.timeUsedSeconds).toBe(3)

    // Recovery closes stale intervals, so the offline gap is not billed either.
    ledger.closeOpenIntervals(11_000)
    ledger.refreshMeasurement(thread.id)
    expect(db.repositories.threadGoals.get(thread.id)?.timeUsedSeconds).toBe(4)
    db.close()
  })

  test('等待用户与终态会关闭活动区间', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('等待线程')
    await service.set({
      threadId: thread.id,
      objective: '等待不计量',
      expectedVersion: null,
      operationId: 'goal:set:waiting',
    })
    const turn = db.createTurn(thread.id, submit('执行'))
    db.claimTurnExecution(turn.turnID)
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM thread_goal_active_intervals WHERE ended_at IS NULL')
        .get(),
    ).toEqual({ count: 1 })

    db.updateAgentStatus(turn.agentID, 'waiting_permission')
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM thread_goal_active_intervals WHERE ended_at IS NULL')
        .get(),
    ).toEqual({ count: 0 })
    db.close()
  })

  test('预算达到时派生 budget-limited，提高预算后回到 active', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('预算线程')
    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '受预算限制',
        tokenBudget: 50,
        expectedVersion: null,
        operationId: 'goal:set:budget',
      })
    ).goal

    const turn = db.createTurn(thread.id, submit('超出预算'))
    insertUsageItem(db, {
      id: 'item:budget:1',
      threadId: thread.id,
      turnId: turn.turnID,
      agentId: turn.agentID,
      ordinal: 0,
      usage: { input: 60, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })
    const limited = service.measureTurn({ threadId: thread.id, turnId: turn.turnID })?.goal
    expect(limited).toMatchObject({ id: goal.id, status: 'budget-limited', tokensUsed: 60 })

    // Raising the budget returns the machine-managed band to active without moving identity.
    await service.set({
      threadId: thread.id,
      tokenBudget: 1_000,
      expectedVersion: limited!.version,
      operationId: 'goal:set:budget-raised',
    })
    const refreshed = db.repositories.threadGoalLedger.refreshMeasurement(thread.id)
    expect(refreshed?.goal).toMatchObject({ id: goal.id, status: 'active', tokensUsed: 60 })
    db.close()
  })

  test('人工暂停不被计量派生覆盖', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('暂停线程')
    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '保持暂停',
        tokenBudget: 10,
        status: 'paused',
        expectedVersion: null,
        operationId: 'goal:set:paused',
      })
    ).goal

    const turn = db.createTurn(thread.id, submit('暂停期间'))
    insertUsageItem(db, {
      id: 'item:paused:1',
      threadId: thread.id,
      turnId: turn.turnID,
      agentId: turn.agentID,
      ordinal: 0,
      usage: { input: 900, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })
    service.measureTurn({ threadId: thread.id, turnId: turn.turnID })
    expect(db.repositories.threadGoals.get(thread.id)).toMatchObject({
      id: goal.id,
      status: 'paused',
      tokensUsed: 900,
    })
    db.close()
  })

  test('创建时使用默认预算，显式 null 表示不限额', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('默认预算线程')

    const defaulted = (
      await service.set({
        threadId: thread.id,
        objective: '默认预算',
        expectedVersion: null,
        operationId: 'goal:set:default',
      })
    ).goal
    expect(DEFAULT_GOAL_TOKEN_BUDGET).toBe(200_000)
    expect(defaulted.tokenBudget).toBe(DEFAULT_GOAL_TOKEN_BUDGET)

    const unlimited = (
      await service.set({
        threadId: thread.id,
        tokenBudget: null,
        expectedVersion: defaulted.version,
        operationId: 'goal:set:unlimited',
      })
    ).goal
    expect(unlimited.tokenBudget).toBeNull()
    expect(unlimited.id).toBe(defaulted.id)
    db.close()
  })

  test('清除后新 Goal 归零，归档 Goal 的用量与 ledger 保留', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('归档线程')
    const first = (
      await service.set({
        threadId: thread.id,
        objective: '第一段',
        tokenBudget: 100,
        expectedVersion: null,
        operationId: 'goal:set:first',
      })
    ).goal
    const turn = db.createTurn(thread.id, submit('第一段执行'))
    insertUsageItem(db, {
      id: 'item:archive:1',
      threadId: thread.id,
      turnId: turn.turnID,
      agentId: turn.agentID,
      ordinal: 0,
      usage: { input: 42, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })
    service.measureTurn({ threadId: thread.id, turnId: turn.turnID })
    const measured = db.repositories.threadGoals.get(thread.id)!
    expect(measured.tokensUsed).toBe(42)
    // Measurement advances the goal version, so a stale CAS value is rejected.
    await expect(
      service.clear({
        threadId: thread.id,
        expectedVersion: first.version,
        operationId: 'goal:clear:stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    await service.clear({
      threadId: thread.id,
      expectedVersion: measured.version,
      operationId: 'goal:clear:archive',
    })
    // The ledger is not cascade-deleted with the visible goal.
    expect(
      (
        db.sqlite.query('SELECT COUNT(*) AS count FROM thread_goal_usage_ledger').get() as {
          count: number
        }
      ).count,
    ).toBe(1)
    expect(db.repositories.threadGoals.history(thread.id)[0]).toMatchObject({
      id: first.id,
      tokensUsed: 42,
    })

    const second = (
      await service.set({
        threadId: thread.id,
        objective: '第二段',
        expectedVersion: null,
        operationId: 'goal:set:second',
      })
    ).goal
    expect(second.id).not.toBe(first.id)
    expect(second.tokensUsed).toBe(0)
    db.close()
  })

  test('终态经 finalizeTurn 在同一事务内计量并产出 Goal 事件', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('整合线程')
    await service.set({
      threadId: thread.id,
      objective: '整合计量',
      tokenBudget: 1_000_000,
      expectedVersion: null,
      operationId: 'goal:set:integration',
    })
    const turn = db.createTurn(thread.id, submit('执行'))
    // Claiming the turn opens the run interval.
    db.claimTurnExecution(turn.turnID)
    expect(
      (
        db.sqlite
          .query(
            'SELECT COUNT(*) AS count FROM thread_goal_active_intervals WHERE ended_at IS NULL',
          )
          .get() as { count: number }
      ).count,
    ).toBe(1)

    // Make the active interval measurably long without sleeping.
    db.sqlite
      .query('UPDATE thread_goal_active_intervals SET started_at = ? WHERE ended_at IS NULL')
      .run(Date.now() - 5_000)
    insertUsageItem(db, {
      id: 'item:integration:1',
      threadId: thread.id,
      turnId: turn.turnID,
      agentId: turn.agentID,
      ordinal: 0,
      usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    })

    const result = db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })

    const goal = db.repositories.threadGoals.get(thread.id)!
    expect(goal.tokensUsed).toBe(120)
    expect(goal.timeUsedSeconds).toBeGreaterThanOrEqual(4)
    // The goal update ships in the same terminal event batch, so it can only be
    // observed after that transaction committed.
    expect(result.events.some((event) => event.method === 'thread/goal/updated')).toBe(true)
    expect(
      (
        db.sqlite
          .query(
            'SELECT COUNT(*) AS count FROM thread_goal_active_intervals WHERE ended_at IS NULL',
          )
          .get() as { count: number }
      ).count,
    ).toBe(0)
    expect(
      (
        db.sqlite
          .query('SELECT COUNT(*) AS count FROM thread_goal_continuations WHERE source_turn_id = ?')
          .get(turn.turnID) as { count: number }
      ).count,
    ).toBe(1)
    expect(
      db.sqlite
        .query(
          "SELECT origin FROM inputs WHERE turn_id <> ? AND thread_id = ? AND status = 'queued'",
        )
        .get(turn.turnID, thread.id),
    ).toEqual({ origin: 'goal-continuation' })
    db.close()
  })

  test('用户排队 Turn 优先且重复终态不创建 Goal continuation', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('用户队列优先')
    await service.set({
      threadId: thread.id,
      objective: '继续完成',
      expectedVersion: null,
      operationId: 'goal:set:queue-priority',
    })
    const running = db.createTurn(thread.id, submit('第一轮'))
    db.claimTurnExecution(running.turnID)
    const queued = db.createTurn(thread.id, submit('用户下一步'), 'queued')
    db.finalizeTurn({
      threadID: thread.id,
      turnID: running.turnID,
      agentID: running.agentID,
      status: 'completed',
    })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: running.turnID,
      agentID: running.agentID,
      status: 'completed',
    })
    expect(
      (
        db.sqlite.query('SELECT COUNT(*) AS count FROM thread_goal_continuations').get() as {
          count: number
        }
      ).count,
    ).toBe(0)
    expect(
      (
        db.sqlite
          .query("SELECT COUNT(*) AS count FROM turns WHERE thread_id = ? AND status = 'queued'")
          .get(thread.id) as { count: number }
      ).count,
    ).toBe(1)
    expect(db.getTurnInput(queued.turnID)?.content).toBe('用户下一步')
    db.close()
  })

  test('未变化时重复计量不写事件、不推进版本', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('空计量线程')
    await service.set({
      threadId: thread.id,
      objective: '空计量',
      expectedVersion: null,
      operationId: 'goal:set:empty',
    })
    expect(goalEvents(db)).toHaveLength(1)

    const turn = db.createTurn(thread.id, submit('没有用量'))
    expect(service.measureTurn({ threadId: thread.id, turnId: turn.turnID })).toBeNull()
    expect(goalEvents(db)).toHaveLength(1)
    expect(db.repositories.threadGoals.get(thread.id)?.version).toBe(1)
    db.close()
  })
})
