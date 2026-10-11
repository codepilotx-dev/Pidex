import type { PlanCheckpoint } from '../orchestration/AgentRuntimeTypes'
import type { ApprovalService } from '../permission/ApprovalService'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type {
  AcquiredResumeCheckpoint,
  RecoveryLeaseSummary,
  ResolvedResumeCheckpoint,
  ResumeCheckpointConsumer,
} from './Types'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export interface ResumeCheckpointResolverOptions {
  resolvedSubagentWait?: (turnID: string) => PlanCheckpoint | null
}

/**
 * Converts all resumable interaction kinds into one durable, exclusive lease.
 * Callers never claim approval/question rows independently.
 */
export class ResumeCheckpointResolver {
  private resolvedSubagentWait: ((turnID: string) => PlanCheckpoint | null) | undefined

  constructor(
    private readonly db: AgentDatabase,
    private readonly approvals: ApprovalService,
    options: ResumeCheckpointResolverOptions = {},
  ) {
    this.resolvedSubagentWait = options.resolvedSubagentWait
  }

  setResolvedSubagentWait(handler: (turnID: string) => PlanCheckpoint | null) {
    this.resolvedSubagentWait = handler
  }

  acquire(
    turnID: string,
    consumer: ResumeCheckpointConsumer,
    leaseID: string,
  ): AcquiredResumeCheckpoint | null {
    const existing = this.db.repositories.interactions.acquiredResumeCheckpointLease(
      turnID,
      leaseID,
    )
    if (existing) return existing

    const approvalCandidate = this.db.repositories.interactions.resolvedApprovalForResume(turnID)
    if (approvalCandidate) {
      const approval = this.approvals.load(approvalCandidate.id)
      if (
        approval?.payload.runState &&
        approval.payload.interruption !== undefined &&
        approval.decision &&
        approval.payload.resolution
      ) {
        const permissionGrant = this.approvals.permissionGrantResolution(approval)
        const checkpoint: ResolvedResumeCheckpoint = {
          kind: 'permission',
          approvalID: approval.approvalID,
          toolCallID: approval.toolCallID,
          state: approval.payload.runState,
          interruption: approval.payload.interruption,
          decision: approval.decision,
          answer: permissionGrant ? null : (approval.payload.resolution.feedback ?? null),
          ...(approval.payload.invocation.authorizationScope
            ? {
                authorizationFingerprint:
                  approval.payload.invocation.authorizationScope.fingerprint,
              }
            : {}),
          ...(permissionGrant ? { permissionGrant } : {}),
          ...(approval.payload.invocation.name === 'ComputerRead' && approval.decision === 'allow'
            ? { computerGrant: approval.payload.resolution.computerGrant ?? ('chat' as const) }
            : {}),
        }
        return this.db.repositories.interactions.acquireResumeCheckpointLease({
          turnID,
          agentID: approval.agentID,
          kind: 'permission',
          checkpoint,
          ...(permissionGrant
            ? { permissionGrant: permissionGrant as unknown as Record<string, unknown> }
            : {}),
          consumer,
          leaseID,
        })
      }
    }

    const question = this.db.repositories.interactions.resolvedQuestionForResume(turnID)
    if (question) {
      const payload = question.payload
      const storedCheckpoint = record(payload.checkpoint)
      const nested = record(storedCheckpoint.payload)
      const state =
        typeof storedCheckpoint.state === 'string'
          ? storedCheckpoint.state
          : typeof nested.state === 'string'
            ? nested.state
            : null
      const interruption = Object.prototype.hasOwnProperty.call(storedCheckpoint, 'interruption')
        ? storedCheckpoint.interruption
        : nested.interruption
      if (state && interruption !== undefined) {
        const storedAnswer = question.answer
        const answerValue = Object.prototype.hasOwnProperty.call(storedAnswer, 'value')
          ? storedAnswer.value
          : null
        const checkpoint: ResolvedResumeCheckpoint = {
          kind: 'question',
          questionID: question.id,
          toolCallID: question.toolCallID ?? question.id,
          state,
          interruption,
          answer:
            typeof answerValue === 'string'
              ? answerValue
              : answerValue == null
                ? null
                : JSON.stringify(answerValue),
        }
        return this.db.repositories.interactions.acquireResumeCheckpointLease({
          turnID,
          agentID: question.agentID,
          kind: 'question',
          checkpoint,
          consumer,
          leaseID,
        })
      }
    }

    const hookTrust = this.db.repositories.interactions.resolvedHookTrustForResume(turnID)
    if (hookTrust) {
      const checkpoint: ResolvedResumeCheckpoint = {
        kind: 'hook-trust',
        requestID: hookTrust.requestID,
        state: '',
        interruption: null,
        decision: hookTrust.decision,
        answer: null,
      }
      return this.db.repositories.interactions.acquireResumeCheckpointLease({
        turnID,
        agentID: hookTrust.agentID,
        kind: 'hook-trust',
        checkpoint,
        consumer,
        leaseID,
      })
    }

    const wait = this.resolvedSubagentWait?.(turnID)
    if (!wait) return null
    const agent = this.db.agentForTurn(turnID)
    if (!agent) return null
    const checkpoint: ResolvedResumeCheckpoint = {
      kind: 'subagent-wait',
      state: wait.state,
      interruption: wait.interruption,
      answer: wait.answer,
    }
    return this.db.repositories.interactions.acquireResumeCheckpointLease({
      turnID,
      agentID: agent.id,
      kind: 'subagent-wait',
      checkpoint,
      consumer,
      leaseID,
    })
  }

  complete(leaseID: string) {
    return this.db.repositories.interactions.completeResumeCheckpointLease(leaseID)
  }

  recoverInterruptedLeases(now = Date.now()): RecoveryLeaseSummary {
    return this.db.repositories.interactions.recoverResumeCheckpointLeases(now)
  }
}

type PiResumeCheckpoint = Exclude<ResolvedResumeCheckpoint, { kind: 'hook-trust' }>

export const toPlanCheckpoint = (acquired: {
  leaseID: string
  checkpoint: PiResumeCheckpoint
}): PlanCheckpoint => {
  const checkpoint = acquired.checkpoint
  if (checkpoint.kind === 'permission') {
    return {
      state: checkpoint.state,
      interruption: checkpoint.interruption,
      answer: checkpoint.answer,
      decision: checkpoint.decision,
      toolCallID: checkpoint.toolCallID,
      approvalID: checkpoint.approvalID,
      resumeLeaseID: acquired.leaseID,
      ...(checkpoint.authorizationFingerprint
        ? { authorizationFingerprint: checkpoint.authorizationFingerprint }
        : {}),
      ...(checkpoint.permissionGrant ? { permissionGrant: checkpoint.permissionGrant } : {}),
      ...(checkpoint.computerGrant ? { computerGrant: checkpoint.computerGrant } : {}),
    }
  }
  return {
    state: checkpoint.state,
    interruption: checkpoint.interruption,
    answer: checkpoint.answer,
    resumeLeaseID: acquired.leaseID,
    ...(checkpoint.kind === 'question'
      ? { checkpointID: checkpoint.questionID, toolCallID: checkpoint.toolCallID }
      : {}),
  }
}
