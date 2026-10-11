import { Database } from 'bun:sqlite'
import { isAbsolute, relative } from 'node:path'
import {
  DEFAULT_PERMISSION_CONFIG,
  decodeApprovalPolicy,
  type ProjectExecutionEnvironment,
  type ThreadSettings,
} from '@pidex/shared/thread'
import type {
  EventEnvelope,
  AgentExecution,
  ModelRef,
  PermissionConfig,
  TaskMode,
  ToolInvocation,
} from '../../Domain'

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
  instructions: string
  executionEnvironment: ProjectExecutionEnvironment
  version: number
}

export type StoredProjectFolder = {
  id: string
  name: string
  path: string
  role: 'primary' | 'secondary'
  availability: 'available' | 'missing'
  order: number
  createdAt: number
  updatedAt: number
}

export type StoredEncryptedCredential = {
  id: string
  integrationID: string
  kind: 'api-key' | 'oauth'
  methodID: string | null
  label: string
  keySuffix: string | null
  fingerprint: string | null
  enabled: boolean
  priority: number
  ciphertext: string
  nonce: string
  keyVersion: number
  createdAt: number
  updatedAt: number
}

export type CredentialHealthStatus =
  'untested' | 'healthy' | 'auth-failed' | 'rate-limited' | 'error'
export type CredentialErrorCategory = 'authentication' | 'rate-limit' | 'network' | 'unknown'

export type StoredCredentialHealth = {
  credentialID: string
  status: CredentialHealthStatus
  lastTestedAt: number | null
  lastUsedAt: number | null
  lastErrorCategory: CredentialErrorCategory | null
  cooldownUntil: number | null
  updatedAt: number
}

export type StoredProject = {
  id: string
  name: string
  primaryFolderId: string
  folders: StoredProjectFolder[]
  removedAt: number | null
  /** Internal compatibility alias for the primary folder. */
  rootPath: string
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
  settings: ProjectModelSettings
}

export type AgentTurnCheckpoint = {
  agentID: string
  turnID: string
  threadID: string
  state: 'waiting_question' | 'waiting_hook_trust' | 'waiting_subagents' | 'ready'
  payload: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
}

export type SideEffectRecoveryPayload = {
  kind: 'side-effect-prompt-recovery'
  attemptOrdinal: number
  completed: Array<{ toolCallID: string; tool: string; summary: string }>
  error: string
}

export type ResumableQuestion = {
  id: string
  threadID: string
  turnID: string
  toolCallID: string | null
  payload: Record<string, unknown>
  payloadVersion: number
  createdAt: number
}

export type ApprovalCheckpointPayload = {
  kind: 'tool-approval'
  invocation: ToolInvocation
  invocationHash: string
  permissionSnapshot: PermissionConfig
  sandbox: Record<string, unknown>
  reviewer: PermissionConfig['approvalsReviewer']
  review: Record<string, unknown>
  runState?: string
  interruption?: unknown
  resolution?: {
    decision: 'allow' | 'deny'
    feedback?: string
    resolvedAt: number
    computerGrant?: 'chat' | 'persistent'
  }
  claimedAt?: number
}

export type StoredApprovalCheckpoint = {
  approvalID: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  status: 'preparing' | 'pending' | 'resolved' | 'claimed' | 'cancelled'
  decision: 'allow' | 'deny' | null
  risk: string
  reason: string
  payload: ApprovalCheckpointPayload
  version: number
  createdAt: number
  updatedAt: number
}

export type SandboxEscalation = {
  token: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  invocation: ToolInvocation
  invocationHash: string
  failure: string
  status: 'awaiting_request' | 'claimed' | 'completed' | 'cancelled'
  createdAt: number
}

export type HookTrustRequest = {
  id: string
  threadID: string | null
  turnID: string | null
  workspacePath: string
  configPath: string
  configHash: string
  status: 'pending' | 'allowed' | 'blocked'
  auditSummary: Record<string, unknown>
  createdAt: number
  resolvedAt: number | null
}

export type SqlValue = string | number | boolean | Uint8Array | null

export const stringify = (value: unknown) => JSON.stringify(value ?? null)
export const parse = <T>(value: string): T => JSON.parse(value) as T
export const now = () => Date.now()
export const previewText = (value: string, limit = 180) =>
  value.replace(/\s+/g, ' ').trim().slice(0, limit) || null
export const containedPath = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
export type QueuePauseReason = 'interrupted' | 'turn_failed' | null
export type QueueMutationMeta = { operationID: string; expectedVersion?: number }

export type StoredThreadWorkspace =
  | {
      kind: 'project'
      projectID: string
      cwd: string
      runtimeWorkspaceRoots: Array<{
        folderId: string
        path: string
        role: 'primary' | 'secondary'
      }>
      instructionSources: string[]
      outputDirectory: null
    }
  | {
      kind: 'projectless'
      projectID: null
      workspaceRoot: string
      cwd: string
      outputDirectory: string
    }

export type CreateThreadInput = {
  id?: string
  title?: string | undefined
  settings?: ThreadSettings | undefined
  workspace:
    | { kind: 'project'; projectID: string }
    | { kind: 'projectless'; workspaceRoot: string; cwd: string; outputDirectory: string }
  operationID?: string | undefined
  requestHash?: string | undefined
}

export type CreatedThreadRecord = {
  id: string
  title: string
  projectID: string | null
  workspace: StoredThreadWorkspace | null
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  event: EventEnvelope
}

export type PermissionColumns = {
  sandbox_mode: PermissionConfig['sandboxMode']
  approval_policy: string
  approvals_reviewer: PermissionConfig['approvalsReviewer']
}

export type ThreadSettingsColumns = PermissionColumns & {
  task_mode: TaskMode
}

export const permissionConfigFromRow = (row: PermissionColumns): PermissionConfig => ({
  sandboxMode: row.sandbox_mode,
  approvalPolicy: decodeApprovalPolicy(row.approval_policy),
  approvalsReviewer: row.approvals_reviewer,
})

export const threadSettingsFromRow = (row: ThreadSettingsColumns): ThreadSettings => ({
  taskMode: row.task_mode,
  permissionConfig: permissionConfigFromRow(row),
})

export const defaultThreadSettings = (): ThreadSettings => ({
  taskMode: 'chat',
  permissionConfig: { ...DEFAULT_PERMISSION_CONFIG },
})

export abstract class RepositoryCore {
  // Domain repositories form one inheritance chain over the same connection.
  // Earlier domains may invoke operations implemented by a later domain
  // (for example thread creation emits through the event repository).
  abstract insertEvent(
    threadId: string | null,
    turnId: string | null,
    method: string,
    params: unknown,
  ): EventEnvelope
  protected abstract requireProject(projectID: string): StoredProject
  abstract threadWorkspace(threadID: string): StoredThreadWorkspace | null
  abstract projectMembership(threadID: string): string | null
  abstract projectMembershipSql(alias?: 't'): string
  abstract getAgentExecution(agentID: string): AgentExecution | null

  private transactionDepth = 0

  private transactionCommitCallbacks: Array<() => void> = []

  private transactionRollbackCallbacks: Array<() => void> = []

  constructor(
    readonly sqlite: Database,
    readonly profileSqlite: Database = sqlite,
  ) {}

  probeHealth(): void {
    this.sqlite.query('SELECT 1').get()
  }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work()
    this.transactionDepth = 1
    this.transactionCommitCallbacks = []
    this.transactionRollbackCallbacks = []
    try {
      const result = this.sqlite.transaction(work)()
      const callbacks = this.transactionCommitCallbacks
      this.transactionDepth = 0
      this.transactionCommitCallbacks = []
      this.transactionRollbackCallbacks = []
      for (const callback of callbacks) callback()
      return result
    } catch (cause) {
      const callbacks = this.transactionRollbackCallbacks
      this.transactionDepth = 0
      this.transactionCommitCallbacks = []
      this.transactionRollbackCallbacks = []
      for (const callback of callbacks) callback()
      throw cause
    }
  }

  onTransactionCommit(callback: () => void) {
    if (this.transactionDepth === 0) callback()
    else this.transactionCommitCallbacks.push(callback)
  }

  onTransactionRollback(callback: () => void) {
    if (this.transactionDepth > 0) this.transactionRollbackCallbacks.push(callback)
  }

  protected appendUserMessage(input: {
    id: string
    threadID: string
    turnID: string
    content: string
    createdAt: number
  }) {
    const row = this.sqlite
      .query('SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM messages WHERE thread_id = ?')
      .get(input.threadID) as { ordinal: number }
    const preview = previewText(input.content)
    this.sqlite
      .query(
        `INSERT INTO messages (id, thread_id, turn_id, role, content, created_at, ordinal) VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      )
      .run(input.id, input.threadID, input.turnID, input.content, input.createdAt, row.ordinal)
    this.sqlite
      .query(
        `
        UPDATE threads
        SET updated_at = ?,
          message_count = message_count + 1,
          first_user_message = COALESCE(first_user_message, ?),
          preview = COALESCE(?, preview)
        WHERE id = ?
      `,
      )
      .run(input.createdAt, input.content, preview, input.threadID)
  }
}
