import { Schema } from 'effect'

export const EmptyParamsSchema = Schema.Struct({})
export type EmptyParams = typeof EmptyParamsSchema.Type

export const JsonValueSchema = Schema.Json
export type JsonValue = typeof JsonValueSchema.Type

export const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
export const OpaqueIDSchema = NonEmptyStringSchema
export const RpcIDSchema = Schema.Union([Schema.String, Schema.Number])
export type RpcID = typeof RpcIDSchema.Type

export const CursorSchema = Schema.String.check(Schema.isMinLength(1))
export const LimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
export const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
export const SequenceSchema = NonNegativeIntSchema
export const TimestampSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export const OperationParamsSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
})

export const OkResultSchema = Schema.Struct({ ok: Schema.Literal(true) })

export const CapabilitySchema = Schema.String.check(Schema.isMinLength(1))
export const CapabilityListSchema = Schema.Array(CapabilitySchema)

export const ApplicationErrorCodeSchema = Schema.Literals([
  'PROTOCOL_VERSION_UNSUPPORTED',
  'CAPABILITY_REQUIRED',
  'UNAUTHORIZED',
  'CURSOR_EXPIRED',
  'CONFIG_LAYER_READONLY',
  'CONFIG_VERSION_CONFLICT',
  'CONFIG_VALIDATION_ERROR',
  'CONFIG_PATH_NOT_FOUND',
  'CONFIG_PROJECT_UNTRUSTED',
  'CONFIG_PROFILE_INVALID',
  'CONFIG_PROFILE_NOT_FOUND',
  'SUBSCRIPTION_NOT_FOUND',
  'SUBSCRIPTION_OVERFLOW',
  'REQUEST_NOT_PENDING',
  'CHECKPOINT_UNAVAILABLE',
  'PROJECT_NOT_FOUND',
  'PROJECT_BUSY',
  'PROJECT_REMOVED',
  'PROJECT_FOLDER_IN_USE',
  'PROJECT_FOLDER_OVERLAP',
  'PROJECT_FOLDER_NOT_FOUND',
  'PROJECT_SOURCE_UNAVAILABLE',
  'PROJECT_SETTINGS_CONFLICT',
  'PATH_DENIED',
  'FILE_NOT_FOUND',
  'FILE_NOT_TEXT',
  'FILE_TOO_LARGE',
  'FILE_READONLY',
  'THREAD_NOT_FOUND',
  'INPUT_NOT_FOUND',
  'TURN_NOT_FOUND',
  'TURN_ACTIVE',
  'TURN_ID_MISMATCH',
  'MODEL_UNAVAILABLE',
  'SANDBOX_UNAVAILABLE',
  'SANDBOX_BUSY',
  'TOOLING_UNAVAILABLE',
  'TOOLING_INSTALL_FAILED',
  'TOOLING_DOWNLOAD_FAILED',
  'TOOLING_INTEGRITY_FAILED',
  'TOOLING_ABORTED',
  'SPEECH_PLATFORM_UNSUPPORTED',
  'SPEECH_RUNTIME_NOT_READY',
  'SPEECH_INSTALL_FAILED',
  'SPEECH_AUDIO_INVALID',
  'SPEECH_AUDIO_TOO_LARGE',
  'SPEECH_DURATION_LIMIT',
  'SPEECH_BUSY',
  'SPEECH_TIMEOUT',
  'SPEECH_CANCELLED',
  'SPEECH_TRANSCRIPTION_FAILED',
  'PERMISSION_DENIED',
  'ATTACHMENT_NOT_FOUND',
  'ATTACHMENT_LIMIT',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_LOCATION_INVALID',
  'ARTIFACT_TOO_LARGE',
  'LOCAL_CONTEXT_NOT_FOUND',
  'MEMORY_NOT_FOUND',
  'MEMORY_REJECTED',
  'SKILL_NOT_FOUND',
  'PLUGIN_NOT_FOUND',
  'PLUGIN_NOT_INSTALLED',
  'PLUGIN_INVALID',
  'MINIMAX_CLI_PREREQUISITE_MISSING',
  'MINIMAX_CLI_INSTALL_FAILED',
  'MINIMAX_CLI_UNINSTALL_FAILED',
  'MINIMAX_CLI_CONFIG_FAILED',
  'SUGGESTION_UNAVAILABLE',
  'MCP_CONFIG_INVALID',
  'MCP_SERVER_NOT_FOUND',
  'MCP_OAUTH_UNAVAILABLE',
  'MCP_UNAVAILABLE',
  'PET_NOT_FOUND',
  'PET_INVALID',
  'PET_DOWNLOAD_FAILED',
  'PET_STORAGE_FAILED',
  'RELEASE_NOTES_NOT_PUBLIC',
  'RELEASE_NOTES_UNAVAILABLE',
  'RELEASE_NOTES_RATE_LIMITED',
  'RELEASE_NOTES_INVALID_RESPONSE',
  'SUBAGENT_NOT_FOUND',
  'WORKSPACE_CONFLICT',
  'PROVIDER_NOT_FOUND',
  'PROVIDER_UNAVAILABLE',
  'CREDENTIAL_NOT_FOUND',
  'CREDENTIAL_STORE_UNAVAILABLE',
  'CREDENTIAL_STORE_MIGRATION_FAILED',
  'AUTHORIZATION_FAILED',
  'REPOSITORY_NOT_FOUND',
  'REVIEW_SOURCE_UNAVAILABLE',
  'REVIEW_SNAPSHOT_EXPIRED',
  'REVIEW_REPOSITORY_BUSY',
  'REVIEW_SOURCE_NOT_PREPARED',
  'REVIEW_BATCH_PARTIAL',
  'GITHUB_AUTH_REQUIRED',
  'GITHUB_AUTH_INVALID',
  'GITHUB_OAUTH_FAILED',
  'GITHUB_API_FAILED',
  'GITHUB_UNAVAILABLE',
  'GITHUB_RATE_LIMITED',
  'GITHUB_REMOTE_UNSUPPORTED',
  'GITHUB_PUSH_FAILED',
  'GITHUB_RESPONSE_INVALID',
  'GITHUB_GRAPHQL_FAILED',
  'GIT_REMOTE_NOT_FOUND',
  'GIT_BRANCH_REQUIRED',
  'GIT_BRANCH_INVALID',
  'GIT_BRANCH_EXISTS',
  'GIT_BRANCH_NOT_FOUND',
  'GIT_CHECKOUT_CONFLICT',
  'GIT_PUSH_FAILED',
  'GIT_STATUS_FAILED',
  'GIT_OUTPUT_TOO_LARGE',
  'GIT_OUTPUT_ENCODING_INVALID',
  'GIT_COMMAND_FAILED',
  'TERMINAL_OUTPUT_INVALID',
  'TERMINAL_OUTPUT_TOO_LARGE',
  'HANDOFF_IN_PROGRESS',
  'OPERATION_ID_CONFLICT',
  'SOURCE_ACTIVE',
  'QUEUE_NOT_EMPTY',
  'PENDING_INTERACTION',
  'NOT_GIT',
  'LOCAL_DETACHED',
  'WORKTREE_DETACHED',
  'DEFAULT_BRANCH',
  'BRANCH_IN_USE',
  'DESTINATION_DIRTY',
  'HEAD_MISMATCH',
  'STASH_FAILED',
  'CHECKOUT_FAILED',
  'APPLY_FAILED',
  'HISTORY_UNSUPPORTED',
  'CLIENT_TRANSFER_REQUIRED',
  'ROLLBACK_FAILED',
  'DESTINATION_UNAVAILABLE',
  'FORK_OPERATION_NOT_FOUND',
  'FORK_OPERATION_CONFLICT',
  'FORK_POINT_NOT_FOUND',
  'FORK_POINT_IN_PROGRESS',
  'FORK_POINT_UNAVAILABLE',
  'FORK_ABANDON_UNAVAILABLE',
  'LOCAL_ENVIRONMENT_NOT_GIT',
  'LOCAL_ENVIRONMENT_INVALID',
  'LOCAL_ENVIRONMENT_CONFLICT',
  'LOCAL_ENVIRONMENT_UNTRUSTED',
  'LOCAL_ENVIRONMENT_ACTION_NOT_FOUND',
  'LOCAL_ENVIRONMENT_PLATFORM_UNSUPPORTED',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_OPERATION_NOT_FOUND',
  'WORKTREE_OPERATION_CONFLICT',
  'WORKTREE_NOT_READY',
  'WORKTREE_SETUP_REQUIRED',
  'WORKTREE_PATH_DENIED',
  'WORKTREE_PATH_UNSAFE',
  'WORKTREE_BRANCH_NOT_FOUND',
  'WORKTREE_GIT_FAILED',
  'WORKTREE_APPLY_CONFLICT',
  'WORKTREE_CLEANUP_FAILED',
  'WORKTREE_RESTORE_FAILED',
  'AUTOMATION_NOT_FOUND',
  'AUTOMATION_RUN_NOT_FOUND',
  'SCHEDULED_TASK_NOT_FOUND',
  'SCHEDULE_PLAN_NOT_FOUND',
  'SESSION_GROUP_NOT_FOUND',
  'SESSION_GROUP_STEP_NOT_FOUND',
  'SESSION_GROUP_CONTEXT_ENTRY_NOT_FOUND',
  'SESSION_GROUP_CONTEXT_REVISION_CONFLICT',
  'SESSION_GROUP_THREAD_BUSY',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
])
export type ApplicationErrorCode = typeof ApplicationErrorCodeSchema.Type

export const RpcApplicationErrorDataSchema = Schema.Struct({
  code: ApplicationErrorCodeSchema,
  retryable: Schema.Boolean,
  requestId: Schema.optional(OpaqueIDSchema),
  details: Schema.optional(JsonValueSchema),
})
export type RpcApplicationErrorData = typeof RpcApplicationErrorDataSchema.Type

export const RpcErrorSchema = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(RpcApplicationErrorDataSchema),
})
export type RpcError = typeof RpcErrorSchema.Type

export const StreamPositionSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  sequence: SequenceSchema,
})
export type StreamPosition = typeof StreamPositionSchema.Type

export const PageParamsSchema = Schema.Struct({
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const MutationMetaSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  expectedVersion: Schema.optional(SequenceSchema),
})

export const AdmissionDispositionSchema = Schema.Literals(['accepted', 'duplicate'])
export const AdmissionSchema = Schema.Struct({
  inputId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  disposition: AdmissionDispositionSchema,
  streamPosition: StreamPositionSchema,
})
