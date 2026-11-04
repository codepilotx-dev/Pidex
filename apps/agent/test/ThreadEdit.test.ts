import { ThreadMessageForkRepository } from '../src/session/fork/ThreadMessageForkRepository'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import {
  SqlitePiSessionRepo,
  SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'
import { ThreadEditRepository } from '../src/storage/repositories/ThreadEditRepository'
import { ThreadService } from '../src/session/ThreadService'
import { ConversationHistoryForkRepository } from '../src/session/fork/ConversationHistoryForkRepository'
import { SideChatRepository } from '../src/storage/repositories/SideChatRepository'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { AttachmentService } from '../src/subagent/AttachmentService'
import { SqliteAttachmentCatalog } from '../src/subagent/SqliteAttachmentCatalog'
import { removeFixturePaths } from './FixtureCleanup'

const roots: string[] = []
const databases: AgentDatabase[] = []
afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})
const model = Model.Ref.make({ providerID: Provider.ID.make('test'), id: Model.ID.make('test') })
const input = (content: string) => ({
  content,
  model,
  permissionConfig: DEFAULT_PERMISSION_CONFIG,
  strategy: 'start' as const,
  taskMode: 'chat' as const,
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pidex-edit-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const thread = db.createThread()
  const repo = new SqlitePiSessionRepo(db)
  const attachments = await AttachmentService.open(root, {
    catalog: new SqliteAttachmentCatalog(db),
  })
  const service = new ThreadService(
    db,
    { publish: () => Effect.void } as never,
    { resolve: async () => ({ capabilities: { input: ['text', 'image'], tools: true } }) } as never,
    null as never,
    { setResumeHandler: () => undefined } as never,
    { clearTurnPermissionGrants: () => undefined } as never,
    { resolvedWaitCheckpoint: () => null, setParentResumeHandler: () => undefined } as never,
    attachments,
    { dataRoot: root, userHome: root },
    null as never,
    null as never,
    { resolve: async () => ({}) } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
  )
  // 验证真实 admission 与 Pi 持久化；模型执行留在边界外，不向外网请求。
  const execution = service as unknown as {
    executeTurn: () => Promise<void>
    coordinator: { release(thread: string, turn: string): void }
  }
  execution.executeTurn = async () => undefined
  async function completed(content: string) {
    const value = db.createTurn(thread.id, input(content), 'completed')
    new ThreadEditRepository(db).recordStart(thread.id, value.turnID)
    let session
    try {
      session = await repo.openByID(`${thread.id}:main`)
    } catch {
      session = await repo.create({
        id: `${thread.id}:main`,
        threadID: thread.id,
        agentID: value.agentID,
      })
    }
    await session.appendMessage({ role: 'user', content, timestamp: Date.now() })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    return value
  }
  function finish(turnID: string) {
    db.sqlite.query("UPDATE turns SET status = 'completed' WHERE id = ?").run(turnID)
    db.sqlite.query("UPDATE inputs SET status = 'completed' WHERE turn_id = ?").run(turnID)
    db.sqlite
      .query("UPDATE agent_executions SET status = 'completed' WHERE turn_id = ?")
      .run(turnID)
    execution.coordinator.release(thread.id, turnID)
  }
  return { db, repo, thread, attachments, service, completed, finish }
}

test('编辑末轮保留旧记录，切换上下文；幂等、连续编辑、冷读取均一致', async () => {
  const f = await fixture()
  const first = await f.completed('前文')
  const old = await f.completed('旧问题')
  const request = {
    operationId: 'edit-1',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '新问题',
    attachmentIds: [],
    contextReferenceIds: [],
  }
  const result = await f.service.editUserMessage(request)
  expect(result.turnID).not.toBe(old.turnID)
  expect(await f.service.editUserMessage({ ...request })).toMatchObject({
    ...result,
    disposition: 'duplicate',
  })
  await expect(
    f.service.editUserMessage({ ...request, content: '另一问题' }),
  ).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' })
  const reopened = await f.repo.openByID(`${f.thread.id}:main`)
  expect(JSON.stringify((await reopened.buildContext()).messages)).toContain('前文')
  expect(JSON.stringify((await reopened.buildContext()).messages)).not.toContain('旧问题')
  expect(f.db.getTurnInput(old.turnID)?.content).toBe('旧问题')
  const projection = new ThreadProjection(f.db)
  expect(projection.snapshot(f.thread.id)?.turns.map((turn) => turn.id)).toEqual([
    first.turnID,
    result.turnID,
  ])
  expect(projection.historyPage(f.thread.id)?.turns.map((bundle) => bundle.turn.id)).not.toContain(
    old.turnID,
  )
  const events = f.db.sqlite
    .query('SELECT method FROM events WHERE thread_id = ? ORDER BY id')
    .all(f.thread.id) as { method: string }[]
  const cut = events.findIndex((row) => row.method === 'thread/history/edited')
  expect(events.slice(cut + 1).some((row) => row.method === 'turn/queued')).toBe(true)
  f.finish(result.turnID)
  const second = await f.service.editUserMessage({
    ...request,
    operationId: 'edit-2',
    turnId: result.turnID,
    inputId: result.inputID,
    content: '再修改',
  })
  expect(projection.snapshot(f.thread.id)?.turns.map((turn) => turn.id)).toEqual([
    first.turnID,
    second.turnID,
  ])
  expect(
    f.db
      .threadTitleRegenerationContext(f.thread.id)
      ?.recentCompletedTurns.map((turn) => turn.turnID),
  ).not.toContain(old.turnID)
  f.finish(second.turnID)
})

test('停止已经结束的 Turn 是幂等成功', async () => {
  const f = await fixture()
  const turn = await f.completed('已结束')
  f.finish(turn.turnID)

  await expect(f.service.stop(f.thread.id, turn.turnID)).resolves.toBe('completed')
})

test('纯附件编辑复制元数据，保留原输入绑定；全部清空和跨输入引用均拒绝', async () => {
  const f = await fixture()
  const old = await f.completed('旧问题')
  const [file] = await f.attachments.store([
    {
      kind: 'text',
      name: 'note.txt',
      mimeType: 'text/plain',
      data: new TextEncoder().encode('附件'),
    },
  ])
  f.db.bindInputAttachments(old.inputID, [file!.id])
  const request = {
    operationId: 'edit-file',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '',
    attachmentIds: [file!.id],
    contextReferenceIds: [],
  }
  await expect(f.service.editUserMessage({ ...request, attachmentIds: [] })).rejects.toMatchObject({
    code: 'EMPTY_MESSAGE',
  })
  await expect(
    f.service.editUserMessage({ ...request, attachmentIds: ['foreign'] }),
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  const next = await f.service.editUserMessage(request)
  expect(
    (await f.attachments.listByBinding({ type: 'input', id: old.inputID })).map((row) => row.id),
  ).toEqual([file!.id])
  const copied = await f.attachments.listByBinding({ type: 'input', id: next.inputID })
  expect(copied).toHaveLength(1)
  expect(copied[0]!.id).not.toBe(file!.id)
  expect(copied[0]!.sha256).toBe(file!.sha256)
  f.finish(next.turnID)
})

test('运行、等待、队列、旧目标和合并输入在回退前拒绝', async () => {
  const f = await fixture()
  const old = await f.completed('旧问题')
  const request = {
    operationId: 'blocked',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '修改',
    attachmentIds: [],
    contextReferenceIds: [],
  }
  for (const status of [
    'running',
    'waiting_permission',
    'waiting_question',
    'waiting_subagents',
    'queued',
  ]) {
    f.db.sqlite.query('UPDATE turns SET status = ? WHERE id = ?').run(status, old.turnID)
    await expect(f.service.editUserMessage(request)).rejects.toMatchObject({ code: 'TURN_ACTIVE' })
  }
  f.finish(old.turnID)
  const latest = await f.completed('后来问题')
  await expect(f.service.editUserMessage(request)).rejects.toMatchObject({ code: 'CONFLICT' })
  f.db.appendGuide(f.thread.id, latest.turnID, input('合并输入'), 'merged')
  await expect(
    f.service.editUserMessage({ ...request, turnId: latest.turnID, inputId: 'merged' }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(f.db.sqlite.query('SELECT * FROM thread_edits').all()).toHaveLength(0)
})

test('事务中 admission 失败恢复 leaf、活动轮次及 outbox；首轮可回退到空上下文', async () => {
  const f = await fixture()
  const old = await f.completed('首轮')
  const request = {
    operationId: 'atomic',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '修改',
    attachmentIds: [],
    contextReferenceIds: [],
  }
  const edits = new ThreadEditRepository(f.db)
  const boundary = edits.prepare(f.thread.id, old.turnID, old.inputID)
  const switchHistory = await edits.stageHistorySwitch(f.thread.id, boundary)
  expect(() =>
    f.db.transaction(() => {
      edits.commit(request, 'hash', 'new-input', boundary)
      switchHistory()
      throw new Error('admission failed')
    }),
  ).toThrow('admission failed')
  expect(edits.lookup('atomic')).toBeNull()
  expect(new ThreadProjection(f.db).snapshot(f.thread.id)?.turns.map((turn) => turn.id)).toEqual([
    old.turnID,
  ])
  expect(
    JSON.stringify((await (await f.repo.openByID(`${f.thread.id}:main`)).buildContext()).messages),
  ).toContain('首轮')
  const next = await f.service.editUserMessage(request)
  expect(
    (await (await f.repo.openByID(`${f.thread.id}:main`)).buildContext()).messages,
  ).toHaveLength(0)
  f.finish(next.turnID)
})

test('回退事务内新输入写入失败时保留原历史与修订号', async () => {
  const f = await fixture()
  const old = await f.completed('原问题')
  const request = {
    operationId: 'fail-create',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '新问题',
    attachmentIds: [],
    contextReferenceIds: [],
  }
  f.db.sqlite.exec(
    "CREATE TEMP TRIGGER reject_edit_input BEFORE INSERT ON inputs BEGIN SELECT RAISE(ABORT, 'admission failure'); END",
  )
  await expect(f.service.editUserMessage(request)).rejects.toThrow('admission failure')
  expect(new ThreadEditRepository(f.db).lookup(request.operationId)).toBeNull()
  expect(
    JSON.stringify((await (await f.repo.openByID(`${f.thread.id}:main`)).buildContext()).messages),
  ).toContain('原问题')
  expect(new ThreadProjection(f.db).snapshot(f.thread.id)?.historyRevision).toBe(0)
})

test('历史消息使用轮尾持久映射定位边界；缺少映射时拒绝猜测', async () => {
  const f = await fixture()
  const old = await f.completed('历史问题')
  const session = await f.repo.openByID(`${f.thread.id}:main`)
  const entry = await session.getLeafId()
  f.db.sqlite.query('DELETE FROM turn_pi_starts WHERE turn_id = ?').run(old.turnID)
  const request = {
    operationId: 'legacy-edit',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '修改',
    attachmentIds: [],
    contextReferenceIds: [],
  }
  await expect(f.service.editUserMessage(request)).rejects.toMatchObject({
    code: 'CHECKPOINT_UNAVAILABLE',
  })
  f.db.sqlite
    .query('INSERT INTO turn_pi_boundaries (turn_id, session_id, entry_id) VALUES (?, ?, ?)')
    .run(old.turnID, `${f.thread.id}:main`, entry)
  const next = await f.service.editUserMessage(request)
  expect(
    (await (await f.repo.openByID(`${f.thread.id}:main`)).buildContext()).messages,
  ).toHaveLength(0)
  f.finish(next.turnID)
})

test('schema 61 前向迁移新增编辑表，保留旧记录及未知对象', async () => {
  const f = await fixture()
  const old = await f.completed('迁移前输入')
  f.db.sqlite.exec(
    "DROP TABLE thread_inactive_turns; DROP TABLE thread_edits; DROP TABLE turn_pi_starts; CREATE TABLE future_edit_data (value TEXT); INSERT INTO future_edit_data VALUES ('keep'); PRAGMA user_version = 61",
  )
  const dbPath = f.db.sqlite.filename
  f.db.close()
  databases.splice(databases.indexOf(f.db), 1)
  const reopened = new AgentDatabase(dbPath)
  databases.push(reopened)
  expect(reopened.getTurnInput(old.turnID)?.content).toBe('迁移前输入')
  expect(reopened.sqlite.query('SELECT value FROM future_edit_data').get()).toEqual({
    value: 'keep',
  })
  expect(new ThreadEditRepository(reopened).revision(f.thread.id)).toBe(0)
})

test('编辑后的 fork 与侧边聊天只复制活动轮次和 Pi 前缀', async () => {
  const f = await fixture()
  const old = await f.completed('旧问题')
  const next = await f.service.editUserMessage({
    operationId: 'fork-edit',
    threadId: f.thread.id,
    turnId: old.turnID,
    inputId: old.inputID,
    content: '新问题',
    attachmentIds: [],
    contextReferenceIds: [],
  })
  const session = await f.repo.openByID(`${f.thread.id}:main`)
  await session.appendMessage({ role: 'user', content: '新问题', timestamp: 1 })
  const entry = await session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: '新回答' }],
    api: 'openai-responses',
    provider: 'test',
    model: 'test',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  })
  ;(session.getStorage() as SqlitePiSessionStorage).flush()
  f.finish(next.turnID)
  const agent = f.db.sqlite
    .query('SELECT root_agent_id FROM turns WHERE id = ?')
    .get(next.turnID) as { root_agent_id: string }
  f.db.upsertItem(f.thread.id, {
    id: 'edited-answer',
    turnID: next.turnID,
    agentID: agent.root_agent_id,
    type: 'text',
    status: 'completed',
    data: { text: '新回答', placement: 'result' },
    createdAt: 2,
    updatedAt: 2,
  })
  f.db.sqlite
    .query('INSERT INTO turn_pi_boundaries (turn_id, session_id, entry_id) VALUES (?, ?, ?)')
    .run(next.turnID, `${f.thread.id}:main`, entry)
  const history = new ConversationHistoryForkRepository(f.db)
  const targetWorkspace = {
    cwd: roots.at(-1)!,
    roots: JSON.stringify([roots.at(-1)!]),
    gitBranch: 'main',
  }
  const forkInput = {
    sourceThreadID: f.thread.id,
    sourceTurnID: next.turnID,
    sourceItemID: 'edited-answer',
    destinationKind: 'same-worktree' as const,
  }
  new ThreadMessageForkRepository(f.db).create({
    operationID: 'fork-operation',
    ...forkInput,
    requestHash: ThreadMessageForkRepository.requestHash(forkInput),
  })
  const fork = await history.forkThrough(f.thread.id, {
    operationID: 'fork-operation',
    throughTurnID: next.turnID,
    sourceItemID: 'edited-answer',
    targetWorkspace,
  })
  const child = new ThreadProjection(f.db).snapshot(fork.targetThreadID)!
  expect(child.turns).toHaveLength(1)
  expect(child.inputs.map((value) => value.content)).toEqual(['新问题'])
  const side = await history.forkLatestForSideChat(
    f.thread.id,
    { operationID: 'side-operation', targetWorkspace },
    new SideChatRepository(f.db),
  )
  expect(
    new ThreadProjection(f.db).snapshot(side.threadID)?.inputs.map((value) => value.content),
  ).toEqual(['新问题'])
})
