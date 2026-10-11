import type { PermissionGrantResolution } from '../permission/ApprovalService'

export type ResumeCheckpointConsumer = 'main' | 'subagent'
export type ResumeCheckpointKind = 'permission' | 'question' | 'hook-trust' | 'subagent-wait'
export type ResumeCheckpointLeaseStatus = 'available' | 'acquired' | 'completed' | 'interrupted'

export type ResolvedResumeCheckpoint =
  | {
      kind: 'permission'
      approvalID: string
      toolCallID: string
      state: string
      interruption: unknown
      decision: 'allow' | 'deny'
      answer: string | null
      computerGrant?: 'chat' | 'persistent'
      authorizationFingerprint?: string
      permissionGrant?: PermissionGrantResolution
    }
  | {
      kind: 'question'
      questionID: string
      toolCallID: string
      state: string
      interruption: unknown
      answer: string | null
    }
  | {
      kind: 'hook-trust'
      requestID: string
      state: string
      interruption: unknown
      decision: 'allow' | 'deny'
      answer: string | null
    }
  | {
      kind: 'subagent-wait'
      state: string
      interruption: unknown
      answer: string | null
    }

export type AcquiredResumeCheckpoint = {
  leaseID: string
  checkpoint: ResolvedResumeCheckpoint
}

export type RecoveryLeaseSummary = {
  available: string[]
  completed: string[]
  interrupted: string[]
}
