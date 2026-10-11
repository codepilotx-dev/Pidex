import { Effect } from 'effect'
import { createHash } from 'node:crypto'
import { AgentError, type PermissionDecision, type ToolInvocation } from '../Domain'
import type {
  AgentDatabase,
  ApprovalCheckpointPayload,
  StoredApprovalCheckpoint,
} from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type { InteractionOperationInput } from '../storage/repositories/InteractionRepository'
import type { ToolRegistry } from '../tool/ToolRegistry'
import {
  PermissionDecisionEngine,
  requestedPermissions,
  type ResolvedPermissionDecision,
} from './PermissionDecisionEngine'
import { secretScrubber } from '../security/SecretScrubber'
import { ApprovalRules } from './ApprovalRules'
import type { ConfigService } from '../config/ConfigService'
import { analyzeShellRisk } from '../security/ShellRiskClassifier'
import type { BrowserService } from '../browser/BrowserService'
import type { ApprovalRule } from './ApprovalRules'

export type Reviewer = (
  invocation: ToolInvocation,
  signal: AbortSignal,
) => Promise<PermissionDecision>

export type PermissionGrantResolution = {
  scope: 'tool-call' | 'turn' | 'session'
  grantedPermissions: {
    readPaths?: string[]
    writePaths?: string[]
    networkDomains?: string[]
  }
}

const PERMISSION_GRANT_PREFIX = '__permission_grant_v1__:'

export type PreparedApprovalCheckpoint = {
  approvalID: string
  invocation: ToolInvocation
  review: PermissionDecision
  requestPayload: Record<string, unknown>
  checkpoint: ApprovalCheckpointPayload
  version: 1
  createdAt: number
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

const checkpointHash = (
  payload: Omit<ApprovalCheckpointPayload, 'invocationHash' | 'resolution' | 'claimedAt'>,
  version: number,
) =>
  createHash('sha256')
    .update(stable({ ...payload, version }), 'utf8')
    .digest('hex')
const sandboxEscalationHash = (invocation: ToolInvocation, failure: string) =>
  createHash('sha256').update(stable({ invocation, failure }), 'utf8').digest('hex')
const allowedPermissionScopes = (requested: unknown): Array<PermissionGrantResolution['scope']> =>
  requested === 'session'
    ? ['tool-call', 'turn', 'session']
    : requested === 'turn'
      ? ['tool-call', 'turn']
      : ['tool-call']

const reviewerInvocation = (invocation: ToolInvocation): ToolInvocation => {
  const { fileDiffs: _fileDiffs, ...reviewable } = invocation
  const scope = invocation.authorizationScope
  return scope && scope.affectedPaths.length > 0
    ? {
        ...reviewable,
        input: {
          patchHash: scope.fingerprint,
          affectedPaths: scope.affectedPaths,
          summary: scope.reviewSummary ?? null,
        },
      }
    : reviewable
}

const approvalScopePayload = (invocation: ToolInvocation) =>
  invocation.authorizationScope
    ? {
        affectedPaths: invocation.authorizationScope.affectedPaths,
        ...(invocation.authorizationScope.computerApp
          ? { computerApp: invocation.authorizationScope.computerApp }
          : {}),
        ...(invocation.authorizationScope.reviewSummary
          ? { reviewSummary: invocation.authorizationScope.reviewSummary }
          : {}),
      }
    : {}

export class ApprovalService {
  readonly rules: ApprovalRules
  private readonly decisions = new PermissionDecisionEngine()
  private agentStatusHandler?: (agentID: string, status: 'waiting_permission' | 'running') => void

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly tools: ToolRegistry,
    private readonly reviewer: Reviewer | null = null,
    config?: ConfigService,
    private readonly browser?: BrowserService,
  ) {
    this.rules = new ApprovalRules(db, tools, config)
  }

  approvalMetadata(invocation: ToolInvocation) {
    const origin = (invocation.toolPolicy ?? this.tools.get(invocation.name)).origin
    return {
      grantOptions: [
        ...this.rules.options(invocation),
        ...this.browserRules(invocation).map((rule) => ({
          id: rule.id,
          kind: 'browser' as const,
          scope: rule.scope,
          label:
            rule.scope === 'session'
              ? '此聊天允许此网站'
              : rule.scope === 'origin'
                ? `始终允许 ${rule.target[0]}`
                : '允许所有网站',
          ...(rule.scope === 'all-sites' ? { requiresConfirmation: true } : {}),
        })),
      ],
      ...(origin?.kind === 'mcp'
        ? {
            toolIdentity: { server: origin.serverName, tool: origin.rawToolName },
            input: invocation.input,
          }
        : {}),
      ...(invocation.fileDiffs?.length
        ? { input: { approvalFileDiffs: invocation.fileDiffs } }
        : {}),
      ...approvalScopePayload(invocation),
    }
  }
  private browserRules(invocation: ToolInvocation): ApprovalRule[] {
    const origin = invocation.authorizationScope?.browserOrigin
    if (!origin || !this.browser || invocation.permissionFacts?.hookRequiresApproval) return []
    return (['session', 'origin', 'all-sites'] as const).map((scope) => ({
      id: `${invocation.authorizationScope!.fingerprint}:${scope}`,
      kind: 'browser',
      scope,
      workspace: '',
      target: [origin],
    }))
  }
  validateGrant(invocation: ToolInvocation, id: string): ApprovalRule {
    return (
      this.browserRules(invocation).find((rule) => rule.id === id) ??
      this.rules.validate(invocation, id)
    )
  }

  setAgentStatusHandler(
    handler: (agentID: string, status: 'waiting_permission' | 'running') => void,
  ) {
    this.agentStatusHandler = handler
  }

  private async emit(threadID: string, turnID: string, method: string, params: unknown) {
    const event = this.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.hub.publish(event))
    return event
  }

  async authorize(invocation: ToolInvocation, signal: AbortSignal): Promise<PermissionDecision> {
    const tool = (invocation.toolPolicy ??
      this.tools.get(invocation.name)) as import('../tool/ToolRegistry').ToolCatalogEntry
    if (typeof invocation.input.command === 'string') {
      const analysis = analyzeShellRisk({
        command: invocation.input.command,
        ...(typeof invocation.input.cwd === 'string' ? { cwd: invocation.input.cwd } : {}),
      })
      if (analysis.hardDenied)
        return { decision: 'deny', risk: analysis.risk, reason: analysis.reason }
    }
    const resolved = this.decisions.evaluate(invocation, tool)
    const safeInvocation = secretScrubber.scrub(invocation)
    if (resolved.action !== 'review')
      return { decision: resolved.decision, risk: resolved.risk, reason: resolved.reason }
    if (
      resolved.reviewer === 'user' &&
      ((await this.rules.matches(invocation)) ||
        !!(
          invocation.authorizationScope?.browserOrigin &&
          this.browser?.isGranted(invocation.threadID, invocation.authorizationScope.browserOrigin)
        ))
    )
      return { decision: 'allow', risk: resolved.risk, reason: '已匹配用户授予的审批范围' }
    if (resolved.reviewer === 'auto_review' && this.reviewer) {
      const fingerprint = this.retryFingerprint(invocation)
      const retryAuthorization = this.db.repositories.interactions.claimApprovalRetry(
        invocation.threadID,
        fingerprint,
      )
      let reviewed: PermissionDecision
      try {
        reviewed = await this.reviewer(
          reviewerInvocation({
            ...safeInvocation,
            ...(retryAuthorization ? { retryAuthorization } : {}),
          }),
          signal,
        )
      } catch (cause) {
        const denied = invocation.permissionConfig.approvalPolicy === 'never'
        reviewed = {
          decision: denied ? 'deny' : 'ask',
          risk: resolved.risk,
          reason: `Guardian 不可用，${denied ? '已拒绝' : '转人工确认'}：${secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))}`,
        }
      }
      const event = this.db.repositories.interactions.recordApprovalReview(
        safeInvocation,
        fingerprint,
        reviewed,
      )
      if (event) await Promise.allSettled([Effect.runPromise(this.hub.publish(event))])
      if (reviewed.decision !== 'ask') return reviewed
      return this.checkpointForHuman(safeInvocation, reviewed, resolved)
    }
    if (
      resolved.reviewer === 'auto_review' &&
      invocation.permissionConfig.approvalPolicy === 'never'
    )
      return {
        decision: 'deny',
        risk: resolved.risk,
        reason: '未配置独立 Guardian，never 策略下拒绝',
      }
    const review = {
      decision: 'ask',
      risk: resolved.risk,
      reason:
        resolved.reviewer === 'auto_review' ? '未配置独立 Guardian，转人工确认' : resolved.reason,
    } satisfies PermissionDecision
    return this.checkpointForHuman(safeInvocation, review, resolved)
  }
  private retryFingerprint(invocation: ToolInvocation): string {
    return createHash('sha256')
      .update(
        stable({
          tool: invocation.name,
          input: invocation.input,
          scope: invocation.authorizationScope,
          permissions: invocation.permissionConfig,
          workspace: this.db.threadWorkspace(invocation.threadID),
          taskMode: invocation.taskMode,
        }),
      )
      .digest('hex')
  }
  requestRetry(threadID: string, reviewID: string, operationID: string) {
    return this.db.repositories.interactions.authorizeApprovalRetry(threadID, reviewID, operationID)
  }

  prepare(
    invocation: ToolInvocation,
    review: PermissionDecision,
    resolved: Extract<ResolvedPermissionDecision, { action: 'review' }>,
  ): PreparedApprovalCheckpoint {
    const safeInvocation = secretScrubber.scrub(invocation)
    const id = crypto.randomUUID()
    const createdAt = Date.now()
    const base = {
      kind: 'tool-approval' as const,
      invocation: safeInvocation,
      permissionSnapshot: safeInvocation.permissionConfig,
      sandbox: resolved.sandbox as unknown as Record<string, unknown>,
      reviewer: resolved.reviewer,
      review: secretScrubber.scrub(review) as unknown as Record<string, unknown>,
    }
    const checkpoint: ApprovalCheckpointPayload = {
      ...base,
      invocationHash: checkpointHash(base, 1),
    }
    return {
      approvalID: id,
      invocation: safeInvocation,
      review,
      requestPayload: {
        version: 1,
        command: safeInvocation.input.command ?? null,
        cwd: safeInvocation.input.cwd ?? null,
        requestedPermissions: requestedPermissions(safeInvocation.input),
        ...this.approvalMetadata(safeInvocation),
        // Dynamic permission requests persist their grant metadata so the
        // thread projection can restore permissionGrant without live events.
        ...(safeInvocation.name === 'request_permissions'
          ? {
              kind: 'permission',
              requestedScope: ['tool-call', 'turn', 'session'].includes(
                String(safeInvocation.input.scope),
              )
                ? safeInvocation.input.scope
                : 'tool-call',
              allowedScopes: allowedPermissionScopes(safeInvocation.input.scope),
            }
          : {}),
      },
      checkpoint,
      version: 1,
      createdAt,
    }
  }

  persist(prepared: PreparedApprovalCheckpoint) {
    return this.db.persistApprovalCheckpoint({
      approvalID: prepared.approvalID,
      invocation: prepared.invocation,
      risk: prepared.review.risk,
      reason: prepared.review.reason,
      requestPayload: prepared.requestPayload,
      reviewPayload: prepared.review.review
        ? (secretScrubber.scrub(prepared.review.review) as unknown as Record<string, unknown>)
        : null,
      checkpoint: prepared.checkpoint,
      version: prepared.version,
      createdAt: prepared.createdAt,
    })
  }

  load(id: string) {
    const checkpoint = this.db.getApprovalCheckpoint(id)
    if (!checkpoint) return null
    const {
      invocationHash: _hash,
      resolution: _resolution,
      claimedAt: _claimedAt,
      ...base
    } = checkpoint.payload
    if (
      checkpoint.version !== 1 ||
      checkpoint.payload.kind !== 'tool-approval' ||
      checkpoint.payload.invocationHash !== checkpointHash(base, checkpoint.version)
    )
      throw new AgentError('APPROVAL_CHECKPOINT_INVALID', '审批 checkpoint 无效或已被篡改', 409)
    return checkpoint
  }

  async attachRunState(toolCallID: string, state: string, interruption: unknown) {
    const stored = this.db.approvalCheckpointForToolCall(toolCallID)
    if (!stored)
      throw new AgentError('APPROVAL_CHECKPOINT_MISSING', '工具审批没有对应的 durable request', 409)
    this.load(stored.approvalID)
    let scrubbedState: string
    try {
      scrubbedState = secretScrubber.assertSafeOpaqueState(state)
    } catch {
      this.db.invalidateApprovalCheckpoint(stored.approvalID, 'RunState 包含无法安全脱敏的凭据')
      throw new AgentError(
        'APPROVAL_RUN_STATE_SECRET_DENIED',
        '审批 RunState 包含无法安全脱敏的凭据，已拒绝持久化',
        403,
      )
    }
    const safeInterruption = secretScrubber.scrub(interruption)
    const {
      invocationHash: _hash,
      resolution: _resolution,
      claimedAt: _claimedAt,
      ...base
    } = stored.payload
    const nextBase = { ...base, runState: scrubbedState, interruption: safeInterruption }
    const payload: ApprovalCheckpointPayload = {
      ...nextBase,
      invocationHash: checkpointHash(nextBase, stored.version),
    }
    const invocation = payload.invocation
    const requestedParams =
      invocation.name === 'request_permissions'
        ? {
            interactionId: stored.approvalID,
            threadId: stored.threadID,
            turnId: stored.turnID,
            agentId: stored.agentID,
            createdAt: stored.createdAt,
            version: stored.version,
            kind: 'permission',
            toolCallId: stored.toolCallID,
            tool: invocation.name,
            reason:
              typeof invocation.input.justification === 'string'
                ? invocation.input.justification
                : stored.reason,
            requestedPermissions: requestedPermissions(invocation.input),
            requestedScope: ['tool-call', 'turn', 'session'].includes(
              String(invocation.input.scope),
            )
              ? invocation.input.scope
              : 'tool-call',
            allowedScopes: allowedPermissionScopes(invocation.input.scope),
            risk: ['low', 'medium', 'high', 'critical'].includes(stored.risk)
              ? stored.risk
              : 'high',
          }
        : {
            interactionId: stored.approvalID,
            threadId: stored.threadID,
            turnId: stored.turnID,
            agentId: stored.agentID,
            createdAt: stored.createdAt,
            version: stored.version,
            kind: 'approval',
            toolCallId: stored.toolCallID,
            tool: invocation.name,
            risk: ['low', 'medium', 'high', 'critical'].includes(stored.risk)
              ? stored.risk
              : 'high',
            reason: stored.reason || '需要批准工具调用',
            ...(typeof invocation.input.command === 'string'
              ? { command: invocation.input.command }
              : {}),
            ...(typeof invocation.input.cwd === 'string' ? { cwd: invocation.input.cwd } : {}),
            requestedPermissions: requestedPermissions(invocation.input),
            ...this.approvalMetadata(invocation),
            allowedChoices: ['allow-once', 'deny', 'stop'],
          }
    const { checkpoint, events } = this.db.activateApprovalCheckpoint(
      stored.approvalID,
      payload,
      requestedParams,
    )
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
    this.agentStatusHandler?.(checkpoint.agentID, 'waiting_permission')
    return checkpoint
  }

  private async checkpointForHuman(
    invocation: ToolInvocation,
    review: PermissionDecision,
    resolved: Extract<ResolvedPermissionDecision, { action: 'review' }>,
  ): Promise<PermissionDecision> {
    // Direct host calls (for example command Hooks) do not own an SDK RunState and
    // therefore cannot create a checkpoint that could ever be resumed safely.
    if (!invocation.durableApproval) return { ...review, decision: 'ask', reason: review.reason }
    const existing = this.db.approvalCheckpointForToolCall(invocation.id)
    if (existing) return { ...review, decision: 'ask', reason: review.reason }
    const prepared = this.prepare(invocation, review, resolved)
    this.persist(prepared)
    return { ...review, decision: 'ask', reason: review.reason }
  }

  async respond(
    id: string,
    decision: 'allow' | 'deny',
    feedback?: string,
    operation?: InteractionOperationInput,
    computerGrant?: 'chat' | 'persistent',
    grantOptionId?: string,
  ) {
    try {
      this.load(id)
    } catch (cause) {
      const invalidated = this.db.invalidateApprovalCheckpoint(id, '审批 checkpoint 校验失败')
      for (const event of invalidated?.events ?? [])
        await Effect.runPromise(this.hub.publish(event))
      throw cause
    }
    const safeFeedback = feedback?.trim()
      ? secretScrubber.scrubText(feedback.trim().slice(0, 4_000))
      : undefined
    const loaded = this.load(id)
    const grantRule =
      grantOptionId && loaded && decision === 'allow'
        ? this.validateGrant(loaded.payload.invocation, grantOptionId)
        : undefined
    const result = this.db.resolveApprovalCheckpoint(
      id,
      decision,
      safeFeedback,
      operation,
      computerGrant,
      grantRule,
    )
    if (result.state === 'missing')
      throw new AgentError('APPROVAL_NOT_FOUND', '审批请求不存在', 404)
    if (result.state === 'not-ready')
      throw new AgentError('APPROVAL_NOT_READY', '审批 RunState 尚未完整落盘', 409)
    if (result.state === 'already-resolved')
      throw new AgentError('APPROVAL_ALREADY_RESOLVED', '审批请求已经处理', 409)
    if (result.state === 'invalid-checkpoint') {
      for (const event of result.events) await Effect.runPromise(this.hub.publish(event))
      throw new AgentError(
        'APPROVAL_CHECKPOINT_MISSING',
        '旧审批缺少可恢复 checkpoint，已安全取消',
        409,
      )
    }
    if (result.state !== 'resolved')
      throw new AgentError('APPROVAL_CHECKPOINT_INVALID', '审批 checkpoint 状态无效', 409)
    const checkpoint = result.checkpoint
    try {
      if (grantRule?.scope === 'project') await this.rules.persistProject(grantRule)
      if (
        grantRule?.kind === 'browser' &&
        (grantRule.scope === 'origin' || grantRule.scope === 'all-sites')
      )
        await this.browser?.grant(grantRule.target[0]!, grantRule.scope)
    } catch {
      // Resolution already owns the durable resume. A settings error must not strand it.
      const timestamp = Date.now()
      const { event } = this.db.upsertItemWithEvent(
        checkpoint.threadID,
        {
          id: `approval-grant-error:${id}`,
          turnID: checkpoint.turnID,
          agentID: checkpoint.agentID,
          type: 'activity',
          status: 'error',
          data: {
            activity: 'notice',
            title: '持久授权未保存',
            detail: '本次操作已允许，后续操作仍需审批。请在授权管理中重新设置。',
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        'item/completed',
      )
      result.events.push(event)
    }
    await Promise.allSettled(
      result.events.map((event) => Effect.runPromise(this.hub.publish(event))),
    )
    return checkpoint
  }

  respondPermission(
    id: string,
    decision: 'allow' | 'deny',
    grant?: PermissionGrantResolution,
    operation?: InteractionOperationInput,
  ) {
    const feedback =
      decision === 'allow' && grant
        ? `${PERMISSION_GRANT_PREFIX}${JSON.stringify(grant)}`
        : undefined
    return this.respond(id, decision, feedback, operation)
  }

  permissionGrantResolution(
    checkpoint: StoredApprovalCheckpoint,
  ): PermissionGrantResolution | undefined {
    if (checkpoint.payload.invocation.name !== 'request_permissions') return undefined
    const feedback = checkpoint.payload.resolution?.feedback
    if (!feedback?.startsWith(PERMISSION_GRANT_PREFIX)) return undefined
    try {
      const value = JSON.parse(
        feedback.slice(PERMISSION_GRANT_PREFIX.length),
      ) as PermissionGrantResolution
      return ['tool-call', 'turn', 'session'].includes(value.scope) &&
        value.grantedPermissions &&
        typeof value.grantedPermissions === 'object'
        ? value
        : undefined
    } catch {
      return undefined
    }
  }

  claimResume(turnID: string): StoredApprovalCheckpoint | null {
    const candidate = this.db.repositories.interactions.resolvedApprovalForResume(turnID)
    if (!candidate) return null
    try {
      const loaded = this.load(candidate.id)
      if (
        !loaded?.payload.runState ||
        loaded.payload.interruption === undefined ||
        !loaded.payload.resolution
      ) {
        throw new AgentError(
          'APPROVAL_CHECKPOINT_INCOMPLETE',
          '审批 checkpoint 缺少 RunState 或 interruption',
          409,
        )
      }
    } catch (cause) {
      this.db.invalidateApprovalCheckpoint(candidate.id, '审批 checkpoint 校验失败')
      throw cause
    }
    return this.db.claimResolvedApproval(turnID)
  }

  cancelTurn(turnID: string) {
    this.db.cancelApprovalsForTurn(turnID)
  }

  prepareSandboxEscalation(invocation: ToolInvocation, failure: string) {
    const safe = secretScrubber.scrub(invocation)
    if (stable(safe.input) !== stable(invocation.input))
      throw new AgentError(
        'SANDBOX_ESCALATION_SECRET_DENIED',
        '包含凭据的命令不能持久化为 host escalation',
        403,
      )
    const token = crypto.randomUUID()
    const safeFailure = secretScrubber.scrubText(failure).slice(0, 2_000)
    return this.db.createSandboxEscalation({
      token,
      threadID: invocation.threadID,
      turnID: invocation.turnID,
      agentID: invocation.agentID,
      toolCallID: invocation.id,
      invocation: safe,
      invocationHash: sandboxEscalationHash(safe, safeFailure),
      failure: safeFailure,
    })
  }

  claimSandboxEscalation(
    token: string,
    scope: { threadID: string; turnID: string; agentID: string },
  ) {
    const stored = this.db.getSandboxEscalation(token)
    if (
      !stored ||
      stored.invocationHash !== sandboxEscalationHash(stored.invocation, stored.failure)
    ) {
      if (stored) this.db.cancelSandboxEscalation(token, 'Sandbox escalation 完整性校验失败')
      return null
    }
    return this.db.claimSandboxEscalation(token, scope)
  }

  completeSandboxEscalation(token: string, output: unknown) {
    this.db.completeSandboxEscalation(token, secretScrubber.scrub(output))
  }
}
