import { Model } from '@pidex/model-schema'
import { AgentThread } from '@pidex/shared'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  AdmissionSchema,
  CapabilityListSchema,
  CapabilitySchema,
  CursorSchema,
  EmptyParamsSchema,
  JsonValueSchema,
  LimitSchema,
  MutationMetaSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  OkResultSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  PositiveIntSchema,
  SequenceSchema,
  StreamPositionSchema,
  TimestampSchema,
} from '../wire/Primitives'

const CommonErrors = ['RATE_LIMITED', 'INTERNAL_ERROR'] as const
const InitializationErrors = [
  'PROTOCOL_VERSION_UNSUPPORTED',
  'CAPABILITY_REQUIRED',
  'UNAUTHORIZED',
  'PERMISSION_DENIED',
  ...CommonErrors,
] as const
const SubscriptionErrors = [
  'CURSOR_EXPIRED',
  'SUBSCRIPTION_NOT_FOUND',
  'SUBSCRIPTION_OVERFLOW',
  'CAPABILITY_REQUIRED',
  ...CommonErrors,
] as const
const InteractionErrors = [
  'REQUEST_NOT_PENDING',
  'CONFLICT',
  'CHECKPOINT_UNAVAILABLE',
  'CAPABILITY_REQUIRED',
  ...CommonErrors,
] as const
const ProjectErrors = [
  'PROJECT_NOT_FOUND',
  'PROJECT_BUSY',
  'PROJECT_REMOVED',
  'PROJECT_FOLDER_IN_USE',
  'PROJECT_FOLDER_OVERLAP',
  'PROJECT_FOLDER_NOT_FOUND',
  'PROJECT_SOURCE_UNAVAILABLE',
  'PROJECT_SETTINGS_CONFLICT',
  'PATH_DENIED',
  'CONFLICT',
  ...CommonErrors,
] as const
const WorkspaceFileErrors = [
  'PROJECT_NOT_FOUND',
  'PROJECT_REMOVED',
  'PROJECT_FOLDER_NOT_FOUND',
  'PATH_DENIED',
  'FILE_NOT_FOUND',
  'FILE_NOT_TEXT',
  'FILE_TOO_LARGE',
  'FILE_READONLY',
  'CONFLICT',
  ...CommonErrors,
] as const
const ThreadErrors = [
  'THREAD_NOT_FOUND',
  'TURN_NOT_FOUND',
  'TURN_ACTIVE',
  'TURN_ID_MISMATCH',
  'CONFLICT',
  'CHECKPOINT_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'OPERATION_ID_CONFLICT',
  'HANDOFF_IN_PROGRESS',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_NOT_READY',
  'WORKTREE_SETUP_REQUIRED',
  ...CommonErrors,
] as const
const SandboxErrors = [
  'SANDBOX_UNAVAILABLE',
  'SANDBOX_BUSY',
  'PERMISSION_DENIED',
  'CONFLICT',
  ...CommonErrors,
] as const
const AttachmentErrors = [
  'ATTACHMENT_NOT_FOUND',
  'ATTACHMENT_LIMIT',
  'PERMISSION_DENIED',
  ...CommonErrors,
] as const
const LocalContextErrors = [
  'THREAD_NOT_FOUND',
  'LOCAL_CONTEXT_NOT_FOUND',
  'PATH_DENIED',
  'FILE_NOT_FOUND',
  'FILE_NOT_TEXT',
  'FILE_TOO_LARGE',
  'PERMISSION_DENIED',
  'CONFLICT',
  ...CommonErrors,
] as const
const MemoryErrors = [
  'MEMORY_NOT_FOUND',
  'MEMORY_REJECTED',
  'PERMISSION_DENIED',
  ...CommonErrors,
] as const

const ApprovalFeedbackSchema = Schema.String.check(Schema.isMaxLength(4_000))
const NonNegativeNumberSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const NullableCursorSchema = Schema.NullOr(CursorSchema)

export const ClientInfoSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  platform: Schema.optional(NonEmptyStringSchema),
  instanceId: Schema.optional(OpaqueIDSchema),
  authority: Schema.optional(Schema.Literal('desktop-host')),
})

export const InitializeParamsSchema = Schema.Struct({
  clientInfo: ClientInfoSchema,
  protocols: Schema.Array(NonEmptyStringSchema),
  capabilities: CapabilityListSchema,
  interactionDelivery: Schema.Literals(['active', 'observe']),
})

export const InitializeResultSchema = Schema.Struct({
  protocol: Schema.Literal('thread-rpc-v4'),
  serverInfo: Schema.Struct({
    name: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
  }),
  capabilities: CapabilityListSchema,
  limits: Schema.Struct({
    maxFrameBytes: PositiveIntSchema,
    maxSubscriptions: PositiveIntSchema,
    maxStreamsPerSubscription: PositiveIntSchema,
    maxPendingRequests: PositiveIntSchema,
  }),
  connectionId: OpaqueIDSchema,
})

export const ShutdownResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
  acceptedAt: TimestampSchema,
})

export const StreamCursorSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  after: Schema.Union([SequenceSchema, Schema.Literal('latest')]),
})

export const EventSubscribeParamsSchema = Schema.Struct({
  streams: Schema.Array(StreamCursorSchema),
  liveEventTypes: Schema.optional(Schema.Array(NonEmptyStringSchema)),
})

export const SubscriptionPositionSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  sequence: SequenceSchema,
})

export const EventSubscribeResultSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  highWatermarks: Schema.Array(SubscriptionPositionSchema),
})

export const EventAckParamsSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  positions: Schema.Array(SubscriptionPositionSchema),
})

export const EventAckResultSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  acknowledged: Schema.Array(SubscriptionPositionSchema),
})

export const EventUnsubscribeParamsSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
})

export const InteractionKindSchema = Schema.Literals([
  'approval',
  'permission',
  'question',
  'hookTrust',
  'mcp-elicitation',
])
export const InteractionStateSchema = Schema.Literals([
  'pending',
  'resolved',
  'cancelled',
  'expired',
])

const InteractionMetadataFields = {
  interactionId: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  agentId: OpaqueIDSchema,
  createdAt: TimestampSchema,
  version: SequenceSchema,
}

export const PendingApprovalInteractionSchema = Schema.Struct({
  grantOptions: AgentThread.ApprovalRequestSchema.fields.grantOptions,
  toolIdentity: AgentThread.ApprovalRequestSchema.fields.toolIdentity,
  input: AgentThread.ApprovalRequestSchema.fields.input,
  ...InteractionMetadataFields,
  kind: Schema.Literal('approval'),
  toolCallId: OpaqueIDSchema,
  tool: NonEmptyStringSchema,
  risk: Schema.Literals(['low', 'medium', 'high', 'critical']),
  reason: NonEmptyStringSchema,
  command: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  affectedPaths: Schema.optional(Schema.Array(AgentThread.ToolAffectedPathSchema)),
  reviewSummary: Schema.optional(AgentThread.ToolReviewSummarySchema),
  computerApp: Schema.optional(AgentThread.ComputerAppApprovalSchema),
  requestedPermissions: AgentThread.AdditionalPermissionsSchema,
  allowedChoices: Schema.Array(Schema.Literals(['allow-once', 'deny', 'stop'])),
})

export const PendingPermissionInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal('permission'),
  toolCallId: OpaqueIDSchema,
  tool: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
  requestedPermissions: AgentThread.AdditionalPermissionsSchema,
  requestedScope: AgentThread.PermissionGrantScopeSchema,
  allowedScopes: Schema.Array(AgentThread.PermissionGrantScopeSchema)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(3)),
  // New agents always send the real checkpoint risk; old durable events may
  // omit it, in which case consumers fall back to a high-risk presentation.
  risk: Schema.optional(Schema.Literals(['low', 'medium', 'high', 'critical'])),
})

export const InteractionQuestionChoiceSchema = AgentThread.InteractionQuestionChoiceSchema
export const InteractionQuestionSchema = AgentThread.InteractionQuestionSchema

export const PendingQuestionInteractionSchema = Schema.Struct({
  autoResolutionPaused: Schema.optional(Schema.Boolean),
  ...InteractionMetadataFields,
  kind: Schema.Literal('question'),
  toolCallId: Schema.optional(OpaqueIDSchema),
  questions: Schema.Array(InteractionQuestionSchema)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(3)),
  autoResolutionMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 60_000, maximum: 240_000 })),
  ),
})

export const PendingHookTrustInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal('hookTrust'),
  configPath: NonEmptyStringSchema,
  sha256: NonEmptyStringSchema,
  hook: Schema.Struct({
    id: OpaqueIDSchema,
    name: NonEmptyStringSchema,
    event: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
  }),
})

export const PendingInteractionSchema = Schema.Union([
  Schema.Struct({
    ...InteractionMetadataFields,
    kind: Schema.Literal('mcp-elicitation'),
    server: NonEmptyStringSchema,
    tool: NonEmptyStringSchema,
    toolCallId: OpaqueIDSchema,
    request: Schema.Record(Schema.String, JsonValueSchema),
  }),
  PendingApprovalInteractionSchema,
  PendingPermissionInteractionSchema,
  PendingQuestionInteractionSchema,
  PendingHookTrustInteractionSchema,
])

export const InteractionListPendingParamsSchema = Schema.Struct({
  threadId: Schema.optional(OpaqueIDSchema),
  kinds: Schema.optional(Schema.Array(InteractionKindSchema)),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const InteractionListPendingResultSchema = Schema.Struct({
  interactions: Schema.Array(PendingInteractionSchema),
  nextCursor: NullableCursorSchema,
})

export const ApprovalInteractionResponseSchema = Schema.Struct({
  grantOptionId: Schema.optional(NonEmptyStringSchema),
  computerGrant: Schema.optional(Schema.Literals(['chat', 'persistent'])),
  kind: Schema.Literal('approval'),
  decision: Schema.Literals(['allow-once', 'deny', 'stop']),
  feedback: Schema.optional(ApprovalFeedbackSchema),
  remember: Schema.optional(
    Schema.Struct({
      scope: Schema.Literals(['command', 'tool', 'workspace']),
      value: NonEmptyStringSchema,
    }),
  ),
})

export const PermissionInteractionResponseSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('permission'),
    decision: Schema.Literal('grant'),
    scope: AgentThread.PermissionGrantScopeSchema,
    grantedPermissions: AgentThread.AdditionalPermissionsSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('permission'),
    decision: Schema.Literals(['deny', 'stop']),
  }),
])

export const QuestionInteractionResponseSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('question'),
    status: Schema.Literal('answered'),
    resolution: Schema.Literals(['user', 'auto']),
    answers: Schema.Array(AgentThread.InteractionQuestionAnswerSchema)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(3)),
  }),
  Schema.Struct({ kind: Schema.Literal('question'), status: Schema.Literal('ignored') }),
])

export const HookTrustInteractionResponseSchema = Schema.Struct({
  kind: Schema.Literal('hookTrust'),
  decision: Schema.Literals(['allow', 'block']),
})

export const InteractionResponseSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('mcp-elicitation'),
    action: Schema.Literals(['accept', 'decline', 'cancel']),
    content: Schema.optional(Schema.Record(Schema.String, JsonValueSchema)),
  }),
  ApprovalInteractionResponseSchema,
  PermissionInteractionResponseSchema,
  QuestionInteractionResponseSchema,
  HookTrustInteractionResponseSchema,
])

export const InteractionRespondParamsSchema = Schema.Struct({
  interactionId: OpaqueIDSchema,
  expectedVersion: SequenceSchema,
  response: InteractionResponseSchema,
  operationId: OpaqueIDSchema,
})

export const InteractionRespondResultSchema = Schema.Struct({
  interactionId: OpaqueIDSchema,
  kind: InteractionKindSchema,
  state: InteractionStateSchema,
  version: SequenceSchema,
  resolvedAt: TimestampSchema,
  response: InteractionResponseSchema,
})

export const ProjectListParamsSchema = Schema.Struct({
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
  folderPath: Schema.optional(NonEmptyStringSchema),
})

export const ProjectListResultSchema = Schema.Struct({
  projects: Schema.Array(AgentThread.ProjectSchema),
  nextCursor: NullableCursorSchema,
})

export const ProjectCreateParamsSchema = Schema.Struct({
  name: Schema.optional(NonEmptyStringSchema),
  primaryPath: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectCreateResultSchema = Schema.Struct({ project: AgentThread.ProjectSchema })

export const ProjectOpenParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectOpenResultSchema = Schema.Struct({ project: AgentThread.ProjectSchema })

export const ProjectUpdateParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  name: NonEmptyStringSchema,
  expectedVersion: SequenceSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectUpdateResultSchema = Schema.Struct({ project: AgentThread.ProjectSchema })

export const ProjectEditParamsSchema = Schema.Struct({
  ...ProjectUpdateParamsSchema.fields,
  paths: Schema.Array(NonEmptyStringSchema),
})

export const ProjectRestoreParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  removalOperationId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectRemoveParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectRemoveResultSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  removedAt: TimestampSchema,
  archivedThreadCount: NonNegativeIntSchema,
  removalOperationId: Schema.optional(OpaqueIDSchema),
  undoExpiresAt: Schema.optional(TimestampSchema),
})

export const ProjectContextReadParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
})

export const ProjectContextReadResultSchema = Schema.Struct({
  project: AgentThread.ProjectSchema,
  sources: Schema.Array(AgentThread.ProjectSourceSchema),
})

const ProjectFolderMutationFields = {
  projectId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
}

export const ProjectFolderAddParamsSchema = Schema.Struct({
  ...ProjectFolderMutationFields,
  path: NonEmptyStringSchema,
})

export const ProjectFolderRemoveParamsSchema = Schema.Struct({
  ...ProjectFolderMutationFields,
  folderId: OpaqueIDSchema,
})

export const ProjectFolderSetPrimaryParamsSchema = Schema.Struct({
  ...ProjectFolderMutationFields,
  folderId: OpaqueIDSchema,
})

export const ProjectFolderMutationResultSchema = Schema.Struct({
  project: AgentThread.ProjectSchema,
  changed: Schema.Boolean,
})

export const ProjectSettingsPatchSchema = Schema.Struct({
  defaultModel: Schema.optional(Schema.NullOr(Model.Ref)),
  instructions: Schema.optional(Schema.String),
  executionEnvironment: Schema.optional(AgentThread.ProjectExecutionEnvironmentSchema),
})

export const ProjectSettingsUpdateParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  settings: ProjectSettingsPatchSchema,
  expectedVersion: SequenceSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectSettingsUpdateResultSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  settings: AgentThread.ProjectSettingsSchema,
  version: SequenceSchema,
})

export const ProjectSourceUploadSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('text'),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literals(['utf8', 'base64']),
    data: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('image'),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literal('base64'),
    data: NonEmptyStringSchema,
  }),
])

export const ProjectSourceListParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const ProjectSourceListResultSchema = Schema.Struct({
  sources: Schema.Array(AgentThread.ProjectSourceSchema),
  nextCursor: NullableCursorSchema,
})

export const ProjectSourceImportParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  uploads: Schema.Array(ProjectSourceUploadSchema),
  ...OperationParamsSchema.fields,
})

export const ProjectSourceReferenceAddParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  folderId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectSourceMutationResultSchema = Schema.Struct({
  sources: Schema.Array(AgentThread.ProjectSourceSchema),
})

export const ProjectSourceReadParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  sourceId: OpaqueIDSchema,
  range: Schema.optional(
    Schema.Struct({
      offset: NonNegativeIntSchema,
      length: PositiveIntSchema,
    }),
  ),
})

export const ProjectSourceReadResultSchema = Schema.Struct({
  source: AgentThread.ProjectSourceSchema,
  data: Schema.String,
  encoding: Schema.Literals(['utf8', 'base64']),
  range: Schema.Struct({
    offset: NonNegativeIntSchema,
    length: NonNegativeIntSchema,
    total: NonNegativeIntSchema,
  }),
})

export const ProjectSourceRemoveParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  sourceId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectSourceRemoveResultSchema = Schema.Struct({
  sourceId: OpaqueIDSchema,
  removed: Schema.Boolean,
})

export const WorkspaceFileRevisionSchema = Schema.Struct({
  mtimeMs: NonNegativeNumberSchema,
  sha256: NonEmptyStringSchema,
  rawSha256: Schema.optional(NonEmptyStringSchema),
  utf8Bom: Schema.optional(Schema.Boolean),
})

export const WorkspaceFileListParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  folderId: OpaqueIDSchema,
  path: Schema.String,
})

export const WorkspaceFileListResultSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      name: NonEmptyStringSchema,
      path: NonEmptyStringSchema,
      type: Schema.Literals(['file', 'directory']),
      depth: NonNegativeIntSchema,
    }),
  ),
})

export const WorkspaceFileReadParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  folderId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
})

export const WorkspaceFileReadResultSchema = Schema.Struct({
  path: NonEmptyStringSchema,
  content: Schema.String,
  sizeBytes: NonNegativeIntSchema,
  readonly: Schema.Boolean,
  truncated: Schema.Literal(false),
  revision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileSaveParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  folderId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
  content: Schema.String,
  expectedRevision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileSaveResultSchema = Schema.Struct({
  outcome: Schema.Literals(['saved', 'conflict']),
  revision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileWatchParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  folderId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
})

export const WorkspaceFileWatchResultSchema = Schema.Struct({
  watching: Schema.Boolean,
  path: NonEmptyStringSchema,
})

export const ThreadListParamsSchema = Schema.Struct({
  projectId: Schema.optional(OpaqueIDSchema),
  archived: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const ThreadListResultSchema = Schema.Struct({
  threads: Schema.Array(AgentThread.ThreadListItemSchema),
  nextCursor: NullableCursorSchema,
})

export const ThreadCreateWorkspaceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('project'),
    projectId: OpaqueIDSchema,
    execution: Schema.optional(
      Schema.Union([
        Schema.Struct({ kind: Schema.Literal('local') }),
        Schema.Struct({ kind: Schema.Literal('worktree'), worktreeId: OpaqueIDSchema }),
        Schema.Struct({
          kind: Schema.Literal('worktree'),
          startingState: Schema.Union([
            Schema.Struct({ type: Schema.Literal('working-tree') }),
            Schema.Struct({ type: Schema.Literal('branch'), branchName: NonEmptyStringSchema }),
          ]),
        }),
      ]),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('projectless'),
    prompt: Schema.optional(Schema.String),
  }),
])

const ThreadCreateFields = {
  sessionGroupId: Schema.optional(OpaqueIDSchema),
  workflowId: Schema.optional(OpaqueIDSchema),
  creationSurface: Schema.optional(AgentThread.ThreadCreationSurfaceSchema),
  title: Schema.optional(Schema.String),
  settings: Schema.optional(AgentThread.ThreadSettingsSchema),
  ...OperationParamsSchema.fields,
}

export const ThreadCreateParamsSchema = Schema.Struct({
  workspace: ThreadCreateWorkspaceSchema,
  ...ThreadCreateFields,
})

export const ThreadSnapshotResultSchema = Schema.Struct({
  snapshot: AgentThread.ThreadSnapshotSchema,
  streamPosition: StreamPositionSchema,
})

export const ThreadReadParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })

const ThreadHistoryLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))

export const ThreadHistoryReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  before: Schema.optional(CursorSchema),
  limit: Schema.optional(ThreadHistoryLimitSchema),
})

export const ThreadHistoryPageResultSchema = Schema.Struct({
  thread: AgentThread.ThreadSchema,
  pendingPlanApproval: Schema.optional(Schema.NullOr(AgentThread.PlanApprovalSchema)),
  subagents: Schema.Array(AgentThread.SubagentProjectionSchema),
  turns: Schema.Array(AgentThread.ThreadTurnBundleSchema),
  queue: Schema.Struct({
    version: SequenceSchema,
    pauseReason: AgentThread.QueuePauseReasonSchema,
    turns: Schema.Array(AgentThread.TurnSchema),
    inputs: Schema.Array(AgentThread.InputSchema),
  }),
  olderCursor: Schema.NullOr(CursorSchema),
  hasOlder: Schema.Boolean,
  streamPosition: StreamPositionSchema,
})

export const ThreadUpdateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  patch: Schema.Struct({
    title: Schema.optional(Schema.String),
    archived: Schema.optional(Schema.Boolean),
  }),
  ...MutationMetaSchema.fields,
})

export const ThreadUpdateResultSchema = Schema.Struct({ thread: AgentThread.ThreadListItemSchema })

export const ThreadMarkReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  readThroughAt: TimestampSchema,
  ...OperationParamsSchema.fields,
})

export const ThreadMarkReadResultSchema = Schema.Struct({
  thread: AgentThread.ThreadListItemSchema,
})

export const ThreadMarkUnreadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  unreadAt: TimestampSchema,
  ...OperationParamsSchema.fields,
})

export const ThreadMarkUnreadResultSchema = Schema.Struct({
  thread: AgentThread.ThreadListItemSchema,
})

export const ThreadTitleRegenerateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ThreadTitleRegenerateResultSchema = Schema.Struct({
  thread: AgentThread.ThreadListItemSchema,
})

export const ThreadSettingsUpdateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: AgentThread.ThreadSettingsPatchSchema,
  ...MutationMetaSchema.fields,
})

export const ThreadSettingsUpdateResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: AgentThread.ThreadSettingsSchema,
  version: SequenceSchema,
})

export const ThreadDeleteParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ThreadDeleteResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  deletedAt: TimestampSchema,
})

export const ThreadPatchDiffParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  toolCallId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
})

export const ThreadPatchDiffHunkSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  header: NonEmptyStringSchema,
  oldStart: NonNegativeIntSchema,
  oldLines: NonNegativeIntSchema,
  newStart: NonNegativeIntSchema,
  newLines: NonNegativeIntSchema,
  patch: Schema.String,
})

export const ThreadPatchDiffResultSchema = Schema.Struct({
  path: NonEmptyStringSchema,
  operation: Schema.Literals(['create', 'update', 'delete']),
  patch: Schema.String,
  hunks: Schema.Array(ThreadPatchDiffHunkSchema),
  renderable: Schema.Boolean,
  tooLargeReason: Schema.NullOr(Schema.Literals(['changed-lines', 'changed-bytes', 'line-bytes'])),
})
export const decodeThreadPatchDiff = (value: unknown): typeof ThreadPatchDiffResultSchema.Type =>
  Schema.decodeUnknownSync(ThreadPatchDiffResultSchema)(value)

export const PromptSourceSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('builtin'), name: NonEmptyStringSchema }),
  Schema.Struct({ type: Schema.Literal('setting'), name: NonEmptyStringSchema }),
  Schema.Struct({
    type: Schema.Literal('file'),
    path: NonEmptyStringSchema,
    scope: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('runtime'), name: NonEmptyStringSchema }),
])

export const PromptRoleSchema = Schema.Literals(['system', 'developer', 'contextual-user'])
export const PromptCacheClassSchema = Schema.Literals([
  'global-stable',
  'session-stable',
  'dynamic',
])
export const PromptAuthoritySchema = Schema.Literals([
  'builtin',
  'user',
  'project',
  'memory',
  'external-data',
])

export const PromptSectionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  role: PromptRoleSchema,
  cache: PromptCacheClassSchema,
  authority: PromptAuthoritySchema,
  source: PromptSourceSchema,
  content: Schema.String,
  modes: Schema.optional(Schema.Array(AgentThread.TaskModeSchema)),
  profiles: Schema.optional(Schema.Array(AgentThread.SubagentProfileSchema)),
  requiredTools: Schema.optional(Schema.Array(NonEmptyStringSchema)),
})

export const PromptSectionDiagnosticSchema = Schema.Struct({
  id: OpaqueIDSchema,
  role: PromptRoleSchema,
  cache: PromptCacheClassSchema,
  authority: PromptAuthoritySchema,
  source: PromptSourceSchema,
  hash: NonEmptyStringSchema,
  bytes: NonNegativeIntSchema,
  estimatedTokens: NonNegativeIntSchema,
  included: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(['empty', 'mode', 'profile', 'required-tools'])),
})

export const PromptCacheSegmentSchema = Schema.Struct({
  index: NonNegativeIntSchema,
  cache: PromptCacheClassSchema,
  role: Schema.Literals(['instructions', 'context']),
  sectionIds: Schema.Array(OpaqueIDSchema),
  content: Schema.String,
  hash: NonEmptyStringSchema,
  start: NonNegativeIntSchema,
  end: NonNegativeIntSchema,
  cacheable: Schema.Boolean,
})

export const PromptCacheBoundarySchema = Schema.Struct({
  segmentIndex: NonNegativeIntSchema,
  cache: Schema.Literals(['global-stable', 'session-stable']),
  offset: NonNegativeIntSchema,
  hash: NonEmptyStringSchema,
})

export const PromptCacheCapabilitySchema = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal('openai'),
    strategy: Schema.Literal('prompt-cache-key'),
  }),
  Schema.Struct({
    provider: Schema.Literal('anthropic'),
    strategy: Schema.Literal('explicit-ephemeral'),
    maxBreakpoints: PositiveIntSchema,
  }),
  Schema.Struct({ provider: Schema.Literal('other'), strategy: Schema.Literal('stable-prefix') }),
])

export const PromptContextFragmentSchema = Schema.Struct({
  id: OpaqueIDSchema,
  kind: Schema.Literals([
    'mode',
    'permission',
    'settings',
    'project',
    'skill',
    'memory',
    'subagent',
    'plan',
  ]),
  version: SequenceSchema,
  hash: NonEmptyStringSchema,
  payload: JsonValueSchema,
  createdAt: TimestampSchema,
})

export const PromptBaselineSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  baselineVersion: SequenceSchema,
  promptVersion: NonEmptyStringSchema,
  baseHash: NonEmptyStringSchema,
  contextHash: NonEmptyStringSchema,
  cacheKey: NonEmptyStringSchema,
  fragments: Schema.Array(PromptContextFragmentSchema),
  contextWindowTokens: NonNegativeIntSchema,
  usageTokens: NonNegativeIntSchema,
  usageSource: Schema.Literals(['measured', 'estimated', 'compaction-estimate']),
  usageSampleId: Schema.NullOr(OpaqueIDSchema),
  needsCompaction: Schema.Boolean,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const PromptPreviewSchema = Schema.Struct({
  instructions: Schema.String,
  contextItems: Schema.Array(JsonValueSchema),
  diagnostics: Schema.Array(PromptSectionDiagnosticSchema),
  cacheSegments: Schema.Array(PromptCacheSegmentSchema),
  cacheBoundaries: Schema.Array(PromptCacheBoundarySchema),
  baseHash: NonEmptyStringSchema,
  contextHash: NonEmptyStringSchema,
  cacheHash: NonEmptyStringSchema,
  cacheKey: NonEmptyStringSchema,
  cacheMode: PromptCacheCapabilitySchema,
  sections: Schema.Array(PromptSectionSchema),
  baseline: Schema.NullOr(PromptBaselineSchema),
})

export const PromptPreviewParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })
export const PromptPreviewResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  preview: PromptPreviewSchema,
  cacheKey: NonEmptyStringSchema,
})

export const PromptSettingsSchema = Schema.Struct({
  systemPrompt: Schema.optional(Schema.String),
  personality: Schema.optional(Schema.String),
  customInstructions: Schema.optional(Schema.String),
  appendPrompt: Schema.optional(Schema.String),
  appendSystemPrompt: Schema.optional(Schema.String),
  enableMemory: Schema.optional(Schema.Boolean),
  defaultModeRequestUserInput: Schema.optional(Schema.Boolean),
})

export const PromptSettingsSnapshotSchema = Schema.Struct({
  engine: Schema.Literal('prompt-engine-v2'),
  version: Schema.Literal(2),
  snapshottedAt: TimestampSchema,
  settings: PromptSettingsSchema,
})

export const PromptRefreshParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const PromptRefreshResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: PromptSettingsSnapshotSchema,
  cacheKey: NonEmptyStringSchema,
})

export const CompactionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  trigger: Schema.optional(Schema.Literals(['manual', 'automatic', 'reactive'])),
  beforeCount: NonNegativeIntSchema,
  afterCount: NonNegativeIntSchema,
  beforeTokens: NonNegativeIntSchema,
  afterTokens: NonNegativeIntSchema,
  afterTokensSource: Schema.optional(Schema.Literals(['compaction-estimate', 'measured'])),
  targetTokens: NonNegativeIntSchema,
  usageSampleId: OpaqueIDSchema,
  baselineVersion: SequenceSchema,
})

export const ThreadCompactParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})
export const ThreadCompactResultSchema = Schema.Struct({ compaction: CompactionSchema })

export const SkillSelectionSchema = AgentThread.SkillSelectionSchema
export type SkillSelection = typeof SkillSelectionSchema.Type

const TurnContentFields = {
  content: Schema.String,
  skills: Schema.optional(Schema.Array(SkillSelectionSchema)),
  attachmentIds: Schema.optional(Schema.Array(OpaqueIDSchema)),
  contextReferenceIds: Schema.optional(Schema.Array(OpaqueIDSchema)),
}

export const TurnStartParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
  model: Model.Ref,
  permissionConfig: AgentThread.PermissionConfigSchema,
  taskMode: AgentThread.TaskModeSchema,
  goal: Schema.optional(
    Schema.Struct({
      objective: NonEmptyStringSchema,
      tokenBudget: Schema.optional(Schema.NullOr(NonNegativeIntSchema)),
      expectedVersion: Schema.NullOr(SequenceSchema),
    }),
  ),
})

export const QueueAddParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
  model: Model.Ref,
  permissionConfig: AgentThread.PermissionConfigSchema,
  taskMode: AgentThread.TaskModeSchema,
  ...MutationMetaSchema.fields,
})

export const QueueAdmissionResultSchema = Schema.Struct({
  ...AdmissionSchema.fields,
  admission: Schema.Literals(['started', 'queued']),
})

export const TurnSteerParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
})

export const QueuePauseReasonSchema = Schema.NullOr(Schema.Literals(['interrupted', 'turn_failed']))

const QueueMutationFields = {
  threadId: OpaqueIDSchema,
  ...MutationMetaSchema.fields,
}

export const QueueUpdateParamsSchema = Schema.Struct({
  ...QueueMutationFields,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
})

export const QueueInputParamsSchema = Schema.Struct({
  ...QueueMutationFields,
  inputId: OpaqueIDSchema,
})

export const QueueResumeParamsSchema = Schema.Struct(QueueMutationFields)

export const QueueStateResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  version: SequenceSchema,
  pauseReason: QueuePauseReasonSchema,
  turns: Schema.Array(AgentThread.TurnSchema),
  inputs: Schema.Array(AgentThread.InputSchema),
  streamPosition: StreamPositionSchema,
})

export const TurnInterruptParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const TurnInterruptResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  status: AgentThread.TurnStatusSchema,
})

export const TurnResumeParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const TurnResumeResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  status: AgentThread.TurnStatusSchema,
})

export const SandboxStateSchema = Schema.Literals([
  'unsupported',
  'not-installed',
  'installing',
  'available',
  'damaged',
  'repair-required',
])
export const SandboxStatusSchema = Schema.Struct({
  state: SandboxStateSchema,
  platform: NonEmptyStringSchema,
  architecture: NonEmptyStringSchema,
  runtimeVersion: NonEmptyStringSchema,
  maturity: Schema.Literal('alpha'),
  maxConcurrentCommands: PositiveIntSchema,
  error: Schema.NullOr(Schema.String),
  operations: Schema.Struct({
    canInstall: Schema.Boolean,
    canRepair: Schema.Boolean,
    canUninstall: Schema.Boolean,
  }),
})
export const SandboxResultSchema = Schema.Struct({ sandbox: SandboxStatusSchema })
export const SandboxUninstallParamsSchema = Schema.Struct({
  confirm: Schema.Literal(true),
  ...OperationParamsSchema.fields,
})

export const AttachmentUploadSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('text'),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literals(['utf8', 'base64']),
    data: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('image'),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literal('base64'),
    data: NonEmptyStringSchema,
  }),
])

export const AttachmentImportParamsSchema = Schema.Struct({
  uploads: Schema.Array(AttachmentUploadSchema),
  ...OperationParamsSchema.fields,
})
export const AttachmentImportResultSchema = Schema.Struct({
  attachments: Schema.Array(AgentThread.AttachmentSchema),
})

export const AttachmentReadParamsSchema = Schema.Struct({
  attachmentId: OpaqueIDSchema,
  range: Schema.optional(
    Schema.Struct({
      offset: NonNegativeIntSchema,
      length: PositiveIntSchema,
    }),
  ),
})

export const AttachmentReadResultSchema = Schema.Struct({
  attachment: AgentThread.AttachmentSchema,
  data: Schema.String,
  encoding: Schema.Literals(['utf8', 'base64']),
  range: Schema.Struct({
    offset: NonNegativeIntSchema,
    length: NonNegativeIntSchema,
    total: NonNegativeIntSchema,
  }),
})

export const ArtifactMetadataSchema = Schema.Struct({
  id: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  itemId: OpaqueIDSchema,
  name: NonEmptyStringSchema,
  mimeType: NonEmptyStringSchema,
  sizeBytes: NonNegativeIntSchema,
  createdAt: TimestampSchema,
})

export const ArtifactReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  artifactId: OpaqueIDSchema,
})

export const ArtifactReadResultSchema = Schema.Struct({
  artifact: ArtifactMetadataSchema,
  data: Schema.String,
  encoding: Schema.Literals(['base64']),
  sizeBytes: NonNegativeIntSchema,
})

export const LocalContextPathImportParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  paths: Schema.Array(NonEmptyStringSchema),
  ...OperationParamsSchema.fields,
})
export const LocalContextPathImportResultSchema = Schema.Struct({
  references: Schema.Array(AgentThread.LocalContextReferenceSchema),
})

export const LocalContextPathRangeSchema = Schema.Struct({
  offset: NonNegativeIntSchema,
  length: PositiveIntSchema,
})

export const LocalContextPathReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  referenceId: OpaqueIDSchema,
  relativePath: Schema.optional(Schema.String),
  range: Schema.optional(LocalContextPathRangeSchema),
})
export const LocalContextPathReadResultSchema = Schema.Struct({
  reference: AgentThread.LocalContextReferenceSchema,
  relativePath: Schema.NullOr(Schema.String),
  preview: Schema.Literals(['text', 'image', 'unsupported']),
  mediaType: Schema.NullOr(Schema.String),
  data: Schema.NullOr(Schema.String),
  encoding: Schema.NullOr(Schema.Literals(['utf8', 'base64'])),
  range: Schema.NullOr(
    Schema.Struct({
      offset: NonNegativeIntSchema,
      length: NonNegativeIntSchema,
      total: NonNegativeIntSchema,
    }),
  ),
})

export const LocalContextPathListParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  referenceId: OpaqueIDSchema,
  relativePath: Schema.optional(Schema.String),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})
export const LocalContextPathListResultSchema = Schema.Struct({
  reference: AgentThread.LocalContextReferenceSchema,
  relativePath: Schema.NullOr(Schema.String),
  entries: Schema.Array(
    Schema.Struct({
      name: NonEmptyStringSchema,
      relativePath: NonEmptyStringSchema,
      kind: Schema.Literals(['file', 'directory']),
      status: Schema.Literals(['available', 'missing']),
    }),
  ),
  nextCursor: NullableCursorSchema,
})

export const MemoryScopeSchema = Schema.Literals(['user', 'project'])
export const MemoryEntrySchema = Schema.Struct({
  id: OpaqueIDSchema,
  scope: MemoryScopeSchema,
  projectId: Schema.NullOr(OpaqueIDSchema),
  content: Schema.String,
  sourceThreadId: Schema.NullOr(OpaqueIDSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const UserMemoryScopeFields = { scope: Schema.Literal('user') }
const ProjectMemoryScopeFields = { scope: Schema.Literal('project'), projectId: OpaqueIDSchema }

export const MemoryListParamsSchema = Schema.Union([
  Schema.Struct({
    ...UserMemoryScopeFields,
    cursor: Schema.optional(CursorSchema),
    limit: Schema.optional(LimitSchema),
  }),
  Schema.Struct({
    ...ProjectMemoryScopeFields,
    cursor: Schema.optional(CursorSchema),
    limit: Schema.optional(LimitSchema),
  }),
])
export const MemoryListResultSchema = Schema.Struct({
  entries: Schema.Array(MemoryEntrySchema),
  nextCursor: NullableCursorSchema,
})

export const MemoryReadParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, id: OpaqueIDSchema }),
  Schema.Struct({ ...ProjectMemoryScopeFields, id: OpaqueIDSchema }),
])
export const MemoryReadResultSchema = Schema.Struct({ entry: MemoryEntrySchema })

export const MemorySaveParamsSchema = Schema.Union([
  Schema.Struct({
    ...UserMemoryScopeFields,
    id: Schema.optional(OpaqueIDSchema),
    content: NonEmptyStringSchema,
    ...OperationParamsSchema.fields,
  }),
  Schema.Struct({
    ...ProjectMemoryScopeFields,
    id: Schema.optional(OpaqueIDSchema),
    content: NonEmptyStringSchema,
    ...OperationParamsSchema.fields,
  }),
])
export const MemorySaveResultSchema = Schema.Struct({ entry: MemoryEntrySchema })

export const MemoryDeleteParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, id: OpaqueIDSchema, ...OperationParamsSchema.fields }),
  Schema.Struct({
    ...ProjectMemoryScopeFields,
    id: OpaqueIDSchema,
    ...OperationParamsSchema.fields,
  }),
])
export const MemoryDeleteResultSchema = Schema.Struct({
  deleted: Schema.Boolean,
  id: OpaqueIDSchema,
})

export const MemoryResetParamsSchema = Schema.Union([
  Schema.Struct({
    ...UserMemoryScopeFields,
    includeEventLog: Schema.Boolean,
    ...OperationParamsSchema.fields,
  }),
  Schema.Struct({
    ...ProjectMemoryScopeFields,
    includeEventLog: Schema.Boolean,
    ...OperationParamsSchema.fields,
  }),
])
export const MemoryResetResultSchema = Schema.Struct({ deleted: NonNegativeIntSchema })

export const CoreRpcMethods = {
  initialize: defineMethod({
    params: InitializeParamsSchema,
    result: InitializeResultSchema,
    errors: InitializationErrors,
    capability: null,
    mutation: false,
  }),
  shutdown: defineMethod({
    params: OperationParamsSchema,
    result: ShutdownResultSchema,
    errors: InitializationErrors,
    capability: 'agent.shutdown.v1',
    mutation: true,
    exactParams: true,
  }),
  'event/subscribe': defineMethod({
    params: EventSubscribeParamsSchema,
    result: EventSubscribeResultSchema,
    errors: SubscriptionErrors,
    capability: 'events.replay.v1',
    mutation: false,
  }),
  'event/ack': defineMethod({
    params: EventAckParamsSchema,
    result: EventAckResultSchema,
    errors: SubscriptionErrors,
    capability: 'events.replay.v1',
    mutation: false,
  }),
  'event/unsubscribe': defineMethod({
    params: EventUnsubscribeParamsSchema,
    result: OkResultSchema,
    errors: SubscriptionErrors,
    capability: 'events.replay.v1',
    mutation: false,
  }),
  'interaction/listPending': defineMethod({
    params: InteractionListPendingParamsSchema,
    result: InteractionListPendingResultSchema,
    errors: InteractionErrors,
    capability: 'interaction.recovery.v1',
    mutation: false,
  }),
  'interaction/respond': defineMethod({
    params: InteractionRespondParamsSchema,
    result: InteractionRespondResultSchema,
    errors: InteractionErrors,
    capability: 'interactions.serverRequests.v1',
    mutation: true,
    exactParams: true,
  }),
  'interaction/questionPause': defineMethod({
    params: Schema.Struct({ interactionId: OpaqueIDSchema, expectedVersion: SequenceSchema }),
    result: Schema.Struct({ paused: Schema.Boolean }),
    errors: InteractionErrors,
    capability: 'interaction.questionPause.v1',
    mutation: true,
  }),
  'approval/rules/list': defineMethod({
    params: Schema.Struct({ threadId: OpaqueIDSchema }),
    result: Schema.Struct({
      rules: Schema.Array(
        Schema.Struct({
          id: NonEmptyStringSchema,
          kind: Schema.Literals(['network', 'mcp']),
          target: Schema.Array(Schema.String),
        }),
      ),
    }),
    errors: InteractionErrors,
    capability: 'interaction.scopedGrants.v1',
    mutation: false,
  }),
  'approval/reviewState': defineMethod({
    params: Schema.Struct({ threadId: OpaqueIDSchema }),
    result: Schema.Struct({
      manualAllows: NonNegativeIntSchema,
      denials: Schema.Array(
        Schema.Struct({
          id: OpaqueIDSchema,
          tool: Schema.String,
          reason: Schema.String,
          input: Schema.optional(Schema.Record(Schema.String, JsonValueSchema)),
          retryOperationId: Schema.optional(OpaqueIDSchema),
          createdAt: TimestampSchema,
        }),
      ),
    }),
    errors: InteractionErrors,
    capability: 'approval.retry.v1',
    mutation: false,
  }),
  'approval/retry': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      reviewId: OpaqueIDSchema,
      operationId: OpaqueIDSchema,
    }),
    result: Schema.Struct({ input: NonEmptyStringSchema }),
    errors: InteractionErrors,
    capability: 'approval.retry.v1',
    mutation: true,
  }),
  'approval/rules/revoke': defineMethod({
    params: Schema.Struct({ threadId: OpaqueIDSchema, ruleId: NonEmptyStringSchema }),
    result: Schema.Struct({ revoked: Schema.Boolean }),
    errors: InteractionErrors,
    capability: 'interaction.scopedGrants.v1',
    mutation: true,
  }),
  'project/list': defineMethod({
    params: ProjectListParamsSchema,
    result: ProjectListResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: false,
  }),
  'project/create': defineMethod({
    params: ProjectCreateParamsSchema,
    result: ProjectCreateResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/open': defineMethod({
    params: ProjectOpenParamsSchema,
    result: ProjectOpenResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/update': defineMethod({
    params: ProjectUpdateParamsSchema,
    result: ProjectUpdateResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/edit': defineMethod({
    params: ProjectEditParamsSchema,
    result: ProjectUpdateResultSchema,
    errors: ProjectErrors,
    capability: 'project.edit.v1',
    mutation: true,
  }),
  'project/restore': defineMethod({
    params: ProjectRestoreParamsSchema,
    result: ProjectUpdateResultSchema,
    errors: ProjectErrors,
    capability: 'project.restore.v1',
    mutation: true,
  }),
  'project/remove': defineMethod({
    params: ProjectRemoveParamsSchema,
    result: ProjectRemoveResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/context/read': defineMethod({
    params: ProjectContextReadParamsSchema,
    result: ProjectContextReadResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: false,
    exactParams: true,
  }),
  'project/folder/add': defineMethod({
    params: ProjectFolderAddParamsSchema,
    result: ProjectFolderMutationResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/folder/remove': defineMethod({
    params: ProjectFolderRemoveParamsSchema,
    result: ProjectFolderMutationResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/folder/set-primary': defineMethod({
    params: ProjectFolderSetPrimaryParamsSchema,
    result: ProjectFolderMutationResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/settings/update': defineMethod({
    params: ProjectSettingsUpdateParamsSchema,
    result: ProjectSettingsUpdateResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/source/list': defineMethod({
    params: ProjectSourceListParamsSchema,
    result: ProjectSourceListResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: false,
    exactParams: true,
  }),
  'project/source/import': defineMethod({
    params: ProjectSourceImportParamsSchema,
    result: ProjectSourceMutationResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/source/reference/add': defineMethod({
    params: ProjectSourceReferenceAddParamsSchema,
    result: ProjectSourceMutationResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'project/source/read': defineMethod({
    params: ProjectSourceReadParamsSchema,
    result: ProjectSourceReadResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: false,
    exactParams: true,
  }),
  'project/source/remove': defineMethod({
    params: ProjectSourceRemoveParamsSchema,
    result: ProjectSourceRemoveResultSchema,
    errors: ProjectErrors,
    capability: null,
    mutation: true,
    exactParams: true,
  }),
  'workspace/file/list': defineMethod({
    params: WorkspaceFileListParamsSchema,
    result: WorkspaceFileListResultSchema,
    errors: WorkspaceFileErrors,
    capability: 'workspace.editor.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'workspace/file/read': defineMethod({
    params: WorkspaceFileReadParamsSchema,
    result: WorkspaceFileReadResultSchema,
    errors: WorkspaceFileErrors,
    capability: 'workspace.editor.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'workspace/file/save': defineMethod({
    params: WorkspaceFileSaveParamsSchema,
    result: WorkspaceFileSaveResultSchema,
    errors: WorkspaceFileErrors,
    capability: 'workspace.editor.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'workspace/file/watch': defineMethod({
    params: WorkspaceFileWatchParamsSchema,
    result: WorkspaceFileWatchResultSchema,
    errors: WorkspaceFileErrors,
    capability: 'workspace.editor.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'workspace/file/unwatch': defineMethod({
    params: WorkspaceFileWatchParamsSchema,
    result: WorkspaceFileWatchResultSchema,
    errors: WorkspaceFileErrors,
    capability: 'workspace.editor.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/list': defineMethod({
    params: ThreadListParamsSchema,
    result: ThreadListResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: false,
  }),
  'thread/create': defineMethod({
    params: ThreadCreateParamsSchema,
    result: ThreadSnapshotResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
  }),
  'thread/read': defineMethod({
    params: ThreadReadParamsSchema,
    result: ThreadSnapshotResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: false,
  }),
  'thread/history/read': defineMethod({
    params: ThreadHistoryReadParamsSchema,
    result: ThreadHistoryPageResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/update': defineMethod({
    params: ThreadUpdateParamsSchema,
    result: ThreadUpdateResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
  }),
  'thread/mark-read': defineMethod({
    params: ThreadMarkReadParamsSchema,
    result: ThreadMarkReadResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/mark-unread': defineMethod({
    params: ThreadMarkUnreadParamsSchema,
    result: ThreadMarkUnreadResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/title/regenerate': defineMethod({
    params: ThreadTitleRegenerateParamsSchema,
    result: ThreadTitleRegenerateResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'thread/settings/update': defineMethod({
    params: ThreadSettingsUpdateParamsSchema,
    result: ThreadSettingsUpdateResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
  }),
  'thread/delete': defineMethod({
    params: ThreadDeleteParamsSchema,
    result: ThreadDeleteResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
  }),
  'thread/patch/diff': defineMethod({
    params: ThreadPatchDiffParamsSchema,
    result: ThreadPatchDiffResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'thread/patch/apply': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      itemId: OpaqueIDSchema,
      action: Schema.Literals(['undo', 'reapply']),
      expectedVersion: NonNegativeIntSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ item: AgentThread.PatchItemSchema }),
    errors: ThreadErrors,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'prompt/preview': defineMethod({
    params: PromptPreviewParamsSchema,
    result: PromptPreviewResultSchema,
    errors: ThreadErrors,
    capability: 'prompt.preview.sensitive.v1',
    mutation: false,
  }),
  'prompt/refresh': defineMethod({
    params: PromptRefreshParamsSchema,
    result: PromptRefreshResultSchema,
    errors: ThreadErrors,
    capability: 'prompt.refresh.v1',
    mutation: true,
  }),
  'thread/compact': defineMethod({
    params: ThreadCompactParamsSchema,
    result: ThreadCompactResultSchema,
    errors: ThreadErrors,
    capability: 'context.compact.v1',
    mutation: true,
    exactResult: true,
  }),
  'turn/start': defineMethod({
    params: TurnStartParamsSchema,
    result: AdmissionSchema,
    errors: ThreadErrors,
    capability: 'turn.admission.v1',
    mutation: true,
    exactParams: true,
  }),
  'turn/steer': defineMethod({
    params: TurnSteerParamsSchema,
    result: AdmissionSchema,
    errors: ThreadErrors,
    capability: 'turn.steer.v1',
    mutation: true,
    exactParams: true,
  }),
  'turn/interrupt': defineMethod({
    params: TurnInterruptParamsSchema,
    result: TurnInterruptResultSchema,
    errors: ThreadErrors,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'turn/resume': defineMethod({
    params: TurnResumeParamsSchema,
    result: TurnResumeResultSchema,
    errors: ThreadErrors,
    capability: 'turn.resume.v1',
    mutation: true,
  }),
  'queue/add': defineMethod({
    params: QueueAddParamsSchema,
    result: QueueAdmissionResultSchema,
    errors: ThreadErrors,
    capability: 'turn.queue.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'queue/update': defineMethod({
    params: QueueUpdateParamsSchema,
    result: QueueStateResultSchema,
    errors: ThreadErrors,
    capability: 'turn.queue.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'queue/remove': defineMethod({
    params: QueueInputParamsSchema,
    result: QueueStateResultSchema,
    errors: ThreadErrors,
    capability: 'turn.queue.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'queue/resume': defineMethod({
    params: QueueResumeParamsSchema,
    result: QueueStateResultSchema,
    errors: ThreadErrors,
    capability: 'turn.queue.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'sandbox/status': defineMethod({
    params: EmptyParamsSchema,
    result: SandboxResultSchema,
    errors: SandboxErrors,
    capability: 'sandbox.management.v1',
    mutation: false,
    exactResult: true,
  }),
  'sandbox/refresh': defineMethod({
    params: EmptyParamsSchema,
    result: SandboxResultSchema,
    errors: SandboxErrors,
    capability: 'sandbox.management.v1',
    mutation: false,
    exactResult: true,
  }),
  'sandbox/install': defineMethod({
    params: OperationParamsSchema,
    result: SandboxResultSchema,
    errors: SandboxErrors,
    capability: 'sandbox.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'sandbox/repair': defineMethod({
    params: OperationParamsSchema,
    result: SandboxResultSchema,
    errors: SandboxErrors,
    capability: 'sandbox.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'sandbox/uninstall': defineMethod({
    params: SandboxUninstallParamsSchema,
    result: SandboxResultSchema,
    errors: SandboxErrors,
    capability: 'sandbox.management.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'attachment/import': defineMethod({
    params: AttachmentImportParamsSchema,
    result: AttachmentImportResultSchema,
    errors: AttachmentErrors,
    capability: 'attachments.v1',
    mutation: true,
    exactParams: true,
  }),
  'attachment/read': defineMethod({
    params: AttachmentReadParamsSchema,
    result: AttachmentReadResultSchema,
    errors: AttachmentErrors,
    capability: 'attachments.v1',
    mutation: false,
  }),
  'artifact/read': defineMethod({
    params: ArtifactReadParamsSchema,
    result: ArtifactReadResultSchema,
    errors: [
      'THREAD_NOT_FOUND',
      'ARTIFACT_NOT_FOUND',
      'ARTIFACT_LOCATION_INVALID',
      'PERMISSION_DENIED',
      ...CommonErrors,
    ] as const,
    capability: 'artifacts.read.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'context/path/import': defineMethod({
    params: LocalContextPathImportParamsSchema,
    result: LocalContextPathImportResultSchema,
    errors: LocalContextErrors,
    capability: 'local-context.paths.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'context/path/read': defineMethod({
    params: LocalContextPathReadParamsSchema,
    result: LocalContextPathReadResultSchema,
    errors: LocalContextErrors,
    capability: 'local-context.paths.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'context/path/list': defineMethod({
    params: LocalContextPathListParamsSchema,
    result: LocalContextPathListResultSchema,
    errors: LocalContextErrors,
    capability: 'local-context.paths.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'memory/list': defineMethod({
    params: MemoryListParamsSchema,
    result: MemoryListResultSchema,
    errors: MemoryErrors,
    capability: 'memory.v2',
    mutation: false,
    exactResult: true,
  }),
  'memory/read': defineMethod({
    params: MemoryReadParamsSchema,
    result: MemoryReadResultSchema,
    errors: MemoryErrors,
    capability: 'memory.v2',
    mutation: false,
    exactResult: true,
  }),
  'memory/save': defineMethod({
    params: MemorySaveParamsSchema,
    result: MemorySaveResultSchema,
    errors: MemoryErrors,
    capability: 'memory.v2',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'memory/delete': defineMethod({
    params: MemoryDeleteParamsSchema,
    result: MemoryDeleteResultSchema,
    errors: MemoryErrors,
    capability: 'memory.v2',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'memory/reset': defineMethod({
    params: MemoryResetParamsSchema,
    result: MemoryResetResultSchema,
    errors: MemoryErrors,
    capability: 'memory.v2',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type CoreRpcMethod = keyof typeof CoreRpcMethods
