import { Credential, Model, Provider } from '@pidex/model-schema'
import {
  ModelCatalogSchema,
  SubagentProjectionSchema,
  SubagentRunSchema,
  SubagentTaskSchema,
  SubagentWorkspaceSchema,
  ThreadSnapshotSchema,
} from '@pidex/shared'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  AdmissionSchema,
  CursorSchema,
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  SequenceSchema,
  StreamPositionSchema,
  TimestampSchema,
} from '../wire/Primitives'

const SubagentCapabilitiesSchema = Schema.Struct({
  canFollowup: Schema.optional(Schema.Boolean),
  canStop: Schema.Boolean,
  canRetry: Schema.Boolean,
  canRespondToApprovals: Schema.Boolean,
  canRespondToQuestions: Schema.Boolean,
  canRespondToPlan: Schema.optional(Schema.Boolean),
  canApplyWorktree: Schema.Boolean,
  canDiscardWorktree: Schema.Boolean,
  canRestoreWorkspace: Schema.Boolean,
})

const SubagentTerminalResultSchema = Schema.Struct({
  task: SubagentTaskSchema,
  run: SubagentRunSchema,
})

const DiffByteLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))
const DiffContextLinesSchema = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))

const workspaceMutationResult = <const Action extends 'apply' | 'discard' | 'restore'>(
  action: Action,
) =>
  Schema.Struct({
    result: Schema.Struct({
      taskId: OpaqueIDSchema,
      action: Schema.Literal(action),
      outcome: Schema.Literals(['changed', 'unchanged']),
      workspace: SubagentWorkspaceSchema,
    }),
  })

const CatalogResultSchema = Schema.Struct({
  ...ModelCatalogSchema.fields,
  catalogVersion: SequenceSchema,
  total: Schema.optional(NonNegativeIntSchema),
  nextCursor: Schema.optional(CursorSchema),
})

const ModelPageLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))

const SettingsVersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// Public headers deliberately exclude names whose values must use the
// write-only sensitiveHeaders channel below.
const PublicHeaderNameSchema = Schema.String.check(
  Schema.isPattern(
    /^(?!(?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$)[!#$%&'*+.^_`|~0-9A-Za-z-]+$/i,
  ),
)
const PublicHeadersSchema = Schema.Record(PublicHeaderNameSchema, Schema.String)
export const PiProviderApiSchema = Schema.Literals([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])

const NonNegativeNumberSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

const ProviderModelCostSchema = Schema.Struct({
  input: Schema.optional(NonNegativeNumberSchema),
  output: Schema.optional(NonNegativeNumberSchema),
  cacheRead: Schema.optional(NonNegativeNumberSchema),
  cacheWrite: Schema.optional(NonNegativeNumberSchema),
})

const ThinkingLevelMapSchema = Schema.Struct({
  off: Schema.optional(Schema.NullOr(Schema.String)),
  minimal: Schema.optional(Schema.NullOr(Schema.String)),
  low: Schema.optional(Schema.NullOr(Schema.String)),
  medium: Schema.optional(Schema.NullOr(Schema.String)),
  high: Schema.optional(Schema.NullOr(Schema.String)),
  xhigh: Schema.optional(Schema.NullOr(Schema.String)),
  max: Schema.optional(Schema.NullOr(Schema.String)),
})

export const ProviderModelDefinitionSchema = Schema.Struct({
  id: Model.ID,
  name: Schema.optional(NonEmptyStringSchema),
  api: PiProviderApiSchema,
  enabled: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 })),
  ),
  maxTokens: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 })),
  ),
  reasoning: Schema.optional(Schema.Boolean),
  input: Schema.optional(
    Schema.Array(Schema.Literals(['text', 'image'])).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(2),
    ),
  ),
  cost: Schema.optional(ProviderModelCostSchema),
  headers: Schema.optional(PublicHeadersSchema),
  thinkingLevelMap: Schema.optional(ThinkingLevelMapSchema),
  compat: Schema.optional(Schema.Record(Schema.String, JsonValueSchema)),
})

export const BuiltinProviderDefinitionSchema = Schema.Struct({
  kind: Schema.Literal('builtin'),
  id: Provider.ID,
  enabled: Schema.Boolean,
  allowModels: Schema.Array(Model.ID),
  denyModels: Schema.Array(Model.ID),
  models: Schema.Array(
    Schema.Struct({
      id: Model.ID,
      enabled: Schema.Boolean,
    }),
  ),
  /**
   * Optional global wire protocol for builtin providers that expose more than
   * one endpoint. Only DeepSeek accepts it; the Agent rejects other builtin
   * providers that carry the field.
   */
  protocol: Schema.optional(PiProviderApiSchema),
})

export const CustomProviderDefinitionSchema = Schema.Struct({
  kind: Schema.Literal('custom'),
  id: Provider.ID,
  name: NonEmptyStringSchema,
  enabled: Schema.Boolean,
  baseUrl: NonEmptyStringSchema,
  auth: Schema.Literals(['api-key', 'none']),
  env: Schema.Array(NonEmptyStringSchema),
  allowInsecureHttp: Schema.Boolean,
  headers: PublicHeadersSchema,
  models: Schema.Array(ProviderModelDefinitionSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(500),
  ),
})

export const ConfigurableProviderDefinitionSchema = Schema.Union([
  BuiltinProviderDefinitionSchema,
  CustomProviderDefinitionSchema,
]).pipe(Schema.toTaggedUnion('kind'))

export const ProviderDefinitionSchema = ConfigurableProviderDefinitionSchema

const ProviderListEntrySchema = Schema.Struct({
  ...Provider.Info.fields,
  authConfigured: Schema.Boolean,
  config: ProviderDefinitionSchema,
  modelCount: Schema.optional(NonNegativeIntSchema),
})

const ProviderConfigIssueSchema = Schema.Struct({
  providerId: Provider.ID,
  path: Schema.String,
  code: Schema.Literals([
    'INVALID_PROVIDER',
    'INVALID_MODEL',
    'UNSAFE_URL',
    'SENSITIVE_HEADER',
    'BUILTIN_OVERRIDE',
    'UNSUPPORTED_SCHEMA',
  ]),
})

const ProviderListResultSchema = Schema.Struct({
  providers: Schema.Array(ProviderListEntrySchema),
  issues: Schema.Array(ProviderConfigIssueSchema),
  defaultModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
  catalogVersion: SequenceSchema,
})

export const ProviderCredentialHealthSchema = Schema.Struct({
  status: Schema.Literals(['untested', 'healthy', 'auth-failed', 'rate-limited', 'error']),
  lastTestedAt: Schema.optional(TimestampSchema),
  errorCategory: Schema.optional(
    Schema.Literals(['authentication', 'rate-limit', 'network', 'unknown']),
  ),
})

export const ProviderCredentialSummarySchema = Schema.Struct({
  id: Credential.ID,
  providerId: Provider.ID,
  kind: Schema.Literals(['api-key', 'oauth']),
  methodId: Schema.optional(Schema.String),
  label: Schema.String,
  maskedValue: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
  active: Schema.Boolean,
  order: NonNegativeIntSchema,
  health: Schema.optional(ProviderCredentialHealthSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const ProviderCredentialMutationResultSchema = Schema.Struct({
  credential: ProviderCredentialSummarySchema,
})

export const ProviderCredentialStoreSchema = Schema.Literals(['auth-json', 'encrypted'])

export const ProviderCredentialStoreStatusSchema = Schema.Struct({
  store: ProviderCredentialStoreSchema,
  portable: Schema.Boolean,
  credentialCount: NonNegativeIntSchema,
  migrationRequired: Schema.Boolean,
})

export const AuthTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('provider'), providerId: Provider.ID }),
  Schema.Struct({ kind: Schema.Literal('usage'), sourceId: NonEmptyStringSchema }),
]).pipe(Schema.toTaggedUnion('kind'))

const AuthPromptSchema = Schema.Struct({
  id: OpaqueIDSchema,
  type: Schema.Literals(['text', 'secret', 'select', 'manual_code']),
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: NonEmptyStringSchema,
        label: Schema.String,
        description: Schema.optional(Schema.String),
      }),
    ),
  ),
})

const AuthNoticeSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('info'),
    message: Schema.String,
    links: Schema.optional(
      Schema.Array(
        Schema.Struct({
          url: NonEmptyStringSchema,
          label: Schema.optional(Schema.String),
        }),
      ),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal('auth_url'),
    url: NonEmptyStringSchema,
    instructions: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal('device_code'),
    userCode: NonEmptyStringSchema,
    verificationUri: NonEmptyStringSchema,
    intervalSeconds: Schema.optional(NonNegativeIntSchema),
    expiresInSeconds: Schema.optional(NonNegativeIntSchema),
  }),
  Schema.Struct({ type: Schema.Literal('progress'), message: Schema.String }),
]).pipe(Schema.toTaggedUnion('type'))

export const AuthSessionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  target: AuthTargetSchema,
  status: Schema.Literals(['running', 'waiting', 'complete', 'failed', 'cancelled', 'expired']),
  prompt: Schema.optional(AuthPromptSchema),
  notices: Schema.Array(AuthNoticeSchema),
  error: Schema.optional(Schema.String),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
})

export const ProviderTestResultSchema = Schema.Union([
  Schema.Struct({
    providerId: Provider.ID,
    model: Schema.optional(Model.Ref),
    status: Schema.Literal('reachable'),
    testedAt: TimestampSchema,
    latencyMs: NonNegativeIntSchema,
  }),
  Schema.Struct({
    providerId: Provider.ID,
    model: Schema.optional(Model.Ref),
    status: Schema.Literal('unavailable'),
    testedAt: TimestampSchema,
    category: Schema.Literals([
      'authentication',
      'configuration',
      'network',
      'rate-limit',
      'unknown',
    ]),
    message: Schema.String,
  }),
])

const ModelHealthFailureCategorySchema = Schema.Literals([
  'authentication',
  'configuration',
  'network',
  'rate-limit',
  'timeout',
  'provider',
  'unknown',
])

export const ModelHealthItemSchema = Schema.Union([
  Schema.Struct({
    model: Model.Ref,
    status: Schema.Literal('queued'),
  }),
  Schema.Struct({
    model: Model.Ref,
    status: Schema.Literal('running'),
    startedAt: TimestampSchema,
  }),
  Schema.Struct({
    model: Model.Ref,
    status: Schema.Literal('healthy'),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    latencyMs: NonNegativeIntSchema,
  }),
  Schema.Struct({
    model: Model.Ref,
    status: Schema.Literal('failed'),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    category: ModelHealthFailureCategorySchema,
    message: Schema.String,
  }),
  Schema.Struct({
    model: Model.Ref,
    status: Schema.Literal('cancelled'),
    completedAt: TimestampSchema,
  }),
]).pipe(Schema.toTaggedUnion('status'))

export const ModelHealthExcludedProviderSchema = Schema.Struct({
  providerId: Provider.ID,
  reason: Schema.Literals(['provider-disabled', 'provider-unconfigured', 'no-eligible-models']),
  modelCount: NonNegativeIntSchema,
})

export const ModelHealthCountsSchema = Schema.Struct({
  total: NonNegativeIntSchema,
  queued: NonNegativeIntSchema,
  running: NonNegativeIntSchema,
  healthy: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  cancelled: NonNegativeIntSchema,
})

export const ModelHealthRunSchema = Schema.Struct({
  runId: OpaqueIDSchema,
  status: Schema.Literals(['running', 'cancelling', 'completed', 'cancelled']),
  startedAt: TimestampSchema,
  completedAt: Schema.optional(TimestampSchema),
  counts: ModelHealthCountsSchema,
  excludedProviders: Schema.Array(ModelHealthExcludedProviderSchema),
  items: Schema.Array(ModelHealthItemSchema),
})

const ApiKeyTestResultSchema = Schema.Struct({
  credential: ProviderCredentialSummarySchema,
  ok: Schema.Boolean,
  message: Schema.String,
})

export const SystemShrinkReasonSchema = Schema.Literals(['turn_end', 'idle', 'manual'])
export type SystemShrinkReason = typeof SystemShrinkReasonSchema.Type

export const SystemShrinkMemoryParamsSchema = Schema.Struct({
  reason: Schema.optional(SystemShrinkReasonSchema),
})
export type SystemShrinkMemoryParams = typeof SystemShrinkMemoryParamsSchema.Type

export const MemoryStatsSchema = Schema.Struct({
  rss: NonNegativeIntSchema,
  heapTotal: NonNegativeIntSchema,
  heapUsed: NonNegativeIntSchema,
  external: NonNegativeIntSchema,
  arrayBuffers: Schema.optional(NonNegativeIntSchema),
})
export type MemoryStats = typeof MemoryStatsSchema.Type

export const SystemShrinkMemoryResultSchema = Schema.Struct({
  success: Schema.Boolean,
  stats: MemoryStatsSchema,
  freedRssBytes: Schema.optional(Schema.Int),
})
export type SystemShrinkMemoryResult = typeof SystemShrinkMemoryResultSchema.Type

const SUBAGENT_CAPABILITY = 'subagents.v1'

export const ExtendedRpcMethods = {
  'subagent/list': defineMethod({
    params: Schema.Struct({
      threadId: OpaqueIDSchema,
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
    }),
    result: Schema.Struct({
      subagents: Schema.Array(SubagentProjectionSchema),
      nextCursor: Schema.NullOr(CursorSchema),
    }),
    errors: ['THREAD_NOT_FOUND', 'CAPABILITY_REQUIRED', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  'subagent/read': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema }),
    result: Schema.Struct({
      task: SubagentTaskSchema,
      currentRun: Schema.NullOr(SubagentRunSchema),
      snapshot: ThreadSnapshotSchema,
      capabilities: SubagentCapabilitiesSchema,
    }),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'THREAD_NOT_FOUND',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  'subagent/stop': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: SubagentTerminalResultSchema,
    errors: [
      'SUBAGENT_NOT_FOUND',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  'subagent/send': defineMethod({
    params: Schema.Struct({
      taskId: OpaqueIDSchema,
      message: NonEmptyStringSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      disposition: Schema.Literals(['steering', 'follow-up']),
      run: SubagentRunSchema,
    }),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'subagents.followup.v1',
    mutation: true,
  }),

  'subagent/followup': defineMethod({
    params: Schema.Struct({
      taskId: OpaqueIDSchema,
      message: NonEmptyStringSchema,
      ...OperationParamsSchema.fields,
    }),
    result: AdmissionSchema,
    errors: [
      'SUBAGENT_NOT_FOUND',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'subagents.followup.v1',
    mutation: true,
  }),

  'subagent/retry': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      task: SubagentTaskSchema,
      run: SubagentRunSchema,
      admission: AdmissionSchema,
    }),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'MODEL_UNAVAILABLE',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  'subagent/worktree/diff': defineMethod({
    params: Schema.Struct({
      taskId: OpaqueIDSchema,
      maxBytes: Schema.optional(DiffByteLimitSchema),
      contextLines: Schema.optional(DiffContextLinesSchema),
    }),
    result: Schema.Struct({
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'WORKSPACE_CONFLICT',
      'PERMISSION_DENIED',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: false,
  }),

  'subagent/worktree/apply': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult('apply'),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'WORKSPACE_CONFLICT',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  'subagent/worktree/discard': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult('discard'),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'WORKSPACE_CONFLICT',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  'subagent/workspace/restore': defineMethod({
    params: Schema.Struct({ taskId: OpaqueIDSchema, ...OperationParamsSchema.fields }),
    result: workspaceMutationResult('restore'),
    errors: [
      'SUBAGENT_NOT_FOUND',
      'WORKSPACE_CONFLICT',
      'PERMISSION_DENIED',
      'CONFLICT',
      'CAPABILITY_REQUIRED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: SUBAGENT_CAPABILITY,
    mutation: true,
  }),

  'model/list': defineMethod({
    params: Schema.Struct({
      providerId: Schema.optional(Provider.ID),
      query: Schema.optional(Schema.String),
      enabled: Schema.optional(Schema.Boolean),
      inputModality: Schema.optional(Schema.String),
      outputModality: Schema.optional(Schema.String),
      cursor: Schema.optional(CursorSchema),
      limit: Schema.optional(ModelPageLimitSchema),
    }),
    result: CatalogResultSchema,
    errors: ['CURSOR_EXPIRED', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: false,
  }),

  'provider/list': defineMethod({
    params: Schema.Struct({}),
    result: ProviderListResultSchema,
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'model.catalog.paged.v1',
    mutation: false,
  }),

  'model/refresh': defineMethod({
    params: OperationParamsSchema,
    result: CatalogResultSchema,
    errors: ['PROVIDER_UNAVAILABLE', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: true,
  }),

  'model/setDefault': defineMethod({
    params: Schema.Struct({ model: Schema.NullOr(Model.Ref), ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      defaultModel: Schema.NullOr(Model.Ref),
      settingsVersion: SettingsVersionSchema,
    }),
    errors: ['MODEL_UNAVAILABLE', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: true,
  }),

  'model/setReviewer': defineMethod({
    params: Schema.Struct({ model: Schema.NullOr(Model.Ref), ...OperationParamsSchema.fields }),
    result: Schema.Struct({
      reviewerModel: Schema.NullOr(Model.Ref),
      settingsVersion: SettingsVersionSchema,
    }),
    errors: ['MODEL_UNAVAILABLE', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: true,
  }),

  'provider/test': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      model: Schema.optional(Model.Ref),
    }),
    result: ProviderTestResultSchema,
    errors: ['PROVIDER_UNAVAILABLE', 'RATE_LIMITED', 'INVALID_REQUEST', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: false,
  }),

  'model/health/preview': defineMethod({
    params: Schema.Struct({}),
    result: Schema.Struct({
      totalRequests: NonNegativeIntSchema,
      excludedProviders: Schema.Array(ModelHealthExcludedProviderSchema),
    }),
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'model.health.v1',
    mutation: false,
  }),

  'model/health/start': defineMethod({
    params: Schema.Struct({ operationId: OpaqueIDSchema }),
    result: Schema.Struct({ run: ModelHealthRunSchema }),
    errors: ['CONFLICT', 'MODEL_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'model.health.v1',
    mutation: true,
  }),

  'model/health/read': defineMethod({
    params: Schema.Struct({ runId: OpaqueIDSchema }),
    result: Schema.Struct({ run: Schema.NullOr(ModelHealthRunSchema) }),
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'model.health.v1',
    mutation: false,
  }),

  'model/health/cancel': defineMethod({
    params: Schema.Struct({
      runId: OpaqueIDSchema,
      operationId: OpaqueIDSchema,
    }),
    result: Schema.Struct({ run: ModelHealthRunSchema }),
    errors: ['CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'model.health.v1',
    mutation: true,
  }),

  'provider/create': defineMethod({
    params: Schema.Struct({
      definition: CustomProviderDefinitionSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      providerId: Provider.ID,
      catalogVersion: SequenceSchema,
    }),
    errors: [
      'CONFLICT',
      'PROVIDER_UNAVAILABLE',
      'RATE_LIMITED',
      'INVALID_REQUEST',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.config.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/update': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      definition: ConfigurableProviderDefinitionSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      providerId: Provider.ID,
      catalogVersion: SequenceSchema,
    }),
    errors: [
      'PROVIDER_NOT_FOUND',
      'CONFLICT',
      'PROVIDER_UNAVAILABLE',
      'RATE_LIMITED',
      'INVALID_REQUEST',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.config.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/delete': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      providerId: Provider.ID,
      deleted: Schema.Literal(true),
      catalogVersion: SequenceSchema,
    }),
    errors: ['PROVIDER_NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.config.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/model/discover': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      api: PiProviderApiSchema,
    }),
    result: Schema.Struct({
      models: Schema.Array(ProviderModelDefinitionSchema),
    }),
    errors: [
      'PROVIDER_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.config.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: false,
  }),

  'provider/credential/list': defineMethod({
    params: Schema.Struct({
      providerId: Schema.optional(Provider.ID),
    }),
    result: Schema.Struct({
      credentials: Schema.Array(ProviderCredentialSummarySchema),
    }),
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: false,
  }),

  'provider/credential/setActive': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      credentialId: Credential.ID,
      ...OperationParamsSchema.fields,
    }),
    result: ProviderCredentialMutationResultSchema,
    errors: [
      'PROVIDER_NOT_FOUND',
      'CREDENTIAL_NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/credential/setEnabled': defineMethod({
    params: Schema.Struct({
      credentialId: Credential.ID,
      enabled: Schema.Boolean,
      ...OperationParamsSchema.fields,
    }),
    result: ProviderCredentialMutationResultSchema,
    errors: ['CREDENTIAL_NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/credential/delete': defineMethod({
    params: Schema.Struct({
      credentialId: Credential.ID,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      credentials: Schema.Array(ProviderCredentialSummarySchema),
    }),
    errors: ['CREDENTIAL_NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/credential/store/read': defineMethod({
    params: Schema.Record(Schema.String, Schema.Never),
    result: ProviderCredentialStoreStatusSchema,
    errors: ['CREDENTIAL_STORE_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: false,
  }),

  'provider/credential/store/update': defineMethod({
    params: Schema.Struct({
      store: ProviderCredentialStoreSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      ...ProviderCredentialStoreStatusSchema.fields,
      migratedCredentials: NonNegativeIntSchema,
    }),
    errors: [
      'CREDENTIAL_STORE_UNAVAILABLE',
      'CREDENTIAL_STORE_MIGRATION_FAILED',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/apiKey/create': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      label: NonEmptyStringSchema,
      key: NonEmptyStringSchema,
      ...OperationParamsSchema.fields,
    }),
    result: ProviderCredentialMutationResultSchema,
    errors: [
      'PROVIDER_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'AUTHORIZATION_FAILED',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/apiKey/update': defineMethod({
    params: Schema.Struct({
      credentialId: Credential.ID,
      label: Schema.optional(NonEmptyStringSchema),
      key: Schema.optional(NonEmptyStringSchema),
      ...OperationParamsSchema.fields,
    }),
    result: ProviderCredentialMutationResultSchema,
    errors: [
      'CREDENTIAL_NOT_FOUND',
      'AUTHORIZATION_FAILED',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/apiKey/reorder': defineMethod({
    params: Schema.Struct({
      providerId: Provider.ID,
      orderedCredentialIds: Schema.Array(Credential.ID),
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      credentials: Schema.Array(ProviderCredentialSummarySchema),
    }),
    errors: [
      'PROVIDER_NOT_FOUND',
      'CREDENTIAL_NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'provider/apiKey/test': defineMethod({
    params: Schema.Struct({ credentialId: Credential.ID }),
    result: ApiKeyTestResultSchema,
    errors: [
      'CREDENTIAL_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'AUTHORIZATION_FAILED',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: false,
  }),

  'auth/session/start': defineMethod({
    params: Schema.Struct({
      target: AuthTargetSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ session: AuthSessionSchema }),
    errors: [
      'PROVIDER_NOT_FOUND',
      'PROVIDER_UNAVAILABLE',
      'AUTHORIZATION_FAILED',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
    ] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'auth/session/respond': defineMethod({
    params: Schema.Struct({
      sessionId: OpaqueIDSchema,
      promptId: OpaqueIDSchema,
      value: Schema.String,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ session: AuthSessionSchema }),
    errors: ['AUTHORIZATION_FAILED', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'auth/session/status': defineMethod({
    params: Schema.Struct({ sessionId: OpaqueIDSchema }),
    result: Schema.Struct({ session: AuthSessionSchema }),
    errors: ['AUTHORIZATION_FAILED', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: false,
  }),

  'auth/session/cancel': defineMethod({
    params: Schema.Struct({
      sessionId: OpaqueIDSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({ session: AuthSessionSchema }),
    errors: ['AUTHORIZATION_FAILED', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: 'provider.auth.pi.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),

  'system/shrinkMemory': defineMethod({
    params: SystemShrinkMemoryParamsSchema,
    result: SystemShrinkMemoryResultSchema,
    errors: ['INTERNAL_ERROR'] as const,
    capability: 'system.memory.v1',
    exactParams: true,
    exactResult: true,
    mutation: true,
  }),
} as const satisfies MethodMap
