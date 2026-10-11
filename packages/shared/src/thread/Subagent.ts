import { Model } from '@pidex/model-schema'
import { Schema } from 'effect'
import { PermissionConfigSchema } from './Permission'

export const MAX_SUBAGENT_DEPTH = 3

export const SubagentProfileSchema = Schema.Literals(['main', 'default', 'explorer', 'worker'])
export type SubagentProfile = typeof SubagentProfileSchema.Type

export const SubagentWorkspaceSchema = Schema.Struct({
  mode: Schema.Literals(['shared', 'worktree']),
  state: Schema.Literals(['ready', 'preparing', 'conflict', 'applied', 'discarded']),
  rootPath: Schema.NullOr(Schema.String),
  baselineRef: Schema.NullOr(Schema.String),
})
export type SubagentWorkspace = typeof SubagentWorkspaceSchema.Type

export const SubagentStatusSchema = Schema.Literals([
  'queued',
  'preparing',
  'running',
  'steering',
  'waiting-question',
  'waiting-permission',
  'completed',
  'failed',
  'stopped',
  'interrupted',
])
export type SubagentStatus = typeof SubagentStatusSchema.Type

export const SubagentQueueReasonSchema = Schema.NullOr(
  Schema.Literals(['parent-limit', 'global-limit', 'workspace-writer']),
)
export type SubagentQueueReason = typeof SubagentQueueReasonSchema.Type

export const SubagentFindingSchema = Schema.Struct({
  title: Schema.String,
  detail: Schema.String,
  severity: Schema.Literals(['info', 'warning', 'error']),
})
export type SubagentFinding = typeof SubagentFindingSchema.Type

export const SubagentChangedFileSchema = Schema.Struct({
  path: Schema.String,
  summary: Schema.String,
})
export type SubagentChangedFile = typeof SubagentChangedFileSchema.Type

export const SubagentValidationSchema = Schema.Struct({
  command: Schema.String,
  status: Schema.Literals(['passed', 'failed', 'skipped']),
  output: Schema.optional(Schema.String),
})
export type SubagentValidation = typeof SubagentValidationSchema.Type

export const SubagentReferenceSchema = Schema.Struct({
  kind: Schema.Literals(['file', 'url', 'thread', 'subagent']),
  value: Schema.String,
  label: Schema.optional(Schema.String),
})
export type SubagentReference = typeof SubagentReferenceSchema.Type

export const SubagentResultSchema = Schema.Struct({
  outcome: Schema.Literals(['succeeded', 'partial', 'blocked']),
  summary: Schema.String,
  findings: Schema.Array(SubagentFindingSchema),
  changedFiles: Schema.Array(SubagentChangedFileSchema),
  validation: Schema.Array(SubagentValidationSchema),
  risks: Schema.Array(Schema.String),
  references: Schema.Array(SubagentReferenceSchema),
})
export type SubagentResult = typeof SubagentResultSchema.Type

export const SubagentRunSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  generation: Schema.Number,
  status: SubagentStatusSchema,
  queueReason: SubagentQueueReasonSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  result: Schema.NullOr(SubagentResultSchema),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
})
export type SubagentRun = typeof SubagentRunSchema.Type

export const SubagentTaskSchema = Schema.Struct({
  id: Schema.String,
  parentThreadId: Schema.String,
  parentTurnId: Schema.String,
  parentAgentId: Schema.String,
  childThreadId: Schema.String,
  notices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.Literals(['report', 'settled']),
        message: Schema.String,
        createdAt: Schema.Number,
      }),
    ),
  ),
  parentTaskId: Schema.optional(Schema.NullOr(Schema.String)),
  depth: Schema.optional(Schema.Number),
  waitingForDescendants: Schema.optional(Schema.Boolean),
  queuedFollowups: Schema.optional(Schema.Number),
  displayName: Schema.String,
  profile: Schema.Literals(['default', 'explorer', 'worker']),
  task: Schema.String,
  permissionCeiling: PermissionConfigSchema,
  workspace: SubagentWorkspaceSchema,
  currentRun: Schema.NullOr(SubagentRunSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SubagentTask = typeof SubagentTaskSchema.Type

export const SubagentProjectionSchema = Schema.Struct({
  task: SubagentTaskSchema,
  currentRun: Schema.NullOr(SubagentRunSchema),
})
export type SubagentProjection = typeof SubagentProjectionSchema.Type

export const AgentExecutionStatusSchema = Schema.Literals([
  'queued',
  'running',
  'waiting-question',
  'waiting-permission',
  'waiting-subagents',
  'completed',
  'failed',
  'interrupted',
  'cancelled',
])
export type AgentExecutionStatus = typeof AgentExecutionStatusSchema.Type

export const AgentExecutionSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  parentAgentId: Schema.NullOr(Schema.String),
  profile: Schema.String,
  task: Schema.String,
  model: Model.Ref,
  sessionId: Schema.String,
  depth: Schema.Number,
  status: AgentExecutionStatusSchema,
  error: Schema.NullOr(Schema.String),
  subagentRunId: Schema.NullOr(Schema.String),
  runSequence: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type AgentExecution = typeof AgentExecutionSchema.Type
