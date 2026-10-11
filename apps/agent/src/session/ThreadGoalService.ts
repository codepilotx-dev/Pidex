import { Effect } from 'effect'
import type { ThreadGoal, ThreadGoalStatus } from '@pidex/shared/thread'
import { AgentError, type EventEnvelope } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { GoalMeasurement } from '../storage/repositories/ThreadGoalLedgerRepository'
import type { EventHub } from '../storage/events/EventHub'

const OBJECTIVE_MAX_LENGTH = 4_000

/** Default applied when a goal is created without an explicit budget. */
export const DEFAULT_GOAL_TOKEN_BUDGET = 200_000

/**
 * Owns the single optional goal attached to a thread. Clearing archives the goal
 * into `thread_goal_history`, so its token and time history survives while a
 * replacement goal always starts from zero.
 */
export class ThreadGoalService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly defaultTokenBudget: () => number = () => DEFAULT_GOAL_TOKEN_BUDGET,
  ) {}

  private repository() {
    return this.db.repositories.threadGoals
  }

  private ledger() {
    return this.db.repositories.threadGoalLedger
  }

  private requireThread(threadId: string) {
    if (!this.db.getThread(threadId)) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
  }

  /** A partial schema must not accept mutations it cannot replay idempotently. */
  private requireWritableStorage() {
    if (!this.repository().available()) {
      throw new AgentError('PERMISSION_DENIED', '当前存储不支持 Goal 写入', 403)
    }
  }

  private async publishStored(events: readonly EventEnvelope[]) {
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
  }

  /** Used by turn admission while its surrounding history transaction is open. */
  admitInTransaction(input: {
    threadId: string
    objective: string
    tokenBudget?: number | null
    expectedVersion: number | null
  }): { goal: ThreadGoal; event: EventEnvelope } {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const objective = input.objective.trim()
    if (!objective || objective.length > OBJECTIVE_MAX_LENGTH)
      throw new AgentError('INVALID_REQUEST', 'Goal 目标无效', 400)
    const goal = this.repository().write({
      threadId: input.threadId,
      objective,
      status: 'active',
      tokenBudget: input.tokenBudget === undefined ? this.defaultTokenBudget() : input.tokenBudget,
      expectedVersion: input.expectedVersion,
    })
    if (!goal) throw new AgentError('CONFLICT', 'Goal 已被更新，请刷新后重试', 409)
    return {
      goal,
      event: this.db.insertEvent(input.threadId, null, 'thread/goal/updated', {
        threadId: input.threadId,
        goal,
        version: goal.version,
      }),
    }
  }

  get(threadId: string): { goal: ThreadGoal | null } {
    this.requireThread(threadId)
    return { goal: this.repository().get(threadId) }
  }

  async set(input: {
    threadId: string
    objective?: string | undefined
    status?: ThreadGoalStatus | undefined
    tokenBudget?: number | null | undefined
    expectedVersion: number | null
    operationId: string
  }): Promise<{ goal: ThreadGoal }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const current = this.repository().get(input.threadId)
    const request = {
      threadId: input.threadId,
      expectedVersion: input.expectedVersion,
      objective: input.objective?.trim(),
      status: input.status,
      tokenBudget: input.tokenBudget === undefined ? undefined : input.tokenBudget,
    }
    const replay = this.repository().completedOperation(
      input.operationId,
      'thread/goal/set',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result as { goal: ThreadGoal }
    }
    const objective = request.objective || current?.objective
    if (!objective) throw new AgentError('INVALID_REQUEST', 'Goal 目标不能为空', 400)
    if (objective.length > OBJECTIVE_MAX_LENGTH)
      throw new AgentError('INVALID_REQUEST', 'Goal 目标过长', 400)
    // Omitted budget means "keep" on update and the configured default on create;
    // an explicit null means the user asked for no budget.
    const tokenBudget =
      input.tokenBudget !== undefined
        ? input.tokenBudget
        : current
          ? current.tokenBudget
          : this.defaultTokenBudget()
    const status: ThreadGoalStatus = input.status ?? current?.status ?? 'active'
    const { result, event } = this.db.transaction(() => {
      const goal = this.repository().write({
        threadId: input.threadId,
        objective,
        status,
        tokenBudget,
        expectedVersion: input.expectedVersion,
      })
      if (!goal) throw new AgentError('CONFLICT', 'Goal 已被更新，请刷新后重试', 409)
      const value = { goal }
      this.repository().recordOperation(input.operationId, 'thread/goal/set', request, value)
      const stored = this.db.insertEvent(goal.threadId, null, 'thread/goal/updated', {
        threadId: goal.threadId,
        goal,
        version: goal.version,
      })
      return { result: value, event: stored }
    })
    await this.publishStored([event])
    return result
  }

  async clear(input: {
    threadId: string
    expectedVersion: number | null
    operationId: string
  }): Promise<{ threadId: string; goalId: string; clearedAt: number }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    if (this.db.activeTurn(input.threadId)) {
      throw new AgentError(
        'GOAL_CLEAR_WHILE_RUNNING',
        '任务正在执行，不能清除 Goal；可以暂停或完成 Goal',
        409,
      )
    }
    const request = { threadId: input.threadId, expectedVersion: input.expectedVersion }
    const replay = this.repository().completedOperation(
      input.operationId,
      'thread/goal/clear',
      request,
    )
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result as { threadId: string; goalId: string; clearedAt: number }
    }
    const { result, event } = this.db.transaction(() => {
      const cleared = this.repository().clear(input.threadId, input.expectedVersion)
      if (!cleared) throw new AgentError('CONFLICT', 'Goal 已被更新或不存在，请刷新后重试', 409)
      const value = {
        threadId: input.threadId,
        goalId: cleared.goalId,
        clearedAt: cleared.clearedAt,
      }
      this.repository().recordOperation(input.operationId, 'thread/goal/clear', request, value)
      const stored = this.db.insertEvent(input.threadId, null, 'thread/goal/cleared', {
        threadId: input.threadId,
        goalId: cleared.goalId,
        clearedAt: cleared.clearedAt,
      })
      return { result: value, event: stored }
    })
    await this.publishStored([event])
    return result
  }

  /**
   * Attributes one terminal turn to the visible goal. Must be called inside the
   * caller's transaction so the ledger rows, totals, derived status and the goal
   * event commit atomically; the returned event is published after that commit.
   * Returns null when there is no goal or nothing measurable changed.
   */
  measureTurn(input: { threadId: string; turnId: string }): GoalMeasurement | null {
    const goal = this.repository().get(input.threadId)
    if (!goal) return null
    return this.ledger().measureTurnForGoal({
      threadId: input.threadId,
      turnId: input.turnId,
      goal: { id: goal.id, createdAt: goal.createdAt },
    })
  }
}
