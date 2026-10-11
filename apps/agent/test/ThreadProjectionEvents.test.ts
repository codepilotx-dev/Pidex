import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import {
  decodeEventEnvelope,
  RpcMethods,
  type EventEnvelope as WireEventEnvelope,
} from '@pidex/agent-protocol'
import { Model, Provider } from '@pidex/model-schema'
import type { EventEnvelope } from '../src/Domain'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { buildEventNextNotification } from '../src/transport/EventEnvelope'
import { ThreadHistoryService } from '../src/session/ThreadHistoryService'
import { ThreadProjection } from '../src/transport/ThreadProjection'
import { SubagentRepository } from '../src/subagent/SubagentRepository'
import { interactionQuestions } from '../src/session/QuestionInput'
import { ThreadReadViewRepository } from '../src/session/ThreadReadViewRepository'

const roots: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const db of databases.splice(0)) db.close()
  await removeFixturePaths(roots.splice(0))
})

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-v4-events-'))
  roots.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  databases.push(db)
  const hub = await Effect.runPromise(EventHub.make)
  const projection = new ThreadProjection(db)
  const history = new ThreadHistoryService(db, hub)
  return { root, db, hub, projection, history }
}

const model = Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
const permission = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'auto_review',
} as const

const decodeFromStorage = (
  event: EventEnvelope,
  projection: ThreadProjection,
): WireEventEnvelope => {
  const notification = buildEventNextNotification({
    subscriptionId: 'sub-test',
    streamId: 'thread',
    event,
    projection,
  })
  expect(notification).not.toBeNull()
  return decodeEventEnvelope(notification!.params.event)
}

const seedTurn = (db: AgentDatabase, threadID: string) => {
  const created = db.createTurn(threadID, {
    content: '请帮我检查实现',
    model,
    permissionConfig: permission,
    strategy: 'queue',
    taskMode: 'chat',
  })
  return {
    ...created,
    input: {
      content: '请帮我检查实现',
      model,
      permissionConfig: permission,
      strategy: 'queue' as const,
      taskMode: 'chat' as const,
      id: created.inputID,
    },
  }
}

describe('v4 会话事件投影契约', () => {
  test.each([false, true])(
    '真实提问历史严格编码保留完整问题（缺省答题数量：%s）',
    async (omitLimits) => {
      const { db } = await fixture()
      const thread = db.createThread()
      const turn = seedTurn(db, thread.id)
      db.startTurnExecution(turn.turnID, { ...turn.input, id: turn.inputID })
      const agent = db.agentForTurn(turn.turnID)!
      const generated = interactionQuestions(
        ['scope', 'format', 'selection'].map((id) => ({
          id,
          header: id,
          question: `Choose ${id}`,
          multiSelect: id === 'selection',
          options: [
            { label: 'A', description: '第一项说明' },
            { label: 'B', description: '第二项说明' },
          ],
        })),
      )
      const questions = omitLimits
        ? generated.map(({ minAnswers: _min, maxAnswers: _max, ...question }) => question)
        : generated
      const { question } = db.createResumableQuestion({
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: agent.id,
        toolCallID: 'call-history',
        payload: { questions, question: questions[0]!.prompt, options: ['A', 'B'] },
        payloadVersion: 2,
        checkpoint: { payload: { state: '', interruption: null }, version: 1 },
      })
      const definition = RpcMethods['thread/history/read']
      expect(definition.exactResult).toBe(true)
      const page = new ThreadReadViewRepository(db).history(thread.id, { limit: 10 })
      const encoded = Schema.encodeSync(definition.result, { onExcessProperty: 'error' })(page)
      const decoded = Schema.decodeUnknownSync(definition.result)(encoded)
      const items = decoded.turns
        .flatMap((turn) => turn.items)
        .filter((item) => item.type === 'question')
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({
        id: question.id,
        status: 'pending',
        questions,
        toolCallId: 'call-history',
      })
    },
  )

  test('问题组实时事件与历史保留同一交互、原始问题和答案', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    db.startTurnExecution(turn.turnID, { ...turn.input, id: turn.inputID })
    const agent = db.agentForTurn(turn.turnID)!
    const questions = ['scope', 'format', 'selection'].map((id) => ({
      id,
      header: id,
      prompt: `Choose ${id}`,
      choices: ['a', 'b'].map((choice) => ({
        id: choice,
        label: choice,
        description: choice,
        recommended: choice === 'a',
      })),
      allowFreeform: true,
      required: true,
    }))
    const { question, events } = db.createResumableQuestion({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: agent.id,
      toolCallID: 'call-group',
      payload: { questions, question: questions[0]!.prompt, options: ['a', 'b'] },
      payloadVersion: 2,
      checkpoint: { payload: { state: '', interruption: null }, version: 1 },
    })
    const wire = decodeFromStorage(
      events.find((event) => event.method === 'question/requested')!,
      projection,
    )
    expect(wire.payload).toMatchObject({
      interactionId: question.id,
      questions,
      toolCallId: 'call-group',
    })
    const projected = () =>
      projection.snapshot(thread.id)!.items.filter((item) => item.type === 'question')
    expect(projected()).toHaveLength(1)
    expect(projected()[0]).toMatchObject({
      id: question.id,
      questions,
      toolCallId: 'call-group',
      status: 'pending',
    })
    const answers = questions.map((entry) => ({ questionId: entry.id, choiceIds: ['b'] }))
    db.resolveResumableQuestion(question.id, { resolution: 'user', answers })
    expect(projected()[0]).toMatchObject({
      id: question.id,
      questions,
      answers,
      status: 'answered',
      answer: 'b',
    })
    const item = db.getItem(question.id)!
    const { toolCallId: _toolCallId, ...historicalData } = item.data
    db.upsertItem(thread.id, { ...item, data: historicalData })
    expect(projected()[0]).toMatchObject({ toolCallId: 'call-group', questions, answers })
    db.upsertItem(thread.id, { ...item, data: { ...item.data, ignored: true } })
    expect(projected()[0]).toMatchObject({ status: 'ignored' })
    db.upsertItem(thread.id, { ...item, status: 'interrupted' })
    expect(projected()[0]).toMatchObject({ status: 'cancelled' })
  })
  test('列表和详情从创建来源、运行绑定与分叉关系投影独立标记', async () => {
    const { db, projection, history } = await fixture()
    const source = db.createThread()
    const scheduled = db.createThread({ operationID: 'automation-run:one-time:thread' })
    const recurring = db.createThread({ operationID: 'automation-run:recurring:thread' })
    const fork = db.createThread()
    const messageFork = db.createThread()
    const child = db.createThread()
    db.sqlite
      .query("UPDATE threads SET kind = 'subagent', parent_thread_id = ? WHERE id = ?")
      .run(source.id, child.id)
    const assertMarkers = (
      id: string,
      hasScheduledRun: boolean,
      isFork: boolean,
      isScheduledSession = false,
    ) => {
      const expected = { hasScheduledRun, isFork, isScheduledSession }
      expect(projection.snapshot(id)?.thread).toMatchObject(expected)
      expect(history.getListItem(id)).toMatchObject(expected)
      expect(history.markUnread(id, 100)).toMatchObject({ ...expected, unreadAt: 100 })
      expect(history.markRead(id, 100)).toMatchObject({ ...expected, unreadAt: null })
      if (id !== child.id)
        expect(projection.list().find((thread) => thread.id === id)).toMatchObject(expected)
    }
    assertMarkers(source.id, false, false)
    assertMarkers(child.id, false, false)
    assertMarkers(scheduled.id, false, false, true)
    assertMarkers(recurring.id, false, false, true)

    db.sqlite
      .query(
        `INSERT INTO scheduled_tasks (
      id, operation_id, kind, name, prompt, status, target_thread_id, model_ref,
      permission_config, scheduled_for, time_zone, notification_policy, created_at, updated_at
    ) VALUES ('schedule', 'schedule', 'thread', 'schedule', 'run', 'scheduled', ?, '{}', '{}', 1, 'UTC', 'all', 1, 1)`,
      )
      .run(source.id)
    assertMarkers(source.id, false, false)
    db.sqlite
      .query("UPDATE scheduled_tasks SET thread_id = ?, status = 'completed' WHERE id = 'schedule'")
      .run(scheduled.id)
    assertMarkers(scheduled.id, true, false, true)
    // An existing conversation gains the same marker when a task actually binds to it.
    db.sqlite.query("UPDATE scheduled_tasks SET thread_id = ? WHERE id = 'schedule'").run(source.id)
    assertMarkers(source.id, true, false)

    db.sqlite
      .query(
        `INSERT INTO thread_handoff_operations (
      operation_id, source_thread_id, target_thread_id, direction, request_hash, status, step, created_at, updated_at
    ) VALUES ('handoff', ?, ?, 'local-to-worktree', 'hash', 'completed', 'complete', 1, 1)`,
      )
      .run(source.id, fork.id)
    db.sqlite
      .query(
        "INSERT INTO thread_forks (target_thread_id, source_thread_id, operation_id, created_at) VALUES (?, ?, 'handoff', 1)",
      )
      .run(fork.id, source.id)
    assertMarkers(fork.id, false, true)

    const turn = seedTurn(db, source.id)
    db.sqlite
      .query(
        `INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at)
      VALUES ('fork-point', ?, ?, ?, 'text', 'completed', '{"text":"done","placement":"result"}', 0, 1, 1)`,
      )
      .run(source.id, turn.turnID, turn.agentID)
    db.sqlite
      .query(
        `INSERT INTO thread_message_fork_operations (
      operation_id, source_thread_id, source_turn_id, source_item_id, target_thread_id,
      destination_kind, request_hash, status, step, created_at, updated_at
    ) VALUES ('message-fork', ?, ?, 'fork-point', ?, 'same-worktree', 'hash', 'completed', 'complete', 1, 1)`,
      )
      .run(source.id, turn.turnID, messageFork.id)
    db.sqlite
      .query(
        `INSERT INTO thread_message_forks (target_thread_id, source_thread_id, source_turn_id, source_item_id, operation_id, created_at)
      VALUES (?, ?, ?, 'fork-point', 'message-fork', 1)`,
      )
      .run(messageFork.id, source.id, turn.turnID)
    assertMarkers(messageFork.id, false, true)

    db.sqlite
      .query(
        `INSERT INTO automations (
      id, kind, name, prompt, status, model_ref, permission_config, schedule, canonical_rrule,
      time_zone, notification_policy, created_at, updated_at
    ) VALUES ('automation', 'thread', 'automation', 'run', 'deleted', '{}', '{}', '{}', 'FREQ=DAILY', 'UTC', 'all', 1, 1)`,
      )
      .run()
    db.sqlite
      .query(
        `INSERT INTO automation_runs (
      id, automation_id, operation_id, trigger, scheduled_for, status, thread_id, created_at
    ) VALUES ('run', 'automation', 'run', 'manual', 1, 'completed', ?, 1)`,
      )
      .run(messageFork.id)
    assertMarkers(messageFork.id, true, true)
    db.sqlite.query("UPDATE automation_runs SET thread_id = ? WHERE id = 'run'").run(recurring.id)
    assertMarkers(recurring.id, true, false, true)
    assertMarkers(fork.id, false, true)
    assertMarkers(child.id, false, false)
  })

  test('thread/updated 把内部 patch 形状投影成完整 Thread + version', async () => {
    const { db, history, projection } = await fixture()
    const thread = db.createThread()
    seedTurn(db, thread.id)
    const cursor = db.eventsAfter(0).at(-1)?.id ?? 0
    const updated = await history.patch(thread.id, { title: '修复事件投影' })

    const stored = db.eventsAfter(cursor).at(-1)
    expect(stored?.method).toBe('thread/updated')

    const wire = decodeFromStorage(stored!, projection)
    expect(wire.type).toBe('thread/updated')
    expect(wire.version).toBe(1)
    expect(wire.payload).toMatchObject({
      thread: {
        id: thread.id,
        title: '修复事件投影',
        projectID: null,
        gitBranch: null,
        settings: {
          taskMode: 'chat',
          permissionConfig: permission,
        },
      },
      version: updated.updatedAt,
    })
  })

  test('agent/upserted 把内部大写 ID agent 投影成协议 camelCase 字段', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)

    const stored = db.eventsAfter(0).find((event) => event.method === 'agent/upserted')
    expect(stored).toBeDefined()

    const wire = decodeFromStorage(stored!, projection)
    expect(wire.type).toBe('agent/upserted')
    expect(wire.payload).toMatchObject({
      agent: {
        id: turn.agentID,
        threadId: thread.id,
        turnId: turn.turnID,
        parentAgentId: null,
        profile: 'main',
        task: '请帮我检查实现',
        model: { providerID: 'openai', id: 'gpt-5' },
        sessionId: `${thread.id}:main`,
        depth: 0,
        status: 'queued',
        error: null,
        subagentRunId: null,
        runSequence: 0,
      },
    })
  })

  test.each([
    ['waiting_subagents', 'waiting-subagents'],
    ['waiting_question', 'waiting-question'],
    ['waiting_permission', 'waiting-permission'],
  ] as const)('agent/upserted 内部 %s 状态规范化为 wire %s', async (internalStatus, wireStatus) => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)

    db.updateAgentStatus(turn.agentID, internalStatus, 'test')
    const stored = db.insertEvent(thread.id, turn.turnID, 'agent/upserted', {
      agent: db.getAgentExecution(turn.agentID),
    })

    const wire = decodeFromStorage(stored, projection)
    expect(wire.type).toBe('agent/upserted')
    expect((wire.payload as { agent: { status: string } }).agent.status).toBe(wireStatus)
  })

  test('turn/queued 投影成完整 Turn + Input 且保留事件 id/threadId/turnId 顺序', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)

    const events = db.eventsAfter(0)
    const queued = events.find((event) => event.method === 'turn/queued')!
    const wire = decodeFromStorage(queued, projection)
    expect(wire.type).toBe('turn/queued')
    expect(wire.eventId).toBe(String(queued.id))
    expect(wire.threadId).toBe(thread.id)
    expect(wire.turnId).toBe(turn.turnID)
    expect(wire.payload).toMatchObject({
      turn: {
        id: turn.turnID,
        threadId: thread.id,
        status: 'queued',
        mode: 'chat',
        permissionConfig: permission,
        model: { providerID: 'openai', id: 'gpt-5' },
        rootAgentId: turn.agentID,
      },
      input: {
        id: turn.inputID,
        threadId: thread.id,
        turnId: turn.turnID,
        delivery: 'follow-up',
        mode: 'chat',
        permissionConfig: permission,
        state: 'queued',
      },
    })
  })

  test('turn/started 投影出 running 状态 Turn + Input', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    db.startTurnExecution(turn.turnID, { ...turn.input, id: turn.inputID })

    const started = db.eventsAfter(0).find((event) => event.method === 'turn/started')!
    const wire = decodeFromStorage(started, projection)
    expect(wire.type).toBe('turn/started')
    expect(wire.payload).toMatchObject({
      turn: { id: turn.turnID, status: 'running' },
      input: { id: turn.inputID, state: 'active' },
    })
  })

  test('turn/completed 投影为终态 Turn 并保留完成事件', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    db.startTurnExecution(turn.turnID, { ...turn.input, id: turn.inputID })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })

    const completed = db.eventsAfter(0).find((event) => event.method === 'turn/completed')!
    const wire = decodeFromStorage(completed, projection)
    expect(wire.type).toBe('turn/completed')
    expect(wire.payload).toMatchObject({
      turn: { id: turn.turnID, status: 'completed' },
    })
  })

  test('StoredItem 经 item 投影后保持 turnId/agentId camelCase 且 wire 可解码', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    const timestamp = Date.now()
    db.upsertItem(thread.id, {
      id: 'text-result',
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'text',
      status: 'completed',
      data: { placement: 'result', text: '已修复' },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    db.upsertItemWithEvent(
      thread.id,
      {
        id: 'text-result',
        turnID: turn.turnID,
        agentID: turn.agentID,
        type: 'text',
        status: 'completed',
        data: { placement: 'result', text: '已修复' },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      'item/completed',
    )

    const completed = db.eventsAfter(0).find((event) => event.method === 'item/completed')!
    const wire = decodeFromStorage(completed, projection)
    expect(wire.type).toBe('item/completed')
    expect(wire.payload).toMatchObject({
      item: {
        id: 'text-result',
        type: 'text',
        placement: 'result',
        text: '已修复',
        status: 'completed',
        turnId: turn.turnID,
        agentId: turn.agentID,
      },
    })
  })

  test('旧 ToolItem 历史缺少 activity 时使用统一分类器兼容投影', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    const timestamp = Date.now()
    const item = projection.item({
      id: 'legacy-read',
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'tool',
      status: 'completed',
      data: {
        callID: 'legacy-read',
        tool: 'Read',
        input: { file_path: 'src/legacy.ts' },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(item).toMatchObject({
      type: 'tool',
      activity: {
        type: 'read',
        subject: 'file',
        target: { displayLabel: 'legacy.ts' },
      },
    })
  })

  test('subagent/created 把内部 task/run 投影成 projection.task + projection.currentRun', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const root = seedTurn(db, thread.id)
    const repository = new SubagentRepository(db)
    const created = repository.create({
      parentThreadID: thread.id,
      parentTurnID: root.turnID,
      parentAgentID: root.agentID,
      displayName: 'Explorer',
      profile: 'explorer',
      task: '审阅实现',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: join(thread.id, 'workspace'),
    })

    const stored = db.eventsAfter(0).find((event) => event.method === 'subagent/created')!
    const wire = decodeFromStorage(stored, projection)
    expect(wire.type).toBe('subagent/created')
    expect(wire.payload).toMatchObject({
      projection: {
        task: {
          id: created.task.id,
          parentThreadId: thread.id,
          parentTurnId: root.turnID,
          parentAgentId: root.agentID,
          childThreadId: created.task.childThreadId,
          displayName: 'Explorer',
          profile: 'explorer',
          task: '审阅实现',
        },
        currentRun: {
          id: created.run.id,
          taskId: created.task.id,
          status: 'queued',
        },
      },
    })
  })

  test('agent/upserted 旧 queued 事件在 Agent settled 后回放仍是 queued', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    const queuedEvent = db.eventsAfter(0).find((event) => event.method === 'agent/upserted')
    expect(queuedEvent).toBeDefined()

    db.updateAgentStatus(turn.agentID, 'completed', 'settled by recovery')
    db.sqlite
      .query('UPDATE agent_executions SET updated_at = ? WHERE id = ?')
      .run(Date.now() + 100, turn.agentID)

    const queuedWire = decodeFromStorage(queuedEvent!, projection)
    expect(queuedWire.type).toBe('agent/upserted')
    expect(
      (queuedWire.payload as { agent: { status: string; updatedAt: number } }).agent.status,
    ).toBe('queued')
    expect((queuedWire.payload as { agent: { updatedAt: number } }).agent.updatedAt).toBeLessThan(
      Date.now() + 100,
    )

    db.insertEvent(thread.id, turn.turnID, 'agent/upserted', {
      agent: db.getAgentExecution(turn.agentID),
    })
    const later = db
      .eventsAfter(0)
      .filter((event) => event.method === 'agent/upserted')
      .at(-1)!
    const laterWire = decodeFromStorage(later, projection)
    expect((laterWire.payload as { agent: { status: string } }).agent.status).toBe('completed')
  })

  test('subagent/created 旧 queued 事件在 Run 进入 running 后回放仍是 queued', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const root = seedTurn(db, thread.id)
    const repository = new SubagentRepository(db)
    const created = repository.create({
      parentThreadID: thread.id,
      parentTurnID: root.turnID,
      parentAgentID: root.agentID,
      displayName: 'Explorer',
      profile: 'explorer',
      task: '审阅实现',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: join(thread.id, 'workspace'),
    })

    const createdEvent = db.eventsAfter(0).find((event) => event.method === 'subagent/created')
    expect(createdEvent).toBeDefined()

    repository.claim(created.run.id)
    db.insertEvent(thread.id, root.turnID, 'subagent/updated', {
      task: repository.task(created.task.id),
      run: repository.run(created.run.id),
    })

    const replayed = decodeFromStorage(createdEvent!, projection)
    expect(replayed.type).toBe('subagent/created')
    const replayedRun = (
      replayed.payload as { projection: { currentRun: { status: string } | null } }
    ).projection.currentRun
    expect(replayedRun?.status).toBe('queued')

    const updatedEvent = db
      .eventsAfter(0)
      .filter((event) => event.method === 'subagent/updated')
      .at(-1)!
    const updatedWire = decodeFromStorage(updatedEvent, projection)
    expect(
      (updatedWire.payload as { projection: { currentRun: { status: string } | null } }).projection
        .currentRun?.status,
    ).toBe('running')
  })

  test('subagent/workspaceUpdated 仅凭 taskId 重建 projection 并可 wire 解码', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const root = seedTurn(db, thread.id)
    const repository = new SubagentRepository(db)
    const created = repository.create({
      parentThreadID: thread.id,
      parentTurnID: root.turnID,
      parentAgentID: root.agentID,
      displayName: 'Explorer',
      profile: 'explorer',
      task: '审阅实现',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: join(thread.id, 'workspace'),
    })

    const stored = db.insertEvent(thread.id, root.turnID, 'subagent/workspaceUpdated', {
      taskId: created.task.id,
      workspace: created.task.workspace,
      result: {
        outcome: 'succeeded',
        summary: '已应用',
        findings: [],
        changedFiles: [],
        validation: [],
        risks: [],
        references: [],
      },
    })

    const wire = decodeFromStorage(stored, projection)
    expect(wire.type).toBe('subagent/workspaceUpdated')
    expect(wire.payload).toMatchObject({
      projection: {
        task: { id: created.task.id, parentThreadId: thread.id },
        currentRun: { id: created.run.id, status: 'queued' },
      },
    })
  })

  test('eventsAfter 顺序与 id 单调与回放保持一致', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    seedTurn(db, thread.id)
    const events = db.eventsAfter(0)
    const ids = events.map((event) => event.id)
    const sorted = [...ids].sort((a, b) => a - b)
    expect(ids).toEqual(sorted)

    for (const event of events) {
      expect(() => decodeFromStorage(event, projection)).not.toThrow()
    }
  })

  test('turn/statusChanged 仅保留协议字段并补充 changedAt', async () => {
    const { db, projection } = await fixture()
    const stored = db.insertEvent('thread-1', 'turn-1', 'turn/statusChanged', {
      turnId: 'turn-1',
      rootAgentId: 'agent-1',
      status: 'waiting-subagents',
      runIds: ['run-1', 'run-2'],
      mode: 'all',
    })

    const wire = decodeFromStorage(stored, projection)
    expect(wire.type).toBe('turn/statusChanged')
    expect(wire.payload).toEqual({
      turnId: 'turn-1',
      status: 'waiting-subagents',
      changedAt: stored.createdAt,
    })
  })

  test('建表驱动验证已发布 v4 method 都能 wire 解码', async () => {
    const { db, projection } = await fixture()
    const thread = db.createThread()
    const turn = seedTurn(db, thread.id)
    db.startTurnExecution(turn.turnID, { ...turn.input, id: turn.inputID })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })
    await new ThreadHistoryService(db, await Effect.runPromise(EventHub.make)).patch(thread.id, {
      title: '新增标题',
    })
    const repository = new SubagentRepository(db)
    repository.create({
      parentThreadID: thread.id,
      parentTurnID: turn.turnID,
      parentAgentID: turn.agentID,
      displayName: 'Worker',
      profile: 'worker',
      task: '完成后续任务',
      model,
      permissionCeiling: permission,
      workspaceMode: 'shared',
      workspaceRoot: join(thread.id, 'workspace'),
    })
    const methods = new Set(db.eventsAfter(0).map((event) => event.method))
    const expected = [
      'thread/created',
      'turn/queued',
      'agent/upserted',
      'turn/started',
      'turn/completed',
      'thread/updated',
      'subagent/created',
    ]
    for (const method of expected) expect(methods.has(method)).toBe(true)
    for (const event of db.eventsAfter(0)) {
      expect(() => decodeFromStorage(event, projection)).not.toThrow()
    }
  })

  test('creationSurface 在 create/list/snapshot 及事件投影中端到端透传', async () => {
    const { db, projection } = await fixture()
    const threadWork = db.createThread({ title: 'Working session', creationSurface: 'working' })
    const threadChat = db.createThread({ title: 'Chat session', creationSurface: 'chat' })
    const threadCoding = db.createThread({ title: 'Coding session', creationSurface: 'coding' })
    const threadLegacy = db.createThread({ title: 'Legacy session' })

    // snapshot 投影
    const snapWork = projection.snapshot(threadWork.id)
    expect(snapWork?.thread.creationSurface).toBe('working')
    const snapChat = projection.snapshot(threadChat.id)
    expect(snapChat?.thread.creationSurface).toBe('chat')
    const snapCoding = projection.snapshot(threadCoding.id)
    expect(snapCoding?.thread.creationSurface).toBe('coding')
    const snapLegacy = projection.snapshot(threadLegacy.id)
    expect(snapLegacy?.thread.creationSurface).toBeUndefined()

    // list 投影
    const list = projection.list()
    const itemWork = list.find((t) => t.id === threadWork.id)
    expect(itemWork?.creationSurface).toBe('working')
    const itemChat = list.find((t) => t.id === threadChat.id)
    expect(itemChat?.creationSurface).toBe('chat')
    const itemLegacy = list.find((t) => t.id === threadLegacy.id)
    expect(itemLegacy?.creationSurface).toBeUndefined()
  })
})
