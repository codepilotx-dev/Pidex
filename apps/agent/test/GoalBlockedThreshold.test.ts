import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentError } from '../src/Domain'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { normalizeGoalBlocker } from '../src/storage/repositories/ThreadGoalControlRepository'
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
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-blocked-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  const thread = db.createThread('阻塞门槛')
  const goal = (
    await service.set({
      threadId: thread.id,
      objective: '交付一个可运行的 CLI',
      expectedVersion: null,
      operationId: 'create',
    })
  ).goal
  return { db, service, thread, goal }
}

/**
 * Creates one goal round that ended with the model reporting `blocker`, then
 * settles it through the same host-fact classifier the runtime uses. No tool
 * item is written, so the round classifies as a blocker candidate.
 */
const blockedRound = (db: AgentDatabase, threadId: string, goalId: string, blocker: string) => {
  const turn = db.createTurn(threadId, submit('继续推进'))
  db.updateTurnStatus(turn.turnID, 'completed')
  const controls = db.repositories.threadGoalControls
  const revision = controls.ensure(goalId, threadId).revision
  controls.recordBlocker({
    goalId,
    revision,
    threadId,
    turnId: turn.turnID,
    blockerText: blocker,
    blockerNorm: normalizeGoalBlocker(blocker),
    toolCallId: `call-${turn.turnID}`,
  })
  controls.settleTurn({
    goalId,
    revision,
    threadId,
    turnId: turn.turnID,
    classification: 'blocker-candidate',
  })
  return turn
}

const reject = async (run: Promise<unknown>): Promise<AgentError> => {
  try {
    await run
  } catch (error) {
    if (error instanceof AgentError) return error
    throw error
  }
  throw new Error('expected the call to be rejected')
}

describe('goal blocked threshold', () => {
  test('前两轮只登记候选并拒绝，第三轮同因才允许 blocked', async () => {
    const { db, service, thread, goal } = await fixture()
    const rounds: string[] = []
    for (let round = 1; round <= 2; round += 1) {
      const turn = db.createTurn(thread.id, submit('继续推进'))
      const rejected = await reject(
        service.applyModelTerminal({
          threadId: thread.id,
          turnId: turn.turnID,
          status: 'blocked',
          blocker: '缺少用户提供的 API 凭据',
          toolCallId: `call-${round}`,
        }),
      )
      expect(rejected.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
      expect(rejected.message).toContain(`${round}/3`)
      db.updateTurnStatus(turn.turnID, 'completed')
      // Rejection must not roll back the candidate: the round still counts. The
      // turn then ends, which settles the candidate as finalizeTurn does.
      expect(
        db.repositories.threadGoalControls.observation(goal.id, 1, turn.turnID)?.classification,
      ).toBe('blocker-candidate')
      db.repositories.threadGoalControls.settleTurn({
        goalId: goal.id,
        revision: 1,
        threadId: thread.id,
        turnId: turn.turnID,
        classification: 'blocker-candidate',
      })
      rounds.push(turn.turnID)
    }
    expect(service.get(thread.id).goal?.status).toBe('active')

    const third = db.createTurn(thread.id, submit('继续推进'))
    const result = await service.applyModelTerminal({
      threadId: thread.id,
      turnId: third.turnID,
      status: 'blocked',
      blocker: '缺少用户提供的 API 凭据',
      toolCallId: 'call-3',
    })
    expect(result.blockedRounds).toBe(3)
    expect(service.get(thread.id).goal?.status).toBe('blocked')
    for (const turnId of rounds)
      expect(db.repositories.threadGoalControls.observation(goal.id, 1, turnId)).not.toBeNull()
  })

  test('连续第三轮同因通过并要求稳定描述', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, '外部服务尚未恢复')
    blockedRound(db, thread.id, goal.id, '外部服务尚未恢复')
    const third = blockedRound(db, thread.id, goal.id, '外部服务尚未恢复')

    const result = await service.applyModelTerminal({
      threadId: thread.id,
      turnId: third.turnID,
      status: 'blocked',
      blocker: '外部服务尚未恢复',
      toolCallId: 'call-3',
    })
    expect(result.blockedRounds).toBe(3)
    expect(service.get(thread.id).goal?.status).toBe('blocked')
  })

  test('缺少 blocker 拒绝登记，也不产生候选', async () => {
    const { db, service, thread, goal } = await fixture()
    const turn = db.createTurn(thread.id, submit('继续推进'))
    const error = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: '   ',
        toolCallId: 'call-blank',
      }),
    )
    expect(error.code).toBe('GOAL_BLOCKER_REQUIRED')
    expect(db.repositories.threadGoalControls.observation(goal.id, 1, turn.turnID)).toBeNull()
    expect(service.get(thread.id).goal?.status).toBe('active')
  })

  test('同一轮换 blocker 冲突，不覆盖第一次记录；同值重试不增加计数', async () => {
    const { db, service, thread, goal } = await fixture()
    const turn = db.createTurn(thread.id, submit('继续推进'))
    const first = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: 'A 条件',
        toolCallId: 'call-a',
      }),
    )
    expect(first.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
    // A retry with the same text and a different tool call id still records once.
    const retried = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: 'A 条件',
        toolCallId: 'call-a-retry',
      }),
    )
    expect(retried.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
    expect(retried.message).toContain('1/3')

    const conflict = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: 'B 条件',
        toolCallId: 'call-b',
      }),
    )
    expect(conflict.code).toBe('GOAL_BLOCKER_CONFLICT')
    expect(
      db.repositories.threadGoalControls.observation(goal.id, 1, turn.turnID)?.blocker_text,
    ).toBe('A 条件')
    expect(
      (
        db.sqlite.query('SELECT COUNT(*) AS count FROM thread_goal_turn_observations').get() as {
          count: number
        }
      ).count,
    ).toBe(1)
  })

  test('A→B→A→A 不通过，中间条件打断连续性', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, 'A 条件')
    blockedRound(db, thread.id, goal.id, 'B 条件')
    blockedRound(db, thread.id, goal.id, 'A 条件')
    const turn = db.createTurn(thread.id, submit('继续推进'))
    const error = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: 'A 条件',
        toolCallId: 'call-4',
      }),
    )
    expect(error.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
    expect(service.get(thread.id).goal?.status).toBe('active')
  })

  test('中间一轮真实推进打断连续性', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, 'A 条件')
    const progress = db.createTurn(thread.id, submit('执行实际修改'))
    db.updateTurnStatus(progress.turnID, 'completed')
    const controls = db.repositories.threadGoalControls
    controls.settleTurn({
      goalId: goal.id,
      revision: 1,
      threadId: thread.id,
      turnId: progress.turnID,
      classification: 'progress',
    })
    blockedRound(db, thread.id, goal.id, 'A 条件')
    const turn = db.createTurn(thread.id, submit('继续推进'))
    const error = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: 'A 条件',
        toolCallId: 'call-x',
      }),
    )
    expect(error.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
  })

  test('用户实际改动目标后旧阻塞审计失效，重新从 1 计数', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, '外部依赖不可用')
    blockedRound(db, thread.id, goal.id, '外部依赖不可用')
    const current = service.get(thread.id).goal!
    await service.set({
      threadId: thread.id,
      objective: '改成只用本地文件完成交付',
      expectedVersion: current.version,
      operationId: 'edit-objective',
    })
    expect(db.repositories.threadGoalControls.revision(goal.id)).toBe(2)

    const turn = db.createTurn(thread.id, submit('继续推进'))
    const error = await reject(
      service.applyModelTerminal({
        threadId: thread.id,
        turnId: turn.turnID,
        status: 'blocked',
        blocker: '外部依赖不可用',
        toolCallId: 'call-after-edit',
      }),
    )
    expect(error.code).toBe('GOAL_BLOCKED_THRESHOLD_NOT_MET')
    expect(error.message).toContain('1/3')
  })

  test('无实际变化的 set 与 operation 重放不推进控制修订', async () => {
    const { db, service, thread, goal } = await fixture()
    const before = db.repositories.threadGoalControls.revision(goal.id)
    const current = service.get(thread.id).goal!
    const noop = {
      threadId: thread.id,
      objective: current.objective,
      tokenBudget: current.tokenBudget,
      status: current.status,
      expectedVersion: current.version,
      operationId: 'noop',
    } as const
    await service.set(noop)
    expect(db.repositories.threadGoalControls.revision(goal.id)).toBe(before)
    // Replaying the same operation returns the stored result without a new write.
    await service.set(noop)
    expect(db.repositories.threadGoalControls.revision(goal.id)).toBe(before)
  })

  test('用量结算不推进控制修订', async () => {
    const { db, thread, goal } = await fixture()
    const before = db.repositories.threadGoalControls.revision(goal.id)
    const turn = db.createTurn(thread.id, submit('一轮'))
    db.updateTurnStatus(turn.turnID, 'completed')
    db.repositories.threadGoalLedger.measureTurnForGoal({
      threadId: thread.id,
      turnId: turn.turnID,
      goal: { id: goal.id, createdAt: goal.createdAt },
    })
    expect(db.repositories.threadGoalControls.revision(goal.id)).toBe(before)
  })

  test('clear 后新 Goal 不继承旧阻塞状态', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, '旧目标阻塞')
    const current = service.get(thread.id).goal!
    await service.clear({
      threadId: thread.id,
      expectedVersion: current.version,
      operationId: 'clear-old',
    })
    const replacement = (
      await service.set({
        threadId: thread.id,
        objective: '全新的目标',
        expectedVersion: null,
        operationId: 'create-new',
      })
    ).goal
    expect(replacement.id).not.toBe(goal.id)
    const row = db.repositories.threadGoalControls.get(replacement.id)!
    expect(row).not.toBeNull()
    expect(row.revision).toBe(1)
    expect(
      (
        db.sqlite
          .query('SELECT COUNT(*) AS count FROM thread_goal_turn_observations WHERE goal_id = ?')
          .get(replacement.id) as { count: number }
      ).count,
    ).toBe(0)
  })

  test('blocked 落库后结算仍落在候选自身的控制修订上', async () => {
    const { db, service, thread, goal } = await fixture()
    blockedRound(db, thread.id, goal.id, '外部依赖不可用')
    blockedRound(db, thread.id, goal.id, '外部依赖不可用')
    const third = db.createTurn(thread.id, submit('继续推进'))
    const result = await service.applyModelTerminal({
      threadId: thread.id,
      turnId: third.turnID,
      status: 'blocked',
      blocker: '外部依赖不可用',
      toolCallId: 'call-third',
    })
    expect(result.goal.status).toBe('blocked')
    // The blocked transition bumps the control revision. Settlement must still
    // land on the revision that recorded the candidate, not the new one.
    expect(db.repositories.threadGoalControls.revision(goal.id)).toBe(2)
    db.finalizeTurn({
      threadID: thread.id,
      turnID: third.turnID,
      agentID: (
        db.sqlite.query('SELECT root_agent_id AS id FROM turns WHERE id = ?').get(third.turnID) as {
          id: string
        }
      ).id,
      status: 'completed',
    })
    const row = db.repositories.threadGoalControls.observationForTurn(goal.id, third.turnID)!
    expect(row.revision).toBe(1)
    expect(row.processing).toBe('settled')
    expect(row.classification).toBe('blocker-candidate')
    // No continuation is queued for a blocked goal.
    expect(
      (
        db.sqlite
          .query("SELECT COUNT(*) AS count FROM turns WHERE thread_id = ? AND status = 'queued'")
          .get(thread.id) as { count: number }
      ).count,
    ).toBe(0)
  })

  test('complete 不受三轮门槛约束', async () => {
    const { db, service, thread } = await fixture()
    const turn = db.createTurn(thread.id, submit('完成'))
    const result = await service.applyModelTerminal({
      threadId: thread.id,
      turnId: turn.turnID,
      status: 'complete',
      toolCallId: 'call-complete',
    })
    expect(result.goal.status).toBe('complete')
  })

  test('blocker 归一化忽略大小写、标点与空白差异', () => {
    expect(normalizeGoalBlocker('  缺少 API  Key! ')).toBe('缺少 api key')
    expect(normalizeGoalBlocker('缺少　API Key')).toBe(normalizeGoalBlocker('缺少 api key.'))
    expect(normalizeGoalBlocker('!!')).toBe('')
  })
})
