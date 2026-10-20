import { isGranularApprovalPolicy, matchPermissionPreset } from '@pidex/shared/thread'
import type { PermissionDecision, ToolInvocation } from '../Domain'
import type { ToolCatalogEntry } from '../tool/ToolRegistry'
import { toolAllowedForFileAccess, toolAllowedInTaskMode } from '../tool/ToolRegistry'
import { resolveEffectivePermissionConfig } from './EffectivePermissionConfig'
import { executionPolicyFromV4, type EffectiveExecutionPolicy } from './ExecutionPolicy'

export interface RequestedPermissions {
  readPaths: string[]
  writePaths: string[]
  networkDomains: string[]
}
export interface ResolvedExecutionPolicy extends EffectiveExecutionPolicy {
  requested: RequestedPermissions
  networkAllowed: boolean
}
export type ResolvedPermissionDecision =
  | {
      action: 'allow'
      sandbox: ResolvedExecutionPolicy
      decision: 'allow'
      risk: PermissionDecision['risk']
      reason: string
    }
  | {
      action: 'review'
      reviewer: 'user' | 'auto_review'
      sandbox: ResolvedExecutionPolicy
      decision: 'ask'
      risk: PermissionDecision['risk']
      reason: string
      /** Explicit ask rules and host-forced approvals never route to Guardian. */
      forceHumanApproval: boolean
    }
  | { action: 'deny'; reason: string; decision: 'deny'; risk: PermissionDecision['risk'] }

export const requestedPermissions = (input: Record<string, unknown>): RequestedPermissions => {
  const raw = input.additionalPermissions ?? (input.scope ? input : undefined)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { readPaths: [], writePaths: [], networkDomains: [] }
  const value = raw as Record<string, unknown>
  const list = (key: string) =>
    Array.isArray(value[key])
      ? value[key].filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        )
      : []
  return {
    readPaths: list('readPaths'),
    writePaths: list('writePaths'),
    networkDomains: list('networkDomains'),
  }
}

export const hasRequestedPermissions = (input: Record<string, unknown>) =>
  Object.values(requestedPermissions(input)).some((items) => items.length > 0)

export const riskFor = (
  invocation: ToolInvocation,
  tool: NonNullable<ToolInvocation['toolPolicy']>,
): PermissionDecision['risk'] => {
  const requested = requestedPermissions(invocation.input)
  if (invocation.permissionFacts?.risk) return invocation.permissionFacts.risk
  if (tool.capabilities.filesystem === 'host-write') return 'critical'
  if (
    requested.writePaths.length ||
    tool.capabilities.filesystem === 'workspace-write' ||
    tool.capabilities.externalState
  )
    return 'high'
  if (requested.networkDomains.length || tool.capabilities.process) return 'medium'
  return 'low'
}

const approvalCapability = (invocation: ToolInvocation, tool: ToolCatalogEntry) => {
  if (tool.sdkName === 'request_permissions') return 'requestPermissions' as const
  if (invocation.permissionFacts?.skillScript === true) return 'skillApproval' as const
  if (tool.origin?.kind === 'mcp') return 'mcpTools' as const
  if (invocation.permissionFacts?.ruleRequiresApproval === true) return 'rules' as const
  if (tool.capabilities.process || tool.capabilities.filesystem === 'host-write')
    return 'sandboxApproval' as const
  return 'rules' as const
}

const hardGatedCapability = (invocation: ToolInvocation, tool: ToolCatalogEntry) => {
  if (tool.sdkName === 'request_permissions') return 'requestPermissions' as const
  if (invocation.permissionFacts?.skillScript === true) return 'skillApproval' as const
  if (tool.origin?.kind === 'mcp') return 'mcpTools' as const
  return null
}

/**
 * Pure permission truth source used by prompting, exposure, approval and
 * execution. Host facts (rules, protected resources, hook asks) are loaded
 * outside this engine; here they are interpreted in one fixed order:
 * Plan/read-only roots → full access → Deny/Ask → matched grants → risk/preset.
 */
export class PermissionDecisionEngine {
  evaluate(invocation: ToolInvocation, tool: ToolCatalogEntry): ResolvedPermissionDecision {
    invocation = {
      ...invocation,
      permissionConfig: resolveEffectivePermissionConfig(
        invocation.taskMode,
        invocation.permissionConfig,
      ),
    }
    const executionPolicy = executionPolicyFromV4(invocation.permissionConfig)
    const risk = riskFor(invocation, tool)
    const deny = (reason: string): ResolvedPermissionDecision => ({
      action: 'deny',
      decision: 'deny',
      risk,
      reason,
    })
    const preset = matchPermissionPreset(invocation.permissionConfig)
    const fullAccess = preset === 'full-access' && invocation.taskMode !== 'plan'
    if (!fullAccess && invocation.permissionFacts?.denyReason)
      return deny(invocation.permissionFacts.denyReason)
    if (!toolAllowedInTaskMode(tool, invocation.taskMode))
      return deny(`工具 ${tool.sdkName} 不允许在 ${invocation.taskMode} 模式执行`)
    if (invocation.taskMode === 'plan' && tool.sdkName === 'request_permissions')
      return deny('Plan 模式禁止请求或提升权限')
    if (!toolAllowedForFileAccess(tool, executionPolicy.fileAccess))
      return deny(
        `${executionPolicy.fileAccess} 文件访问范围禁止 ${tool.capabilities.filesystem} 能力`,
      )
    const requested = requestedPermissions(invocation.input)
    if (executionPolicy.fileAccess === 'read-only' && requested.writePaths.length)
      return deny('只读文件访问范围禁止写入路径')
    if (invocation.taskMode === 'plan' && requested.networkDomains.length)
      return deny('Plan 模式禁止 Shell 网络权限')
    // The durable checkpoint field remains named `sandbox` for v4/SQLite
    // compatibility. Its value is the centrally interpreted execution policy.
    const sandbox: ResolvedExecutionPolicy = {
      ...executionPolicy,
      requested,
      networkAllowed: requested.networkDomains.length > 0,
    }
    const allow = (reason: string): ResolvedPermissionDecision => ({
      action: 'allow',
      sandbox,
      decision: 'allow',
      risk,
      reason,
    })
    const review = (
      reason: string,
      forceHumanApproval: boolean,
      reviewer?: 'user' | 'auto_review',
    ): ResolvedPermissionDecision => ({
      action: 'review',
      reviewer: forceHumanApproval
        ? 'user'
        : (reviewer ?? invocation.permissionConfig.approvalsReviewer),
      sandbox,
      decision: 'ask',
      risk,
      reason,
      forceHumanApproval,
    })
    if (fullAccess) return allow('完全访问权限')
    const policy = invocation.permissionConfig.approvalPolicy
    // Capability switches are hard gates, not merely instructions about who
    // reviews a request. They must run before rules or always-review can create
    // a request.
    const hardCapability = hardGatedCapability(invocation, tool)
    if (isGranularApprovalPolicy(policy) && hardCapability) {
      if (!policy[hardCapability]) return deny(`granular 策略禁止 ${hardCapability} capability`)
    }

    // 1. Explicit Deny rules always win over ask/allow and over every reviewer.
    const ruleEffect = invocation.permissionFacts?.ruleEffect
    if (ruleEffect === 'deny') return deny('权限规则拒绝此操作')

    // 2. Explicit Ask rules always require a human. Guardian, persistent allow
    // rules and temporary grants can never answer them.
    if (ruleEffect === 'ask') {
      if (policy === 'never') return deny('never 策略禁止等待人工审批')
      if (isGranularApprovalPolicy(policy) && !policy.rules) return deny('细粒度策略禁止规则审批')
      return review(invocation.permissionFacts?.approvalReason ?? '权限规则要求人工批准', true)
    }

    // A not-yet-granted application is an elevation like any other. It routes
    // through the same policy gates, but the prompt must say what the grant
    // actually means: screenshots enter the chat and the app may be fronted.
    const computerApp = invocation.authorizationScope?.computerApp
    if (computerApp && invocation.authorizationScope?.ruleRequiresApproval) {
      if (policy === 'never') return deny(`never 策略禁止新的电脑应用授权：${computerApp.name}`)
      if (isGranularApprovalPolicy(policy) && !policy[approvalCapability(invocation, tool)])
        return deny(`细粒度策略禁止新的电脑应用授权：${computerApp.name}`)
      return review(
        `允许在此聊天中读取和操作应用：${computerApp.name}。截图会进入聊天，必要时会短暂切到前台。`,
        true,
      )
    }

    if (invocation.permissionFacts?.hookRequiresApproval) {
      if (policy === 'never') return deny('never 策略禁止等待 Hook 审批')
      return review(invocation.permissionFacts.approvalReason ?? 'Hook 要求人工批准', true)
    }
    if (ruleEffect === 'allow') return allow('已匹配当前工作区授权')
    if (computerApp) return allow('电脑应用访问资格已满足')

    const facts = invocation.permissionFacts
    const externalWrite = requested.writePaths.length > 0 || facts?.externalWrite === true
    const network =
      (facts?.networkAccess ??
        (!tool.capabilities.process && tool.capabilities.network !== 'none')) ||
      requested.networkDomains.length > 0 ||
      (facts?.ruleTargets?.networkDomains?.length ?? 0) > 0
    const externalCommand = facts?.externalCommand === true
    const detectedRisk = facts?.risk
    const readOnlyRequest =
      tool.sdkName === 'request_permissions' &&
      requested.readPaths.length > 0 &&
      requested.writePaths.length === 0 &&
      requested.networkDomains.length === 0
    const risky = detectedRisk !== undefined && detectedRisk !== 'low'
    const unknown =
      tool.approvalStrategy !== 'never-review' &&
      detectedRisk === undefined &&
      (tool.capabilities.process ||
        tool.capabilities.externalState ||
        tool.origin?.kind === 'mcp' ||
        tool.capabilities.filesystem === 'workspace-write' ||
        tool.capabilities.filesystem === 'host-write')
    const needsReview =
      risky ||
      unknown ||
      network ||
      facts?.forcedApproval === true ||
      facts?.ruleRequiresApproval === true ||
      facts?.destructive === true ||
      (preset !== 'auto-review' &&
        (externalWrite ||
          externalCommand ||
          (hasRequestedPermissions(invocation.input) && !readOnlyRequest))) ||
      (tool.sdkName === 'request_permissions' && !readOnlyRequest)
    if (needsReview) {
      if (policy === 'never') return deny('never 策略禁止等待审批或新增授权')
      if (isGranularApprovalPolicy(policy) && !policy[approvalCapability(invocation, tool)])
        return deny('细粒度策略禁止此审批类别')
      return review(facts?.approvalReason ?? '检测到风险或工作区外操作，需要批准', false)
    }

    if (tool.approvalStrategy === 'never-review') return allow('工具声明为无需审批')
    if (isGranularApprovalPolicy(policy)) return allow('当前权限范围内执行')
    if (policy === 'untrusted')
      return tool.capabilities.filesystem === 'read' && !tool.capabilities.process
        ? allow('可信纯读取操作')
        : review('untrusted 策略要求审批非纯读取操作', false)
    return allow('当前权限范围内执行')
  }
}
