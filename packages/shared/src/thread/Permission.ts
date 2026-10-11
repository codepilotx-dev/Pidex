import { Schema } from 'effect'

export const SandboxModeSchema = Schema.Literals([
  'read-only',
  'workspace-write',
  'danger-full-access',
])
export type SandboxMode = typeof SandboxModeSchema.Type

export const GranularApprovalConfigSchema = Schema.Struct({
  sandboxApproval: Schema.Boolean,
  rules: Schema.Boolean,
  skillApproval: Schema.Boolean,
  requestPermissions: Schema.Boolean,
  mcpTools: Schema.Boolean,
  mcpElicitations: Schema.Boolean,
})
export type GranularApprovalConfig = typeof GranularApprovalConfigSchema.Type

export const GranularApprovalPolicySchema = Schema.Struct({
  type: Schema.Literal('granular'),
  sandboxApproval: Schema.Boolean,
  rules: Schema.Boolean,
  skillApproval: Schema.Boolean,
  requestPermissions: Schema.Boolean,
  mcpTools: Schema.Boolean,
  mcpElicitations: Schema.Boolean,
})
export type GranularApprovalPolicy = typeof GranularApprovalPolicySchema.Type

export const ApprovalPolicySchema = Schema.Union([
  Schema.Literals(['untrusted', 'on-failure', 'on-request', 'never']),
  GranularApprovalPolicySchema,
])
export type ApprovalPolicy = typeof ApprovalPolicySchema.Type

export const isGranularApprovalPolicy = (
  policy: ApprovalPolicy,
): policy is GranularApprovalPolicy => typeof policy === 'object' && policy.type === 'granular'

/** Stable TEXT representation used by SQLite and other string-only transports. */
export const encodeApprovalPolicy = (policy: ApprovalPolicy) =>
  typeof policy === 'string' ? policy : JSON.stringify(policy)

export const decodeApprovalPolicy = (value: unknown): ApprovalPolicy => {
  if (value === 'on-failure') return 'on-request'
  if (value === 'untrusted' || value === 'on-request' || value === 'never') return value
  const candidate = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error('approvalPolicy 无效')
  const config = candidate as Record<string, unknown>
  if (config.type !== 'granular') throw new Error('granular approvalPolicy 无效')
  const keys = [
    'sandboxApproval',
    'rules',
    'skillApproval',
    'requestPermissions',
    'mcpTools',
    'mcpElicitations',
  ] as const
  if (keys.some((key) => typeof config[key] !== 'boolean'))
    throw new Error('granular approvalPolicy 缺少布尔配置')
  return {
    type: 'granular',
    sandboxApproval: config.sandboxApproval as boolean,
    rules: config.rules as boolean,
    skillApproval: config.skillApproval as boolean,
    requestPermissions: config.requestPermissions as boolean,
    mcpTools: config.mcpTools as boolean,
    mcpElicitations: config.mcpElicitations as boolean,
  }
}

export const ApprovalsReviewerSchema = Schema.Literals(['user', 'auto_review'])
export type ApprovalsReviewer = typeof ApprovalsReviewerSchema.Type

export const PermissionConfigSchema = Schema.Struct({
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  approvalsReviewer: ApprovalsReviewerSchema,
})
export type PermissionConfig = typeof PermissionConfigSchema.Type

export const DEFAULT_PERMISSION_CONFIG = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const satisfies PermissionConfig

export const AUTO_REVIEW_PERMISSION_CONFIG = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'auto_review',
} as const satisfies PermissionConfig

export const FULL_ACCESS_PERMISSION_CONFIG = {
  sandboxMode: 'danger-full-access',
  approvalPolicy: 'never',
  approvalsReviewer: 'user',
} as const satisfies PermissionConfig

export const AdditionalPermissionsSchema = Schema.Struct({
  readPaths: Schema.optional(Schema.Array(Schema.String)),
  writePaths: Schema.optional(Schema.Array(Schema.String)),
  networkDomains: Schema.optional(Schema.Array(Schema.String)),
})
export type AdditionalPermissions = typeof AdditionalPermissionsSchema.Type

export const PermissionGrantScopeSchema = Schema.Literals(['tool-call', 'turn', 'session'])
export type PermissionGrantScope = typeof PermissionGrantScopeSchema.Type

export const ShellInputSchema = Schema.Struct({
  command: Schema.String,
  cwd: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  additionalPermissions: Schema.optional(AdditionalPermissionsSchema),
  justification: Schema.optional(Schema.String),
})
export type ShellInput = typeof ShellInputSchema.Type

export const RiskCategorySchema = Schema.Literals([
  'destructive',
  'irreversible_change',
  'system_modification',
  'security_control',
  'credential_access',
  'credential_exfiltration',
  'privilege_escalation',
  'persistence',
  'resource_exhaustion',
  'network_access',
  'scope_escape',
  'prompt_injection',
  'obfuscation',
  'unknown_infrastructure',
])
export type RiskCategory = typeof RiskCategorySchema.Type

export const ShellReviewSchema = Schema.Struct({
  decision: Schema.Literals(['allow', 'ask', 'deny']),
  risk: Schema.Literals(['low', 'medium', 'high', 'critical']),
  confidence: Schema.Literals(['low', 'medium', 'high']),
  categories: Schema.Array(RiskCategorySchema),
  requestedScopeValid: Schema.Boolean,
  reason: Schema.String,
})
export type ShellReview = typeof ShellReviewSchema.Type
