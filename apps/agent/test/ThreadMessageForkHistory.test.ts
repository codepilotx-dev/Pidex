import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { PiEventAdapter } from '../src/orchestration/pi/PiEventAdapter'
import { ConversationHistoryForkRepository } from '../src/session/fork/ConversationHistoryForkRepository'
import { ThreadMessageForkRepository } from '../src/session/fork/ThreadMessageForkRepository'
import {
  SqlitePiSessionRepo,
  SqlitePiSessionStorage,
} from '../src/storage/pi-session/SqlitePiSession'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { TurnPiBoundaryRepository } from '../src/storage/repositories/TurnPiBoundaryRepository'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const database = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-message-fork-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  return db
}

const assistant = (text: string, timestamp: number) => ({
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text }],
  api: 'openai-responses' as const,
  provider: 'openai',
  model: 'gpt-test',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop' as const,
  timestamp,
})

const insertTurn = (
  db: AgentDatabase,
  input: {
    threadID: string
    turnID: string
    agentID: string
    sessionID: string
    itemID: string
    text: string
    status?: string
    createdAt: number
  },
) => {
  const status = input.status ?? 'completed'
  db.sqlite
    .query(
      `INSERT INTO turns (
    id, thread_id, root_agent_id, status, mode, model_ref, strategy, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'chat', '{}', 'start', ?, ?)`,
    )
    .run(input.turnID, input.threadID, input.agentID, status, input.createdAt, input.createdAt)
  db.sqlite
    .query(
      `INSERT INTO agent_executions (
    id, thread_id, turn_id, profile, task, model_ref, session_id, status, created_at, updated_at
  ) VALUES (?, ?, ?, 'main', 'task', '{}', ?, ?, ?, ?)`,
    )
    .run(
      input.agentID,
      input.threadID,
      input.turnID,
      input.sessionID,
      status,
      input.createdAt,
      input.createdAt,
    )
  db.sqlite
    .query(
      `INSERT INTO inputs (
    id, thread_id, turn_id, content, model_ref, strategy, task_mode, status, created_at
  ) VALUES (?, ?, ?, ?, '{}', 'start', 'chat', ?, ?)`,
    )
    .run(
      `input-${input.turnID}`,
      input.threadID,
      input.turnID,
      `question-${input.turnID}`,
      status,
      input.createdAt,
    )
  db.sqlite
    .query(
      `INSERT INTO messages (
    id, thread_id, turn_id, role, content, created_at, ordinal
  ) VALUES (?, ?, ?, 'user', ?, ?, 0)`,
    )
    .run(
      `message-${input.turnID}`,
      input.threadID,
      input.turnID,
      `question-${input.turnID}`,
      input.createdAt,
    )
  db.sqlite
    .query(
      `INSERT INTO items (
    id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'text', ?, ?, 0, ?, ?)`,
    )
    .run(
      input.itemID,
      input.threadID,
      input.turnID,
      input.agentID,
      status,
      JSON.stringify({ placement: 'result', text: input.text }),
      input.createdAt,
      input.createdAt,
    )
}

const createOperation = (
  db: AgentDatabase,
  input: { operationID: string; threadID: string; turnID: string; itemID: string },
) => {
  const repo = new ThreadMessageForkRepository(db, () => 100)
  repo.create({
    operationID: input.operationID,
    sourceThreadID: input.threadID,
    sourceTurnID: input.turnID,
    sourceItemID: input.itemID,
    destinationKind: 'same-worktree',
    requestHash: ThreadMessageForkRepository.requestHash({
      sourceThreadID: input.threadID,
      sourceTurnID: input.turnID,
      sourceItemID: input.itemID,
      destinationKind: 'same-worktree',
    }),
  })
}

const insertSubagent = (
  db: AgentDatabase,
  input: {
    parentThreadID: string
    parentTurnID: string
    parentAgentID: string
    taskID: string
    runID: string
    childThreadID: string
    itemID: string
    status: 'queued' | 'completed'
    ordinal: number
  },
) => {
  db.sqlite
    .query(
      `INSERT INTO threads (
    id, title, kind, parent_thread_id, created_at, updated_at
  ) VALUES (?, ?, 'subagent', ?, 1, 1)`,
    )
    .run(input.childThreadID, input.taskID, input.parentThreadID)
  db.sqlite
    .query(
      `INSERT INTO subagent_tasks (
    id, parent_thread_id, parent_turn_id, parent_agent_id, child_thread_id,
    display_name, profile, task, permission_ceiling, workspace_mode,
    workspace_state, current_run_id, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'default', 'audit', '{}', 'shared', '{}', ?, ?, 1, 1)`,
    )
    .run(
      input.taskID,
      input.parentThreadID,
      input.parentTurnID,
      input.parentAgentID,
      input.childThreadID,
      input.taskID,
      input.runID,
      input.status,
    )
  db.sqlite
    .query(
      `INSERT INTO subagent_runs (
    id, task_id, generation, status, model_ref, permission_config, created_at, updated_at
  ) VALUES (?, ?, 1, ?, '{}', '{}', 1, 1)`,
    )
    .run(input.runID, input.taskID, input.status)
  db.sqlite
    .query(
      `INSERT INTO items (
    id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'subagent', ?, ?, ?, 1, 1)`,
    )
    .run(
      input.itemID,
      input.parentThreadID,
      input.parentTurnID,
      input.parentAgentID,
      input.status === 'completed' ? 'completed' : 'pending',
      JSON.stringify({
        subagentTaskId: input.taskID,
        runId: input.runID,
        childThreadId: input.childThreadID,
        displayName: input.taskID,
        profile: 'default',
        task: 'audit',
        status: input.status,
        queueReason: null,
        result: input.status === 'completed' ? { summary: 'done' } : null,
      }),
      input.ordinal,
    )
}

describe('ConversationHistoryForkRepository', () => {
  test('侧边聊天从最新完成回复创建隐藏前缀并忽略活动 Turn', async () => {
    const db = await database()
    const source = db.createThread('侧边聊天来源')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 'side-source',
      threadID: source.id,
      agentID: 'side-agent-1',
    })
    await session.appendMessage({ role: 'user', content: 'question-side-1', timestamp: 1 })
    const firstAssistantEntry = await session.appendMessage(assistant('side-answer-1', 2))
    await session.appendMessage({ role: 'user', content: 'question-side-active', timestamp: 3 })
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    insertTurn(db, {
      threadID: source.id,
      turnID: 'side-turn-1',
      agentID: 'side-agent-1',
      sessionID: 'side-source',
      itemID: 'side-item-1',
      text: 'side-answer-1',
      createdAt: 10,
    })
    insertTurn(db, {
      threadID: source.id,
      turnID: 'side-turn-active',
      agentID: 'side-agent-2',
      sessionID: 'side-source',
      itemID: 'side-item-active',
      text: 'partial',
      status: 'running',
      createdAt: 20,
    })
    new TurnPiBoundaryRepository(db).upsert({
      turnID: 'side-turn-1',
      sessionID: 'side-source',
      entryID: firstAssistantEntry,
    })

    let id = 0
    const history = new ConversationHistoryForkRepository(db, () => `side-id-${++id}`)
    const created = await history.forkLatestForSideChat(
      source.id,
      {
        operationID: 'side-operation',
        targetThreadID: 'side-target',
        referenceText: 'selected reference',
        targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'feature' },
      },
      db.repositories.sideChats,
    )

    expect(created).toMatchObject({
      threadID: 'side-target',
      sourceThreadID: source.id,
      referenceText: 'selected reference',
      operationID: 'side-operation',
    })
    expect(created.inheritedThroughTurnID).not.toBe('side-turn-1')
    expect(
      db.sqlite.query("SELECT title, archived_at FROM threads WHERE id = 'side-target'").get(),
    ).toEqual({
      title: '侧边聊天来源',
      archived_at: -1,
    })
    expect(
      db.sqlite.query("SELECT status FROM turns WHERE thread_id = 'side-target'").all(),
    ).toEqual([{ status: 'completed' }])
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = 'side-turn-active'").get()).toEqual(
      { status: 'running' },
    )
    const copiedSession = db.sqlite
      .query("SELECT id FROM pi_sessions WHERE thread_id = 'side-target'")
      .get() as { id: string }
    expect((await sessions.openByID(copiedSession.id)).getEntries()).resolves.toHaveLength(2)
    await expect(
      history.forkLatestForSideChat(
        source.id,
        {
          operationID: 'side-operation',
          referenceText: 'selected reference',
          targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'feature' },
        },
        db.repositories.sideChats,
      ),
    ).resolves.toEqual(created)
    db.sqlite.query('DELETE FROM threads WHERE id = ?').run(source.id)
    expect(db.sqlite.query("SELECT id FROM threads WHERE id = 'side-target'").get()).toBeNull()
  })

  test('无完成回复时创建空侧边聊天', async () => {
    const db = await database()
    const source = db.createThread('空侧边聊天来源')
    const history = new ConversationHistoryForkRepository(db, () => 'unused-id')
    const created = await history.forkLatestForSideChat(
      source.id,
      {
        operationID: 'empty-side-operation',
        targetThreadID: 'empty-side-target',
        targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: '' },
      },
      db.repositories.sideChats,
    )
    expect(created.inheritedThroughTurnID).toBeNull()
    expect(
      db.sqlite
        .query("SELECT COUNT(*) AS count FROM turns WHERE thread_id = 'empty-side-target'")
        .get(),
    ).toEqual({ count: 0 })
  })

  test('从已完成回复复制精确前缀，保留源后续 active 并按边界 fork Pi session', async () => {
    const db = await database()
    const source = db.createThread('实现普通 Fork')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 'source-main',
      threadID: source.id,
      agentID: 'agent-1',
    })
    await session.appendMessage({ role: 'user', content: 'question-turn-1', timestamp: 1 })
    const firstAssistantEntry = await session.appendMessage(assistant('answer-1', 2))
    await session.appendMessage({ role: 'user', content: 'question-turn-2', timestamp: 3 })
    await session.appendMessage(assistant('answer-2', 4))
    ;(session.getStorage() as SqlitePiSessionStorage).flush()

    insertTurn(db, {
      threadID: source.id,
      turnID: 'turn-1',
      agentID: 'agent-1',
      sessionID: 'source-main',
      itemID: 'item-1',
      text: 'answer-1',
      createdAt: 10,
    })
    db.sqlite
      .query(
        `
      INSERT INTO thread_context_paths (id, thread_id, name, path, path_key, kind, created_at)
      VALUES ('context-1', ?, 'fixture.txt', 'C:\\outside\\fixture.txt', 'c:\\outside\\fixture.txt', 'file', 10)
    `,
      )
      .run(source.id)
    db.sqlite
      .query(
        `
      INSERT INTO input_context_paths (input_id, context_path_id, sort_order, created_at)
      VALUES ('input-turn-1', 'context-1', 0, 10)
    `,
      )
      .run()
    insertTurn(db, {
      threadID: source.id,
      turnID: 'turn-2',
      agentID: 'agent-2',
      sessionID: 'source-main',
      itemID: 'item-2',
      text: 'answer-2',
      createdAt: 20,
    })
    insertTurn(db, {
      threadID: source.id,
      turnID: 'turn-active',
      agentID: 'agent-active',
      sessionID: 'source-main',
      itemID: 'item-active',
      text: 'partial',
      status: 'running',
      createdAt: 30,
    })
    new TurnPiBoundaryRepository(db).upsert({
      turnID: 'turn-1',
      sessionID: 'source-main',
      entryID: firstAssistantEntry,
    })
    db.sqlite
      .query(
        "INSERT INTO events (thread_id, turn_id, method, params, created_at) VALUES (?, 'turn-1', 'private/source', '{}', 1)",
      )
      .run(source.id)
    createOperation(db, {
      operationID: 'fork-1',
      threadID: source.id,
      turnID: 'turn-1',
      itemID: 'item-1',
    })

    let id = 0
    const history = new ConversationHistoryForkRepository(db, () => `fork-id-${++id}`)
    const result = await history.forkThrough(source.id, {
      operationID: 'fork-1',
      targetThreadID: 'target-1',
      throughTurnID: 'turn-1',
      sourceItemID: 'item-1',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'feature' },
      visible: false,
    })

    expect(result.targetThreadID).toBe('target-1')
    expect(
      db.sqlite.query("SELECT title, archived_at FROM threads WHERE id = 'target-1'").get(),
    ).toEqual({
      title: '实现普通 Fork（分支）',
      archived_at: -1,
    })
    const targetTurnID = result.turnIDs.get('turn-1')!
    expect(targetTurnID).toBeDefined()
    const forkRow = db.sqlite
      .query(
        'SELECT target_turn_id, source_thread_id, source_turn_id FROM thread_message_forks WHERE target_thread_id = ?',
      )
      .get('target-1') as { target_turn_id: string; source_thread_id: string; source_turn_id: string }
    expect(forkRow.target_turn_id).toBe(targetTurnID)
    expect(forkRow.source_turn_id).toBe('turn-1')
    expect(forkRow.target_turn_id).not.toBe('turn-1')
    expect(
      db.sqlite
        .query("SELECT status FROM turns WHERE thread_id = 'target-1' ORDER BY created_at")
        .all(),
    ).toEqual([{ status: 'completed' }])
    expect(db.sqlite.query("SELECT status FROM turns WHERE id = 'turn-active'").get()).toEqual({
      status: 'running',
    })
    expect(
      db.sqlite.query("SELECT COUNT(*) AS count FROM events WHERE thread_id = 'target-1'").get(),
    ).toEqual({ count: 0 })
    const copiedSession = db.sqlite
      .query("SELECT id FROM pi_sessions WHERE thread_id = 'target-1'")
      .get() as { id: string }
    expect((await sessions.openByID(copiedSession.id)).getEntries()).resolves.toHaveLength(2)
    expect(
      db.sqlite
        .query(
          "SELECT entry_id FROM turn_pi_boundaries WHERE turn_id IN (SELECT id FROM turns WHERE thread_id = 'target-1')",
        )
        .get(),
    ).toEqual({ entry_id: firstAssistantEntry })
    expect(db.sqlite.query("SELECT id FROM items WHERE thread_id = 'target-1'").get()).not.toEqual({
      id: 'item-1',
    })
    expect(
      db.sqlite
        .query(
          `
      SELECT context.path, binding.sort_order
      FROM thread_context_paths AS context
      JOIN input_context_paths AS binding ON binding.context_path_id = context.id
      JOIN inputs ON inputs.id = binding.input_id
      WHERE context.thread_id = 'target-1' AND inputs.thread_id = 'target-1'
    `,
        )
        .get(),
    ).toEqual({ path: 'C:\\outside\\fixture.txt', sort_order: 0 })

    expect(history.publishTarget('fork-1', 'target-1')).toBe(true)
    expect(history.publishTarget('fork-1', 'target-1')).toBe(false)
    expect(db.sqlite.query("SELECT archived_at FROM threads WHERE id = 'target-1'").get()).toEqual({
      archived_at: null,
    })
    expect(db.sqlite.query("SELECT method FROM events WHERE thread_id = 'target-1'").all()).toEqual(
      [{ method: 'thread/forked' }],
    )

    db.sqlite.query('DELETE FROM threads WHERE id = ?').run(source.id)
    expect(db.sqlite.query('SELECT id FROM threads WHERE id = ?').get(source.id)).toBeNull()
    expect(db.sqlite.query("SELECT id FROM threads WHERE id = 'target-1'").get()).toEqual({
      id: 'target-1',
    })
    expect(
      db.sqlite
        .query(
          "SELECT target_thread_id FROM thread_message_forks WHERE target_thread_id = 'target-1'",
        )
        .get(),
    ).toBeNull()
  })

  test('旧历史只在最终 Assistant entry 可唯一确定时回退，隐藏 target 可以安全回滚', async () => {
    const db = await database()
    const source = db.createThread('旧历史（分支）')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 'legacy-main',
      threadID: source.id,
      agentID: 'legacy-agent',
    })
    const userEntry = await session.appendMessage({
      role: 'user',
      content: 'question-legacy-turn',
      timestamp: 1,
    })
    const assistantEntry = await session.appendMessage(
      assistant('legacy answer\n<proposed_plan>\n# Legacy plan\n</proposed_plan>', 2),
    )
    const storage = session.getStorage() as SqlitePiSessionStorage
    await storage.setLeafId(userEntry)
    await session.appendMessage(
      assistant('legacy answer\n<proposed_plan>\n# Detached plan\n</proposed_plan>', 3),
    )
    await storage.setLeafId(assistantEntry)
    storage.flush()
    insertTurn(db, {
      threadID: source.id,
      turnID: 'legacy-turn',
      agentID: 'legacy-agent',
      sessionID: 'legacy-main',
      itemID: 'legacy-item',
      text: 'legacy answer',
      createdAt: 1,
    })
    createOperation(db, {
      operationID: 'legacy-fork',
      threadID: source.id,
      turnID: 'legacy-turn',
      itemID: 'legacy-item',
    })
    const history = new ConversationHistoryForkRepository(
      db,
      (() => {
        let id = 0
        return () => `legacy-id-${++id}`
      })(),
    )
    await history.forkThrough(source.id, {
      operationID: 'legacy-fork',
      targetThreadID: 'legacy-target',
      throughTurnID: 'legacy-turn',
      sourceItemID: 'legacy-item',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'feature' },
    })
    expect(db.sqlite.query("SELECT title FROM threads WHERE id = 'legacy-target'").get()).toEqual({
      title: '旧历史（分支）',
    })
    expect(
      db.sqlite
        .query(
          "SELECT entry_id FROM turn_pi_boundaries WHERE turn_id IN (SELECT id FROM turns WHERE thread_id = 'legacy-target')",
        )
        .get(),
    ).toEqual({ entry_id: assistantEntry })
    expect(history.rollback('legacy-fork')).toBe(true)
    expect(db.sqlite.query("SELECT id FROM threads WHERE id = 'legacy-target'").get()).toBeNull()
  })

  test('过滤未完成 subagent item，并完整重映射已完成 subagent', async () => {
    const db = await database()
    const source = db.createThread('包含异步子任务')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 'subagent-main',
      threadID: source.id,
      agentID: 'root-agent',
    })
    await session.appendMessage({ role: 'user', content: 'question', timestamp: 1 })
    const assistantEntry = await session.appendMessage(assistant('answer', 2))
    ;(session.getStorage() as SqlitePiSessionStorage).flush()
    insertTurn(db, {
      threadID: source.id,
      turnID: 'root-turn',
      agentID: 'root-agent',
      sessionID: 'subagent-main',
      itemID: 'root-result',
      text: 'answer',
      createdAt: 10,
    })
    new TurnPiBoundaryRepository(db).upsert({
      turnID: 'root-turn',
      sessionID: 'subagent-main',
      entryID: assistantEntry,
    })
    insertSubagent(db, {
      parentThreadID: source.id,
      parentTurnID: 'root-turn',
      parentAgentID: 'root-agent',
      taskID: 'completed-task',
      runID: 'completed-run',
      childThreadID: 'completed-child',
      itemID: 'completed-item',
      status: 'completed',
      ordinal: 1,
    })
    insertSubagent(db, {
      parentThreadID: source.id,
      parentTurnID: 'root-turn',
      parentAgentID: 'root-agent',
      taskID: 'queued-task',
      runID: 'queued-run',
      childThreadID: 'queued-child',
      itemID: 'queued-item',
      status: 'queued',
      ordinal: 2,
    })
    createOperation(db, {
      operationID: 'subagent-fork',
      threadID: source.id,
      turnID: 'root-turn',
      itemID: 'root-result',
    })

    let id = 0
    const history = new ConversationHistoryForkRepository(db, () => `subagent-id-${++id}`)
    await history.forkThrough(source.id, {
      operationID: 'subagent-fork',
      targetThreadID: 'subagent-target',
      throughTurnID: 'root-turn',
      sourceItemID: 'root-result',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'feature' },
    })

    const copiedTasks = db.sqlite
      .query(
        `SELECT id, child_thread_id, current_run_id
      FROM subagent_tasks WHERE parent_thread_id = 'subagent-target'`,
      )
      .all() as Array<{
      id: string
      child_thread_id: string
      current_run_id: string
    }>
    expect(copiedTasks).toHaveLength(1)
    expect(copiedTasks[0]).not.toEqual({
      id: 'completed-task',
      child_thread_id: 'completed-child',
      current_run_id: 'completed-run',
    })
    const copiedItems = db.sqlite
      .query(
        `SELECT data FROM items
      WHERE thread_id = 'subagent-target' AND type = 'subagent'`,
      )
      .all() as Array<{ data: string }>
    expect(copiedItems).toHaveLength(1)
    expect(JSON.parse(copiedItems[0]!.data)).toMatchObject({
      subagentTaskId: copiedTasks[0]!.id,
      runId: copiedTasks[0]!.current_run_id,
      childThreadId: copiedTasks[0]!.child_thread_id,
      status: 'completed',
    })
    expect(db.sqlite.query("SELECT id FROM subagent_tasks WHERE id = 'queued-task'").get()).toEqual(
      { id: 'queued-task' },
    )
    expect(
      db.sqlite
        .query("SELECT id FROM items WHERE thread_id = 'subagent-target' AND id = 'queued-item'")
        .get(),
    ).toBeNull()
  })

  test('压缩后的会话分叉跳过目标 Pi 会话里不存在的前置边界', async () => {
    const db = await database()
    const source = db.createThread('压缩后分叉来源')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 'compact-source',
      threadID: source.id,
      agentID: 'compact-agent-1',
    })
    const storage = session.getStorage() as SqlitePiSessionStorage
    const stamp = new Date(0).toISOString()
    await storage.appendEntry({
      type: 'message',
      id: 'compact-q1',
      parentId: null,
      timestamp: stamp,
      message: { role: 'user', content: 'question-compact-1', timestamp: 1 },
    } as never)
    await storage.appendEntry({
      type: 'message',
      id: 'compact-a1',
      parentId: 'compact-q1',
      timestamp: stamp,
      message: assistant('compact-answer-1', 2),
    } as never)
    // 目标会话从压缩边界开始复制，压缩前的 entry 不会进入分叉会话。
    await storage.appendEntry({
      type: 'compaction',
      id: 'compact-entry-1',
      parentId: 'compact-a1',
      timestamp: stamp,
      summary: '压缩摘要',
      firstKeptEntryId: null,
      tokensBefore: 900,
      retainedTail: true,
    } as never)
    await storage.appendEntry({
      type: 'message',
      id: 'compact-q2',
      parentId: 'compact-entry-1',
      timestamp: stamp,
      message: { role: 'user', content: 'question-compact-2', timestamp: 3 },
    } as never)
    await storage.appendEntry({
      type: 'message',
      id: 'compact-a2',
      parentId: 'compact-q2',
      timestamp: stamp,
      message: assistant('compact-answer-2', 4),
    } as never)
    storage.flush()
    const firstAnswer = 'compact-a1'
    const secondAnswer = 'compact-a2'

    insertTurn(db, {
      threadID: source.id,
      turnID: 'compact-turn-1',
      agentID: 'compact-agent-1',
      sessionID: 'compact-source',
      itemID: 'compact-item-1',
      text: 'compact-answer-1',
      createdAt: 10,
    })
    insertTurn(db, {
      threadID: source.id,
      turnID: 'compact-turn-2',
      agentID: 'compact-agent-2',
      sessionID: 'compact-source',
      itemID: 'compact-item-2',
      text: 'compact-answer-2',
      createdAt: 20,
    })
    const boundaries = new TurnPiBoundaryRepository(db)
    boundaries.upsert({ turnID: 'compact-turn-1', sessionID: 'compact-source', entryID: firstAnswer })
    boundaries.upsert({
      turnID: 'compact-turn-2',
      sessionID: 'compact-source',
      entryID: secondAnswer,
    })
    createOperation(db, {
      operationID: 'compact-fork',
      threadID: source.id,
      turnID: 'compact-turn-2',
      itemID: 'compact-item-2',
    })

    let id = 0
    const history = new ConversationHistoryForkRepository(db, () => `compact-id-${++id}`)
    const result = await history.forkThrough(source.id, {
      operationID: 'compact-fork',
      throughTurnID: 'compact-turn-2',
      sourceItemID: 'compact-item-2',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'main' },
      visible: false,
    })

    const targetTurns = db.sqlite
      .query('SELECT id FROM turns WHERE thread_id = ?')
      .all(result.targetThreadID) as Array<{ id: string }>
    expect(targetTurns).toHaveLength(2)
    const copiedBoundaries = db.sqlite
      .query(
        `SELECT turn_id FROM turn_pi_boundaries WHERE turn_id IN (${targetTurns.map(() => '?').join(',')})`,
      )
      .all(...targetTurns.map((turn) => turn.id)) as Array<{ turn_id: string }>
    // 只有目标 Pi 会话真实保留的边界会被写回，压缩前的 turn 边界被跳过而不是整笔失败。
    expect(copiedBoundaries).toHaveLength(1)
  })

  test('再次分支保存直接来源及当前边界，且回滚完整清理', async () => {
    const db = await database()
    const source = db.createThread('祖先任务')
    const sessions = new SqlitePiSessionRepo(db)
    const session = await sessions.create({
      id: 's-session',
      threadID: source.id,
      agentID: 's-agent-1',
    })
    await session.appendMessage({ role: 'user', content: 'question-1', timestamp: 1 })
    const entry1 = await session.appendMessage(assistant('answer-1', 2))
    ;(session.getStorage() as SqlitePiSessionStorage).flush()

    insertTurn(db, {
      threadID: source.id,
      turnID: 's-turn-1',
      agentID: 's-agent-1',
      sessionID: 's-session',
      itemID: 's-item-1',
      text: 'answer-1',
      createdAt: 10,
    })
    new TurnPiBoundaryRepository(db).upsert({
      turnID: 's-turn-1',
      sessionID: 's-session',
      entryID: entry1,
    })
    createOperation(db, {
      operationID: 'fork-op-1',
      threadID: source.id,
      turnID: 's-turn-1',
      itemID: 's-item-1',
    })

    let idCounter = 0
    const history = new ConversationHistoryForkRepository(db, () => `id-${++idCounter}`)
    const fork1 = await history.forkThrough(source.id, {
      operationID: 'fork-op-1',
      targetThreadID: 'fork-thread-1',
      throughTurnID: 's-turn-1',
      sourceItemID: 's-item-1',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'main' },
      visible: true,
    })

    const fork1Turn1 = fork1.turnIDs.get('s-turn-1')!
    expect(fork1Turn1).toBeDefined()
    const row1 = db.sqlite
      .query(
        'SELECT target_turn_id, source_thread_id, source_turn_id FROM thread_message_forks WHERE target_thread_id = ?',
      )
      .get('fork-thread-1') as {
      target_turn_id: string
      source_thread_id: string
      source_turn_id: string
    }
    expect(row1.target_turn_id).toBe(fork1Turn1)
    expect(row1.source_thread_id).toBe(source.id)

    // 在 fork 1 基础上追加一个新 turn
    const fork1Session = db.sqlite
      .query('SELECT session_id FROM agent_executions WHERE thread_id = ? AND turn_id = ?')
      .get('fork-thread-1', fork1Turn1) as { session_id: string }
    const openedSession = await sessions.openByID(fork1Session.session_id)
    await openedSession.appendMessage({ role: 'user', content: 'question-2', timestamp: 3 })
    const entry2 = await openedSession.appendMessage(assistant('answer-2', 4))
    ;(openedSession.getStorage() as SqlitePiSessionStorage).flush()

    insertTurn(db, {
      threadID: 'fork-thread-1',
      turnID: 'fork-1-turn-2',
      agentID: 'fork-1-agent-2',
      sessionID: fork1Session.session_id,
      itemID: 'fork-1-item-2',
      text: 'answer-2',
      createdAt: 30,
    })
    new TurnPiBoundaryRepository(db).upsert({
      turnID: 'fork-1-turn-2',
      sessionID: fork1Session.session_id,
      entryID: entry2,
    })
    createOperation(db, {
      operationID: 'fork-op-2',
      threadID: 'fork-thread-1',
      turnID: 'fork-1-turn-2',
      itemID: 'fork-1-item-2',
    })

    const fork2 = await history.forkThrough('fork-thread-1', {
      operationID: 'fork-op-2',
      targetThreadID: 'fork-thread-2',
      throughTurnID: 'fork-1-turn-2',
      sourceItemID: 'fork-1-item-2',
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'main' },
      visible: true,
    })

    const fork2Turn2 = fork2.turnIDs.get('fork-1-turn-2')!
    expect(fork2Turn2).toBeDefined()
    const fork2Rows = db.sqlite
      .query(
        'SELECT target_turn_id, source_thread_id, source_turn_id FROM thread_message_forks WHERE target_thread_id = ?',
      )
      .all('fork-thread-2') as Array<{
      target_turn_id: string
      source_thread_id: string
      source_turn_id: string
    }>
    // 仅有一行关系，指向直接来源 fork-thread-1，不继承祖先 source.id
    expect(fork2Rows).toHaveLength(1)
    expect(fork2Rows[0]?.source_thread_id).toBe('fork-thread-1')
    expect(fork2Rows[0]?.target_turn_id).toBe(fork2Turn2)
    expect(fork2Rows[0]?.source_turn_id).toBe('fork-1-turn-2')

    // 回滚测试：针对未发布的隐藏 target 进行 rollback
    const itemInFork2 = (
      db.sqlite
        .query('SELECT id FROM items WHERE thread_id = ? AND turn_id = ?')
        .get('fork-thread-2', fork2Turn2) as { id: string } | null
    )?.id
    if (!itemInFork2) throw new Error('missing itemInFork2')
    createOperation(db, {
      operationID: 'fork-op-rollback',
      threadID: 'fork-thread-2',
      turnID: fork2Turn2,
      itemID: itemInFork2,
    })
    const hiddenFork = await history.forkThrough('fork-thread-2', {
      operationID: 'fork-op-rollback',
      targetThreadID: 'hidden-target',
      throughTurnID: fork2Turn2,
      sourceItemID: itemInFork2,
      targetWorkspace: { cwd: 'C:\\repo', roots: '[]', gitBranch: 'main' },
      visible: false,
    })
    expect(hiddenFork.targetThreadID).toBe('hidden-target')
    expect(db.sqlite.query("SELECT id FROM threads WHERE id = 'hidden-target'").get()).not.toBeNull()
    expect(history.rollback('fork-op-rollback')).toBe(true)
    expect(db.sqlite.query("SELECT id FROM threads WHERE id = 'hidden-target'").get()).toBeNull()
    expect(
      db.sqlite
        .query("SELECT * FROM thread_message_forks WHERE target_thread_id = 'hidden-target'")
        .get(),
    ).toBeNull()
  })
})

describe('PiEventAdapter turn boundary', () => {
  test('只给最终 result Assistant 回传已写入 session 的 entry ID', async () => {
    const completed: Array<{ placement: string; sessionEntryID?: string }> = []
    const adapter = new PiEventAdapter(
      { threadID: 'thread', turnID: 'turn', agentID: 'agent' },
      {
        assistantMessageCompleted: (_context, input) => {
          completed.push(input)
        },
      },
      { resolveSessionEntryID: () => 'assistant-entry' },
    )
    await adapter.handle({ type: 'message_end', message: assistant('done', 1) })
    expect(
      completed.map(({ placement, sessionEntryID }) => ({ placement, sessionEntryID })),
    ).toEqual([{ placement: 'result', sessionEntryID: 'assistant-entry' }])
  })
})
