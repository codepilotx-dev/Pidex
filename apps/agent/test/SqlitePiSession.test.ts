import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import {
  SqlitePiSessionRepo,
  SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-pi-session-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const thread = db.createThread('Pi session test')
  return { db, repo: new SqlitePiSessionRepo(db), threadID: thread.id }
}

describe('SqlitePiSessionRepo', () => {
  test('缓冲当前轮写入并在 flush 后恢复完整上下文和统计', async () => {
    const { db, repo, threadID } = await setup()
    const session = await repo.create({ id: 'session-main', threadID, agentID: 'agent-main' })
    await session.appendModelChange('openai', 'gpt-test')
    await session.appendThinkingLevelChange('high')
    await session.appendActiveToolsChange(['read', 'shell'])
    const userEntryID = await session.appendMessage({
      role: 'user',
      content: 'hello',
      timestamp: 1,
    })
    await session.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'world' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-test',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        totalTokens: 20,
        cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0.02, total: 0.33 },
      },
      stopReason: 'stop',
      timestamp: 2,
    })
    await session.appendLabel(userEntryID, '入口')
    await session.appendSessionName(' 主会话\n')

    const storage = session.getStorage() as SqlitePiSessionStorage
    expect(storage.pendingCount).toBe(7)
    expect((await session.buildContext()).messages).toHaveLength(2)
    expect(await session.getLabel(userEntryID)).toBe('入口')
    expect(await session.getSessionName()).toBe('主会话')
    expect(await session.getSessionStats()).toEqual({
      messageCount: 2,
      cachedTokens: 3,
      uncachedTokens: 12,
      totalTokens: 20,
      costTotal: 0.33,
    })

    const beforeFlush = await repo.openByID('session-main')
    expect(await beforeFlush.getEntries()).toEqual([])

    db.transaction(() => storage.flush())
    expect(storage.pendingCount).toBe(0)
    const reopened = await repo.openByID('session-main')
    expect(await reopened.getLeafId()).toBe(await session.getLeafId())
    expect((await reopened.getEntries()).map((entry) => entry.type)).toEqual([
      'model_change',
      'thinking_level_change',
      'active_tools_change',
      'message',
      'message',
      'label',
      'session_info',
    ])
    expect(await reopened.getSessionName()).toBe('主会话')
  })

  test('支持树导航、compaction、fork、游标和丢弃未提交写入', async () => {
    const { repo, threadID } = await setup()
    const source = await repo.create({ id: 'source', threadID, agentID: 'agent' })
    const first = await source.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
    const answer = await source.appendMessage({ role: 'user', content: 'answer', timestamp: 2 })
    const compaction = await source.appendCompaction('summary', first, 120)
    ;(source.getStorage() as SqlitePiSessionStorage).flush()

    expect((await source.getBranch()).map((entry) => entry.id)).toEqual([first, answer, compaction])
    expect(
      (await source.getEntries({ afterEntrySeq: 1, limit: 1 })).map((entry) => entry.id),
    ).toEqual([answer])

    await source.moveTo(first)
    const storage = source.getStorage() as SqlitePiSessionStorage
    expect(await source.getLeafId()).toBe(first)
    storage.discardPending()
    expect(await source.getLeafId()).toBe(compaction)

    const forked = await repo.fork(await source.getMetadata(), {
      id: 'forked',
      threadID,
      agentID: 'agent-fork',
      entryId: answer,
      position: 'at',
    })
    expect((await forked.getEntries()).map((entry) => entry.id)).toEqual([first, answer])
    expect(await forked.getLeafId()).toBe(answer)
    expect((await repo.list({ threadID })).map((metadata) => metadata.id).sort()).toEqual([
      'forked',
      'source',
    ])

    await repo.delete(await forked.getMetadata())
    expect(await repo.list({ agentID: 'agent-fork' })).toEqual([])
  })

  test('外层业务事务回滚时保留待提交 entry 以便安全重试', async () => {
    const { db, repo, threadID } = await setup()
    const session = await repo.create({ id: 'rollback', threadID, agentID: 'agent' })
    await session.appendMessage({ role: 'user', content: 'retry me', timestamp: 1 })
    const storage = session.getStorage() as SqlitePiSessionStorage

    expect(() =>
      db.transaction(() => {
        storage.flush()
        throw new Error('outbox failed')
      }),
    ).toThrow('outbox failed')
    expect(storage.pendingCount).toBe(1)
    expect(
      db.sqlite
        .query('SELECT COUNT(*) AS count FROM pi_session_entries WHERE session_id = ?')
        .get('rollback'),
    ).toEqual({ count: 0 })

    storage.flush()
    expect(storage.pendingCount).toBe(0)
    expect((await repo.openByID('rollback')).getEntries()).resolves.toHaveLength(1)
  })

  test('Pi session flush 与 steer mailbox consumed 在同一事务提交', async () => {
    const { db, repo, threadID } = await setup()
    const input = {
      content: 'initial',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const turn = db.createTurn(threadID, input)
    db.claimTurnExecution(turn.turnID)
    const steer = db.appendGuide(
      threadID,
      turn.turnID,
      { ...input, content: 'steer', strategy: 'guide' },
      'input:steer:atomic',
    )
    const session = await repo.create({ id: 'steer-settlement', threadID, agentID: turn.agentID })
    await session.appendMessage({ role: 'user', content: 'steer', timestamp: 1 })
    const storage = session.getStorage() as SqlitePiSessionStorage

    expect(() =>
      db.transaction(() => {
        storage.flush()
        db.consumeGuideMailbox(turn.turnID, [steer.inputID])
        throw new Error('steer settlement failed')
      }),
    ).toThrow('steer settlement failed')
    expect(storage.pendingCount).toBe(1)
    expect(db.guideMailbox(turn.turnID).map(({ id }) => id)).toEqual([steer.inputID])
    expect((await repo.openByID('steer-settlement')).getEntries()).resolves.toHaveLength(0)

    db.transaction(() => {
      storage.flush()
      db.consumeGuideMailbox(turn.turnID, [steer.inputID])
    })
    expect(storage.pendingCount).toBe(0)
    expect(db.guideMailbox(turn.turnID)).toEqual([])
    expect((await repo.openByID('steer-settlement')).getEntries()).resolves.toHaveLength(1)
  })

  test('按 Thread 打开时拒绝 session owner 串线', async () => {
    const { db, repo, threadID } = await setup()
    const other = db.createThread('Other')
    await repo.create({ id: 'owned', threadID, agentID: 'agent' })

    expect(repo.openForThread('owned', other.id)).rejects.toMatchObject({ code: 'invalid_session' })
    expect(repo.openForThread('missing', threadID)).rejects.toMatchObject({ code: 'not_found' })
  })

  test('resumed tool outbox 失败时 Pi entry 和公开 item 一起回滚', async () => {
    const { db, repo, threadID } = await setup()
    const turn = db.createTurn(threadID, {
      content: 'resume tool',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    })
    const session = await repo.create({ id: 'tool-settlement', threadID, agentID: turn.agentID })
    await session.appendMessage({
      role: 'toolResult',
      toolCallId: 'tool-call',
      toolName: 'Shell',
      content: [{ type: 'text', text: 'done' }],
      isError: false,
      timestamp: 1,
    })
    const storage = session.getStorage() as SqlitePiSessionStorage
    const timestamp = Date.now()
    db.sqlite.exec(
      `CREATE TRIGGER fail_tool_outbox BEFORE INSERT ON events WHEN NEW.method = 'item/completed' BEGIN SELECT RAISE(ABORT, 'tool outbox unavailable'); END`,
    )

    expect(() =>
      db.transaction(() => {
        storage.flush()
        db.upsertItemWithEvent(
          threadID,
          {
            id: 'tool-call',
            turnID: turn.turnID,
            agentID: turn.agentID,
            type: 'tool',
            status: 'completed',
            data: { name: 'Shell', output: 'done' },
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          'item/completed',
          {},
        )
      }),
    ).toThrow('tool outbox unavailable')
    expect(storage.pendingCount).toBe(1)
    expect(
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM pi_session_entries WHERE session_id = 'tool-settlement'",
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(db.getItem('tool-call')).toBeNull()
  })
})
