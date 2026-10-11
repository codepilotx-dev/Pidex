import { ComputerStateSchema } from '../methods/Computer'
import { Model, Provider } from '@pidex/model-schema'
import { AutomationRunStatusSchema, AutomationStatusSchema } from '@pidex/shared/automation'
import { SchedulePlanProposalStatusSchema } from '@pidex/shared/schedule-plan'
import { ScheduledTaskStatusSchema } from '@pidex/shared/scheduled-task'
import {
  AgentExecutionSchema,
  ExecutionPlanItemSchema,
  InputSchema,
  ItemSchema,
  QueueActionSchema,
  SubagentProjectionSchema,
  ThreadGoalSchema,
  ThreadSchema,
  ThreadSettingsSchema,
  ToolItemSchema,
  TurnSchema,
  TurnStatusSchema,
} from '@pidex/shared/thread'
import { Schema } from 'effect'
import { defineEvent, type EventPayloadOf } from './Definition'
import {
  ApprovalRequestParamsSchema,
  HookTrustRequestParamsSchema,
  PermissionRequestParamsSchema,
  ServerRequestResultSchema,
  QuestionRequestParamsSchema,
} from './Interactions'
import { JsonValueSchema, OpaqueIDSchema, SequenceSchema, TimestampSchema } from './Primitives'
import { ToolingStatusSchema } from '../methods/Tooling'
import { UsageSourceIdSchema } from '../methods/Usage'
import {
  AuthSessionSchema,
  ModelHealthCountsSchema,
  ModelHealthItemSchema,
} from '../methods/Extended'
import { SpeechStatusSchema } from '../methods/Speech'
import { MiniMaxCliStatusSchema } from '../methods/MinimaxCli'

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const SanitizedErrorSchema = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1)),
  message: Schema.String.check(Schema.isMinLength(1)),
  retryable: Schema.Boolean,
})
const ItemDeltaSchema = Schema.Struct({
  itemId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  agentId: OpaqueIDSchema,
  delta: Schema.String,
})
const CompleteSubagentProjectionSchema = Schema.Struct({
  projection: SubagentProjectionSchema,
})
const ToolTerminalPayloadSchema = Schema.Struct({
  item: ToolItemSchema,
})

export const EventManifest = {
  'mcp/elicitationRequested': defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      threadId: OpaqueIDSchema,
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      toolCallId: OpaqueIDSchema,
      createdAt: TimestampSchema,
      version: SequenceSchema,
      kind: Schema.Literal('mcp-elicitation'),
      server: Schema.String,
      tool: Schema.String,
      request: Schema.Record(Schema.String, JsonValueSchema),
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'mcp.elicitation.v1',
  }),
  'computer/changed': defineEvent({
    payload: ComputerStateSchema,
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'computer.use.v1',
    reconcilesWith: 'computer/state',
  }),
  'browser/dataChanged': defineEvent({
    payload: Schema.Struct({ collection: Schema.Literals(['history', 'downloads']) }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'browser.data.v1',
    reconcilesWith: 'browser/history/list',
  }),
  'browser/changed': defineEvent({
    payload: Schema.Struct({ tabId: OpaqueIDSchema }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'browser.manage.v1',
    reconcilesWith: 'browser/list',
  }),
  'scheduled-task/changed': defineEvent({
    payload: Schema.Struct({
      scheduledTaskId: OpaqueIDSchema,
      revision: VersionSchema,
      status: ScheduledTaskStatusSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'calendar.manage.v1',
    reconcilesWith: 'calendar/range',
  }),
  'schedule-plan/changed': defineEvent({
    payload: Schema.Struct({
      proposalId: OpaqueIDSchema,
      revision: VersionSchema,
      status: SchedulePlanProposalStatusSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'calendar.manage.v1',
    reconcilesWith: 'schedule-plan/read',
  }),
  'automation/changed': defineEvent({
    payload: Schema.Struct({
      automationId: OpaqueIDSchema,
      revision: VersionSchema,
      status: AutomationStatusSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'automation.manage.v1',
    reconcilesWith: 'automation/list',
  }),
  'automation/runChanged': defineEvent({
    payload: Schema.Struct({
      automationId: OpaqueIDSchema,
      runId: OpaqueIDSchema,
      status: AutomationRunStatusSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'automation.manage.v1',
    reconcilesWith: 'automation/run/list',
  }),
  'config/updated': defineEvent({
    payload: Schema.Struct({
      version: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
      changedKeyPaths: Schema.Array(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
      scope: Schema.Literals(['user', 'profile', 'project']),
      diagnostics: Schema.Array(
        Schema.Struct({
          severity: Schema.Literals(['warning', 'error']),
          code: Schema.String.check(Schema.isMinLength(1)),
          message: Schema.String.check(Schema.isMinLength(1)),
        }),
      ),
      profileState: Schema.optional(
        Schema.Struct({
          activeProfile: Schema.NullOr(Schema.String),
          selectedProfile: Schema.NullOr(Schema.String),
          restartRequired: Schema.Boolean,
        }),
      ),
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'config.manage.v1',
    reconcilesWith: 'config/read',
  }),
  'workspace/git/changed': defineEvent({
    payload: Schema.Struct({
      projectId: OpaqueIDSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'git.review.v1',
    reconcilesWith: 'review/refresh',
  }),
  'workspace/file/changed': defineEvent({
    payload: Schema.Struct({
      projectId: OpaqueIDSchema,
      folderId: OpaqueIDSchema,
      path: Schema.String.check(Schema.isMinLength(1)),
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'workspace.editor.v1',
    reconcilesWith: 'workspace/file/read',
  }),
  'session-group/changed': defineEvent({
    payload: Schema.Struct({
      groupId: OpaqueIDSchema,
      reason: Schema.Literals([
        'created',
        'updated',
        'deleted',
        'membership_changed',
        'step_changed',
        'context_changed',
      ]),
      threadId: Schema.optional(OpaqueIDSchema),
      stepId: Schema.optional(OpaqueIDSchema),
      revision: VersionSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'session-group.v1',
    reconcilesWith: 'session-group/list',
  }),
  'workflow/changed': defineEvent({
    payload: Schema.Struct({
      workflowId: OpaqueIDSchema,
      reason: Schema.Literals([
        'created',
        'updated',
        'deleted',
        'membership_changed',
        'step_changed',
        'context_changed',
      ]),
      threadId: Schema.optional(OpaqueIDSchema),
      stepId: Schema.optional(OpaqueIDSchema),
      revision: VersionSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'workflow.v1',
    reconcilesWith: 'workflow/list',
  }),
  'tooling/updated': defineEvent({
    payload: Schema.Struct({
      status: ToolingStatusSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'tooling.management.v1',
    reconcilesWith: 'tooling/list',
  }),
  'speech/statusChanged': defineEvent({
    payload: Schema.Struct({ status: SpeechStatusSchema }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'speech.transcription.v1',
    reconcilesWith: 'speech/status',
  }),
  'skill/updated': defineEvent({
    payload: Schema.Struct({
      generation: SequenceSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'skills.manage.v1',
    reconcilesWith: 'skill/list',
  }),
  'plugins/updated': defineEvent({
    payload: Schema.Struct({
      generation: SequenceSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'plugins.manage.v1',
    reconcilesWith: 'plugin/list',
  }),
  'minimaxCli/updated': defineEvent({
    payload: Schema.Struct({ status: MiniMaxCliStatusSchema }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'integrations.minimax-cli.v1',
    reconcilesWith: 'minimaxCli/status',
  }),
  'mcp/updated': defineEvent({
    payload: Schema.Struct({
      generation: SequenceSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'mcp.manage.v1',
    reconcilesWith: 'mcp/list',
  }),
  'thread/created': defineEvent({
    payload: Schema.Struct({ thread: ThreadSchema }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'events.replay.v1',
  }),
  'thread/updated': defineEvent({
    payload: Schema.Struct({ thread: ThreadSchema, version: VersionSchema }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'events.replay.v1',
  }),
  'thread/settings/updated': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      settings: ThreadSettingsSchema,
      version: VersionSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'thread/prompt-settings/updated': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      cacheKey: OpaqueIDSchema,
      promptVersion: OpaqueIDSchema,
      baselineVersion: VersionSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'thread/deleted': defineEvent({
    payload: Schema.Struct({ threadId: OpaqueIDSchema, deletedAt: TimestampSchema }),
    version: 1,
    durability: 'durable',
    stream: 'global',
    capability: 'events.replay.v1',
  }),
  'thread/goal/updated': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      goal: ThreadGoalSchema,
      version: VersionSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'thread.goal.v1',
    reconcilesWith: 'thread/goal/get',
  }),
  'thread/goal/cleared': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      goalId: OpaqueIDSchema,
      clearedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'thread.goal.v1',
    reconcilesWith: 'thread/goal/get',
  }),
  'thread/bookmarks/updated': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      inputIds: Schema.Array(OpaqueIDSchema),
      version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'thread.bookmarks.v1',
    reconcilesWith: 'thread/bookmarks/list',
  }),
  'turn/queued': defineEvent({
    payload: Schema.Struct({ turn: TurnSchema, input: InputSchema }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'turn/started': defineEvent({
    payload: Schema.Struct({ turn: TurnSchema, input: InputSchema }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'turn/statusChanged': defineEvent({
    payload: Schema.Struct({
      turnId: OpaqueIDSchema,
      status: TurnStatusSchema,
      reason: Schema.optional(Schema.String),
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'turn/completed': defineEvent({
    payload: Schema.Struct({ turn: TurnSchema }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'turn/failed': defineEvent({
    payload: Schema.Struct({ turn: TurnSchema, error: SanitizedErrorSchema }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'turn/interrupted': defineEvent({
    payload: Schema.Struct({
      turn: TurnSchema,
      reason: Schema.String.check(Schema.isMinLength(1)),
      recoveryAvailable: Schema.Boolean,
      checkpointVersion: Schema.optional(VersionSchema),
    }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'agent/upserted': defineEvent({
    payload: Schema.Struct({ agent: AgentExecutionSchema }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'subagent/created': defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'subagents.v1',
  }),
  'subagent/updated': defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'subagents.v1',
  }),
  'subagent/workspaceUpdated': defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'subagents.v1',
  }),
  'item/started': defineEvent({
    payload: Schema.Struct({ item: ItemSchema }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'item/completed': defineEvent({
    payload: Schema.Struct({ item: ItemSchema }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'item/agentMessage/delta': defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'item/completed',
  }),
  'reasoning/textDelta': defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'item/completed',
  }),
  'reasoning/summaryPartAdded': defineEvent({
    payload: Schema.Struct({
      itemId: OpaqueIDSchema,
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      partIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'item/completed',
  }),
  'reasoning/summaryTextDelta': defineEvent({
    payload: Schema.Struct({
      itemId: OpaqueIDSchema,
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      partIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      delta: Schema.String,
    }),
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'item/completed',
  }),
  'plan/delta': defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'item/completed',
  }),
  'turn/plan/updated': defineEvent({
    payload: Schema.Struct({ item: ExecutionPlanItemSchema }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'tool/callStarted': defineEvent({
    payload: Schema.Struct({
      item: ToolItemSchema,
      inputSummary: Schema.String,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'tool/outputDelta': defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: 'live',
    stream: 'thread',
    capability: 'events.live.v1',
    reconcilesWith: 'tool/callCompleted',
  }),
  'tool/callCompleted': defineEvent({
    payload: ToolTerminalPayloadSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'tool/error': defineEvent({
    payload: Schema.Struct({ item: ToolItemSchema, error: SanitizedErrorSchema }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'approval/requested': defineEvent({
    payload: ApprovalRequestParamsSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'approval/cancelled': defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      reason: Schema.String.check(Schema.isMinLength(1)),
      cancelledAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'permission/requested': defineEvent({
    payload: PermissionRequestParamsSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'question/requested': defineEvent({
    payload: QuestionRequestParamsSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'interaction/resolved': defineEvent({
    payload: Schema.Struct({
      // Optional for forward compatibility with historical replay: events
      // emitted before this field existed carry no interaction identifier.
      interactionId: Schema.optional(OpaqueIDSchema),
      result: ServerRequestResultSchema,
      resolvedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'context/compacted': defineEvent({
    payload: Schema.Struct({
      compactionId: OpaqueIDSchema,
      trigger: Schema.optional(Schema.Literals(['manual', 'automatic', 'reactive'])),
      beforeCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      afterCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      beforeTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      afterTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      afterTokensSource: Schema.optional(Schema.Literals(['compaction-estimate', 'measured'])),
      targetTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      baselineVersion: VersionSchema,
      usageSampleId: OpaqueIDSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'context.compact.v1',
  }),
  'context/recoveryRequired': defineEvent({
    payload: Schema.Struct({
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      attemptOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      completedSideEffects: Schema.Array(
        Schema.Struct({
          toolCallId: OpaqueIDSchema,
          tool: Schema.String.check(Schema.isMinLength(1)),
          summary: Schema.String,
        }),
      ),
      checkpointVersion: VersionSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'hook/trust/requested': defineEvent({
    payload: HookTrustRequestParamsSchema,
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'hooks.trust.v1',
  }),
  'hook/trust/resolved': defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      configPath: Schema.String,
      configSha256: Schema.String,
      decision: Schema.Literals(['allow', 'block']),
      resumed: Schema.Boolean,
      resolvedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'durable',
    stream: 'thread',
    capability: 'hooks.trust.v1',
  }),
  'queue/updated': defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      action: QueueActionSchema,
      inputId: Schema.optional(OpaqueIDSchema),
      turnId: Schema.optional(OpaqueIDSchema),
      turns: Schema.optional(Schema.Array(TurnSchema)),
      inputs: Schema.optional(Schema.Array(InputSchema)),
      version: Schema.optional(VersionSchema),
      pauseReason: Schema.optional(Schema.NullOr(Schema.Literals(['interrupted', 'turn_failed']))),
    }),
    version: 2,
    durability: 'durable',
    stream: 'thread',
    capability: 'events.replay.v1',
  }),
  'catalog/updated': defineEvent({
    payload: Schema.Struct({
      catalogVersion: SequenceSchema,
      models: Schema.optional(Schema.Array(Model.Info)),
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'events.live.v1',
    reconcilesWith: 'model/list',
  }),
  'provider/credential/updated': defineEvent({
    payload: Schema.Struct({ providerId: Provider.ID }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'provider.auth.pi.v1',
    reconcilesWith: 'provider/credential/list',
  }),
  'auth/session/updated': defineEvent({
    payload: Schema.Struct({ session: AuthSessionSchema }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'provider.auth.pi.v1',
    reconcilesWith: 'auth/session/status',
  }),
  'usage/source/updated': defineEvent({
    payload: Schema.Struct({
      sourceId: UsageSourceIdSchema,
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'events.live.v1',
    reconcilesWith: 'usage/source/list',
  }),
  'model/health/updated': defineEvent({
    payload: Schema.Struct({
      runId: OpaqueIDSchema,
      status: Schema.Literals(['running', 'cancelling', 'completed', 'cancelled']),
      counts: ModelHealthCountsSchema,
      changed: Schema.optional(ModelHealthItemSchema),
      completedAt: Schema.optional(TimestampSchema),
    }),
    version: 1,
    durability: 'live',
    stream: 'global',
    capability: 'model.health.v1',
    reconcilesWith: 'model/health/read',
  }),
} as const

export type EventType = keyof typeof EventManifest
export type EventPayload<T extends EventType> = EventPayloadOf<(typeof EventManifest)[T]>
export type DurableEventType = {
  [T in EventType]: (typeof EventManifest)[T]['durability'] extends 'durable' ? T : never
}[EventType]
export type LiveEventType = Exclude<EventType, DurableEventType>
export type EventEnvelope = DurableEventEnvelope | LiveEventEnvelope

const eventTypes = Object.keys(EventManifest) as [EventType, ...EventType[]]
export const EventTypeSchema = Schema.Literals(eventTypes)

const EventEnvelopeBaseFields = {
  eventId: OpaqueIDSchema,
  streamId: OpaqueIDSchema,
  version: VersionSchema,
  occurredAt: TimestampSchema,
  threadId: Schema.optional(OpaqueIDSchema),
  turnId: Schema.optional(OpaqueIDSchema),
} as const

export const DurableEventEnvelopeSchema = Schema.Struct({
  ...EventEnvelopeBaseFields,
  type: EventTypeSchema,
  durability: Schema.Literal('durable'),
  sequence: SequenceSchema,
  payload: JsonValueSchema,
})

export const LiveEventEnvelopeSchema = Schema.Struct({
  ...EventEnvelopeBaseFields,
  type: EventTypeSchema,
  durability: Schema.Literal('live'),
  sequence: Schema.Null,
  afterSequence: SequenceSchema,
  payload: JsonValueSchema,
})

export type DurableEventEnvelope<T extends DurableEventType = DurableEventType> =
  T extends DurableEventType
    ? {
        readonly eventId: string
        readonly streamId: string
        readonly type: T
        readonly version: (typeof EventManifest)[T]['version']
        readonly occurredAt: number
        readonly threadId?: string
        readonly turnId?: string
        readonly durability: 'durable'
        readonly sequence: number
        readonly payload: EventPayload<T>
      }
    : never

export type LiveEventEnvelope<T extends LiveEventType = LiveEventType> = T extends LiveEventType
  ? {
      readonly eventId: string
      readonly streamId: string
      readonly type: T
      readonly version: (typeof EventManifest)[T]['version']
      readonly occurredAt: number
      readonly threadId?: string
      readonly turnId?: string
      readonly durability: 'live'
      readonly sequence: null
      readonly afterSequence: number
      readonly payload: EventPayload<T>
    }
  : never

export const EventEnvelopeSchema = Schema.Union([
  DurableEventEnvelopeSchema,
  LiveEventEnvelopeSchema,
])

export function decodeEventEnvelope(input: unknown): EventEnvelope {
  const envelope = Schema.decodeUnknownSync(EventEnvelopeSchema)(input)
  const definition = EventManifest[envelope.type]

  if (envelope.version !== definition.version) {
    throw new Error(`Unsupported ${envelope.type} event version: ${envelope.version}`)
  }
  if (envelope.durability !== definition.durability) {
    throw new Error(`Invalid durability for ${envelope.type}: ${envelope.durability}`)
  }

  const payload = Schema.decodeUnknownSync(definition.payload)(envelope.payload)
  return { ...envelope, payload } as EventEnvelope
}

export const EventNextNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  method: Schema.Literal('event/next'),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    event: EventEnvelopeSchema,
  }),
})

export const EventReplayCompleteNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  method: Schema.Literal('event/replayComplete'),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    positions: Schema.Array(Schema.Struct({ streamId: OpaqueIDSchema, sequence: SequenceSchema })),
  }),
})

export const SubscriptionClosedReasonSchema = Schema.Literals([
  'unsubscribed',
  'overflow',
  'cursor-expired',
  'server-shutdown',
])

export const EventSubscriptionClosedNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  method: Schema.Literal('event/subscriptionClosed'),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    reason: SubscriptionClosedReasonSchema,
    positions: Schema.Array(Schema.Struct({ streamId: OpaqueIDSchema, sequence: SequenceSchema })),
  }),
})

export const ServerNotificationSchema = Schema.Union([
  EventNextNotificationSchema,
  EventReplayCompleteNotificationSchema,
  EventSubscriptionClosedNotificationSchema,
])
export type ServerNotification = typeof ServerNotificationSchema.Type

export function decodeServerNotification(input: unknown): ServerNotification {
  const notification = Schema.decodeUnknownSync(ServerNotificationSchema)(input)
  if (notification.method !== 'event/next') return notification

  return {
    ...notification,
    params: {
      ...notification.params,
      event: decodeEventEnvelope(notification.params.event),
    },
  } as unknown as ServerNotification
}
