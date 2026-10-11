import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { ThreadHistoryService } from '../src/session/ThreadHistoryService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import {
  SqlitePiSessionRepo,
  SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'
import { EventHub } from '../src/storage/events/EventHub'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { ApprovalService } from '../src/permission/ApprovalService'
import { PermissionDecisionEngine } from '../src/permission/PermissionDecisionEngine'
import { ToolRegistry } from '../src/tool/ToolRegistry'
import type { ToolInvocation } from '../src/Domain'
import { Model, Provider } from '@pidex/model-schema'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database.close()
  }
  await removeFixturePaths(paths.splice(0))
})

const makeHistory = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-history-'))
  paths.push(root)
  const databasePath = join(root, 'agent.sqlite')
  const db = new AgentDatabase(databasePath)
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  return {
    db,
    history: new ThreadHistoryService(db, hub),
    projection: new ThreadProjection(db),
    root,
    databasePath,
  }
}

const input = (content: string) =>
  ({
    content,
    model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt') }),
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    },
    strategy: 'queue',
    taskMode: 'chat',
  }) as const

describe('Thread 历史', () => {
  test('按项目列出并投影首条用户消息', async () => {
    const { db, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const first = db.createThread('第一段', project.id)
    db.createTurn(first.id, input('alpha 历史搜索目标'))
    const second = db.createThread('第二段', project.id)
    db.createTurn(second.id, input('beta'))

    const threads = projection.list({ projectID: project.id })
    expect(new Set(threads.map((thread) => thread.id))).toEqual(new Set([first.id, second.id]))
    expect(threads.find((thread) => thread.id === first.id)?.firstUserMessage).toBe(
      'alpha 历史搜索目标',
    )
  })

  test('列表投影未读时间并通过 read-through 清除', async () => {
    const { db, history, projection } = await makeHistory()
    const thread = db.createThread('未读会话')
    db.markThreadUnread(thread.id, 100)

    expect(history.getListItem(thread.id)?.unreadAt).toBe(100)
    expect(projection.list().find((item) => item.id === thread.id)?.unreadAt).toBe(100)

    const stale = history.markRead(thread.id, 90)
    expect(stale.unreadAt).toBe(100)
    const read = history.markRead(thread.id, 100)
    expect(read.unreadAt).toBeNull()

    const unread = history.markUnread(thread.id, 120)
    expect(unread.unreadAt).toBe(120)
    expect(history.markUnread(thread.id, 110).unreadAt).toBe(120)
    expect(history.markRead(thread.id, 119).unreadAt).toBe(120)
    expect(history.markRead(thread.id, 120).unreadAt).toBeNull()
    expect(() => history.markUnread('missing-thread', 130)).toThrow('Thread 不存在')
  })

  test('支持重命名、归档、取消归档和删除', async () => {
    const { db, history, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const thread = db.createThread('原标题', project.id)

    const renamed = await history.patch(thread.id, { title: '新标题', archived: true })
    expect(renamed.title).toBe('新标题')
    expect(typeof renamed.archivedAt).toBe('number')
    expect(projection.list({ projectID: project.id, archived: false })).toEqual([])
    expect(
      projection.list({ projectID: project.id, archived: true }).map((item) => item.id),
    ).toEqual([thread.id])
    expect(projection.snapshot(thread.id)?.thread.archivedAt).toBe(renamed.archivedAt)

    const active = await history.patch(thread.id, { archived: false })
    expect(active.archivedAt).toBeNull()
    expect(projection.snapshot(thread.id)?.thread.archivedAt).toBeNull()
    db.createTurn(thread.id, input('# 这是一个用于验证重置行为的非常长的首条用户消息'))
    const reset = await history.patch(thread.id, { title: null })
    expect(reset.title).toBe('这是一个用于验证重置行为的非常长的首条…')
    expect(Array.from(reset.title)).toHaveLength(20)
    const session = await new SqlitePiSessionRepo(db).create({
      id: `${thread.id}:main`,
      threadID: thread.id,
      agentID: 'creator',
    })
    await session.appendMessage({ role: 'user', content: 'private history', timestamp: Date.now() })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    await history.remove(thread.id)
    expect(db.getThread(thread.id)).toBeNull()
    expect(
      db.sqlite.query('SELECT 1 FROM pi_sessions WHERE thread_id = ?').get(thread.id),
    ).toBeNull()
    expect(
      db.sqlite
        .query('SELECT 1 FROM pi_session_entries WHERE session_id = ?')
        .get(`${thread.id}:main`),
    ).toBeNull()
  })

  test('纯标题更新保留活跃时间，归档混合更新仍推进活跃时间', async () => {
    const { db, history } = await makeHistory()
    const thread = db.createThread('原标题')
    db.createTurn(thread.id, input('# 用于重置标题的首条消息'))
    const activityAt = history.getListItem(thread.id)!.updatedAt
    let cursor = db.eventsAfter(0).at(-1)?.id ?? 0

    const renamed = await history.patch(thread.id, { title: '手工标题' })
    expect(renamed.updatedAt).toBe(activityAt)
    const renameEvent = db.eventsAfter(cursor).at(-1)
    expect(renameEvent?.params).toMatchObject({
      patch: { title: '手工标题' },
      updatedAt: activityAt,
    })
    cursor = renameEvent?.id ?? cursor

    const reset = await history.patch(thread.id, { title: null })
    expect(reset.updatedAt).toBe(activityAt)
    expect(db.eventsAfter(cursor).at(-1)?.params).toMatchObject({
      patch: { title: null },
      updatedAt: activityAt,
    })

    db.sqlite.query('UPDATE threads SET updated_at = 1 WHERE id = ?').run(thread.id)
    const archived = await history.patch(thread.id, { title: '归档标题', archived: true })
    expect(archived.updatedAt).toBeGreaterThan(1)
    expect(archived.archivedAt).toBe(archived.updatedAt)
  })

  test('父 Thread 删除会清理子 Agent Pi 历史，但拒绝删除活跃子 Thread', async () => {
    const { db, history } = await makeHistory()
    const parent = db.createThread('parent')
    const child = db.createThread('child')
    db.sqlite
      .query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?")
      .run(parent.id, child.id)
    const repo = new SqlitePiSessionRepo(db)
    const childSession = await repo.create({
      id: `subagent:${child.id}`,
      threadID: child.id,
      agentID: 'creator',
    })
    await childSession.appendMessage({
      role: 'user',
      content: 'child history',
      timestamp: Date.now(),
    })
    ;(childSession.getStorage() as SqlitePiSessionStorage).flush()

    const childTurn = db.createTurn(child.id, input('running'))
    db.claimTurnExecution(childTurn.turnID)
    await expect(history.remove(parent.id)).rejects.toMatchObject({ code: 'THREAD_ACTIVE' })
    db.sqlite
      .query("UPDATE turns SET status = 'completed', finished_at = ?, updated_at = ? WHERE id = ?")
      .run(Date.now(), Date.now(), childTurn.turnID)

    await history.remove(parent.id)
    expect(db.getThread(parent.id)).toBeNull()
    expect(db.getThread(child.id)).toBeNull()
    expect(
      db.sqlite.query('SELECT 1 FROM pi_sessions WHERE id = ?').get(`subagent:${child.id}`),
    ).toBeNull()
  })

  test('ThreadSnapshot 返回对应 Turn 的 Item', async () => {
    const { db, projection, root } = await makeHistory()
    const project = db.createProject({ rootPath: join(root, 'project'), name: '测试项目' })
    const thread = db.createThread('对话', project.id)
    const turn = db.createTurn(thread.id, input('第一条'))
    const timestamp = Date.now()
    db.upsertItem(thread.id, {
      id: 'item-1',
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'text',
      status: 'completed',
      data: { text: '回答' },
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.messages).toMatchObject([
      { id: turn.inputID, turnId: turn.turnID, role: 'user' },
    ])
    expect(snapshot?.items).toMatchObject([{ id: 'item-1', type: 'text', text: '回答' }])
  })

  test('按稳定排他游标分页 Turn，并将 queued Turn 与附件独立投影', async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread('分页会话')
    const completed = Array.from({ length: 12 }, (_, index) => {
      const created = db.createTurn(thread.id, input(`第 ${index + 1} 轮`), 'completed')
      db.updateTurnStatus(created.turnID, 'completed')
      return created
    })
    const queued = db.createTurn(thread.id, input('排队中的一轮'))
    const sameTimestamp = 1_700_000_000_000
    db.sqlite
      .query("UPDATE turns SET created_at = ? WHERE thread_id = ? AND status <> 'queued'")
      .run(sameTimestamp, thread.id)
    db.sqlite
      .query(
        `INSERT INTO input_attachments (id, thread_id, input_id, kind, name, media_type, size_bytes, sha256, storage_path, created_at, bound_at)
      VALUES ('attachment-history', ?, ?, 'text', 'history.txt', 'text/plain', 7, 'sha-history', 'history.txt', ?, ?)`,
      )
      .run(thread.id, completed[0]!.inputID, sameTimestamp, sameTimestamp)

    const first = projection.historyPage(thread.id)!
    expect(first.turns).toHaveLength(10)
    expect(first.hasOlder).toBe(true)
    expect(first.olderCursor).toBeString()
    expect(first.queue.turns.map((turn) => turn.id)).toEqual([queued.turnID])
    expect(first.queue.inputs.map((item) => item.id)).toEqual([queued.inputID])

    const second = projection.historyPage(thread.id, { before: first.olderCursor! })!
    expect(second.turns).toHaveLength(2)
    expect(second.hasOlder).toBe(false)
    expect(second.olderCursor).toBeNull()
    const allBundles = [...second.turns, ...first.turns]
    expect(allBundles.flatMap((bundle) => bundle.attachments)).toMatchObject([
      {
        id: 'attachment-history',
        name: 'history.txt',
        mediaType: 'text/plain',
      },
    ])
    expect(
      allBundles
        .flatMap((bundle) => bundle.inputs)
        .find((item) => item.id === completed[0]!.inputID)?.attachmentIds,
    ).toEqual(['attachment-history'])

    const combined = allBundles.map((bundle) => bundle.turn.id)
    const expected = (
      db.sqlite
        .query(
          "SELECT id FROM turns WHERE thread_id = ? AND status <> 'queued' ORDER BY created_at, id",
        )
        .all(thread.id) as Array<{ id: string }>
    ).map((row) => row.id)
    expect(combined).toEqual(expected)
    expect(new Set(combined).size).toBe(12)
  })

  test('设置立即持久化且幂等更新不修改活跃时间或重复写事件', async () => {
    const { db, history, databasePath } = await makeHistory()
    const thread = db.createThread('设置持久化')
    const updatedAt = thread.updatedAt
    const beforeEvents = db.eventsAfter(0).length
    const settings = {
      taskMode: 'plan',
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'auto_review',
      },
    } as const

    const changed = await history.patchSettings(thread.id, settings)
    expect(changed.version).toBe(updatedAt)
    expect(db.getThreadSettings(thread.id)).toEqual(settings)
    expect(db.sqlite.query('SELECT updated_at FROM threads WHERE id = ?').get(thread.id)).toEqual({
      updated_at: updatedAt,
    })
    expect(db.eventsAfter(0).length).toBe(beforeEvents + 1)

    const unchanged = await history.patchSettings(thread.id, {})
    const repeated = await history.patchSettings(thread.id, settings)
    expect(unchanged.version).toBe(updatedAt)
    expect(repeated.version).toBe(updatedAt)
    expect(db.eventsAfter(0).length).toBe(beforeEvents + 1)

    db.close()
    databases.splice(databases.indexOf(db), 1)
    const reopened = new AgentDatabase(databasePath)
    databases.push(reopened)
    expect(reopened.getThreadSettings(thread.id)).toEqual(settings)
  })

  test('工作分支更新不改变会话活跃时间且空值不覆盖旧分支', async () => {
    const { db } = await makeHistory()
    const thread = db.createThread('分支持久化')

    expect(db.updateThreadGitBranch(thread.id, ' codex/hover-card ')).toBe(true)
    expect(db.updateThreadGitBranch(thread.id, 'codex/hover-card')).toBe(false)
    expect(db.updateThreadGitBranch(thread.id, ' ')).toBe(false)
    expect(db.getThread(thread.id)).toMatchObject({
      gitBranch: 'codex/hover-card',
      updatedAt: thread.updatedAt,
    })
  })

  test('创建 Thread 时保存并投影初始设置', async () => {
    const { db, projection } = await makeHistory()
    const settings = {
      taskMode: 'plan',
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      },
    } as const
    const thread = db.createThread('Plan 会话', undefined, settings)

    expect(projection.snapshot(thread.id)?.thread.settings).toEqual(settings)
    expect(projection.list().find((item) => item.id === thread.id)?.settings).toEqual(settings)
  })

  test('创建 Turn 原子同步 Thread 设置并保持已有 Turn 快照不变', async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread('不可变快照')
    const firstInput = input('第一轮')
    const first = db.createTurn(thread.id, firstInput)
    expect(first.settingsEvent?.id).toBeLessThan(first.event.id)
    db.claimTurnExecution(first.turnID)

    const nextSettings = {
      taskMode: 'plan',
      permissionConfig: {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'auto_review',
      },
    } as const
    db.updateThreadSettings(thread.id, nextSettings)
    const second = db.createTurn(thread.id, { ...firstInput, content: '第二轮', ...nextSettings })
    expect(second.settingsEvent).toBeNull()

    const snapshot = projection.snapshot(thread.id)
    expect(snapshot?.thread.settings).toEqual(nextSettings)
    expect(snapshot?.turns.find((turn) => turn.id === first.turnID)).toMatchObject({
      mode: 'chat',
      permissionConfig: firstInput.permissionConfig,
    })
    expect(snapshot?.turns.find((turn) => turn.id === second.turnID)).toMatchObject({
      mode: 'plan',
      permissionConfig: nextSettings.permissionConfig,
    })
    expect(snapshot?.inputs.find((item) => item.id === second.inputID)).toMatchObject({
      mode: 'plan',
      permissionConfig: nextSettings.permissionConfig,
    })
  })

  test('snapshot 与 historyPage 从 request_payload 恢复动态权限元数据', async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread('权限会话')
    const firstInput = input('需要额外权限')
    const turn = db.createTurn(thread.id, firstInput)
    db.claimTurnExecution(turn.turnID)
    const service = new ApprovalService(
      db,
      await Effect.runPromise(EventHub.make),
      new ToolRegistry(),
    )
    const invocation: ToolInvocation = {
      id: 'permission-tool',
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      name: 'request_permissions',
      input: {
        scope: 'session',
        readPaths: ['C:\\docs'],
        writePaths: ['C:\\out'],
        networkDomains: ['api.example.com'],
        justification: '需要读取与写入目录',
      },
      permissionConfig: firstInput.permissionConfig,
      model: firstInput.model,
      taskMode: 'chat',
      durableApproval: true,
    }
    const resolved = new PermissionDecisionEngine().evaluate(
      invocation,
      new ToolRegistry().get('request_permissions'),
    )
    if (resolved.action !== 'review') throw new Error('测试需要 review 决策')
    const prepared = service.prepare(
      invocation,
      { decision: 'ask', risk: 'high', reason: '需要权限' },
      resolved,
    )
    service.persist(prepared)
    await service.attachRunState('permission-tool', JSON.stringify({ version: 1 }), {
      name: 'request_permissions',
      callId: 'permission-tool',
    })

    const snapshot = projection.snapshot(thread.id)
    expect(
      snapshot?.approvals.find((approval) => approval.id === prepared.approvalID),
    ).toMatchObject({
      paths: ['C:\\docs', 'C:\\out', 'api.example.com'],
      status: 'pending',
      permissionGrant: {
        requestedScope: 'session',
        allowedScopes: ['tool-call', 'turn', 'session'],
      },
    })

    const page = projection.historyPage(thread.id)
    expect(page?.turns[0]?.approvals[0]).toMatchObject({
      id: prepared.approvalID,
      permissionGrant: {
        requestedScope: 'session',
        allowedScopes: ['tool-call', 'turn', 'session'],
      },
    })
    expect(page?.turns[0]?.approvals[0]?.paths).toEqual(['C:\\docs', 'C:\\out', 'api.example.com'])
  })

  test('列表投影：最新已完成轮次含已完成 plan item 时返回计划待审批', async () => {
    const { db, projection } = await makeHistory()
    const thread = db.createThread('计划待审批会话')
    // 计划审批只从最新的 Plan 模式已完成轮次派生，并随轮次完成写入 plan_approvals。
    const turn = db.createTurn(thread.id, { ...input('制定计划'), taskMode: 'plan' })
    db.upsertItem(thread.id, {
      id: 'plan-item-1',
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'plan',
      status: 'completed',
      data: { title: '实施计划', markdown: '- 步骤一' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    db.claimTurnExecution(turn.turnID)
    db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })

    const item = projection.list().find((entry) => entry.id === thread.id)
    expect(item?.latestTurnStatus).toBe('completed')
    expect(item?.pendingPlanApproval).toBe(true)
  })

  test('列表投影：无 plan、未完成 plan、存在更新轮次或活动轮次时计划待审批为 false', async () => {
    const { db, projection } = await makeHistory()
    const planless = db.createThread('无计划会话')
    const planlessTurn = db.createTurn(planless.id, { ...input('没有计划'), taskMode: 'plan' })
    db.updateTurnStatus(planlessTurn.turnID, 'completed')

    const streaming = db.createThread('流式计划会话')
    const streamingTurn = db.createTurn(streaming.id, {
      ...input('正在生成计划'),
      taskMode: 'plan',
    })
    db.updateTurnStatus(streamingTurn.turnID, 'completed')
    db.upsertItem(streaming.id, {
      id: 'plan-streaming',
      turnID: streamingTurn.turnID,
      agentID: streamingTurn.agentID,
      type: 'plan',
      status: 'running',
      data: { title: '实施计划', markdown: '- 步骤一' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const superseded = db.createThread('已有更新轮次会话')
    const oldTurn = db.createTurn(superseded.id, { ...input('第一轮计划'), taskMode: 'plan' })
    db.updateTurnStatus(oldTurn.turnID, 'completed')
    db.upsertItem(superseded.id, {
      id: 'plan-old',
      turnID: oldTurn.turnID,
      agentID: oldTurn.agentID,
      type: 'plan',
      status: 'completed',
      data: { title: '实施计划', markdown: '- 步骤一' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const newerTurn = db.createTurn(superseded.id, input('第二轮继续'))
    db.updateTurnStatus(newerTurn.turnID, 'completed')
    db.sqlite
      .query('UPDATE turns SET created_at = ? WHERE id = ?')
      .run(Date.now() - 1000, oldTurn.turnID)
    db.sqlite
      .query('UPDATE turns SET created_at = ? WHERE id = ?')
      .run(Date.now(), newerTurn.turnID)

    const active = db.createThread('活动轮次会话')
    const activePlanTurn = db.createTurn(active.id, { ...input('计划已完成'), taskMode: 'plan' })
    db.updateTurnStatus(activePlanTurn.turnID, 'completed')
    db.upsertItem(active.id, {
      id: 'plan-active',
      turnID: activePlanTurn.turnID,
      agentID: activePlanTurn.agentID,
      type: 'plan',
      status: 'completed',
      data: { title: '实施计划', markdown: '- 步骤一' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const runningTurn = db.createTurn(active.id, input('正在继续'))
    db.updateTurnStatus(runningTurn.turnID, 'running')
    db.sqlite
      .query('UPDATE turns SET created_at = ? WHERE id = ?')
      .run(Date.now() - 1000, activePlanTurn.turnID)
    db.sqlite
      .query('UPDATE turns SET created_at = ? WHERE id = ?')
      .run(Date.now(), runningTurn.turnID)

    // 与轮次完成和启动恢复一致，从 turn/item 真源派生待审批状态。
    db.repositories.planApprovals.recover()

    const byId = new Map(projection.list().map((item) => [item.id, item]))
    expect(byId.get(planless.id)?.pendingPlanApproval).toBe(false)
    expect(byId.get(streaming.id)?.pendingPlanApproval).toBe(false)
    expect(byId.get(superseded.id)?.pendingPlanApproval).toBe(false)
    expect(byId.get(active.id)?.pendingPlanApproval).toBe(false)
    expect(byId.get(superseded.id)?.latestTurnStatus).toBe('completed')
    expect(byId.get(active.id)?.latestTurnStatus).toBe('running')
  })
})
