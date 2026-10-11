import { Schema } from 'effect'
import {
  ApprovalRequestSchema,
  AttachmentSchema,
  InputSchema,
  ItemSchema,
  LocalContextReferenceSchema,
  MessageSchema,
  ThreadTurnBundleSchema,
} from './Items'
import { ThreadGoalSchema } from './Goal'
import { ThreadListItemSchema, ThreadSchema, TurnSchema } from './Schema'
import { AgentExecutionSchema, SubagentProjectionSchema } from './Subagent'
import { PlanApprovalSchema } from './PlanApproval'

export const QueuePauseReasonSchema = Schema.NullOr(Schema.Literals(['interrupted', 'turn_failed']))
export type QueuePauseReason = typeof QueuePauseReasonSchema.Type

export const QueueActionSchema = Schema.Literals([
  'added',
  'edited',
  'removed',
  'paused',
  'resumed',
  'steer-accepted',
  'steer-consumed',
])
export type QueueAction = typeof QueueActionSchema.Type

export const ThreadSnapshotSchema = Schema.Struct({
  thread: ThreadSchema,
  turns: Schema.Array(TurnSchema),
  agents: Schema.Array(AgentExecutionSchema),
  subagents: Schema.Array(SubagentProjectionSchema),
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  items: Schema.Array(ItemSchema),
  approvals: Schema.Array(ApprovalRequestSchema),
  /** Null once the goal is cleared; omitted by older writers. */
  goal: Schema.optional(Schema.NullOr(ThreadGoalSchema)),
  pendingPlanApproval: Schema.optional(Schema.NullOr(PlanApprovalSchema)),
  contextReferences: Schema.optional(Schema.Array(LocalContextReferenceSchema)),
  queue: Schema.optional(
    Schema.Struct({
      version: Schema.Number,
      pauseReason: QueuePauseReasonSchema,
    }),
  ),
})
export type ThreadSnapshot = typeof ThreadSnapshotSchema.Type
