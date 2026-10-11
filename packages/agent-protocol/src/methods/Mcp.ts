import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import {
  NonEmptyStringSchema,
  OperationParamsSchema,
  SequenceSchema,
  TimestampSchema,
} from '../wire/Primitives'

const StringMapSchema = Schema.Record(NonEmptyStringSchema, Schema.String)
const EnvironmentReferenceMapSchema = Schema.Record(NonEmptyStringSchema, NonEmptyStringSchema)
const TimeoutSchema = Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 600_000 }))

export const McpScopeSchema = Schema.Literals(['user', 'local'])
export const McpTransportTypeSchema = Schema.Literals(['stdio', 'http'])
export const McpHttpAuthSchema = Schema.Literals(['oauth', 'none'])
export const McpToolApprovalModeSchema = Schema.Literals(['auto', 'prompt', 'writes', 'approve'])

export const McpToolPolicySchema = Schema.Struct({
  approvalMode: McpToolApprovalModeSchema,
})

export const McpStdioTransportSchema = Schema.Struct({
  type: Schema.Literal('stdio'),
  command: NonEmptyStringSchema,
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(NonEmptyStringSchema),
  env: Schema.optional(StringMapSchema),
  envFromHost: Schema.optional(EnvironmentReferenceMapSchema),
})

export const McpHttpTransportSchema = Schema.Struct({
  type: Schema.Literal('http'),
  url: NonEmptyStringSchema,
  auth: Schema.optional(McpHttpAuthSchema),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  oauthResource: Schema.optional(NonEmptyStringSchema),
  headers: Schema.optional(StringMapSchema),
  headerFromEnv: Schema.optional(EnvironmentReferenceMapSchema),
  bearerTokenEnvVar: Schema.optional(NonEmptyStringSchema),
})

export const McpTransportConfigSchema = Schema.Union([
  McpStdioTransportSchema,
  McpHttpTransportSchema,
])

export const McpServerDeclarationSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  scope: McpScopeSchema,
  enabled: Schema.Boolean,
  transport: McpTransportConfigSchema,
  diagnosticContext: Schema.optional(Schema.Boolean),
  startupTimeoutMs: Schema.optional(TimeoutSchema),
  toolTimeoutMs: Schema.optional(TimeoutSchema),
  required: Schema.optional(Schema.Boolean),
  enabledTools: Schema.optional(Schema.Array(Schema.String)),
  disabledTools: Schema.optional(Schema.Array(Schema.String)),
  defaultToolsApprovalMode: Schema.optional(McpToolApprovalModeSchema),
  tools: Schema.optional(Schema.Record(NonEmptyStringSchema, McpToolPolicySchema)),
})

export const McpServerListItemSchema = Schema.Struct({
  server: McpServerDeclarationSchema,
  effective: Schema.Boolean,
  shadowedByScope: Schema.optional(McpScopeSchema),
})

export const McpListParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
})

export const McpListResultSchema = Schema.Struct({
  servers: Schema.Array(McpServerListItemSchema),
  generation: SequenceSchema,
})

export const McpRuntimeStateSchema = Schema.Literals([
  'disabled',
  'shadowed',
  'starting',
  'connected',
  'needs_auth',
  'failed',
])

export const McpSanitizedErrorSchema = Schema.Struct({
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  retryable: Schema.Boolean,
})

export const McpRuntimeAuthSummarySchema = Schema.Struct({
  source: Schema.Literals(['none', 'environment', 'oauth']),
  canLogin: Schema.Boolean,
  canLogout: Schema.Boolean,
})
export const McpRuntimeServerAuthSchema = McpRuntimeAuthSummarySchema

export const McpRuntimeServerStatusSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  scope: McpScopeSchema,
  type: McpTransportTypeSchema,
  state: McpRuntimeStateSchema,
  auth: McpRuntimeAuthSummarySchema,
  error: Schema.optional(McpSanitizedErrorSchema),
  toolCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  resourceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  promptCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

export const McpStatusParamsSchema = McpListParamsSchema
export const McpStatusResultSchema = Schema.Struct({
  servers: Schema.Array(McpRuntimeServerStatusSchema),
  totalTools: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  totalResources: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  totalPrompts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  generation: SequenceSchema,
})

export const McpSaveParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  originalName: Schema.optional(NonEmptyStringSchema),
  server: McpServerDeclarationSchema,
  ...OperationParamsSchema.fields,
})

export const McpRemoveParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  scope: McpScopeSchema,
  name: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const McpSetEnabledParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  scope: McpScopeSchema,
  name: NonEmptyStringSchema,
  enabled: Schema.Boolean,
  ...OperationParamsSchema.fields,
})

export const McpReloadParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  ...OperationParamsSchema.fields,
})

export const McpReloadFailureSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  error: McpSanitizedErrorSchema,
})

export const McpReloadResultSchema = Schema.Struct({
  generation: SequenceSchema,
  added: Schema.Array(NonEmptyStringSchema),
  replaced: Schema.Array(NonEmptyStringSchema),
  removed: Schema.Array(NonEmptyStringSchema),
  unchanged: Schema.Array(NonEmptyStringSchema),
  failed: Schema.Array(McpReloadFailureSchema),
})

export const McpOAuthServerParamsSchema = Schema.Struct({
  workspace: Schema.optional(NonEmptyStringSchema),
  scope: McpScopeSchema,
  name: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const McpOAuthStartResultSchema = Schema.Struct({
  attemptId: NonEmptyStringSchema,
  authorizationUrl: NonEmptyStringSchema,
  expiresAt: TimestampSchema,
})

export const McpOAuthStatusParamsSchema = Schema.Struct({
  attemptId: NonEmptyStringSchema,
})

export const McpOAuthStatusResultSchema = Schema.Struct({
  state: Schema.Literals(['pending', 'completed', 'failed', 'expired']),
  error: Schema.optional(McpSanitizedErrorSchema),
})

export const McpOAuthLogoutResultSchema = Schema.Struct({
  generation: SequenceSchema,
})

const McpErrors = [
  'MCP_CONFIG_INVALID',
  'MCP_SERVER_NOT_FOUND',
  'MCP_OAUTH_UNAVAILABLE',
  'MCP_UNAVAILABLE',
  'PATH_DENIED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const

export const McpRpcMethods = {
  'mcp/list': defineMethod({
    params: McpListParamsSchema,
    result: McpListResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/status': defineMethod({
    params: McpStatusParamsSchema,
    result: McpStatusResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/save': defineMethod({
    params: McpSaveParamsSchema,
    result: McpListResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/remove': defineMethod({
    params: McpRemoveParamsSchema,
    result: McpListResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/setEnabled': defineMethod({
    params: McpSetEnabledParamsSchema,
    result: McpListResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/reload': defineMethod({
    params: McpReloadParamsSchema,
    result: McpReloadResultSchema,
    errors: McpErrors,
    capability: 'mcp.manage.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/oauth/start': defineMethod({
    params: McpOAuthServerParamsSchema,
    result: McpOAuthStartResultSchema,
    errors: McpErrors,
    capability: 'mcp.oauth.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/oauth/status': defineMethod({
    params: McpOAuthStatusParamsSchema,
    result: McpOAuthStatusResultSchema,
    errors: McpErrors,
    capability: 'mcp.oauth.v1',
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),
  'mcp/oauth/logout': defineMethod({
    params: McpOAuthServerParamsSchema,
    result: McpOAuthLogoutResultSchema,
    errors: McpErrors,
    capability: 'mcp.oauth.v1',
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type McpScope = typeof McpScopeSchema.Type
export type McpTransportType = typeof McpTransportTypeSchema.Type
export type McpHttpAuth = typeof McpHttpAuthSchema.Type
export type McpToolApprovalMode = typeof McpToolApprovalModeSchema.Type
export type McpToolPolicy = typeof McpToolPolicySchema.Type
export type McpTransportConfig = typeof McpTransportConfigSchema.Type
export type McpServerDeclaration = typeof McpServerDeclarationSchema.Type
export type McpServerListItem = typeof McpServerListItemSchema.Type
export type McpRuntimeState = typeof McpRuntimeStateSchema.Type
export type McpRuntimeAuthSummary = typeof McpRuntimeAuthSummarySchema.Type
export type McpRuntimeServerAuth = typeof McpRuntimeServerAuthSchema.Type
export type McpRuntimeServerStatus = typeof McpRuntimeServerStatusSchema.Type
export type McpSanitizedError = typeof McpSanitizedErrorSchema.Type
