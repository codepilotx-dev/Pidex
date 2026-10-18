import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { PermissionDecision, ToolInvocation } from '../Domain'
import type { ReviewerService } from './ReviewerService'
import { secretScrubber } from '../security/SecretScrubber'
import {
  guardianActionHash,
  guardianActionSensitivity,
  guardianAuthorizationVersion,
  guardianFastPathEligible,
  guardianReview,
  type GuardianScopeClass,
  type GuardianTrajectoryEntry,
} from './Guardian'

/**
 * Per-thread fast path for Guardian Beta.
 *
 * The score is a short, binary risk classification sampled before the tool
 * executes. A low score may satisfy a later approval only when every one of the
 * following still holds at reuse time:
 *
 * - the score belongs to the same turn and to the current invalidation
 *   generation (denials, asks, turn end and authorization changes bump it)
 * - the authorization snapshot is unchanged
 * - the action hash is unchanged for the same tool call
 * - the score is settled, low risk, and at most two tool calls old
 * - the caller's AbortSignal is not aborted
 *
 * Invalidation makes late asynchronous results unusable: a stale resolution can
 * never restore a low score, reset `failed`, or resurrect an approval.
 */

type ScoreEntry = {
  callID: string
  index: number
  generation: number
  actionHash: string
  authorizationVersion: string
  sampledAt: number
  risk: 'low' | 'high'
  trajectoryRisk: 'low' | 'high'
  predictedRisk: 'low' | 'high'
  scope: GuardianScopeClass
  sensitive: boolean
  tool: string
  summary: string
  decision?: 'allow' | 'ask' | 'deny'
  failed: boolean
  settled: boolean
  promise: Promise<void>
}

type ThreadState = {
  turnID: string
  /** Bumped by every invalidation; entries from older generations are dead. */
  generation: number
  authorizationVersion: string
  nextIndex: number
  entries: ScoreEntry[]
  byCall: Map<string, ScoreEntry>
}

type LowRiskSelection = {
  entry: ScoreEntry
  lag: number
  reusedAcrossActions: boolean
}

const MAX_TOOL_CALL_LAG = 2
const MAX_ENTRIES = 64
const SCORE_TIMEOUT_MS = 7_000

const summarizeInvocation = (invocation: ToolInvocation): string => {
  const candidate =
    invocation.input.command ??
    invocation.input.file_path ??
    invocation.input.path ??
    invocation.name
  return secretScrubber
    .scrubText(typeof candidate === 'string' ? candidate : invocation.name)
    .slice(0, 240)
}

export class GuardianScoreService {
  private readonly threads = new Map<string, ThreadState>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly reviewer: ReviewerService,
  ) {}

  observe(invocation: ToolInvocation): void {
    const state = this.stateFor(invocation.threadID, invocation.turnID)
    this.syncAuthorization(state, invocation.threadID)
    const actionHash = guardianActionHash(invocation)
    const previous = state.byCall.get(invocation.id)
    if (previous) {
      // A re-observed tool call means a new execution attempt. The previous
      // score must never survive, even when the action text is identical.
      this.failEntry(previous)
      state.byCall.delete(invocation.id)
    }
    if (!guardianFastPathEligible(invocation)) return
    const index = state.nextIndex++
    const authorizationVersion = guardianAuthorizationVersion(this.db, invocation.threadID)
    const sensitivity = guardianActionSensitivity(invocation)
    const entry: ScoreEntry = {
      callID: invocation.id,
      index,
      generation: state.generation,
      actionHash,
      authorizationVersion,
      sampledAt: Date.now(),
      risk: 'high',
      trajectoryRisk: 'high',
      predictedRisk: 'high',
      scope: sensitivity.scope,
      sensitive: sensitivity.sensitive,
      tool: invocation.name,
      summary: summarizeInvocation(invocation),
      failed: true,
      settled: false,
      promise: Promise.resolve(),
    }
    entry.promise = this.score(invocation, entry, state)
    state.entries.push(entry)
    state.byCall.set(entry.callID, entry)
    if (state.entries.length > MAX_ENTRIES) {
      const removed = state.entries.splice(0, state.entries.length - MAX_ENTRIES)
      for (const item of removed) {
        if (state.byCall.get(item.callID) === item) state.byCall.delete(item.callID)
      }
    }
  }

  /**
   * The trajectory that the classifier should see. It contains completed
   * actions only: pending scores, failures and denials are deliberately absent
   * because a denial already invalidates every score in the turn.
   */
  trajectory(invocation: ToolInvocation): GuardianTrajectoryEntry[] {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return []
    const current = state.byCall.get(invocation.id)?.index ?? state.nextIndex
    return state.entries
      .filter(
        (entry) =>
          entry.generation === state.generation &&
          entry.settled &&
          !entry.failed &&
          entry.index < current,
      )
      .slice(-6)
      .map((entry) => ({
        tool: entry.tool,
        scope: entry.scope,
        risk: entry.risk,
        sensitive: entry.sensitive,
        ...(entry.decision ? { decision: entry.decision } : {}),
        ...(entry.summary ? { summary: entry.summary } : {}),
      }))
  }

  /**
   * Records the enforced outcome so later scores can be invalidated. A human
   * confirmation (ask) or a denial ends the trajectory the classifier scored.
   */
  recordDecision(invocation: ToolInvocation, decision: 'allow' | 'ask' | 'deny'): void {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return
    this.syncAuthorization(state, invocation.threadID)
    const entry = state.byCall.get(invocation.id)
    if (entry) entry.decision = decision
    if (decision !== 'allow') this.invalidateState(state)
  }

  cachedAllow(invocation: ToolInvocation, signal?: AbortSignal): PermissionDecision | null {
    if (signal?.aborted) return null
    const state = this.currentState(invocation)
    if (!state) return null
    if (!guardianFastPathEligible(invocation)) return null
    const selection = this.selectLowRisk(state, invocation)
    if (!selection) return null
    return this.allowFromScore(selection.entry, selection.lag, selection.reusedAcrossActions)
  }

  async waitForLowRisk(
    invocation: ToolInvocation,
    signal: AbortSignal,
    timeoutMs = 2_500,
  ): Promise<PermissionDecision | null> {
    if (signal.aborted) return null
    const cached = this.cachedAllow(invocation, signal)
    if (cached) return cached
    const state = this.currentState(invocation)
    if (!state) return null
    const entry = state.byCall.get(invocation.id)
    if (!entry) return null
    if (entry.generation !== state.generation) return null
    const winner = await Promise.race([
      entry.promise.then(() => 'settled' as const),
      this.timeout(signal, timeoutMs),
    ])
    if (winner !== 'settled') {
      // A cancellation must also kill the late result: invalidate the turn so a
      // score that finishes afterwards can never be reused.
      if (signal.aborted) this.invalidateState(state)
      return null
    }
    if (signal.aborted) {
      this.invalidateState(state)
      return null
    }
    // `cachedAllow` owns the single reuse validation for both entry points.
    return this.cachedAllow(invocation, signal)
  }

  clearThread(threadID: string): void {
    this.threads.delete(threadID)
  }

  /**
   * Ends a turn. Every outstanding score becomes unusable, including results
   * that resolve after this call, and the state is dropped so a new turn starts
   * from a clean generation.
   */
  endTurn(threadID: string, turnID: string): void {
    const state = this.threads.get(threadID)
    if (!state || state.turnID !== turnID) return
    state.generation += 1
    for (const entry of state.entries) this.failEntry(entry)
    this.threads.delete(threadID)
  }

  /** A synchronous denial/ask overrides low async scores for the whole turn. */
  invalidateAction(invocation: ToolInvocation): void {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return
    this.syncAuthorization(state, invocation.threadID)
    this.invalidateState(state)
  }

  /** Returns the low score that may satisfy this action, after full validation. */
  private selectLowRisk(state: ThreadState, invocation: ToolInvocation): LowRiskSelection | null {
    const actionHash = guardianActionHash(invocation)
    const authorizationVersion = guardianAuthorizationVersion(this.db, invocation.threadID)
    const sensitivity = guardianActionSensitivity(invocation)
    const own = state.byCall.get(invocation.id)
    const current = own?.index ?? state.nextIndex - 1
    // A settled high-risk or failed score for the current action is a verdict:
    // it must not fall through to an older low score from another action.
    if (own && own.settled && (own.failed || own.risk !== 'low')) return null
    if (own && own.generation !== state.generation) return null
    let best: ScoreEntry | null = null
    for (const entry of state.entries) {
      if (!entry.settled || entry.failed) continue
      if (entry.generation !== state.generation) continue
      if (entry.authorizationVersion !== authorizationVersion) continue
      if (entry.index > current) continue
      if (current - entry.index > MAX_TOOL_CALL_LAG) continue
      const sameAction = entry.actionHash === actionHash
      if (!sameAction) {
        // The same tool call must never reuse a score for a different command
        // or action; cross-action reuse is only for distinct benign actions.
        if (entry.callID === invocation.id) continue
        if (!this.reusableAcrossActions(entry, sensitivity)) continue
        if (entry.risk !== 'low' || entry.predictedRisk !== 'low' || entry.trajectoryRisk !== 'low')
          continue
      } else if (entry.risk !== 'low') {
        continue
      }
      if (!best || entry.index > best.index) best = entry
    }
    if (!best) return null
    return {
      entry: best,
      lag: Math.max(0, current - best.index),
      reusedAcrossActions: best.actionHash !== actionHash,
    }
  }

  /**
   * Codex-compatible lag reuse. A prior score may cover a later action only when
   * the action class is identical, both actions are independently benign, and the
   * classifier predicted the next action as low risk. Only read-only shell
   * commands and read capabilities qualify, so a package script or destructive
   * command never inherits a previous low score.
   */
  private reusableAcrossActions(
    entry: ScoreEntry,
    current: { scope: GuardianScopeClass; sensitive: boolean },
  ): boolean {
    if (entry.scope !== current.scope) return false
    if (entry.sensitive || current.sensitive) return false
    return entry.scope === 'read' || entry.scope === 'shell'
  }

  private allowFromScore(
    entry: ScoreEntry,
    lag: number,
    reusedAcrossActions: boolean,
  ): PermissionDecision {
    return {
      decision: 'allow',
      risk: 'low',
      reason: reusedAcrossActions
        ? 'Guardian 低风险轨迹快速通道放行（异步评分复用）'
        : 'Guardian 低风险快速通道放行（异步评分）',
      guardian: guardianReview({
        status: 'cached',
        source: 'cache',
        risk: 'low',
        userAuthorization: 'unknown',
        confidence: 'medium',
        categories: [],
        rationale: reusedAcrossActions
          ? '当前动作与最近的低风险轨迹同类，且用户授权版本未变化。'
          : '当前动作被 Guardian 异步评分为低风险，且用户授权版本未变化。',
        scoreLag: lag,
        reviewedAt: entry.sampledAt,
        authorizationVersion: entry.authorizationVersion,
      }),
    }
  }

  private async score(
    invocation: ToolInvocation,
    entry: ScoreEntry,
    state: ThreadState,
  ): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error('Guardian score timeout')),
      SCORE_TIMEOUT_MS,
    )
    try {
      const result = await this.reviewer.classify(
        invocation,
        controller.signal,
        this.trajectory(invocation),
      )
      if (!this.isCurrentEntry(invocation, state, entry)) {
        // The turn ended, the action was invalidated, or a newer generation
        // started while the classifier was running. Never resurrect the score.
        this.failEntry(entry)
        return
      }
      if (
        guardianAuthorizationVersion(this.db, invocation.threadID) !== entry.authorizationVersion
      ) {
        this.syncAuthorization(state, invocation.threadID)
        this.failEntry(entry)
        return
      }
      entry.risk = result.risk
      entry.trajectoryRisk = result.trajectory_risk ?? result.risk
      entry.predictedRisk = result.predicted_risk ?? result.risk
      entry.failed = false
    } catch {
      this.failEntry(entry)
    } finally {
      entry.settled = true
      clearTimeout(timeout)
    }
  }

  private isCurrentEntry(
    invocation: ToolInvocation,
    state: ThreadState,
    entry: ScoreEntry,
  ): boolean {
    return (
      this.threads.get(invocation.threadID) === state &&
      state.turnID === invocation.turnID &&
      state.generation === entry.generation
    )
  }

  private currentState(invocation: ToolInvocation): ThreadState | null {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return null
    this.syncAuthorization(state, invocation.threadID)
    return state
  }

  /**
   * Authorization changes invalidate all outstanding scores. The check is
   * evaluated lazily on every state access, so it also covers changes that happen
   * while a classifier call is in flight.
   */
  private syncAuthorization(state: ThreadState, threadID: string): void {
    const current = guardianAuthorizationVersion(this.db, threadID)
    if (current === state.authorizationVersion) return
    state.authorizationVersion = current
    this.invalidateState(state)
  }

  private invalidateState(state: ThreadState): void {
    state.generation += 1
    for (const entry of state.entries) this.failEntry(entry)
  }

  private failEntry(entry: ScoreEntry): void {
    entry.risk = 'high'
    entry.trajectoryRisk = 'high'
    entry.predictedRisk = 'high'
    entry.failed = true
  }

  private stateFor(threadID: string, turnID: string): ThreadState {
    const current = this.threads.get(threadID)
    if (current && current.turnID === turnID) return current
    const next: ThreadState = {
      turnID,
      generation: 0,
      authorizationVersion: guardianAuthorizationVersion(this.db, threadID),
      nextIndex: 0,
      entries: [],
      byCall: new Map(),
    }
    this.threads.set(threadID, next)
    if (this.threads.size > 256) {
      const oldest = this.threads.keys().next().value
      if (oldest !== undefined && oldest !== threadID) this.threads.delete(oldest)
    }
    return next
  }

  private timeout(signal: AbortSignal, timeoutMs: number): Promise<'timeout'> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>
      const onAbort = () => {
        clearTimeout(timer)
        resolve('timeout')
      }
      timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve('timeout')
      }, timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}
