import { QueuedGoalRepository } from '../src/storage/repositories/QueuedGoalRepository'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-goal-'))
  paths.push(root)
  const path = join(root, 'agent.sqlite')
  const db = new AgentDatabase(path)
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  return { db, path, service }
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

const goalEvents = (db: AgentDatabase) =>
  db.sqlite.query("SELECT method FROM events WHERE method LIKE 'thread/goal/%' ORDER BY id").all()

/** Exact schema 45 goal table, reproduced to exercise a store without the identity column. */
const LEGACY_GOAL_TABLE = `
  CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
    objective TEXT NOT NULL CHECK(length(objective) BETWEEN 1 AND 4000),
    status TEXT NOT NULL CHECK(status IN ('active','paused','blocked','usage-limited','budget-limited','complete')),
    token_budget INTEGER CHECK(token_budget IS NULL OR token_budget >= 0),
    tokens_used INTEGER NOT NULL DEFAULT 0 CHECK(tokens_used >= 0),
    time_used_seconds INTEGER NOT NULL DEFAULT 0 CHECK(time_used_seconds >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    cleared_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

describe('ThreadGoalService', () => {
  test('创建、更新冲突、暂停、完成、清除并跨重启保留', async () => {
    const { db, path, service } = await fixture()
    const thread = db.createThread('目标线程')

    const created = (
      await service.set({
        threadId: thread.id,
        objective: '修复登录失败',
        expectedVersion: null,
        operationId: 'goal:set:create',
      })
    ).goal
    expect(created).toMatchObject({
      threadId: thread.id,
      objective: '修复登录失败',
      status: 'active',
      version: 1,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    })
    expect(created.id).toBeTruthy()
    expect(service.get(thread.id).goal).toEqual(created)

    // A stale version assertion must not silently overwrite the stored goal.
    await expect(
      service.set({
        threadId: thread.id,
        objective: '改写目标',
        expectedVersion: null,
        operationId: 'goal:set:stale',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(service.get(thread.id).goal?.objective).toBe('修复登录失败')

    const paused = (
      await service.set({
        threadId: thread.id,
        status: 'paused',
        expectedVersion: created.version,
        operationId: 'goal:set:pause',
      })
    ).goal
    // Updating keeps the identity and accumulates on the same goal instance.
    expect(paused).toMatchObject({
      id: created.id,
      status: 'paused',
      version: 2,
      objective: '修复登录失败',
      createdAt: created.createdAt,
    })

    const completed = (
      await service.set({
        threadId: thread.id,
        status: 'complete',
        expectedVersion: paused.version,
        operationId: 'goal:set:complete',
      })
    ).goal
    expect(completed).toMatchObject({ id: created.id, status: 'complete', version: 3 })
    expect(completed.completedAt).toBeGreaterThan(0)

    // Completing a goal neither archives the thread nor blocks further turns.
    expect(db.getThread(thread.id)?.id).toBe(thread.id)
    expect(db.sqlite.query('SELECT archived_at FROM threads WHERE id = ?').get(thread.id)).toEqual({
      archived_at: null,
    })
    expect(db.createTurn(thread.id, submit('继续执行')).turnID).toBeTruthy()

    expect(goalEvents(db)).toEqual([
      { method: 'thread/goal/updated' },
      { method: 'thread/goal/updated' },
      { method: 'thread/goal/updated' },
    ])
    db.close()

    const reopened = new AgentDatabase(path)
    const reopenedService = new ThreadGoalService(reopened, await Effect.runPromise(EventHub.make))
    expect(reopenedService.get(thread.id).goal).toMatchObject({
      id: created.id,
      objective: '修复登录失败',
      status: 'complete',
      version: 3,
    })

    const cleared = await reopenedService.clear({
      threadId: thread.id,
      expectedVersion: completed.version,
      operationId: 'goal:clear:first',
    })
    expect(cleared).toEqual({
      threadId: thread.id,
      goalId: created.id,
      clearedAt: expect.any(Number),
    })
    expect(reopenedService.get(thread.id).goal).toBeNull()
    // The archived goal keeps its identity and consumption for history.
    expect(reopened.repositories.threadGoals.history(thread.id)).toEqual([
      expect.objectContaining({
        id: created.id,
        objective: '修复登录失败',
        status: 'complete',
        version: 3,
        clearedAt: cleared.clearedAt,
      }),
    ])
    expect(goalEvents(reopened)).toEqual([
      { method: 'thread/goal/updated' },
      { method: 'thread/goal/updated' },
      { method: 'thread/goal/updated' },
      { method: 'thread/goal/cleared' },
    ])
    reopened.close()
  })

  test('清除后重新创建生成新 goalId 且用量与创建时间归零', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('重建线程')

    const first = (
      await service.set({
        threadId: thread.id,
        objective: '第一次目标',
        expectedVersion: null,
        operationId: 'goal:set:first',
      })
    ).goal
    // Simulate consumption recorded against the first goal.
    db.sqlite
      .query('UPDATE thread_goals SET tokens_used = 1234, time_used_seconds = 99 WHERE id = ?')
      .run(first.id)
    expect(service.get(thread.id).goal).toMatchObject({ tokensUsed: 1234, timeUsedSeconds: 99 })

    const cleared = await service.clear({
      threadId: thread.id,
      expectedVersion: first.version,
      operationId: 'goal:clear:first',
    })
    expect(service.get(thread.id).goal).toBeNull()

    const second = (
      await service.set({
        threadId: thread.id,
        objective: '第二次目标',
        expectedVersion: null,
        operationId: 'goal:set:second',
      })
    ).goal

    expect(second.id).not.toBe(first.id)
    expect(second).toMatchObject({
      threadId: thread.id,
      objective: '第二次目标',
      status: 'active',
      version: 1,
      tokensUsed: 0,
      timeUsedSeconds: 0,
    })
    expect(second.createdAt).toBeGreaterThanOrEqual(first.createdAt)
    // The old goal survives in history with its consumption intact.
    const history = db.repositories.threadGoals.history(thread.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      id: first.id,
      tokensUsed: 1234,
      timeUsedSeconds: 99,
      clearedAt: cleared.clearedAt,
      createdAt: first.createdAt,
    })
    db.close()
  })

  test('operationId 幂等重放且拒绝复用到不同请求', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('幂等线程')

    const first = await service.set({
      threadId: thread.id,
      objective: '排查内存泄漏',
      expectedVersion: null,
      operationId: 'goal:set:idempotent',
    })
    const replay = await service.set({
      threadId: thread.id,
      objective: '排查内存泄漏',
      expectedVersion: null,
      operationId: 'goal:set:idempotent',
    })
    expect(replay).toEqual(first)
    expect(goalEvents(db)).toEqual([{ method: 'thread/goal/updated' }])

    await expect(
      service.set({
        threadId: thread.id,
        objective: '另一个目标',
        expectedVersion: null,
        operationId: 'goal:set:idempotent',
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' })

    // Clearing without a visible goal is a conflict rather than a silent success.
    await expect(
      service.clear({
        threadId: thread.id,
        expectedVersion: null,
        operationId: 'goal:clear:empty',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    db.close()
  })

  test('Goal 纳入 Thread snapshot，清除后回到 null', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('快照线程')
    const projection = new ThreadProjection(db)

    expect(projection.snapshot(thread.id)?.goal ?? null).toBeNull()
    expect(projection.list().find((item) => item.id === thread.id)?.goal).toBeNull()

    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '让快照带上 Goal',
        expectedVersion: null,
        operationId: 'goal:set:snapshot',
      })
    ).goal
    expect(projection.snapshot(thread.id)?.goal).toEqual(goal)
    expect(projection.list().find((item) => item.id === thread.id)?.goal).toEqual(goal)

    await service.clear({
      threadId: thread.id,
      expectedVersion: goal.version,
      operationId: 'goal:clear:snapshot',
    })
    expect(projection.snapshot(thread.id)?.goal ?? null).toBeNull()
    expect(projection.list().find((item) => item.id === thread.id)?.goal).toBeNull()
    db.close()
  })

  test('缺少 operation 表时 fail-closed，不广告 thread.goal.v1', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('部分表线程')
    await service.set({
      threadId: thread.id,
      objective: '仍可读取既有 Goal',
      expectedVersion: null,
      operationId: 'goal:set:partial',
    })

    db.sqlite.exec('DROP TABLE thread_goal_operations')

    expect(db.repositories.threadGoals.available()).toBe(false)
    expect(filterAdvertisedCapabilities(db)).not.toContain('thread.goal.v1')
    // The goal table still reads; only idempotent mutation is unavailable.
    expect(db.repositories.threadGoals.get(thread.id)?.objective).toBe('仍可读取既有 Goal')
    await expect(
      service.set({
        threadId: thread.id,
        objective: '写入必须 fail-closed',
        expectedVersion: 1,
        operationId: 'goal:set:partial',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    db.close()
  })

  test('缺少 thread_goal_history 表时降级只读，不广告 thread.goal.v1', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('缺历史表线程')
    await service.set({
      threadId: thread.id,
      objective: '历史表缺失时的目标',
      expectedVersion: null,
      operationId: 'goal:set:no-history',
    })

    db.sqlite.exec('DROP TABLE thread_goal_history')

    expect(db.repositories.threadGoals.available()).toBe(false)
    expect(filterAdvertisedCapabilities(db)).not.toContain('thread.goal.v1')
    expect(db.repositories.threadGoals.get(thread.id)?.objective).toBe('历史表缺失时的目标')
    await expect(
      service.set({
        threadId: thread.id,
        status: 'paused',
        expectedVersion: 1,
        operationId: 'goal:set:no-history',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    db.close()
  })

  test('缺少 id 列的旧形状只读降级，Goal 行不再投影', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('旧形状线程')
    await service.set({
      threadId: thread.id,
      objective: '旧形状目标',
      expectedVersion: null,
      operationId: 'goal:set:legacy-shape',
    })

    db.sqlite.exec(
      'DROP TABLE thread_goal_history; DROP TABLE thread_goals; DROP TABLE thread_goal_operations;',
    )
    db.sqlite.exec(LEGACY_GOAL_TABLE)
    db.sqlite
      .query(
        `
      INSERT INTO thread_goals (thread_id, objective, status, token_budget, tokens_used,
        time_used_seconds, version, cleared_at, created_at, updated_at)
      VALUES (?, '旧形状目标', 'active', NULL, 5, 1, 1, NULL, 1, 2)
    `,
      )
      .run(thread.id)

    const projection = new ThreadProjection(db)
    expect(db.repositories.threadGoals.available()).toBe(false)
    expect(db.repositories.threadGoals.visibleGoalsValid()).toBe(false)
    expect(filterAdvertisedCapabilities(db)).not.toContain('thread.goal.v1')
    expect(db.repositories.threadGoals.get(thread.id)).toBeNull()
    // thread/read 仍然成功，只是无法校验的 Goal 被省略。
    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.thread.id).toBe(thread.id)
    expect(snapshot?.goal ?? null).toBeNull()
    await expect(
      service.set({
        threadId: thread.id,
        objective: '写入必须 fail-closed',
        expectedVersion: null,
        operationId: 'goal:set:legacy',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    db.close()
  })

  test('未知 status 与非法计数的 Goal 行被省略并关闭 capability', async () => {
    const { db, service } = await fixture()
    const statusThread = db.createThread('未知状态线程')
    const countThread = db.createThread('非法计数线程')
    const statusGoal = (
      await service.set({
        threadId: statusThread.id,
        objective: '目标 A',
        expectedVersion: null,
        operationId: 'goal:set:a',
      })
    ).goal
    await service.set({
      threadId: countThread.id,
      objective: '目标 B',
      expectedVersion: null,
      operationId: 'goal:set:b',
    })
    const projection = new ThreadProjection(db)
    expect(projection.snapshot(statusThread.id)?.goal).toEqual(statusGoal)

    // Simulate rows written by a newer build with unknown shapes.
    db.sqlite.exec('PRAGMA ignore_check_constraints = ON')
    db.sqlite
      .query("UPDATE thread_goals SET status = 'reconciling' WHERE id = ?")
      .run(statusGoal.id)
    db.sqlite
      .query('UPDATE thread_goals SET tokens_used = -5 WHERE thread_id = ?')
      .run(countThread.id)
    db.sqlite.exec('PRAGMA ignore_check_constraints = OFF')

    expect(db.repositories.threadGoals.get(statusThread.id)).toBeNull()
    expect(db.repositories.threadGoals.get(countThread.id)).toBeNull()
    expect(db.repositories.threadGoals.visibleGoalsValid()).toBe(false)
    expect(filterAdvertisedCapabilities(db)).not.toContain('thread.goal.v1')
    // thread/read 仍然成功，只是省略无法校验的 Goal。
    const snapshot = projection.snapshot(statusThread.id)
    expect(snapshot?.thread.id).toBe(statusThread.id)
    expect(snapshot?.goal ?? null).toBeNull()
    expect(projection.snapshot(countThread.id)?.goal ?? null).toBeNull()
    db.close()
  })
})

test('排队目标跨重启保留，执行时原子生效，失败回滚且编辑删除不改变当前目标', async () => {
  const fixtureValue = await fixture()
  let db = fixtureValue.db
  const thread = db.createThread('排队目标')
  const initial = fixtureValue.service.admitInTransaction({
    threadId: thread.id,
    objective: '原目标',
    expectedVersion: null,
  }).goal
  const first = db.createTurn(thread.id, submit('第一个目标'))
  const second = db.createTurn(thread.id, submit('第二个目标'))
  new QueuedGoalRepository(db).put(first.inputID, { objective: '第一个目标' })
  new QueuedGoalRepository(db).put(second.inputID, { objective: '第二个目标', tokenBudget: 123 })
  expect(fixtureValue.service.get(thread.id).goal?.objective).toBe('原目标')
  db.close()
  db = new AgentDatabase(fixtureValue.path)
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  const pending = new QueuedGoalRepository(db)
  expect(pending.get(first.inputID)?.objective).toBe('第一个目标')
  expect(
    new ThreadProjection(db).snapshot(thread.id)?.inputs.find((input) => input.id === first.inputID)
      ?.goal?.objective,
  ).toBe('第一个目标')
  const input = db.getTurnInput(first.turnID)!
  expect(() =>
    db.startTurnExecution(first.turnID, input, () => {
      service.applyInputInTransaction(thread.id, input.id, 'chat')
      throw new Error('模拟启动失败')
    }),
  ).toThrow('模拟启动失败')
  expect(db.getTurnStatus(first.turnID)).toBe('queued')
  expect(service.get(thread.id).goal?.objective).toBe('原目标')
  expect(pending.get(input.id)?.objective).toBe('第一个目标')
  const started = db.startTurnExecution(first.turnID, input, () =>
    service.applyInputInTransaction(thread.id, input.id, 'chat'),
  )!
  expect(started.events[0]?.method).toBe('thread/goal/updated')
  expect(service.get(thread.id).goal?.objective).toBe('第一个目标')
  expect(pending.get(input.id)).toBeUndefined()
  expect(db.startTurnExecution(first.turnID, input)).toBeNull()
  await expect(
    service.set({
      threadId: thread.id,
      status: 'paused',
      expectedVersion: initial.version,
      operationId: 'stale',
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  db.updateQueuedInput(thread.id, second.inputID, '编辑后的目标', { operationID: 'edit' })
  expect(pending.get(second.inputID)).toMatchObject({ objective: '编辑后的目标', tokenBudget: 123 })
  expect(service.get(thread.id).goal?.objective).toBe('第一个目标')
  db.removeQueuedInput(thread.id, second.inputID, { operationID: 'remove' })
  expect(pending.get(second.inputID)).toBeUndefined()
  expect(service.get(thread.id).goal?.objective).toBe('第一个目标')
  db.close()
})

test('Plan 和 Grill 启动时暂停目标，Chat 保留目标，只有 Chat 可自动续跑', async () => {
  const { db, service } = await fixture()
  const thread = db.createThread()
  service.admitInTransaction({ threadId: thread.id, objective: '持续工作', expectedVersion: null })
  for (const taskMode of ['plan', 'grill'] as const) {
    const turn = db.createTurn(thread.id, { ...submit('规划或访谈'), taskMode })
    db.startTurnExecution(turn.turnID, db.getTurnInput(turn.turnID)!, () =>
      service.applyInputInTransaction(thread.id, turn.inputID, taskMode),
    )
    expect(service.get(thread.id).goal?.status).toBe('paused')
    expect(db.repositories.threadGoalContinuations.canContinue(thread.id, taskMode)).toBe(false)
    await service.set({
      threadId: thread.id,
      status: 'active',
      expectedVersion: service.get(thread.id).goal!.version,
      operationId: `resume-${taskMode}`,
    })
  }
  expect(service.applyInputInTransaction(thread.id, 'ordinary-chat', 'chat')).toBeUndefined()
  expect(service.get(thread.id).goal?.status).toBe('active')
  expect(db.repositories.threadGoalContinuations.canContinue(thread.id, 'chat')).toBe(true)
  const queued = db.createTurn(thread.id, submit('用户排队输入'))
  expect(db.repositories.threadGoalContinuations.canContinue(thread.id, 'chat')).toBe(false)
  db.removeQueuedInput(thread.id, queued.inputID, { operationID: 'remove-user' })
  db.close()
})

test('66→67 新增队列目标表，未知对象和更高版本原样保留', async () => {
  const { db, path } = await fixture()
  db.sqlite.exec(
    "DROP TABLE queued_goal_intents; CREATE TABLE future_goal_data (value TEXT); INSERT INTO future_goal_data VALUES ('keep'); PRAGMA user_version = 66",
  )
  db.close()
  const migrated = new AgentDatabase(path)
  expect(new QueuedGoalRepository(migrated).available()).toBe(true)
  expect(filterAdvertisedCapabilities(migrated)).toContain('queue.goal.v1')
  expect(migrated.sqlite.query('SELECT value FROM future_goal_data').get()).toEqual({
    value: 'keep',
  })
  migrated.sqlite.exec('DROP TABLE queued_goal_intents; PRAGMA user_version = 99')
  migrated.close()
  const future = new AgentDatabase(path)
  expect(future.sqlite.query('PRAGMA user_version').get()).toEqual({ user_version: 99 })
  expect(filterAdvertisedCapabilities(future)).not.toContain('queue.goal.v1')
  expect(new QueuedGoalRepository(future).available()).toBe(false)
  expect(future.sqlite.query('SELECT value FROM future_goal_data').get()).toEqual({ value: 'keep' })
  future.close()
})

describe('Goal 预算只允许放宽', () => {
  test('降低预算、不限额转有限与相同值：拒绝与保持', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('预算只放宽')
    const created = (
      await service.set({
        threadId: thread.id,
        objective: '预算规则',
        tokenBudget: 200,
        expectedVersion: null,
        operationId: 'budget:create',
      })
    ).goal

    const before = service.get(thread.id).goal!
    const eventCount = () =>
      (
        db.sqlite.query('SELECT COUNT(*) AS count FROM thread_goal_operations').get() as {
          count: number
        }
      ).count
    const operationsBefore = eventCount()
    // A narrowing request must fail without moving the goal, its version or the
    // idempotency log.
    await expect(
      service.set({
        threadId: thread.id,
        tokenBudget: 100,
        expectedVersion: before.version,
        operationId: 'budget:narrow',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(service.get(thread.id).goal).toEqual(before)
    expect(eventCount()).toBe(operationsBefore)
    expect(goalEvents(db)).toHaveLength(1)

    // Same value is a no-op write, not a violation.
    const same = await service.set({
      threadId: thread.id,
      tokenBudget: 200,
      expectedVersion: before.version,
      operationId: 'budget:same',
    })
    expect(same.goal.tokenBudget).toBe(200)

    // Removing the cap is widening.
    const unlimited = await service.set({
      threadId: thread.id,
      tokenBudget: null,
      expectedVersion: same.goal.version,
      operationId: 'budget:unlimited',
    })
    expect(unlimited.goal.tokenBudget).toBeNull()

    // An unlimited goal may never become finite again.
    const unlimitedBefore = service.get(thread.id).goal!
    await expect(
      service.set({
        threadId: thread.id,
        tokenBudget: 5_000,
        expectedVersion: unlimitedBefore.version,
        operationId: 'budget:recap',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(service.get(thread.id).goal).toEqual(unlimitedBefore)

    // Omitted budget keeps the stored value rather than re-applying a default.
    const kept = await service.set({
      threadId: thread.id,
      objective: '预算规则（正文更新）',
      expectedVersion: unlimitedBefore.version,
      operationId: 'budget:omit',
    })
    expect(kept.goal.tokenBudget).toBeNull()
    expect(created.id).toBe(kept.goal.id)
    db.close()
  })

  test('已完成目标不能通过预算操作改变预算或重开', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('完成目标预算')
    const created = (
      await service.set({
        threadId: thread.id,
        objective: '完成即冻结',
        tokenBudget: 100,
        expectedVersion: null,
        operationId: 'budget:done-create',
      })
    ).goal
    const completed = await service.set({
      threadId: thread.id,
      status: 'complete',
      expectedVersion: created.version,
      operationId: 'budget:done-complete',
    })
    expect(completed.goal.status).toBe('complete')

    await expect(
      service.set({
        threadId: thread.id,
        tokenBudget: 500,
        expectedVersion: completed.goal.version,
        operationId: 'budget:done-raise',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(service.get(thread.id).goal).toEqual(completed.goal)

    // Omitted budget on a completed goal stays allowed and keeps it complete.
    const edited = await service.set({
      threadId: thread.id,
      objective: '完成即冻结（正文）',
      expectedVersion: completed.goal.version,
      operationId: 'budget:done-objective',
    })
    expect(edited.goal).toMatchObject({ status: 'complete', tokenBudget: 100 })
    db.close()
  })

  test('排队意图在预算基准变化后执行时被拒绝，且不改动当前目标', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('排队预算')
    const created = (
      await service.set({
        threadId: thread.id,
        objective: '排队预算基准',
        tokenBudget: 300,
        expectedVersion: null,
        operationId: 'budget:queue-create',
      })
    ).goal

    const turn = db.createTurn(thread.id, submit('排队目标'))
    // The queued intent was authored against the 300 cap, which has since been raised.
    new QueuedGoalRepository(db).put(turn.inputID, { objective: '排队目标', tokenBudget: 150 })
    await service.set({
      threadId: thread.id,
      tokenBudget: 400,
      expectedVersion: created.version,
      operationId: 'budget:queue-raise',
    })

    expect(() =>
      db.startTurnExecution(turn.turnID, db.getTurnInput(turn.turnID)!, () =>
        service.applyInputInTransaction(thread.id, turn.inputID, 'chat'),
      ),
    ).toThrow('不能降低')
    expect(db.getTurnStatus(turn.turnID)).toBe('queued')
    expect(service.get(thread.id).goal).toMatchObject({
      objective: '排队预算基准',
      tokenBudget: 400,
    })
    // The rejected intent survives so admission failure stays visible and retryable.
    expect(new QueuedGoalRepository(db).get(turn.inputID)?.tokenBudget).toBe(150)
    db.close()
  })
})

test('direct Goal budget writes reject non-safe integers without changing state or events', async () => {
  const { db, service } = await fixture()
  const thread = db.createThread('budget validation')
  const { goal } = await service.set({
    threadId: thread.id,
    objective: '交付',
    tokenBudget: 200,
    expectedVersion: null,
    operationId: 'create-safe',
  })
  const events = goalEvents(db)
  for (const tokenBudget of [NaN, Infinity, -1, 200.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      service.set({
        threadId: thread.id,
        tokenBudget,
        expectedVersion: goal.version,
        operationId: `bad-${tokenBudget}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(service.get(thread.id).goal).toEqual(goal)
    expect(goalEvents(db)).toEqual(events)
  }
  db.close()
})
