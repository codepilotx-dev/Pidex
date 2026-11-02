import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { GoalTurnClassifier } from '../src/session/GoalTurnClassifier'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

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

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-classify-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  const thread = db.createThread('进度分类')
  const goal = (
    await service.set({
      threadId: thread.id,
      objective: '完成一次真实交付',
      expectedVersion: null,
      operationId: 'create',
    })
  ).goal
  const classifier = new GoalTurnClassifier(db)
  return { db, service, thread, goal, classifier }
}

/** Writes one persisted tool item, the same shape the runtime records. */
const toolItem = (
  db: AgentDatabase,
  input: { threadId: string; turnId: string; agentId: string; tool: string; status: string },
) => {
  const timestamp = Date.now()
  db.upsertItem(input.threadId, {
    id: `item-${input.tool}-${input.turnId}`,
    turnID: input.turnId,
    agentID: input.agentId,
    type: 'tool',
    status: input.status as 'completed' | 'error',
    data: { tool: input.tool },
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

describe('goal turn classification', () => {
  test('成功业务工具算推进；ToolSearch 与 update_plan 不算', async () => {
    const { db, thread, goal } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    // Queued admission creates the first Turn before creating its Goal.
    db.sqlite
      .query('UPDATE turns SET created_at = ? WHERE id = ?')
      .run(goal.createdAt - 42, turn.turnID)
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    for (const tool of ['ToolSearch', 'update_plan']) {
      toolItem(db, { threadId: thread.id, turnId: turn.turnID, agentId, tool, status: 'completed' })
    }
    const classifier = new GoalTurnClassifier(db)
    expect(classifier.facts(turn.turnID).hasProgress).toBe(false)

    toolItem(db, {
      threadId: thread.id,
      turnId: turn.turnID,
      agentId,
      tool: 'Write',
      status: 'completed',
    })
    expect(classifier.facts(turn.turnID).hasProgress).toBe(true)
  })

  test('失败的业务工具不伪装成推进', async () => {
    const { db, thread, classifier } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    toolItem(db, {
      threadId: thread.id,
      turnId: turn.turnID,
      agentId,
      tool: 'Write',
      status: 'error',
    })
    expect(classifier.facts(turn.turnID).hasProgress).toBe(false)
  })

  test('登记在案的审批、提问与子任务构成宿主可确认的等待', async () => {
    const { db, thread, classifier } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    expect(classifier.facts(turn.turnID).hasWaiting).toBe(false)

    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, created_at)
         VALUES ('approval-1', ?, ?, ?, 'call-1', 'high', 'write', 'pending', ?)`,
      )
      .run(thread.id, turn.turnID, agentId, Date.now())
    expect(classifier.facts(turn.turnID).hasWaiting).toBe(true)
  })

  test('提问构成等待，已取消的审批不构成', async () => {
    const { db, thread, classifier } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, created_at)
         VALUES ('approval-2', ?, ?, ?, 'call-2', 'high', 'write', 'cancelled', ?)`,
      )
      .run(thread.id, turn.turnID, agentId, Date.now())
    expect(classifier.facts(turn.turnID).hasWaiting).toBe(false)

    db.sqlite
      .query(
        `INSERT INTO question_requests (id, thread_id, turn_id, agent_id, tool_call_id, payload, status, created_at)
         VALUES ('question-1', ?, ?, ?, 'call-3', '{}', 'pending', ?)`,
      )
      .run(thread.id, turn.turnID, agentId, Date.now())
    expect(classifier.facts(turn.turnID).hasWaiting).toBe(true)
  })

  test('分类优先级：等待 > 推进 > 阻塞候选 > 无进度', async () => {
    const { db, thread, classifier } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    toolItem(db, {
      threadId: thread.id,
      turnId: turn.turnID,
      agentId,
      tool: 'Edit',
      status: 'completed',
    })
    expect(classifier.classify({ turnId: turn.turnID, hasBlockerCandidate: true })).toBe('progress')

    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, created_at)
         VALUES ('approval-3', ?, ?, ?, 'call-4', 'high', 'write', 'pending', ?)`,
      )
      .run(thread.id, turn.turnID, agentId, Date.now())
    expect(classifier.classify({ turnId: turn.turnID, hasBlockerCandidate: true })).toBe('waiting')
  })

  test('有宿主等待的轮次不能登记 blocked', async () => {
    const { db, service, thread } = await fixture()
    const turn = db.createTurn(thread.id, submit('执行'))
    const agentId = (
      db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(turn.turnID) as {
        id: string
      }
    ).id
    db.sqlite
      .query(
        `INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, created_at)
         VALUES ('approval-4', ?, ?, ?, 'call-5', 'high', 'write', 'pending', ?)`,
      )
      .run(thread.id, turn.turnID, agentId, Date.now())
    let code: string | undefined
    try {
      await service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: '等待用户授权',
        toolCallId: 'call-5',
      })
    } catch (error) {
      code = (error as { code?: string }).code
    }
    expect(code).toBe('GOAL_BLOCKED_NOT_APPLICABLE')
  })
})

test('new read evidence advances investigation; unchanged results with new call metadata do not', async () => {
  const { db, thread, classifier } = await fixture()
  const run = (output: string) => {
    const turn = db.createTurn(thread.id, submit('检查'))
    db.upsertItem(thread.id, {
      id: crypto.randomUUID(),
      turnID: turn.turnID,
      agentID: turn.agentID,
      type: 'tool',
      status: 'completed',
      data: {
        tool: 'Read',
        input: { path: 'input.txt' },
        output,
        callID: crypto.randomUUID(),
        durationMs: Date.now(),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const progress = classifier.facts(turn.turnID).hasProgress
    db.updateTurnStatus(turn.turnID, 'completed')
    return progress
  }
  expect(run('missing')).toBe(true)
  expect(run('missing')).toBe(false)
  expect(run('new user input')).toBe(true)
  expect(run('new user input')).toBe(false)
  db.close()
})
