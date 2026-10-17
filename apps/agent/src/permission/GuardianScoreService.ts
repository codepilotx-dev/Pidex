import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { PermissionDecision, ToolInvocation } from '../Domain'
import type { ReviewerService } from './ReviewerService'
import { secretScrubber } from '../security/SecretScrubber'
import {
  guardianActionHash,
  guardianActionSensitivity,
  guardianAuthorizationVersion,
  guardianReview,
  shouldScoreGuardianAction,
  type GuardianScopeClass,
  type GuardianTrajectoryEntry,
} from './Guardian'

/**
 * Per-thread fast path for Guardian Beta.
 *
 * The score is a short, binary risk classification sampled before the tool
 * executes. A low score may satisfy a later approval only when the authorization
 * version is unchanged, the score predates the action, and it is at most two
 * tool calls old. Cross-action reuse additionally requires the same capability
 * class, a low trajectory prediction and a non-sensitive action.
 */

type ScoreEntry = {
  callID: string
  index: number
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
  nextIndex: number
  entries: ScoreEntry[]
  byCall: Map<string, ScoreEntry>
}

const MAX_TOOL_CALL_LAG = 2
const MAX_ENTRIES = 64
const SCORE_TIMEOUT_MS = 7_000

const summarizeInvocation = (invocation: ToolInvocation): string => {
  const candidate =
    invocation.input.command ?? invocation.input.file_path ?? invocation.input.path ?? invocation.name
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
    if (!shouldScoreGuardianAction(invocation)) return
    const state = this.stateFor(invocation.threadID, invocation.turnID)
    const index = state.nextIndex++
    const actionHash = guardianActionHash(invocation)
    const authorizationVersion = guardianAuthorizationVersion(this.db, invocation.threadID)
    const sensitivity = guardianActionSensitivity(invocation)
    const entry: ScoreEntry = {
      callID: invocation.id,
      index,
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
    entry.promise = this.score(invocation, entry)
    state.entries.push(entry)
    state.byCall.set(entry.callID, entry)
    if (state.entries.length > MAX_ENTRIES) {
      const removed = state.entries.splice(0, state.entries.length - MAX_ENTRIES)
      for (const item of removed) state.byCall.delete(item.callID)
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
      .filter((entry) => entry.settled && !entry.failed && entry.index < current)
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

  /** Records the enforced outcome so later scores can be invalidated. */
  recordDecision(invocation: ToolInvocation, decision: 'allow' | 'ask' | 'deny'): void {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return
    const entry = state.byCall.get(invocation.id)
    if (entry) entry.decision = decision
    // A human confirmation or a denial means the turn is no longer the same
    // trajectory the classifier evaluated. Drop every reuse candidate.
    if (decision !== 'allow') {
      for (const item of state.entries) {
        item.failed = true
        item.predictedRisk = 'high'
        item.trajectoryRisk = 'high'
      }
    }
  }

  cachedAllow(invocation: ToolInvocation): PermissionDecision | null {
    const entry = this.selectLowRisk(invocation)
    if (!entry) return null
    const state = this.stateFor(invocation.threadID, invocation.turnID)
    const current = state.byCall.get(invocation.id)?.index ?? state.nextIndex - 1
    return this.allowFromScore(
      entry,
      Math.max(0, current - entry.index),
      entry.actionHash !== guardianActionHash(invocation),
    )
  }

  async waitForLowRisk(
    invocation: ToolInvocation,
    signal: AbortSignal,
    timeoutMs = 2_500,
  ): Promise<PermissionDecision | null> {
    const cached = this.cachedAllow(invocation)
    if (cached) return cached
    if (signal.aborted) return null
    const state = this.stateFor(invocation.threadID, invocation.turnID)
    const entry = state.byCall.get(invocation.id)
    if (!entry) return null
    const winner = await Promise.race([
      entry.promise.then(() => 'settled' as const),
      this.timeout(signal, timeoutMs),
    ])
    if (winner !== 'settled') return null
    if (signal.aborted) return null
    if (
      entry.failed ||
      entry.risk !== 'low' ||
      entry.authorizationVersion !== guardianAuthorizationVersion(this.db, invocation.threadID)
    ) {
      return null
    }
    const current = state.byCall.get(invocation.id)?.index ?? entry.index
    if (current - entry.index > MAX_TOOL_CALL_LAG) return null
    return this.allowFromScore(
      entry,
      Math.max(0, current - entry.index),
      entry.actionHash !== guardianActionHash(invocation),
    )
  }

  clearThread(threadID: string): void {
    this.threads.delete(threadID)
  }

  /** A synchronous denial overrides low async scores for the whole turn. */
  invalidateAction(invocation: ToolInvocation): void {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return
    for (const entry of state.entries) {
      entry.risk = 'high'
      entry.predictedRisk = 'high'
      entry.trajectoryRisk = 'high'
      entry.failed = true
    }
  }

  private selectLowRisk(invocation: ToolInvocation): ScoreEntry | null {
    const state = this.threads.get(invocation.threadID)
    if (!state || state.turnID !== invocation.turnID) return null
    const current = state.byCall.get(invocation.id)?.index ?? state.nextIndex - 1
    const authorizationVersion = guardianAuthorizationVersion(this.db, invocation.threadID)
    const actionHash = guardianActionHash(invocation)
    const sensitivity = guardianActionSensitivity(invocation)
    let best: ScoreEntry | null = null
    for (const entry of state.entries) {
      if (entry.failed || !entry.settled) continue
      if (entry.authorizationVersion !== authorizationVersion) continue
      if (entry.index > current) continue
      if (current - entry.index > MAX_TOOL_CALL_LAG) continue
      if (entry.actionHash === actionHash) {
        if (entry.risk !== 'low') continue
      } else if (
        !this.reusableAcrossActions(entry, sensitivity) ||
        entry.risk !== 'low' ||
        entry.predictedRisk !== 'low' ||
        entry.trajectoryRisk !== 'low'
      ) {
        continue
      }
      if (!best || entry.index > best.index) best = entry
    }
    return best
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
      }),
    }
  }

  private async score(invocation: ToolInvocation, entry: ScoreEntry): Promise<void> {
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
      if (guardianAuthorizationVersion(this.db, invocation.threadID) !== entry.authorizationVersion) {
        entry.risk = 'high'
        entry.failed = true
        return
      }
      entry.risk = result.risk
      entry.trajectoryRisk = result.trajectory_risk ?? result.risk
      entry.predictedRisk = result.predicted_risk ?? result.risk
      entry.failed = false
    } catch {
      entry.risk = 'high'
      entry.trajectoryRisk = 'high'
      entry.predictedRisk = 'high'
      entry.failed = true
    } finally {
      entry.settled = true
      clearTimeout(timeout)
    }
  }

  private stateFor(threadID: string, turnID: string): ThreadState {
    const current = this.threads.get(threadID)
    if (current && current.turnID === turnID) return current
    const next: ThreadState = {
      turnID,
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
