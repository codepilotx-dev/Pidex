import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { PermissionDecision, ToolInvocation } from '../Domain'
import {
  analyzeShellRisk,
  RISK_CATEGORIES,
  type RiskCategory,
  type ShellRiskLevel,
} from '../security/ShellRiskClassifier'

/**
 * Guardian Beta fidelity layer.
 *
 * Mirrors the Codex Guardian split between policy, evidence and enforcement:
 * - a verdict is structured (risk + user authorization + rationale)
 * - decisions are bound to an action hash and an authorization version
 * - low-risk async scores may satisfy an approval before the synchronous reviewer
 * - repeated denials open a per-turn circuit breaker
 *
 * The reviewer can inspect bounded workspace evidence through host-owned read
 * APIs, but it never executes a command, writes a file or widens the requested
 * scope.
 */

export const guardianUserAuthorizationSchema = z.enum(['unknown', 'low', 'medium', 'high'])
export type GuardianUserAuthorization = z.infer<typeof guardianUserAuthorizationSchema>

export const guardianConfidenceSchema = z.enum(['low', 'medium', 'high'])
export type GuardianConfidence = z.infer<typeof guardianConfidenceSchema>

export const guardianRiskSchema = z.enum(['low', 'medium', 'high', 'critical'])

export const guardianVerdictSchema = z.object({
  decision: z.enum(['allow', 'ask', 'deny']),
  risk: guardianRiskSchema,
  user_authorization: guardianUserAuthorizationSchema.optional().default('unknown'),
  confidence: guardianConfidenceSchema.optional().default('medium'),
  categories: z.array(z.enum(RISK_CATEGORIES)).optional().default([]),
  requested_scope_valid: z.boolean().optional().default(true),
  reason: z.string().min(1),
})
export type GuardianVerdictInput = z.infer<typeof guardianVerdictSchema>

export const guardianScopeClasses = [
  'read',
  'shell',
  'file-write',
  'network',
  'system',
  'unknown',
] as const
export type GuardianScopeClass = (typeof guardianScopeClasses)[number]

export const guardianClassificationSchema = z.object({
  risk: z.enum(['low', 'high']),
  /** Risk of the recent trajectory, not just the sampled action. */
  trajectory_risk: z.enum(['low', 'high']).optional(),
  /** Predicted risk of the next action in the same trajectory. */
  predicted_risk: z.enum(['low', 'high']).optional(),
  scope_class: z.enum(guardianScopeClasses).optional(),
  reason: z.string().optional().default(''),
})
export type GuardianClassification = z.infer<typeof guardianClassificationSchema>

export type GuardianTrajectoryEntry = {
  tool: string
  scope: GuardianScopeClass
  risk: ShellRiskLevel
  decision?: 'allow' | 'ask' | 'deny'
  sensitive: boolean
  summary?: string
}

export type GuardianReviewStatus =
  | 'completed'
  | 'cached'
  | 'unavailable'
  | 'timeout'
  | 'circuit_open'

export type GuardianReviewSource = 'model' | 'cache' | 'fallback'

export type GuardianReview = {
  status: GuardianReviewStatus
  source: GuardianReviewSource
  risk: ShellRiskLevel
  userAuthorization: GuardianUserAuthorization
  confidence: GuardianConfidence
  categories: RiskCategory[]
  rationale: string
  reviewedAt: number
  scoreLag?: number
  fallbackReason?: string
  model?: string
}

export type GuardianPolicyResult = {
  decision: 'allow' | 'ask' | 'deny'
  reason: string
}

const riskRank: Record<ShellRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

const authorizationRank: Record<GuardianUserAuthorization, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
}

export const maxGuardianRisk = (
  first: ShellRiskLevel,
  second: ShellRiskLevel,
): ShellRiskLevel => (riskRank[first] >= riskRank[second] ? first : second)

export const mergeGuardianCategories = (
  first: readonly RiskCategory[],
  second: readonly RiskCategory[],
): RiskCategory[] => [...new Set([...first, ...second])]

/**
 * Codex-style outcome policy, adapted to Pidex's existing shell taxonomy.
 *
 * Critical risk is never auto-approved. High risk requires at least medium
 * authorization. Low risk may be approved with high confidence even when the
 * model could not establish explicit authorization. Everything uncertain
 * degrades to `ask`, never to a silent allow.
 */
export function applyGuardianPolicy(input: {
  verdict: GuardianVerdictInput
  staticRisk: ShellRiskLevel
  staticCategories: readonly RiskCategory[]
  retryAuthorized: boolean
}): GuardianPolicyResult & {
  risk: ShellRiskLevel
  categories: RiskCategory[]
  userAuthorization: GuardianUserAuthorization
  confidence: GuardianConfidence
} {
  const { verdict, staticRisk, retryAuthorized } = input
  const risk = maxGuardianRisk(staticRisk, verdict.risk)
  const categories = mergeGuardianCategories(input.staticCategories, verdict.categories)
  const authorization = verdict.user_authorization
  const authorizationLevel = authorizationRank[authorization]

  if (!verdict.requested_scope_valid) {
    return {
      decision: 'deny',
      reason: '申请的额外权限范围未通过 Guardian 审核',
      risk,
      categories,
      userAuthorization: authorization,
      confidence: verdict.confidence,
    }
  }
  if (risk === 'critical') {
    return {
      decision: 'deny',
      reason: `命令达到灾难级风险，Guardian 拒绝自动执行：${verdict.reason}`,
      risk,
      categories,
      userAuthorization: authorization,
      confidence: verdict.confidence,
    }
  }
  if (risk === 'high' && authorizationLevel < authorizationRank.medium) {
    return {
      decision: 'deny',
      reason: `高风险操作缺少足够的用户授权（${authorization}）：${verdict.reason}`,
      risk,
      categories,
      userAuthorization: authorization,
      confidence: verdict.confidence,
    }
  }
  if (verdict.decision === 'allow' && verdict.confidence !== 'high') {
    return {
      decision: 'ask',
      reason: `Guardian 审核置信度不足（${verdict.confidence}），转人工确认：${verdict.reason}`,
      risk,
      categories,
      userAuthorization: authorization,
      confidence: verdict.confidence,
    }
  }
  if (
    verdict.decision === 'allow' &&
    risk !== 'low' &&
    authorizationLevel < authorizationRank.medium
  ) {
    return {
      decision: 'ask',
      reason: `操作风险为 ${risk}，但用户授权不足（${authorization}），转人工确认：${verdict.reason}`,
      risk,
      categories,
      userAuthorization: authorization,
      confidence: verdict.confidence,
    }
  }
  if (verdict.decision === 'allow' && retryAuthorized && risk === 'high') {
    // A user-authorized retry still needs a precise, high-confidence verdict.
    if (authorizationLevel < authorizationRank.medium) {
      return {
        decision: 'deny',
        reason: `用户授权重试未覆盖此高风险操作：${verdict.reason}`,
        risk,
        categories,
        userAuthorization: authorization,
        confidence: verdict.confidence,
      }
    }
  }
  return {
    decision: verdict.decision,
    reason: verdict.reason,
    risk,
    categories,
    userAuthorization: authorization,
    confidence: verdict.confidence,
  }
}

export function guardianReview(input: {
  status: GuardianReviewStatus
  source: GuardianReviewSource
  risk: ShellRiskLevel
  userAuthorization: GuardianUserAuthorization
  confidence: GuardianConfidence
  categories: readonly RiskCategory[]
  rationale: string
  reviewedAt?: number
  scoreLag?: number
  fallbackReason?: string
  model?: string
}): GuardianReview {
  return {
    status: input.status,
    source: input.source,
    risk: input.risk,
    userAuthorization: input.userAuthorization,
    confidence: input.confidence,
    categories: [...input.categories],
    rationale: input.rationale,
    reviewedAt: input.reviewedAt ?? Date.now(),
    ...(input.scoreLag === undefined ? {} : { scoreLag: input.scoreLag }),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.model ? { model: input.model } : {}),
  }
}

export function attachGuardianReview(
  decision: PermissionDecision,
  review: GuardianReview,
): PermissionDecision {
  return { ...decision, guardian: review }
}

export function guardianFallbackDecision(input: {
  risk: ShellRiskLevel
  status: 'unavailable' | 'timeout' | 'circuit_open'
  reason: string
  approvalPolicy: unknown
  categories?: readonly RiskCategory[]
}): PermissionDecision {
  const decision =
    input.approvalPolicy === 'never' || input.status === 'circuit_open'
      ? 'deny'
      : input.approvalPolicy === 'untrusted'
        ? 'deny'
        : 'ask'
  return {
    decision,
    risk: input.risk,
    reason: input.reason,
    fallbackReason: input.reason,
    guardian: guardianReview({
      status: input.status,
      source: 'fallback',
      risk: input.risk,
      userAuthorization: 'unknown',
      confidence: 'low',
      categories: input.categories ?? [],
      rationale: input.reason,
      fallbackReason: input.reason,
    }),
  }
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

export function guardianActionHash(invocation: ToolInvocation): string {
  const scope = invocation.authorizationScope
  return createHash('sha256')
    .update(
      stable({
        tool: invocation.name,
        // The reviewer input collapses file mutations to a patch hash and path
        // list. Bind the fast path to that same host-owned scope rather than the
        // presentation-only input rewrite.
        ...(scope && scope.affectedPaths.length > 0
          ? {
              scope: {
                fingerprint: scope.fingerprint,
                affectedPaths: scope.affectedPaths,
              },
            }
          : { input: invocation.input }),
        taskMode: invocation.taskMode,
        permissions: invocation.permissionConfig,
      }),
      'utf8',
    )
    .digest('hex')
}

/**
 * A compaction-stable approximation of Codex's `user_message_revision`.
 * Assistant messages, tool output and compaction do not change it. Subagent
 * threads also bind the root conversation, because only the root user can
 * authorize the delegated action.
 */
export function guardianAuthorizationVersion(
  db: Pick<AgentDatabase, 'sqlite'> | undefined,
  threadID: string,
): string {
  if (!db?.sqlite) return 'no-db'
  try {
    const rootThreadID = guardianRootThreadID(db, threadID)
    return createHash('sha256')
      .update(
        stable({
          threadID,
          rootThreadID,
          local: userMessageFingerprint(db.sqlite, threadID),
          root:
            rootThreadID === threadID ? null : userMessageFingerprint(db.sqlite, rootThreadID),
        }),
        'utf8',
      )
      .digest('hex')
  } catch {
    return 'unavailable'
  }
}

export function guardianRootThreadID(
  db: Pick<AgentDatabase, 'sqlite'> | undefined,
  threadID: string,
): string {
  if (!db?.sqlite) return threadID
  let current = threadID
  try {
    for (let depth = 0; depth < 8; depth += 1) {
      const row = db.sqlite
        .query('SELECT parent_thread_id FROM threads WHERE id = ?')
        .get(current) as { parent_thread_id: string | null } | null
      if (!row?.parent_thread_id || row.parent_thread_id === current) break
      current = row.parent_thread_id
    }
  } catch {
    return threadID
  }
  return current
}

function userMessageFingerprint(
  sqlite: NonNullable<Pick<AgentDatabase, 'sqlite'>['sqlite']>,
  threadID: string,
): { count: number; messageIDs: string[] } {
  const rows = sqlite
    .query(
      `SELECT id FROM messages WHERE thread_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 32`,
    )
    .all(threadID) as Array<{ id: string }>
  const count = sqlite
    .query(`SELECT count(*) AS count FROM messages WHERE thread_id = ? AND role = 'user'`)
    .get(threadID) as { count: number } | null
  return { count: count?.count ?? 0, messageIDs: rows.map((row) => row.id) }
}

export type GuardianCircuitState = {
  turnID: string
  consecutiveDenials: number
  recent: boolean[]
  open: boolean
}

const CIRCUIT_MAX_CONSECUTIVE_DENIALS = 3
const CIRCUIT_MAX_RECENT_DENIALS = 10
const CIRCUIT_WINDOW = 50
const CIRCUIT_MAX_THREADS = 256

export class GuardianCircuitBreaker {
  private readonly states = new Map<string, GuardianCircuitState>()

  check(threadID: string, turnID: string): { open: boolean; reason?: string } {
    const state = this.stateFor(threadID, turnID)
    if (!state.open) return { open: false }
    return {
      open: true,
      reason: `自动审查本轮已拒绝 ${state.consecutiveDenials} 次（最近 ${CIRCUIT_WINDOW} 次中 ${this.recentDenials(state)} 次），已中断本轮并转人工确认`,
    }
  }

  record(
    threadID: string,
    turnID: string,
    decision: 'allow' | 'ask' | 'deny',
  ): { tripped: boolean; reason?: string } {
    const state = this.stateFor(threadID, turnID)
    state.recent.push(decision === 'deny')
    if (state.recent.length > CIRCUIT_WINDOW) state.recent.shift()
    if (decision === 'deny') {
      state.consecutiveDenials += 1
    } else {
      state.consecutiveDenials = 0
    }
    if (
      !state.open &&
      (state.consecutiveDenials >= CIRCUIT_MAX_CONSECUTIVE_DENIALS ||
        this.recentDenials(state) >= CIRCUIT_MAX_RECENT_DENIALS)
    ) {
      state.open = true
      return {
        tripped: true,
        reason: `自动审查本轮已拒绝 ${state.consecutiveDenials} 次（最近 ${CIRCUIT_WINDOW} 次中 ${this.recentDenials(state)} 次），已中断本轮并转人工确认`,
      }
    }
    return { tripped: false }
  }

  reset(threadID: string): void {
    this.states.delete(threadID)
  }

  private stateFor(threadID: string, turnID: string): GuardianCircuitState {
    const current = this.states.get(threadID)
    if (current && current.turnID === turnID) return current
    const next: GuardianCircuitState = {
      turnID,
      consecutiveDenials: 0,
      recent: [],
      open: false,
    }
    this.states.set(threadID, next)
    if (this.states.size > CIRCUIT_MAX_THREADS) {
      const oldest = this.states.keys().next().value
      if (oldest !== undefined && oldest !== threadID) this.states.delete(oldest)
    }
    return next
  }

  private recentDenials(state: GuardianCircuitState): number {
    return state.recent.filter(Boolean).length
  }
}

/**
 * Only score actions that can plausibly require an approval. Read-only file
 * inspection stays on the deterministic path, which keeps the fast path cheap.
 */
export function shouldScoreGuardianAction(invocation: ToolInvocation): boolean {
  if (invocation.permissionConfig.approvalsReviewer !== 'auto_review') return false
  if (invocation.permissionConfig.approvalPolicy === 'never') return false
  if (invocation.permissionConfig.sandboxMode === 'danger-full-access') return false
  if (invocation.durableApproval) return false
  const capabilities = invocation.toolPolicy?.capabilities
  if (!capabilities) return true
  if (invocation.name === 'request_permissions') return true
  return (
    capabilities.process ||
    capabilities.network !== 'none' ||
    capabilities.filesystem === 'workspace-write' ||
    capabilities.filesystem === 'host-write'
  )
}

/**
 * Coarse capability class used to decide whether an async score may be reused
 * for a later action. Scores never cross from a narrow class into a destructive
 * or externally visible class.
 */
export function guardianScopeClass(invocation: ToolInvocation): GuardianScopeClass {
  if (invocation.name === 'request_permissions') return 'system'
  const capabilities = invocation.toolPolicy?.capabilities
  if (!capabilities) return 'unknown'
  if (capabilities.process) return 'shell'
  if (capabilities.network !== 'none') return 'network'
  if (
    capabilities.filesystem === 'workspace-write' ||
    capabilities.filesystem === 'host-write'
  )
    return 'file-write'
  return 'read'
}

const SENSITIVE_CATEGORIES = new Set<RiskCategory>([
  'destructive',
  'irreversible_change',
  'system_modification',
  'security_control',
  'credential_access',
  'credential_exfiltration',
  'privilege_escalation',
  'persistence',
  'network_access',
  'scope_escape',
])

/**
 * Cross-action reuse for shell is restricted to commands that cannot mutate
 * state. The static classifier intentionally treats ordinary package scripts as
 * low risk, so it cannot be used as the sole reuse gate.
 */
const READ_ONLY_SHELL =
  /^(?:git\s+(?:status|diff|log|show|rev-parse|branch(?:\s+--list)?)|ls|dir|cat|type|head|tail|wc|rg|grep|find|pwd|echo|get-childitem|get-content|select-string)\b/i
const SHELL_SIDE_EFFECT = /[>|;&]|\$\(|`/

export function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || SHELL_SIDE_EFFECT.test(trimmed)) return false
  return READ_ONLY_SHELL.test(trimmed)
}

/**
 * Cross-action score reuse is only safe for actions that are independently
 * low risk. Any elevated static risk, sensitive category or unknown capability
 * keeps the score bound to the exact action it classified.
 */
export function guardianActionSensitivity(invocation: ToolInvocation): {
  scope: GuardianScopeClass
  sensitive: boolean
} {
  const scope = guardianScopeClass(invocation)
  if (scope === 'network' || scope === 'system' || scope === 'unknown')
    return { scope, sensitive: true }
  if (scope === 'file-write') return { scope, sensitive: true }
  if (scope !== 'shell') return { scope, sensitive: false }
  const command = invocation.input.command
  if (typeof command !== 'string') return { scope, sensitive: true }
  const analysis = analyzeShellRisk({
    command,
    ...(typeof invocation.input.cwd === 'string' ? { cwd: invocation.input.cwd } : {}),
  })
  const sensitive =
    !isReadOnlyShellCommand(command) ||
    analysis.risk !== 'low' ||
    analysis.categories.some((category) => SENSITIVE_CATEGORIES.has(category))
  return { scope, sensitive }
}

export function guardianStatusLabel(status: GuardianReviewStatus): string {
  switch (status) {
    case 'completed':
      return '审查完成'
    case 'cached':
      return '低风险自动放行'
    case 'unavailable':
      return '审查不可用'
    case 'timeout':
      return '审查超时'
    case 'circuit_open':
      return '本轮已中断'
  }
}
