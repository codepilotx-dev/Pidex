import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { ThreadGoalService } from '../src/session/ThreadGoalService'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { EventHub } from '../src/storage/events/EventHub'
import { computeConvergenceReserve } from '../src/session/GoalDirectiveService'
import { GOAL_WRAPUP_OUTPUT_TOKENS, goalBudgetAdmission } from '../src/session/GoalWrapupPolicy'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)), 30_000)

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-goal-wrapup-'))
  paths.push(root)
  const db = new AgentDatabase(join(root, 'agent.sqlite'))
  const service = new ThreadGoalService(db, await Effect.runPromise(EventHub.make))
  const thread = db.createThread('预算收尾')
  const goal = (
    await service.set({
      threadId: thread.id,
      objective: '交付',
      tokenBudget: 10000,
      expectedVersion: null,
      operationId: 'create',
    })
  ).goal
  return { db, service, thread, goal }
}

describe('budget wrap-up policy', () => {
  test('输入、输出和收尾预留都装得下才继续工作', () => {
    const input = { reserve: 4096, inputTokens: 2000, outputTokens: 3000, wrapupInputTokens: 2200 }
    expect(goalBudgetAdmission({ ...input, remaining: 9096 })).toBe('work')
    expect(goalBudgetAdmission({ ...input, remaining: 9095 })).toBe('wrapup')
  })

  test('收尾输入和 1024 输出不足额时拒绝；恰好足额允许收尾', () => {
    const input = { reserve: 4096, inputTokens: 2000, outputTokens: 3000, wrapupInputTokens: 2200 }
    expect(goalBudgetAdmission({ ...input, remaining: 2200 + GOAL_WRAPUP_OUTPUT_TOKENS - 1 })).toBe(
      'denied',
    )
    expect(goalBudgetAdmission({ ...input, remaining: 2200 + GOAL_WRAPUP_OUTPUT_TOKENS })).toBe(
      'wrapup',
    )
  })

  test('同一控制修订只能领取一次收尾', async () => {
    const { db, goal } = await fixture()
    const controls = db.repositories.threadGoalControls
    const revision = controls.get(goal.id)!.revision
    expect(controls.claimWrapup(goal.id, revision)).toBe(true)
    expect(controls.claimWrapup(goal.id, revision)).toBe(false)
    expect(controls.get(goal.id)!.wrapup_revision).toBe(revision)
  })

  test('新修订重新获得一次收尾额度', async () => {
    const { db, service, thread, goal } = await fixture()
    const controls = db.repositories.threadGoalControls
    const first = controls.get(goal.id)!.revision
    expect(controls.claimWrapup(goal.id, first)).toBe(true)

    const current = service.get(thread.id).goal!
    await service.set({
      threadId: thread.id,
      objective: '改过的目标',
      expectedVersion: current.version,
      operationId: 'edit',
    })
    const next = controls.get(goal.id)!.revision
    expect(next).toBeGreaterThan(first)
    expect(controls.get(goal.id)!.wrapup_revision).toBeNull()
    expect(controls.claimWrapup(goal.id, next)).toBe(true)
  })

  test('预算变更也打开新的收尾额度，但不新增 objective 修订', async () => {
    const { db, service, thread, goal } = await fixture()
    const controls = db.repositories.threadGoalControls
    const first = controls.get(goal.id)!.revision
    expect(controls.claimWrapup(goal.id, first)).toBe(true)
    const current = service.get(thread.id).goal!
    await service.set({
      threadId: thread.id,
      tokenBudget: 20000,
      expectedVersion: current.version,
      operationId: 'budget',
    })
    const row = controls.get(goal.id)!
    expect(row.revision).toBeGreaterThan(first)
    expect(row.objective_revision).toBe(0)
    expect(row.wrapup_revision).toBeNull()
  })

  test('无预算目标的预留为零，准入由调用方直接放行', () => {
    expect(computeConvergenceReserve(0)).toBe(0)
  })
})
