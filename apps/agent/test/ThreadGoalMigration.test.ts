import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

/** Exact schema 45 goal table, reproduced so the migration sees a real legacy store. */
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

const tableNames = (db: AgentDatabase) =>
  (
    db.sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'thread_goal%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)

describe('thread goal schema migration', () => {
  test('schema 45 回填可见与已清除 Goal 并保留消耗与创建时间', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-goal-migration-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const seeded = new AgentDatabase(path)

    const visibleThread = seeded.createThread('可见目标线程')
    const clearedThread = seeded.createThread('已清除目标线程')
    seeded.sqlite.exec(
      `DROP TABLE thread_goal_history; DROP TABLE thread_goals; ${LEGACY_GOAL_TABLE}`,
    )
    const insert = seeded.sqlite.query(`
      INSERT INTO thread_goals (thread_id, objective, status, token_budget, tokens_used,
        time_used_seconds, version, cleared_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(visibleThread.id, '保留中的目标', 'active', 200_000, 500, 60, 3, null, 1_000, 2_000)
    insert.run(clearedThread.id, '已清除的目标', 'complete', null, 900, 120, 5, 3_000, 1_500, 3_000)
    seeded.sqlite.exec('PRAGMA user_version = 45')
    seeded.close()

    const migrated = new AgentDatabase(path)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })

    const visible = migrated.repositories.threadGoals.get(visibleThread.id)
    expect(visible).toMatchObject({
      threadId: visibleThread.id,
      objective: '保留中的目标',
      status: 'active',
      tokenBudget: 200_000,
      tokensUsed: 500,
      timeUsedSeconds: 60,
      version: 3,
      createdAt: 1_000,
      updatedAt: 2_000,
    })
    expect(visible?.id).toMatch(/^[0-9a-f]{64}$/)
    // `complete` rows carry a completion timestamp derived from their last update.
    expect(visible?.completedAt ?? null).toBeNull()

    // Cleared goals move to history and stop being visible.
    expect(migrated.repositories.threadGoals.get(clearedThread.id)).toBeNull()
    const history = migrated.repositories.threadGoals.history(clearedThread.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      objective: '已清除的目标',
      status: 'complete',
      tokenBudget: null,
      tokensUsed: 900,
      timeUsedSeconds: 120,
      version: 5,
      completedAt: 3_000,
      clearedAt: 3_000,
      createdAt: 1_500,
    })
    expect(history[0]!.id).toMatch(/^[0-9a-f]{64}$/)
    expect(history[0]!.id).not.toBe(visible?.id)

    // Reopening at the current version must not mint new identities.
    const identities = {
      visible: visible?.id,
      archived: history[0]!.id,
    }
    migrated.close()
    const reopened = new AgentDatabase(path)
    expect(reopened.repositories.threadGoals.get(visibleThread.id)?.id).toBe(identities.visible)
    expect(reopened.repositories.threadGoals.history(clearedThread.id)[0]?.id).toBe(
      identities.archived,
    )
    reopened.close()
  })

  test('schema 44 依次迁移到 47，建立 Goal 身份与计量表并保留未知对象', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-goal-chain-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const seeded = new AgentDatabase(path)
    const thread = seeded.createThread('链路线程')
    seeded.sqlite.exec(`
      DROP TABLE thread_goal_history;
      DROP TABLE thread_goals;
      DROP TABLE thread_goal_operations;
      CREATE TABLE future_fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_fixture VALUES ('kept', 'unknown');
      PRAGMA user_version = 44;
    `)
    seeded.close()

    const migrated = new AgentDatabase(path)
    expect(migrated.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    expect(tableNames(migrated)).toEqual([
      'thread_goal_active_intervals',
      'thread_goal_continuations',
      'thread_goal_history',
      'thread_goal_operations',
      'thread_goal_usage_ledger',
      'thread_goals',
    ])
    expect(
      migrated.sqlite.query("SELECT value FROM future_fixture WHERE id = 'kept'").get(),
    ).toEqual({ value: 'unknown' })
    expect(migrated.repositories.threadGoals.available()).toBe(true)

    const service = new ThreadGoalService(migrated, await Effect.runPromise(EventHub.make))
    const goal = (
      await service.set({
        threadId: thread.id,
        objective: '迁移后新建的目标',
        expectedVersion: null,
        operationId: 'goal:set:after-migration',
      })
    ).goal
    expect(goal).toMatchObject({
      objective: '迁移后新建的目标',
      version: 1,
      tokensUsed: 0,
      createdAt: expect.any(Number),
    })
    expect(goal.id).toBeTruthy()
    migrated.close()
  })

  test('更高版本的未知 schema 保留 user_version 与未知表', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-goal-future-'))
    paths.push(root)
    const path = join(root, 'agent.sqlite')
    const seeded = new AgentDatabase(path)
    seeded.sqlite.exec(`
      DROP TABLE thread_goal_history;
      CREATE TABLE future_goal_owner (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO future_goal_owner VALUES ('kept', 'future');
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    seeded.close()

    const reopened = new AgentDatabase(path)
    expect(reopened.sqlite.query('PRAGMA user_version').get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(
      reopened.sqlite.query("SELECT value FROM future_goal_owner WHERE id = 'kept'").get(),
    ).toEqual({ value: 'future' })
    // Must not recreate a table the newer schema deliberately removed.
    expect(tableNames(reopened)).not.toContain('thread_goal_history')
    reopened.close()
  })
})
