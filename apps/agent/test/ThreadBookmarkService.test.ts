import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { ThreadBookmarkService } from '../src/session/ThreadBookmarkService'
import { AgentDatabase, SCHEMA_VERSION } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { filterAdvertisedCapabilities } from '../src/transport/rpc/handlers/SystemCapabilities'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-thread-bookmark-'))
  paths.push(root)
  const path = join(root, 'agent.sqlite')
  const db = new AgentDatabase(path)
  const service = new ThreadBookmarkService(db, await Effect.runPromise(EventHub.make))
  return { db, path, service }
}

const insertInput = (
  db: AgentDatabase,
  threadId: string,
  inputId: string,
  origin: string | null = null,
) => {
  db.sqlite
    .query(
      `INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, strategy, task_mode, status, created_at, origin)
      VALUES (?, ?, NULL, '你好', '{"providerID":"openai","id":"test"}', 'start', 'chat', 'completed', 1, ?)`,
    )
    .run(inputId, threadId, origin)
}

const bookmarkEvents = (db: AgentDatabase) =>
  db.sqlite
    .query(
      "SELECT method, params FROM events WHERE method = 'thread/bookmarks/updated' ORDER BY id",
    )
    .all() as Array<{ method: string; params: string }>

describe('ThreadBookmarkService', () => {
  test('添加、取消、幂等重放与状态未变不重复写事件', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('书签线程')
    insertInput(db, thread.id, 'input-1')

    const created = await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:1',
    })
    expect(created).toEqual({ threadId: thread.id, inputIds: ['input-1'], version: 1 })

    // 幂等重放：同 operationId + 同请求返回相同结果，不追加事件。
    const replayed = await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:1',
    })
    expect(replayed).toEqual(created)
    expect(bookmarkEvents(db)).toHaveLength(1)

    // 状态未改变：不写库、不升版本、不发事件。
    const unchanged = await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 1,
      operationId: 'bookmark:set:no-op',
    })
    expect(unchanged).toEqual(created)
    expect(bookmarkEvents(db)).toHaveLength(1)

    // operationId 复用到不同请求必须拒绝。
    await expect(
      service.set({
        threadId: thread.id,
        inputId: 'input-1',
        bookmarked: false,
        expectedVersion: 1,
        operationId: 'bookmark:set:1',
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' })

    const removed = await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: false,
      expectedVersion: 1,
      operationId: 'bookmark:set:2',
    })
    expect(removed).toEqual({ threadId: thread.id, inputIds: [], version: 2 })
    expect(service.list({ threadId: thread.id })).toEqual({
      threadId: thread.id,
      inputIds: [],
      version: 2,
    })
  })

  test('版本冲突拒绝写入且不产生事件，刷新后可重试', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('冲突线程')
    insertInput(db, thread.id, 'input-1')
    insertInput(db, thread.id, 'input-2')

    await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:a',
    })
    // 过期的 expectedVersion 不覆盖其他窗口的写入。
    await expect(
      service.set({
        threadId: thread.id,
        inputId: 'input-2',
        bookmarked: true,
        expectedVersion: 0,
        operationId: 'bookmark:set:b',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(bookmarkEvents(db)).toHaveLength(1)
    expect(service.list({ threadId: thread.id })).toEqual({
      threadId: thread.id,
      inputIds: ['input-1'],
      version: 1,
    })

    // 用刷新后的版本重试成功。
    const retried = await service.set({
      threadId: thread.id,
      inputId: 'input-2',
      bookmarked: true,
      expectedVersion: 1,
      operationId: 'bookmark:set:b',
    })
    expect(retried.inputIds.sort()).toEqual(['input-1', 'input-2'])
    expect(retried.version).toBe(2)
  })

  test('拒绝不属于目标会话的输入与系统续跑输入', async () => {
    const { db, service } = await fixture()
    const threadA = db.createThread('会话 A')
    const threadB = db.createThread('会话 B')
    insertInput(db, threadA.id, 'input-a')
    insertInput(db, threadB.id, 'input-b-continuation', 'goal-continuation')

    await expect(
      service.set({
        threadId: threadA.id,
        inputId: 'input-b',
        bookmarked: true,
        expectedVersion: 0,
        operationId: 'bookmark:set:cross',
      }),
    ).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    // 不存在的输入同样拒绝。
    await expect(
      service.set({
        threadId: threadA.id,
        inputId: 'input-missing',
        bookmarked: true,
        expectedVersion: 0,
        operationId: 'bookmark:set:missing',
      }),
    ).rejects.toMatchObject({ code: 'INPUT_NOT_FOUND' })
    // 系统续跑输入不参与书签。
    await expect(
      service.set({
        threadId: threadB.id,
        inputId: 'input-b-continuation',
        bookmarked: true,
        expectedVersion: 0,
        operationId: 'bookmark:set:continuation',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(service.list({ threadId: threadA.id })).toEqual({
      threadId: threadA.id,
      inputIds: [],
      version: 0,
    })
  })

  test('书签写入与 durable 事件在事务内原子提交', async () => {
    const { db, service } = await fixture()
    const thread = db.createThread('原子线程')
    insertInput(db, thread.id, 'input-1')

    await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:atomic',
    })
    // 书签行、版本行与事件在同一事务提交：三者同时可见。
    const events = bookmarkEvents(db)
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0]!.params)).toEqual({
      threadId: thread.id,
      inputIds: ['input-1'],
      version: 1,
    })

    // 冲突路径整体回滚：不留下事件或幂等记录。
    await expect(
      service.set({
        threadId: thread.id,
        inputId: 'input-1',
        bookmarked: true,
        expectedVersion: 9,
        operationId: 'bookmark:set:rollback',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const rollbackRows = db.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM thread_bookmark_operations WHERE operation_id = 'bookmark:set:rollback'",
      )
      .get() as { count: number }
    expect(rollbackRows.count).toBe(0)
    expect(bookmarkEvents(db)).toHaveLength(1)
  })

  test('删除输入或会话时级联清理书签', async () => {
    const { db, service } = await fixture()
    const threadA = db.createThread('级联线程')
    const threadB = db.createThread('删除线程')
    insertInput(db, threadA.id, 'input-a1')
    insertInput(db, threadA.id, 'input-a2')
    insertInput(db, threadB.id, 'input-b1')

    await service.set({
      threadId: threadA.id,
      inputId: 'input-a1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:a1',
    })
    await service.set({
      threadId: threadA.id,
      inputId: 'input-a2',
      bookmarked: true,
      expectedVersion: 1,
      operationId: 'bookmark:set:a2',
    })
    await service.set({
      threadId: threadB.id,
      inputId: 'input-b1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:b1',
    })

    // 删除单个输入级联删除对应书签。
    db.sqlite.query('DELETE FROM inputs WHERE id = ?').run('input-a1')
    expect(service.list({ threadId: threadA.id }).inputIds).toEqual(['input-a2'])

    // 删除会话级联删除其全部书签与版本行。
    db.sqlite.query('DELETE FROM threads WHERE id = ?').run(threadB.id)
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM thread_bookmarks WHERE thread_id = ?')
        .get(threadB.id),
    ).toEqual({ count: 0 })
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM thread_bookmark_state WHERE thread_id = ?')
        .get(threadB.id),
    ).toEqual({ count: 0 })
  })

  test('schema 54 → 55 迁移保留既有数据并重建书签表', async () => {
    const { db, path, service } = await fixture()
    const thread = db.createThread('迁移线程')
    insertInput(db, thread.id, 'input-1')
    await service.set({
      threadId: thread.id,
      inputId: 'input-1',
      bookmarked: true,
      expectedVersion: 0,
      operationId: 'bookmark:set:migration',
    })
    // 模拟旧版本打开后的回滚 user_version，并携带未知表与未知记录。
    db.sqlite.exec('CREATE TABLE unknown_future_table (id TEXT PRIMARY KEY, value TEXT)')
    db.sqlite.exec("INSERT INTO unknown_future_table (id, value) VALUES ('u1', 'keep')")
    db.sqlite.exec('PRAGMA user_version = 54')
    db.close()

    const reopened = new AgentDatabase(path)
    const version = reopened.sqlite.query('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(SCHEMA_VERSION)
    // 迁移保留既有书签、会话与未知对象。
    expect(
      new ThreadBookmarkService(reopened, await Effect.runPromise(EventHub.make)).list({
        threadId: thread.id,
      }),
    ).toEqual({ threadId: thread.id, inputIds: ['input-1'], version: 1 })
    expect(
      reopened.sqlite.query("SELECT value FROM unknown_future_table WHERE id = 'u1'").get() as {
        value: string
      },
    ).toEqual({ value: 'keep' })
    reopened.close()
  })

  test('书签存储齐全时广告 thread.bookmarks.v1 capability', async () => {
    const { db } = await fixture()
    expect(filterAdvertisedCapabilities(db)).toContain('thread.bookmarks.v1')
    // 缺表时 fail-closed，不广告不可执行的 mutation。
    db.sqlite.exec('DROP TABLE thread_bookmarks')
    expect(filterAdvertisedCapabilities(db)).not.toContain('thread.bookmarks.v1')
  })
})
