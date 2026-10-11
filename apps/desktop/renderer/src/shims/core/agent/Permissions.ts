import {
  DEFAULT_PERMISSION_CONFIG,
  AUTO_REVIEW_PERMISSION_CONFIG,
  FULL_ACCESS_PERMISSION_CONFIG,
} from '@pidex/shared/thread'
export type ApprovalsReviewer = 'user' | 'auto_review'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type AgentPermissionProfile = ':read-only' | ':workspace' | ':danger-full-access' | string

export type AgentApprovalMode = 'on-request' | 'on-failure' | 'never' | 'untrusted'

export type AgentPermissionAction = 'read' | 'write' | 'shell' | 'network' | 'mcp'
export type AgentPermissionEffect = 'allow' | 'ask' | 'deny'
export type AgentPermissionActionScopes = Partial<
  Record<AgentPermissionAction, AgentPermissionEffect>
>

export type AgentPermissionPolicy = {
  profile: AgentPermissionProfile
  approvalMode: AgentApprovalMode
  approvalsReviewer?: ApprovalsReviewer
  sandboxMode?: SandboxMode
  sandboxPolicy?: AgentPermissionProfile
  actionScopes?: AgentPermissionActionScopes
  toolOverrides?: Record<string, AgentPermissionActionScopes>
}

export type AgentPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  alwaysAllow?: boolean
  updatedInput?: Record<string, unknown>
}

export type AgentPermissionRequest = {
  requestId: string
  toolName: string
  toolUseId?: string
  input: Record<string, unknown>
  description: string
  profile?: AgentPermissionProfile
  approvalMode?: AgentApprovalMode
  approvalsReviewer?: ApprovalsReviewer
  requestKind?:
    | 'shell-command'
    | 'file-write'
    | 'network'
    | 'sandbox-escalation'
    | 'full-access'
    | 'tool'
    | 'permission-grant'
  autoReviewFallbackReason?: string
}

export type DesktopAgentPermissionMode = 'default' | 'auto-review' | 'full-access' | 'custom'

export const DESKTOP_AGENT_PERMISSION_MODES = [
  'default',
  'auto-review',
  'full-access',
  'custom',
] as const satisfies readonly DesktopAgentPermissionMode[]

export function normalizeDesktopAgentPermissionMode(mode: unknown): DesktopAgentPermissionMode {
  switch (mode) {
    case 'auto':
    case 'acceptEdits':
      return 'auto-review'
    case 'bypassPermissions':
      return 'full-access'
    case 'customConfig':
    case 'dontAsk':
      return 'custom'
    case 'auto-review':
    case 'full-access':
    case 'custom':
    case 'default':
      return mode
    default:
      return 'default'
  }
}

export function isDesktopAgentPermissionMode(value: unknown): value is DesktopAgentPermissionMode {
  return (
    typeof value === 'string' &&
    (DESKTOP_AGENT_PERMISSION_MODES as readonly string[]).includes(value)
  )
}

export function permissionPolicyForDesktopMode(
  mode: DesktopAgentPermissionMode | string | undefined,
): AgentPermissionPolicy {
  const normalized = normalizeDesktopAgentPermissionMode(mode)
  const config =
    normalized === 'full-access'
      ? FULL_ACCESS_PERMISSION_CONFIG
      : normalized === 'auto-review'
        ? AUTO_REVIEW_PERMISSION_CONFIG
        : DEFAULT_PERMISSION_CONFIG
  const profile = config.sandboxMode === 'danger-full-access' ? ':danger-full-access' : ':workspace'
  return {
    profile,
    sandboxPolicy: profile,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalPolicy,
    approvalsReviewer: config.approvalsReviewer,
  }
}
