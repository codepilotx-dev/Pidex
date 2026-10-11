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

    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '让快照带上 Goal',
        expectedVersion: null,
        operationId: 'goal:set:snapshot',
      })
    ).goal
    expect(projection.snapshot(thread.id)?.goal).toEqual(goal)

    await service.clear({
      threadId: thread.id,
      expectedVersion: goal.version,
      operationId: 'goal:clear:snapshot',
    })
    expect(projection.snapshot(thread.id)?.goal ?? null).toBeNull()
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
