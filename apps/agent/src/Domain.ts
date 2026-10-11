import type { PermissionConfig, ShellReview, ThreadSettings } from '@pidex/shared/thread'
import type { Model } from '@pidex/model-schema'

export type { PermissionConfig } from '@pidex/shared/thread'
/** SQLite-private delivery encoding; public RPC/view models expose InputDelivery. */
export type StoredInputDelivery = 'start' | 'queue' | 'guide'
export type TaskMode = 'chat' | 'plan'
export type TurnStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'waiting_question'
  | 'waiting_subagents'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export type ModelRef = Model.Ref

export interface SubmitMessage {
  content: string
  skills?: readonly import('@pidex/agent-protocol').SkillSelection[]
  model: ModelRef
  permissionConfig: PermissionConfig
  strategy: StoredInputDelivery
  taskMode: TaskMode
  /** Omitted historical inputs are user-authored. */
  origin?: 'user' | 'goal-continuation'
}

export type ItemType =
  | 'reasoning'
  | 'activity'
  | 'text'
  | 'tool'
  | 'plan'
  | 'execution-plan'
  | 'question'
  | 'patch'
  | 'subagent'

export type SubagentProfile = 'main' | 'default' | 'explorer' | 'worker'
export type SubagentWorkspaceMode = 'shared' | 'worktree'
export type SubagentWorkspaceState = 'ready' | 'preparing' | 'conflict' | 'applied' | 'discarded'

export interface SubagentWorkspace {
  mode: SubagentWorkspaceMode
  state: SubagentWorkspaceState
  rootPath: string | null
  baselineRef: string | null
}

export type SubagentStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'steering'
  | 'waiting_question'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'

export type SubagentQueueReason = 'parent_limit' | 'global_limit' | 'workspace_writer' | null

export interface SubagentResult {
  outcome: 'succeeded' | 'partial' | 'blocked'
  summary: string
  findings: Array<{
    title: string
    detail: string
    severity: 'info' | 'warning' | 'error'
  }>
  changedFiles: Array<{
    path: string
    summary: string
  }>
  validation: Array<{
    command: string
    status: 'passed' | 'failed' | 'skipped'
    output?: string
  }>
  risks: string[]
  references: Array<{
    kind: 'file' | 'url' | 'thread' | 'subagent'
    value: string
    label?: string
  }>
}

export interface SubagentRun {
  id: string
  taskID: string
  generation: number
  status: SubagentStatus
  queueReason: SubagentQueueReason
  model: ModelRef
  permissionConfig: PermissionConfig
  result: SubagentResult | null
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface SubagentTask {
  id: string
  parentThreadID: string
  parentTurnID: string
  parentAgentID: string
  childThreadID: string
  displayName: string
  profile: Exclude<SubagentProfile, 'main'>
  task: string
  permissionCeiling: PermissionConfig
  workspace: SubagentWorkspace
  currentRun: SubagentRun | null
  createdAt: number
  updatedAt: number
}

export interface SubagentProjection {
  task: SubagentTask
  currentRun: SubagentRun | null
}

export type AgentExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting_question'
  | 'waiting_permission'
  | 'waiting_subagents'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

export interface AgentExecution {
  id: string
  threadID: string
  turnID: string
  parentAgentID: string | null
  profile: string
  task: string
  model: ModelRef
  sessionID: string
  depth: number
  status: AgentExecutionStatus
  error: string | null
  subagentRunID: string | null
  runSequence: number
  createdAt: number
  updatedAt: number
}

export interface Item {
  id: string
  turnID: string
  agentID: string
  type: ItemType
  status: 'pending' | 'running' | 'completed' | 'error' | 'interrupted'
  data: Record<string, unknown>
  ordinal?: number
  createdAt: number
  updatedAt: number
}

export interface ThreadSnapshot {
  id: string
  title: string
  gitBranch: string | null
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  turns: Array<{
    id: string
    rootAgentID: string
    status: TurnStatus
    mode: TaskMode
    startedAt: number | null
    finishedAt: number | null
    items: Item[]
  }>
  agents?: AgentExecution[]
  subagents?: SubagentProjection[]
}

export interface EventEnvelope<T = unknown> {
  id: number
  /** Fixed global durable cursor captured when a non-durable event is published. */
  afterSequence?: number
  threadId: string | null
  turnId: string | null
  method: string
  params: T
  createdAt: number
}

export interface ToolPermissionFacts {
  ruleRequiresApproval?: boolean
  hookRequiresApproval?: boolean
  skillScript?: boolean
  risk?: PermissionDecision['risk']
  denyReason?: string
  approvalReason?: string
  approvalCategories?: readonly (keyof import('@pidex/shared/thread').GranularApprovalConfig)[]
}

export interface ToolInvocation {
  fileDiffs?: readonly import('@pidex/agent-protocol').RpcResult<'thread/patch/diff'>[]
  retryAuthorization?: { reviewId: string; fingerprint: string }
  toolPolicy?: Pick<
    import('./tool/ToolRegistry').ToolCatalogEntry,
    'sdkName' | 'capabilities' | 'allowedModes' | 'approvalStrategy' | 'origin'
  >
  /** Trusted facts derived by host inspection, never from model arguments. */
  permissionFacts?: ToolPermissionFacts
  grantsForbidden?: boolean
  id: string
  threadID: string
  turnID: string
  agentID: string
  name: string
  input: Record<string, unknown>
  permissionConfig: PermissionConfig
  model: Model.Ref
  taskMode: TaskMode
  /** Host-derived mutation scope. Model input can never provide this value. */
  authorizationScope?: ToolAuthorizationScope
  /** True only for an Agents SDK preflight that can be resumed from a RunState interruption. */
  durableApproval?: boolean
}

export interface ToolAffectedPath {
  /** Workspace-safe display path produced after host path validation. */
  path: string
  operation: 'create' | 'update'
}

export interface ToolReviewSummary {
  fileCount: number
  hunkCount: number
  additions: number
  deletions: number
}

export interface ToolAuthorizationScope {
  browserOrigin?: string
  computerApp?: { name: string; allowPersistentApproval: boolean }
  affectedPaths: readonly ToolAffectedPath[]
  /** SHA-256 over the inspected input and its canonical mutation scope. */
  fingerprint: string
  ruleRequiresApproval: boolean
  reviewSummary?: ToolReviewSummary
}

export interface PermissionDecision {
  decision: 'allow' | 'ask' | 'deny'
  risk: 'low' | 'medium' | 'high' | 'critical'
  reason: string
  review?: ShellReview
  /** Returned only by authorization previews for scope-bound execution. */
  authorizationFingerprint?: string
}

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    readonly details?: unknown,
  ) {
    super(message)
  }
}
