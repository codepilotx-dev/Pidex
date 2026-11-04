import { QueuedGoalRepository } from '../storage/repositories/QueuedGoalRepository'
import { ThreadGoalContinuationRepository } from '../storage/repositories/ThreadGoalContinuationRepository'
import {
  GOAL_BLOCKED_THRESHOLD,
  normalizeGoalBlocker,
} from '../storage/repositories/ThreadGoalControlRepository'
import { GoalTurnClassifier } from './GoalTurnClassifier'
import type { TaskMode } from '../Domain'
import { Effect } from 'effect'
import type { ThreadGoal, ThreadGoalStatus } from '@pidex/shared/thread'
import { threadGoalBudgetViolation } from '@pidex/shared/thread'
import { AgentError, type EventEnvelope } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { GoalMeasurement } from '../storage/repositories/ThreadGoalLedgerRepository'
import type { EventHub } from '../storage/events/EventHub'

const OBJECTIVE_MAX_LENGTH = 4_000
/** Upper bound for a model-supplied blocker description. */
const BLOCKER_MAX_LENGTH = 1_000

/** Default applied when a goal is created without an explicit budget. */
export const DEFAULT_GOAL_TOKEN_BUDGET: number | null = null

/**
 * Owns the single optional goal attached to a thread. Clearing archives the goal
 * into `thread_goal_history`, so its token and time history survives while a
 * replacement goal always starts from zero.
 */
export class ThreadGoalService {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly defaultTokenBudget: () => number | null = () => DEFAULT_GOAL_TOKEN_BUDGET,
  ) {}

  private budgetReviewer?: (threadId: string, proposedBudget: number | null) => Promise<ThreadGoal>

  setBudgetReviewer(
    reviewer: (threadId: string, proposedBudget: number | null) => Promise<ThreadGoal>,
  ): void {
    this.budgetReviewer = reviewer
  }

  private repository() {
    return this.db.repositories.threadGoals
  }

  private controls() {
    return this.db.repositories.threadGoalControls
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

  /**
   * Budgets may only widen after the goal exists, and a completed goal's budget is
   * frozen. Checked here so the direct set and the queued admission path reject the
   * same requests before any write.
   */
  private assertBudgetWidens(current: ThreadGoal | null, next: number | null): void {
    if (!current) return
    if (current.status === 'complete' && next !== current.tokenBudget)
      throw new AgentError('INVALID_REQUEST', '已完成的目标不能再修改预算', 400)
    const violation = threadGoalBudgetViolation(current.tokenBudget, next)
    if (!violation) return
    throw new AgentError(
      'INVALID_REQUEST',
      violation === 'capped'
        ? '目标当前不限额，不能再设置有限预算'
        : '目标预算只能增加或取消上限，不能降低',
      400,
    )
  }

  /**
   * An existing goal keeps its stored budget when the caller omits one; only a
   * brand-new goal falls back to the configured default.
   */
  private resolveBudget(
    current: ThreadGoal | null,
    requested: number | null | undefined,
  ): number | null {
    const next =
      requested !== undefined
        ? requested
        : current
          ? current.tokenBudget
          : this.defaultTokenBudget()
    if (next !== null && (!Number.isSafeInteger(next) || next < 0))
      throw new AgentError('INVALID_REQUEST', 'Goal 预算必须为非负安全整数或不限额', 400)
    this.assertBudgetWidens(current, next)
    return next
  }

  /** Used by turn admission while its surrounding history transaction is open. */
  admitInTransaction(input: {
    threadId: string
    objective: string
    tokenBudget?: number | null | undefined
    expectedVersion: number | null
  }): { goal: ThreadGoal; event: EventEnvelope } {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const objective = input.objective.trim()
    if (!objective || objective.length > OBJECTIVE_MAX_LENGTH)
      throw new AgentError('INVALID_REQUEST', 'Goal 目标无效', 400)
    const previous = this.repository().get(input.threadId)
    const goal = this.repository().write({
      threadId: input.threadId,
      objective,
      status: 'active',
      tokenBudget: this.resolveBudget(previous, input.tokenBudget),
      expectedVersion: input.expectedVersion,
    })
    if (!goal) throw new AgentError('CONFLICT', 'Goal 已被更新，请刷新后重试', 409)
    // A brand-new goal starts its own control generation; it never inherits the
    // observations or verifications of the goal it replaced.
    this.markControlChange({
      before: previous,
      after: goal,
      requested: { objective, tokenBudget: goal.tokenBudget, status: 'active' },
    })
    return {
      goal,
      event: this.db.insertEvent(input.threadId, null, 'thread/goal/updated', {
        threadId: input.threadId,
        goal,
        version: goal.version,
      }),
    }
  }

  applyInputInTransaction(
    threadId: string,
    inputId: string,
    taskMode: TaskMode,
  ): EventEnvelope | undefined {
    const pending = new QueuedGoalRepository(this.db).get(inputId)
    const current = this.repository().get(threadId)
    if (pending) {
      if (taskMode !== 'chat')
        throw new AgentError('INVALID_REQUEST', 'Goal 必须使用 Chat 模式', 400)
      const { event } = this.admitInTransaction({
        threadId,
        ...pending,
        expectedVersion: current?.version ?? null,
      })
      new QueuedGoalRepository(this.db).remove(inputId)
      return event
    }
    if (taskMode !== 'chat' && current?.status === 'active') {
      const goal = this.repository().write({
        threadId,
        objective: current.objective,
        status: 'paused',
        tokenBudget: current.tokenBudget,
        expectedVersion: current.version,
      })
      if (!goal) throw new AgentError('CONFLICT', 'Goal 已变化，请重试', 409)
      if (this.controls().available()) this.controls().bump(goal.id, threadId)
      return this.db.insertEvent(threadId, null, 'thread/goal/updated', {
        threadId,
        goal,
        version: goal.version,
      })
    }
    return undefined
  }

  get(threadId: string): { goal: ThreadGoal | null } {
    this.requireThread(threadId)
    return { goal: this.repository().get(threadId) }
  }

  /**
   * Advances the control generation when the caller actually changed objective,
   * budget or status. Usage settlement, an operation replay and a no-op set must
   * not bump it, or every settlement would orphan in-flight continuation work.
   */
  private markControlChange(input: {
    before: ThreadGoal | null
    after: ThreadGoal
    requested: {
      objective?: string | undefined
      tokenBudget?: number | null | undefined
      status?: ThreadGoalStatus | undefined
    }
  }): void {
    if (!this.controls().available()) return
    // A brand-new goal starts its generation at revision 1; there is no earlier
    // generation to invalidate.
    if (!input.before) {
      this.controls().ensure(input.after.id, input.after.threadId)
      return
    }
    const objectiveChanged = Boolean(
      input.requested.objective !== undefined &&
      input.requested.objective !== (input.before?.objective ?? ''),
    )
    const budgetChanged =
      input.requested.tokenBudget !== undefined &&
      input.requested.tokenBudget !== (input.before?.tokenBudget ?? null)
    const statusChanged = input.after.status !== input.before.status
    if (!objectiveChanged && !budgetChanged && !statusChanged) return
    this.controls().bump(input.after.id, input.after.threadId, {
      objectiveChanged,
      budgetChanged,
      previousBudget: input.before.tokenBudget,
    })
  }

  /**
   * Model-only terminal entry. The host owns the turn identity, the control
   * revision and the consecutive-round count, so a model cannot claim a source
   * turn or replay the same blocker to satisfy the threshold.
   */
  async applyModelTerminal(input: {
    threadId: string
    turnId: string
    status: 'complete' | 'blocked'
    blocker?: string | undefined
    toolCallId: string
    identity?: { goalId: string; revision: number }
  }): Promise<{ goal: ThreadGoal; blockedRounds?: number }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
    const current = this.repository().get(input.threadId)
    if (!current) throw new AgentError('GOAL_NOT_FOUND', '当前任务没有 Goal', 409)
    if (current.status !== 'active')
      throw new AgentError('GOAL_NOT_ACTIVE', '当前 Goal 未处于 active，模型不能设置终态', 409)
    if (
      input.identity &&
      (current.id !== input.identity.goalId ||
        this.controls().revision(current.id) !== input.identity.revision)
    )
      throw new AgentError('CONFLICT', 'Goal 已变化，请先读取当前目标再决定终态', 409)
    if (!this.controls().ownsTurn(input.threadId, input.turnId))
      throw new AgentError('CONFLICT', 'Goal 来源轮次无效', 409)
    if (input.status === 'complete') {
      return this.set({
        threadId: input.threadId,
        status: 'complete',
        expectedVersion: current.version,
        operationId: `goal-tool:${input.turnId}:${input.toolCallId}`,
      })
    }
    return this.applyModelBlocked(input)
  }

  /**
   * Blocked needs the same unstable condition reported on three consecutive
   * settled goal rounds within one control revision. The turn hosts the count;
   * the model only supplies the condition text.
   */
  private async applyModelBlocked(input: {
    threadId: string
    turnId: string
    blocker?: string | undefined
    toolCallId: string
  }): Promise<{ goal: ThreadGoal; blockedRounds: number }> {
    const current = this.repository().get(input.threadId)!
    const controls = this.controls()
    const revision = controls.ensure(current.id, input.threadId).revision
    const operationId = `goal-tool:${input.turnId}:${input.toolCallId}`
    const rawBlocker = input.blocker?.trim() ?? ''
    const blockerNorm = normalizeGoalBlocker(rawBlocker)
    const request = {
      threadId: input.threadId,
      status: 'blocked' as const,
      blocker: rawBlocker,
      revision,
    }
    const replay = this.repository().completedOperation(operationId, 'thread/goal/blocked', request)
    if (replay) {
      if (!replay.matches)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他请求', 409)
      return replay.result as { goal: ThreadGoal; blockedRounds: number }
    }
    if (!rawBlocker || !blockerNorm || rawBlocker.length > BLOCKER_MAX_LENGTH)
      throw new AgentError(
        'GOAL_BLOCKER_REQUIRED',
        'update_goal(status="blocked") 必须提供 1–1000 字符的稳定阻塞描述。描述真正的阻塞条件（缺少的输入、外部依赖或不可用能力），不要描述你还没做的工作。',
        400,
      )
    const existing = controls.observation(current.id, revision, input.turnId)
    if (existing?.blocker_norm && existing.blocker_norm !== blockerNorm)
      throw new AgentError(
        'GOAL_BLOCKER_CONFLICT',
        `本轮已登记阻塞条件「${existing.blocker_text}」。同一轮只能有一个阻塞条件；继续推进或如实结束本轮。`,
        409,
      )
    // Record the candidate before validating the threshold: the first two rounds
    // must survive even though the call is rejected.
    controls.recordBlocker({
      goalId: current.id,
      revision,
      threadId: input.threadId,
      turnId: input.turnId,
      blockerText: rawBlocker,
      blockerNorm,
      toolCallId: input.toolCallId,
    })
    const facts = new GoalTurnClassifier(this.db).facts(input.turnId)
    if (facts.hasWaiting || facts.hasProgress)
      throw new AgentError(
        'GOAL_BLOCKED_NOT_APPLICABLE',
        `本轮已有${facts.hasWaiting ? '宿主可确认的等待' : '成功推进的证据'}，不能标记为 blocked。继续推进，或等待真实事件返回。`,
        409,
      )
    const previous = controls.previousSettled(current.id, revision, input.turnId)
    // Count the contiguous run of identical blockers immediately before this
    // turn; any different blocker, progress or wait row ends the run.
    let streak = 0
    for (const row of [...previous].reverse()) {
      if (row.classification !== 'blocker-candidate' || row.blocker_norm !== blockerNorm) break
      streak += 1
    }
    const rounds = streak + 1
    if (rounds < GOAL_BLOCKED_THRESHOLD) {
      throw new AgentError(
        'GOAL_BLOCKED_THRESHOLD_NOT_MET',
        `连续阻塞门槛未达到（当前 ${rounds}/${GOAL_BLOCKED_THRESHOLD}）。同一轮内重试不会增加次数，也不是解除门槛的方式。继续做有意义的推进；如果确实没有可做的实际工作，如实结束本轮并说明现状。`,
        409,
        { blockedRounds: rounds, requiredRounds: GOAL_BLOCKED_THRESHOLD },
      )
    }
    const { result, events } = this.db.transaction(() => {
      const goal = this.repository().write({
        threadId: input.threadId,
        objective: current.objective,
        status: 'blocked',
        tokenBudget: current.tokenBudget,
        expectedVersion: current.version,
      })
      if (!goal) throw new AgentError('CONFLICT', 'Goal 已被更新，请刷新后重试', 409)
      const value = { goal, blockedRounds: rounds }
      this.repository().recordOperation(operationId, 'thread/goal/blocked', request, value)
      controls.bump(goal.id, input.threadId)
      return {
        result: value,
        events: [
          this.db.insertEvent(goal.threadId, null, 'thread/goal/updated', {
            threadId: goal.threadId,
            goal,
            version: goal.version,
          }),
        ],
      }
    })
    await this.publishStored(events)
    return result
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
    let current = this.repository().get(input.threadId)
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
    const tokenBudget = this.resolveBudget(current, input.tokenBudget)
    let expectedVersion = input.expectedVersion
    let reviewRevision: number | undefined
    let externalInputReview: { turnId: string; reason: string; nextAction: string } | undefined
    if (
      current &&
      current.status !== 'active' &&
      current.status !== 'complete' &&
      input.tokenBudget !== undefined &&
      tokenBudget !== current.tokenBudget &&
      !this.db.activeTurn(input.threadId) &&
      this.budgetReviewer
    ) {
      if (input.expectedVersion !== current.version)
        throw new AgentError('CONFLICT', 'Goal 已变化，请刷新后重试', 409)
      const reviewed = await this.budgetReviewer(input.threadId, tokenBudget)
      const latest = this.repository().get(input.threadId)
      if (latest?.id !== current.id || latest.version !== reviewed.version)
        throw new AgentError('CONFLICT', 'Goal 在核验期间已变化，请刷新后重试', 409)
      if (reviewed.status === 'complete')
        throw new AgentError(
          'INVALID_REQUEST',
          '目标已完成，不允许追加预算或取消上限；预算未修改',
          400,
        )
      current = reviewed
      expectedVersion = reviewed.version
      reviewRevision = this.controls().revision(reviewed.id)
      const source = this.controls().latestGoalTurn(input.threadId)
      const audit = source && this.controls().verification(reviewed.id, reviewRevision, source.id)
      if (
        audit?.status === 'fail' &&
        audit.continuation === 'external-input' &&
        objective === reviewed.objective
      )
        externalInputReview = {
          turnId: source!.id,
          reason: audit.reason ?? '',
          nextAction: audit.next_action ?? '',
        }
    }

    let status: ThreadGoalStatus = input.status ?? current?.status ?? 'active'
    // `budget-limited` is cleared only by an explicit budget change or an explicit
    // resume. Editing the objective alone must not lift the limit: the goal can be
    // limited by the *estimated* next request being larger than the remaining
    // budget, in which case measured usage is still below the budget.
    const budgetChanged =
      input.tokenBudget !== undefined &&
      (current ? current.tokenBudget !== input.tokenBudget : true)
    if (current?.status === 'budget-limited' && (budgetChanged || input.status === 'active')) {
      const tokensUsed = this.db.repositories.threadGoalLedger.tokensUsed(current.id)
      if (tokenBudget === null || tokenBudget > tokensUsed) {
        status = 'active'
      } else {
        status = 'budget-limited'
      }
    }
    if (externalInputReview) status = 'paused'
    const { result, events } = this.db.transaction(() => {
      const goal = this.repository().write({
        threadId: input.threadId,
        objective,
        status,
        tokenBudget,
        expectedVersion,
      })
      if (!goal) throw new AgentError('CONFLICT', 'Goal 已被更新，请刷新后重试', 409)
      this.markControlChange({
        before: current,
        after: goal,
        requested: {
          objective: request.objective,
          tokenBudget: input.tokenBudget,
          status: input.status,
        },
      })
      if (reviewRevision !== undefined && objective === current?.objective)
        this.controls().carryBudgetReview(
          goal.id,
          reviewRevision,
          this.controls().revision(goal.id),
        )
      const value = { goal }
      this.repository().recordOperation(input.operationId, 'thread/goal/set', request, value)
      const outboxEvents: EventEnvelope[] = [
        this.db.insertEvent(goal.threadId, null, 'thread/goal/updated', {
          threadId: goal.threadId,
          goal,
          version: goal.version,
        }),
      ]
      if (externalInputReview) {
        const agent = this.db.agentForTurn(externalInputReview.turnId)
        if (agent) {
          const timestamp = Date.now()
          const item = {
            id: crypto.randomUUID(),
            turnID: externalInputReview.turnId,
            agentID: agent.id,
            type: 'text' as const,
            status: 'completed' as const,
            data: {
              placement: 'result',
              phase: 'notice',
              text: `预算上限已调整为 ${tokenBudget ?? '不限额'}，目标仍需外部输入，已保持暂停。${externalInputReview.reason}\n恢复条件：${externalInputReview.nextAction || '补齐所需输入后明确恢复目标。'}\n追加预算只调整上限，不会补齐外部输入；条件满足后请明确恢复目标。`,
            },
            createdAt: timestamp,
            updatedAt: timestamp,
          }
          this.db.upsertItem(input.threadId, item)
          outboxEvents.push(
            this.db.insertEvent(input.threadId, item.turnID, 'item/completed', {
              item: this.db.getItem(item.id)!,
            }),
          )
        }
      }
      if (current?.status === 'budget-limited' && goal.status === 'active') {
        const queueMeta = this.db.queueStateMeta(input.threadId)
        if (queueMeta?.pauseReason === 'interrupted') {
          const timestamp = Date.now()
          this.db.sqlite
            .query(
              'UPDATE threads SET queue_pause_reason = NULL, queue_version = queue_version + 1, updated_at = ? WHERE id = ?',
            )
            .run(timestamp, input.threadId)
          const nextQueue = this.db.queueStateMeta(input.threadId)
          outboxEvents.push(
            this.db.insertEvent(input.threadId, null, 'queue/updated', {
              threadId: input.threadId,
              version: nextQueue?.version ?? 0,
              pauseReason: null,
              action: 'resumed',
            }),
          )
        }
      }
      return { result: value, events: outboxEvents }
    })
    await this.publishStored(events)
    return result
  }

  async clear(input: {
    threadId: string
    expectedVersion: number | null
    operationId: string
  }): Promise<{ threadId: string; goalId: string; clearedAt: number }> {
    this.requireThread(input.threadId)
    this.requireWritableStorage()
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
    const { result, events } = this.db.transaction(() => {
      const cleared = this.repository().clear(input.threadId, input.expectedVersion)
      if (!cleared) throw new AgentError('CONFLICT', 'Goal 已被更新或不存在，请刷新后重试', 409)
      const value = {
        threadId: input.threadId,
        goalId: cleared.goalId,
        clearedAt: cleared.clearedAt,
      }
      this.repository().recordOperation(input.operationId, 'thread/goal/clear', request, value)
      // Clearing ends the generation too: an in-flight verifier must not resurrect
      // the goal it was verifying.
      if (this.controls().available()) this.controls().bump(cleared.goalId, input.threadId)
      const stored = this.db.insertEvent(input.threadId, null, 'thread/goal/cleared', {
        threadId: input.threadId,
        goalId: cleared.goalId,
        clearedAt: cleared.clearedAt,
      })
      const events = [stored]
      for (const queued of new ThreadGoalContinuationRepository(this.db).pendingInputs(
        cleared.goalId,
      )) {
        const mutation = this.db.removeQueuedInput(input.threadId, queued.id, {
          operationID: `${input.operationId}:${queued.id}`,
        })
        if (mutation.event) events.push(mutation.event)
      }
      return { result: value, events }
    })
    await this.publishStored(events)
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
