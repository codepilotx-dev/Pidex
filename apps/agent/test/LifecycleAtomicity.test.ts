import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Model, Provider } from '@pidex/model-schema'
import { removeFixturePaths } from './FixtureCleanup'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { recoverInterruptedRuns } from '../src/storage/recovery/InterruptedRunRecovery'

const paths: string[] = []
const databases: AgentDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await removeFixturePaths(paths.splice(0))
})

const input = {
  content: '执行任务',
  model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('test') }),
  permissionConfig: {
    sandboxMode: 'workspace-write',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
  },
  strategy: 'queue',
  taskMode: 'chat',
} as const

describe('Turn 生命周期事务', () => {
  test('start outbox 失败时不留下 running 状态', () => {
    const path = join(tmpdir(), `pidex-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.sqlite.exec(
      `CREATE TRIGGER fail_turn_started BEFORE INSERT ON events WHEN NEW.method = 'turn/started' BEGIN SELECT RAISE(ABORT, 'start outbox unavailable'); END`,
    )

    expect(() => db.startTurnExecution(turn.turnID, { ...input, id: turn.inputID })).toThrow(
      'start outbox unavailable',
    )
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'queued',
    })
    expect(
      db.sqlite.query('SELECT status FROM agent_executions WHERE id = ?').get(turn.agentID),
    ).toEqual({ status: 'queued' })
  })

  test('terminal outbox 失败时状态、checkpoint 和队列一起回滚', () => {
    const path = join(tmpdir(), `pidex-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    db.saveAgentTurnCheckpoint({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      state: 'ready',
      payload: { marker: true },
      version: 1,
    })
    db.sqlite.exec(
      `CREATE TRIGGER fail_turn_completed BEFORE INSERT ON events WHEN NEW.method = 'turn/completed' BEGIN SELECT RAISE(ABORT, 'terminal outbox unavailable'); END`,
    )

    expect(() =>
      db.finalizeTurn({
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        status: 'completed',
      }),
    ).toThrow('terminal outbox unavailable')
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(turn.turnID)).toEqual({
      status: 'running',
    })
    expect(
      db.sqlite.query('SELECT status FROM agent_executions WHERE id = ?').get(turn.agentID),
    ).toEqual({ status: 'running' })
    expect(db.getAgentTurnCheckpoint(turn.turnID)).not.toBeNull()
    expect(
      db.sqlite.query('SELECT * FROM thread_read_state WHERE thread_id = ?').get(thread.id),
    ).toBeNull()
  })

  test('完成和失败标记未读，中断不标记且 read-through 不清除更新标记', () => {
    const path = join(tmpdir(), `pidex-unread-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)

    const completedThread = db.createThread('完成')
    const completed = db.createTurn(completedThread.id, input)
    db.claimTurnExecution(completed.turnID)
    db.finalizeTurn({
      threadID: completedThread.id,
      turnID: completed.turnID,
      agentID: completed.agentID,
      status: 'completed',
    })
    const completedUnreadAt = (
      db.sqlite
        .query('SELECT unread_at FROM thread_read_state WHERE thread_id = ?')
        .get(completedThread.id) as { unread_at: number }
    ).unread_at
    expect(completedUnreadAt).toBeGreaterThan(0)

    db.markThreadReadThrough(completedThread.id, completedUnreadAt)
    expect(
      db.sqlite
        .query('SELECT unread_at FROM thread_read_state WHERE thread_id = ?')
        .get(completedThread.id),
    ).toEqual({ unread_at: null })

    const laterUnreadAt = completedUnreadAt + 10
    db.markThreadUnread(completedThread.id, laterUnreadAt)
    db.markThreadReadThrough(completedThread.id, completedUnreadAt)
    expect(
      db.sqlite
        .query('SELECT unread_at FROM thread_read_state WHERE thread_id = ?')
        .get(completedThread.id),
    ).toEqual({ unread_at: laterUnreadAt })

    const failedThread = db.createThread('失败')
    const failed = db.createTurn(failedThread.id, input)
    db.claimTurnExecution(failed.turnID)
    db.finalizeTurn({
      threadID: failedThread.id,
      turnID: failed.turnID,
      agentID: failed.agentID,
      status: 'failed',
    })
    expect(
      (
        db.sqlite
          .query('SELECT unread_at FROM thread_read_state WHERE thread_id = ?')
          .get(failedThread.id) as { unread_at: number }
      ).unread_at,
    ).toBeGreaterThan(0)

    const interruptedThread = db.createThread('中断')
    const interrupted = db.createTurn(interruptedThread.id, input)
    db.claimTurnExecution(interrupted.turnID)
    db.finalizeTurn({
      threadID: interruptedThread.id,
      turnID: interrupted.turnID,
      agentID: interrupted.agentID,
      status: 'interrupted',
    })
    expect(
      db.sqlite
        .query('SELECT * FROM thread_read_state WHERE thread_id = ?')
        .get(interruptedThread.id),
    ).toBeNull()
  })

  test('interrupt outbox 失败时 claimed/resuming checkpoint 不会被提前消费', () => {
    const path = join(tmpdir(), `pidex-interrupt-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    db.saveAgentTurnCheckpoint({
      agentID: turn.agentID,
      turnID: turn.turnID,
      threadID: thread.id,
      state: 'ready',
      payload: {},
      version: 1,
    })
    db.sqlite
      .query(
        `
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at)
      VALUES ('claimed', ?, ?, ?, 'tool', 'high', 'test', 'claimed', 'allow', '{}', ?)
    `,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.sqlite
      .query(
        `
      INSERT INTO question_requests
        (id, thread_id, turn_id, agent_id, payload, payload_version, status, answer, created_at)
      VALUES ('resuming', ?, ?, ?, '{}', 1, 'resuming', '{"value":"A"}', ?)
    `,
      )
      .run(thread.id, turn.turnID, turn.agentID, Date.now())
    db.sqlite.exec(
      `CREATE TRIGGER fail_turn_interrupted BEFORE INSERT ON events WHEN NEW.method = 'turn/interrupted' BEGIN SELECT RAISE(ABORT, 'interrupt outbox unavailable'); END`,
    )

    expect(() =>
      db.finalizeTurn({
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        status: 'interrupted',
      }),
    ).toThrow('interrupt outbox unavailable')
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'claimed'").get(),
    ).toEqual({ status: 'claimed' })
    expect(
      db.sqlite.query("SELECT status FROM question_requests WHERE id = 'resuming'").get(),
    ).toEqual({ status: 'resuming' })
    expect(db.getAgentTurnCheckpoint(turn.turnID)).not.toBeNull()
  })

  test('execution plan 快照、终态与 outbox 保持原子和有序', () => {
    const path = join(tmpdir(), `pidex-plan-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    databases.push(db)
    const thread = db.createThread()
    const turn = db.createTurn(thread.id, input)
    db.claimTurnExecution(turn.turnID)
    db.sqlite.exec(
      `CREATE TRIGGER fail_plan_updated BEFORE INSERT ON events WHEN NEW.method = 'turn/plan/updated' BEGIN SELECT RAISE(ABORT, 'plan update outbox unavailable'); END`,
    )
    expect(() =>
      db.updateExecutionPlan({
        threadID: thread.id,
        turnID: turn.turnID,
        agentID: turn.agentID,
        explanation: '准备执行',
        plan: [{ step: '实现', status: 'in_progress' }],
      }),
    ).toThrow('plan update outbox unavailable')
    expect(db.getItem(`${turn.turnID}:execution-plan`)).toBeNull()
    db.sqlite.exec('DROP TRIGGER fail_plan_updated')

    db.updateExecutionPlan({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      explanation: '准备执行',
      plan: [{ step: '实现', status: 'in_progress' }],
    })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: turn.turnID,
      agentID: turn.agentID,
      status: 'completed',
    })
    expect(db.getItem(`${turn.turnID}:execution-plan`)?.status).toBe('completed')
    const events = db.sqlite
      .query(
        "SELECT method FROM events WHERE turn_id = ? AND method IN ('item/completed', 'turn/completed') ORDER BY id",
      )
      .all(turn.turnID) as Array<{ method: string }>
    expect(events.map(({ method }) => method)).toEqual(['item/completed', 'turn/completed'])

    const interrupted = db.createTurn(thread.id, { ...input, content: '中断' })
    db.claimTurnExecution(interrupted.turnID)
    db.updateExecutionPlan({
      threadID: thread.id,
      turnID: interrupted.turnID,
      agentID: interrupted.agentID,
      plan: [{ step: '未完成', status: 'in_progress' }],
    })
    db.finalizeTurn({
      threadID: thread.id,
      turnID: interrupted.turnID,
      agentID: interrupted.agentID,
      status: 'interrupted',
    })
    expect(db.getItem(`${interrupted.turnID}:execution-plan`)?.status).toBe('interrupted')
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE turn_id = ? AND method = 'item/completed'")
        .get(interrupted.turnID),
    ).toEqual({ method: 'item/completed' })
  })

  test('重启中断写入 turn、agent、item 和 queue durable events 且只执行一次', () => {
    const path = join(tmpdir(), `pidex-lifecycle-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const thread = db.createThread()
    const active = db.createTurn(thread.id, input)
    db.claimTurnExecution(active.turnID)
    db.upsertItem(thread.id, {
      id: 'running-item',
      turnID: active.turnID,
      agentID: active.agentID,
      type: 'tool',
      status: 'running',
      data: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    db.sqlite
      .query(
        `
      INSERT INTO tool_calls
        (id, thread_id, turn_id, agent_id, tool_name, input, status, started_at)
      VALUES ('running-tool', ?, ?, ?, 'Shell', '{}', 'running', ?)
    `,
      )
      .run(thread.id, active.turnID, active.agentID, Date.now())
    db.createTurn(thread.id, { ...input, content: 'queued' })
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(active.turnID)).toEqual({
      status: 'interrupted',
    })
    const interruptedTool = db.sqlite
      .query("SELECT status, finished_at, error FROM tool_calls WHERE id = 'running-tool'")
      .get() as {
      status: string
      finished_at: number | null
      error: string | null
    }
    expect(interruptedTool).toEqual({
      status: 'interrupted',
      finished_at: expect.any(Number),
      error: 'Agent 重启时工具执行被中断',
    })
    for (const method of [
      'turn/interrupted',
      'agent/upserted',
      'item/completed',
      'queue/updated',
    ]) {
      expect(
        (
          db.sqlite
            .query(
              'SELECT COUNT(*) AS count FROM events WHERE method = ? AND (turn_id = ? OR thread_id = ?)',
            )
            .get(method, active.turnID, thread.id) as { count: number }
        ).count,
      ).toBeGreaterThan(0)
    }
    const count = (
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE method = 'turn/interrupted' AND turn_id = ?",
        )
        .get(active.turnID) as { count: number }
    ).count
    db.close()
    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(
      db.sqlite
        .query(
          "SELECT COUNT(*) AS count FROM events WHERE method = 'turn/interrupted' AND turn_id = ?",
        )
        .get(active.turnID),
    ).toEqual({ count })
    expect(
      db.sqlite
        .query("SELECT status, finished_at, error FROM tool_calls WHERE id = 'running-tool'")
        .get(),
    ).toEqual(interruptedTool)
  })

  test('重启会安全重开纯数据 checkpoint，并对运行中的审批副作用 fail-closed', () => {
    const path = join(tmpdir(), `pidex-claim-recovery-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    let db = new AgentDatabase(path)
    const thread = db.createThread()
    const questionTurn = db.createTurn(thread.id, input)
    db.claimTurnExecution(questionTurn.turnID)
    db.sqlite
      .query(
        `
      INSERT INTO question_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, payload, payload_version, status, answer, created_at, resolved_at)
      VALUES ('question-resuming', ?, ?, ?, 'question-tool', '{}', 1, 'resuming', '{"value":"A"}', ?, ?)
    `,
      )
      .run(thread.id, questionTurn.turnID, questionTurn.agentID, Date.now(), Date.now())

    const denyTurn = db.createTurn(thread.id, { ...input, content: 'deny' })
    db.claimTurnExecution(denyTurn.turnID)
    db.sqlite
      .query(
        `
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at, resolved_at)
      VALUES ('approval-deny', ?, ?, ?, 'deny-tool', 'high', 'deny', 'claimed', 'deny', '{}', ?, ?)
    `,
      )
      .run(thread.id, denyTurn.turnID, denyTurn.agentID, Date.now(), Date.now())

    const ambiguousTurn = db.createTurn(thread.id, { ...input, content: 'ambiguous' })
    db.claimTurnExecution(ambiguousTurn.turnID)
    db.sqlite
      .query(
        `
      INSERT INTO approval_requests
        (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, created_at, resolved_at)
      VALUES ('approval-running', ?, ?, ?, 'running-tool', 'high', 'allow', 'claimed', 'allow', '{}', ?, ?)
    `,
      )
      .run(thread.id, ambiguousTurn.turnID, ambiguousTurn.agentID, Date.now(), Date.now())
    db.sqlite
      .query(
        `
      INSERT INTO tool_calls
        (id, thread_id, turn_id, agent_id, tool_name, input, status, started_at)
      VALUES ('running-tool', ?, ?, ?, 'Shell', '{}', 'running', ?)
    `,
      )
      .run(thread.id, ambiguousTurn.turnID, ambiguousTurn.agentID, Date.now())
    db.close()

    db = new AgentDatabase(path)
    databases.push(db)
    recoverInterruptedRuns(db)
    expect(
      db.sqlite.query("SELECT status FROM question_requests WHERE id = 'question-resuming'").get(),
    ).toEqual({ status: 'resolved' })
    expect(
      db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(questionTurn.turnID),
    ).toEqual({ status: 'queued' })
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'approval-deny'").get(),
    ).toEqual({ status: 'resolved' })
    expect(db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(denyTurn.turnID)).toEqual({
      status: 'queued',
    })
    expect(
      db.sqlite.query("SELECT status FROM approval_requests WHERE id = 'approval-running'").get(),
    ).toEqual({ status: 'cancelled' })
    expect(
      db.sqlite.query('SELECT status FROM turns WHERE id = ?').get(ambiguousTurn.turnID),
    ).toEqual({ status: 'interrupted' })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
        .get(ambiguousTurn.turnID),
    ).toEqual({ method: 'approval/cancelled' })
    const cancelledEvent = db.sqlite
      .query("SELECT params FROM events WHERE method = 'approval/cancelled' AND turn_id = ?")
      .get(ambiguousTurn.turnID) as { params: string }
    expect(JSON.parse(cancelledEvent.params)).toEqual({
      interactionId: 'approval-running',
      reason: '审批后的工具执行结果不确定，已按 fail-closed 中断',
      cancelledAt: expect.any(Number),
    })
    expect(
      db.sqlite
        .query("SELECT method FROM events WHERE method = 'turn/interrupted' AND turn_id = ?")
        .get(ambiguousTurn.turnID),
    ).toEqual({ method: 'turn/interrupted' })
  })
})
