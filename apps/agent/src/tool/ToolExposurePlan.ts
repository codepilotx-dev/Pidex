import type { SubagentProfile, TaskMode } from '../Domain'
import { MAX_SUBAGENT_DEPTH, type SandboxMode } from '@pidex/shared/thread'
import { isGranularApprovalPolicy, type PermissionConfig } from '@pidex/shared/thread'
import type { ToolCatalog } from './ToolRegistry'

export const PI_LIFECYCLE_TOOLS = [
  // These Skill names remain bindable only for already persisted turn snapshots.
  'skill_list',
  'skill_read',
  'project_source_list',
  'project_source_read',
  'request_user_input',
  'request_permissions',
  'update_plan',
  'submit_plan',
  'spawn_agents',
  'wait_agents',
  'send_agent',
  'followup_agent',
  'report_agent',
  'list_agents',
  'stop_agent',
  'finalize_result',
  'update_goal',
] as const

export interface ToolExposureInput {
  taskMode: TaskMode
  sandboxMode: SandboxMode
  /**
   * Approval policy of the effective permission config. It decides whether the
   * model may even ask for temporary permissions, so exposure and execution
   * share one answer instead of advertising a tool every call would deny.
   */
  approvalPolicy: PermissionConfig['approvalPolicy']
  profile?: SubagentProfile
  hasSkillService?: boolean
  hasProjectSources?: boolean
  defaultModeRequestUserInput?: boolean
  delegationEnabled?: boolean
  collaborationEnabled?: boolean
  depth?: number
  allowedTools?: readonly string[]
  activeDeferredTools?: readonly string[]
  hasActiveGoal?: boolean
}

/**
 * `request_permissions` can only ever be answered when the policy permits
 * approvals: `never` forbids waiting, and a granular policy that switches the
 * capability off is a hard denial rather than a review.
 */
export const approvalAllowsPermissionRequests = (policy: PermissionConfig['approvalPolicy']) =>
  policy !== 'never' && !(isGranularApprovalPolicy(policy) && !policy.requestPermissions)

export interface ToolExposurePlan {
  eager: readonly string[]
  deferred: readonly string[]
  exposed: readonly string[]
  allows(name: string): boolean
}

/** Single source of truth for prompt composition and Pi runtime exposure. */
export function createToolExposurePlan(
  catalog: ToolCatalog,
  input: ToolExposureInput,
): ToolExposurePlan {
  const profile = input.profile ?? 'main'
  const sandboxMode = input.taskMode === 'plan' ? 'read-only' : input.sandboxMode
  const definitions = catalog.list(input.taskMode, sandboxMode, profile)
  const eager = definitions
    .filter((tool) => tool.visibility === 'eager')
    .map((tool) => tool.sdkName)
  const deferredCandidates = definitions
    .filter((tool) => tool.visibility === 'deferred')
    .map((tool) => tool.sdkName)
  const lifecycle: string[] = []
  if (input.hasProjectSources) lifecycle.push('project_source_list', 'project_source_read')
  if (profile !== 'main') lifecycle.push('finalize_result')
  else {
    if (input.taskMode === 'plan' || input.defaultModeRequestUserInput)
      lifecycle.push('request_user_input')
    // Plan 主 Agent 以结构化 submit_plan 交付最终方案；<proposed_plan> 仅作兼容回退。
    if (input.taskMode === 'plan') lifecycle.push('submit_plan')
    if (input.taskMode === 'chat') {
      // Chat 主 Agent 可选用结构化交付收尾；Plan 的最终方案由 submit_plan 负责。
      // 权限申请工具只在审批策略真的能应答时暴露。
      if (approvalAllowsPermissionRequests(input.approvalPolicy))
        lifecycle.push('request_permissions')
      lifecycle.push('update_plan', 'finalize_result')
      if (input.hasActiveGoal) lifecycle.push('update_goal')
    }
  }

  if (
    input.delegationEnabled !== false &&
    (input.collaborationEnabled !== false || profile === 'main')
  ) {
    if ((input.depth ?? (profile === 'main' ? 0 : 1)) < MAX_SUBAGENT_DEPTH)
      lifecycle.push('spawn_agents')
    lifecycle.push('wait_agents', 'send_agent', 'stop_agent')
    if (input.collaborationEnabled !== false) lifecycle.push('followup_agent', 'list_agents')
    if (profile !== 'main' && input.collaborationEnabled !== false) lifecycle.push('report_agent')
  }
  const allowlist = input.allowedTools ? new Set(input.allowedTools) : null
  const deferred = deferredCandidates.filter((name) => !allowlist || allowlist.has(name))
  const activeDeferred = new Set(input.activeDeferredTools ?? [])
  const contextuallyActiveDeferred = deferredCandidates.filter(
    (name) => activeDeferred.has(name) && (!allowlist || allowlist.has(name)),
  )
  const explicitlyAllowedDeferred = allowlist
    ? deferredCandidates.filter((name) => allowlist.has(name))
    : []
  // 子 Agent 无论 allowlist 收紧都必须能够收尾提交；主 Agent 的 finalize_result
  // 与其他生命周期工具一样服从 Skill allowlist。
  const finalizers = new Set(['finalize_result'])
  const lifecycleExemption =
    profile !== 'main' ? (name: string) => finalizers.has(name) : () => false
  const exposed = [
    ...new Set([
      ...eager,
      ...contextuallyActiveDeferred,
      ...explicitlyAllowedDeferred,
      ...lifecycle,
    ]),
  ].filter((name) => !allowlist || allowlist.has(name) || lifecycleExemption(name))
  const exposedSet = new Set(exposed)
  return {
    eager: eager.filter((name) => exposedSet.has(name)),
    deferred,
    exposed,
    allows: (name) => exposedSet.has(name),
  }
}
