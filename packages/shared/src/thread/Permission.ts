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

/**
 * Shared permission preset catalog. Every client must derive its labels,
 * selection state and generated config from this single source instead of
 * re-identifying permission combinations locally.
 *
 * The three stored fields (`sandboxMode`, `approvalPolicy`, `approvalsReviewer`)
 * form one preset identity. A configuration that differs in any of them is
 * custom, including full access combined with an automatic reviewer.
 */
export type PermissionPresetId = 'default' | 'auto-review' | 'full-access'
export type PermissionPresetSelection = PermissionPresetId | 'custom'

export type PermissionPreset = {
  id: PermissionPresetId
  label: string
  description: string
  config: PermissionConfig
}

export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  {
    id: 'default',
    label: '请求批准',
    description:
      '工作区内低风险操作直接执行；外部文件编辑、外部目录命令、检测到的联网与风险操作由你批准。授权仅在当前项目生效。',
    config: DEFAULT_PERMISSION_CONFIG,
  },
  {
    id: 'auto-review',
    label: '帮我批准',
    description:
      '低风险操作自动执行，包括工作区外低风险操作；联网与风险操作交 Guardian，无法判断或不可用时询问你。',
    config: AUTO_REVIEW_PERMISSION_CONFIG,
  },
  {
    id: 'full-access',
    label: '完全访问',
    description:
      '允许访问本机文件、互联网、执行命令及调用工具和 MCP，不进行权限审批；Plan 模式仍独立生效。不提供 OS 沙箱或网络隔离。',
    config: FULL_ACCESS_PERMISSION_CONFIG,
  },
]

export const CUSTOM_PERMISSION_PRESET = {
  id: 'custom',
  label: '自定义',
  description: '分别配置内建文件访问范围、审批策略与审批者。',
} as const

export const PERMISSION_PRESET_OPTIONS: ReadonlyArray<{
  id: PermissionPresetSelection
  label: string
  description: string
}> = [
  ...PERMISSION_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
  CUSTOM_PERMISSION_PRESET,
]

const approvalPolicyIsEqual = (left: ApprovalPolicy, right: ApprovalPolicy): boolean => {
  if (typeof left === 'string' || typeof right === 'string')
    return typeof left === 'string' && typeof right === 'string' && left === right
  return encodeApprovalPolicy(left) === encodeApprovalPolicy(right)
}

/** Exact three-field preset matching. Anything else is custom. */
export const matchPermissionPreset = (config: PermissionConfig): PermissionPresetSelection => {
  const preset = PERMISSION_PRESETS.find(
    (candidate) =>
      candidate.config.sandboxMode === config.sandboxMode &&
      candidate.config.approvalsReviewer === config.approvalsReviewer &&
      approvalPolicyIsEqual(candidate.config.approvalPolicy, config.approvalPolicy),
  )
  return preset?.id ?? 'custom'
}

/** Full access is one complete preset, not a file-scope flag. */
export const isFullAccessPermissionConfig = (config: PermissionConfig): boolean =>
  matchPermissionPreset(config) === 'full-access'

/** Generates the stored config for a preset; custom keeps the current config. */
export const permissionConfigForPreset = (
  preset: PermissionPresetSelection,
  current?: PermissionConfig,
): PermissionConfig => {
  if (preset === 'custom') return { ...(current ?? DEFAULT_PERMISSION_CONFIG) }
  const selected = PERMISSION_PRESETS.find((candidate) => candidate.id === preset)
  return { ...(selected?.config ?? DEFAULT_PERMISSION_CONFIG) }
}

/**
 * Permission rules are additive user intent layered on top of the preset.
 * `effect` is the requested outcome, `scope` is the persistence boundary and
 * `match` describes the exact host-observed subject. Deny always outranks ask,
 * and ask always outranks allow.
 */
export const PermissionRuleEffectSchema = Schema.Literals(['allow', 'ask', 'deny'])
export type PermissionRuleEffect = typeof PermissionRuleEffectSchema.Type

export const PermissionRuleScopeSchema = Schema.Literals(['user', 'project', 'chat'])
export type PermissionRuleScope = typeof PermissionRuleScopeSchema.Type

/** Where the rule is stored; legacy rules come from old approval grants. */
export const PermissionRuleSourceSchema = Schema.Literals(['user', 'project', 'chat', 'legacy'])
export type PermissionRuleSource = typeof PermissionRuleSourceSchema.Type

export const PermissionRuleMatchSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('tool'),
    /** Canonical registered tool name. */
    tool: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('file'),
    access: Schema.Literals(['read', 'write']),
    /** Absolute, host-resolved path or directory. */
    path: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('command'),
    /** Exact raw command value, always matched literally. */
    command: Schema.String,
    cwd: Schema.optional(Schema.String),
    /** Safe argv prefix parsed by the host; absent means exact-command only. */
    argv: Schema.optional(Schema.Array(Schema.String)),
  }),
  Schema.Struct({
    kind: Schema.Literal('network'),
    /** Exact lower-case hostname only; no wildcard or subdomain matching. */
    domain: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('mcp'),
    server: Schema.String,
    tool: Schema.optional(Schema.String),
  }),
])
export type PermissionRuleMatch = typeof PermissionRuleMatchSchema.Type

export const PermissionRuleSchema = Schema.Struct({
  id: Schema.String,
  effect: PermissionRuleEffectSchema,
  scope: PermissionRuleScopeSchema,
  source: PermissionRuleSourceSchema,
  match: PermissionRuleMatchSchema,
  editable: Schema.Boolean,
  /** Config layer version or chat-rule revision used for optimistic writes. */
  version: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Number),
  workspace: Schema.optional(Schema.String),
})
export type PermissionRule = typeof PermissionRuleSchema.Type

export const PermissionRuleInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  effect: PermissionRuleEffectSchema,
  scope: PermissionRuleScopeSchema,
  match: PermissionRuleMatchSchema,
})
export type PermissionRuleInput = typeof PermissionRuleInputSchema.Type

export const permissionRuleEffectRank: Readonly<Record<PermissionRuleEffect, number>> = {
  deny: 3,
  ask: 2,
  allow: 1,
}

/** Deny > ask > allow, independent of storage source. */
export const strongestPermissionRuleEffect = (
  effects: readonly PermissionRuleEffect[],
): PermissionRuleEffect | null =>
  effects.reduce<PermissionRuleEffect | null>(
    (strongest, effect) =>
      strongest === null || permissionRuleEffectRank[effect] > permissionRuleEffectRank[strongest]
        ? effect
        : strongest,
    null,
  )

/** Stable identity for a match object, used to deduplicate and compare rules. */
export const permissionRuleMatchKey = (match: PermissionRuleMatch): string => {
  switch (match.kind) {
    case 'tool':
      return `tool:${match.tool}`
    case 'file':
      return `file:${match.access}:${match.path}`
    case 'command':
      return match.argv && match.argv.length > 0
        ? `command:${match.argv.join('\u0000')}`
        : `command-exact:${match.cwd ?? ''}:${match.command}`
    case 'network':
      return `network:${match.domain}`
    case 'mcp':
      return `mcp:${match.server}/${match.tool ?? '*'}`
  }
}

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
