// Runtime capability provenance and Hook recheck adapted from ZCode 872ad96
// (Apache-2.0); see docs/agent/permissions.md and docs/licenses/ZCode-Apache-2.0.txt.
import { createHash } from 'node:crypto'
import {
  AgentError,
  type PermissionDecision,
  type SubagentProfile,
  type TaskMode,
  type ToolAuthorizationScope,
  type ToolInvocation,
} from '../Domain'
import type { WorkspaceService } from '../workspace/WorkspaceService'
import { buildFileDiff } from '../patch/TurnPatchService'
import {
  toolNameMatches,
  type ToolCatalog,
  type ToolFileSnapshots,
  type ToolInputInspection,
  type ToolPauseRequest,
  type ToolProgress,
  type ToolRegistry,
} from './ToolRegistry'
import type { ComputerOperationRecovery } from '../nodeRepl/Protocol'
import { createToolExposurePlan, type ToolExposureInput } from './ToolExposurePlan'
import {
  DEFAULT_PERMISSION_CONFIG,
  isFullAccessPermissionConfig,
  isReadOnlyTaskMode,
  type AdditionalPermissions,
  type PermissionConfig,
  type PermissionGrantScope,
  type ShellInput,
} from '@pidex/shared/thread'
import { Model, Provider } from '@pidex/model-schema'
import { runHostCommand, type ProcessResult } from './Shell/HostProcess'
import { shellCommandSegments } from './Shell/CommandSyntax'
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path'
import {
  PermissionDecisionEngine,
  hasRequestedPermissions,
  requestedPermissions,
} from '../permission/PermissionDecisionEngine'
import { resolveEffectivePermissionConfig } from '../permission/EffectivePermissionConfig'
import { executionPolicyFromV4 } from '../permission/ExecutionPolicy'
import { filePathProtection, resolveProtectionPath } from '../permission/FilePathProtection'
import { PermissionGrantStore } from '../permission/PermissionGrantStore'
import { simpleCommandArgv, type PermissionRuleFacts } from '../permission/ApprovalRules'
import { pathContains } from '../permission/PathPermissions'
import { analyzeShellRisk, type ShellSecurityLevel } from '../security/ShellRiskClassifier'
import { secretScrubber } from '../security/SecretScrubber'
import {
  resolveManagedTool,
  resolveToolingEnvironment,
  runToolProcess,
  toolingPathOverride,
  type ToolingEnvironmentResolver,
  type ToolingResolver,
  type ToolProcessRunner,
} from './ToolingRuntime'
import type { ManagedToolID, ToolingResolution } from './ToolingManager'
import { applyEditsText, type EditOperation } from './Edit/ApplyEditText'
import type { AgentLogger } from '../observability/AgentLogger'
import { parseApplyPatch } from './ApplyPatch/ParseApplyPatch'
import type { TurnPatchMutationBatch } from '../patch/TurnPatchTypes'

type FileToolFailurePhase = 'normalize' | 'authorization' | 'execute' | 'post-hook'

const isFileMutationTool = (name: string) =>
  name === 'Write' || name === 'Edit' || name === 'apply_patch'

const RUNTIME_COMMANDS: Readonly<Record<string, ManagedToolID>> = {
  node: 'nodejs',
  npm: 'nodejs',
  npx: 'nodejs',
  corepack: 'nodejs',
  python: 'python',
  python3: 'python',
  pip: 'python',
  pip3: 'python',
}

/** 仅在 shell 命令片段的起始位置识别需要注入的运行时。 */
export function shellRuntimeDependencies(command: string): ManagedToolID[] {
  const dependencies = new Set<ManagedToolID>()
  for (const segment of shellCommandSegments(command)) {
    const dependency =
      segment.executable && !segment.executableIsPath
        ? RUNTIME_COMMANDS[segment.executable]
        : undefined
    if (dependency) dependencies.add(dependency)
  }
  return [...dependencies]
}

export interface ToolExecutionContext {
  subagentLifecycle?: (name: string, input: Record<string, unknown>) => Promise<unknown>
  threadID: string
  turnID: string
  agentID?: string
  profile?: SubagentProfile
  taskMode: TaskMode
  signal: AbortSignal
  workspace: WorkspaceService
  /** Default process cwd. It must remain inside workspace.rootPath. */
  defaultCwd?: string
  permissionConfig?: PermissionConfig
  model?: Model.Ref
  taskSummary?: string
  skipHooks?: boolean
  hookDepth?: number
  /** Agents SDK tool-call identity used by durable approval interruptions. */
  toolCallID?: string
  /** Set only after a validated durable checkpoint has been claimed. */
  approvedToolCallID?: string
  /** Host-derived scope fingerprint bound to the claimed approval. */
  approvedAuthorizationFingerprint?: string
  approvedComputerGrant?: 'chat' | 'persistent'
  /**
   * Host-only: internal operation recorded in the claimed approval checkpoint.
   * The node_repl entry resumes only this operation; the script is never replayed.
   */
  computerRecovery?: ComputerOperationRecovery
  /** Host-only: arranges a durable approval pause from inside tool execution. */
  requestPause?: (approval: ToolPauseRequest) => Promise<void>
  /** Runs normalization, hard-deny, hooks and review without executing the tool. */
  authorizationOnly?: boolean
  /** Optional active Skill ceiling. It can only remove tools from the effective policy. */
  allowedTools?: readonly string[]
  onProgress?: (progress: ToolProgress) => void
  onSkillDocumentRead?: (path: string, hash: string) => Promise<{ name: string } | undefined>
  /** Immutable tool catalog captured for this turn. */
  toolCatalog?: ToolCatalog
  /** Deferred tool names frozen in the durable turn composition. */
  frozenDeferredToolNames?: readonly string[]
}

export const frozenDeferredEnvelope = <T extends { sdkName: string }>(
  definitions: readonly T[],
  frozenNames: readonly string[] | undefined,
): T[] => {
  if (!frozenNames) return [...definitions]
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.sdkName, definition]),
  )
  const missing = frozenNames.filter((name) => !definitionsByName.has(name))
  if (missing.length > 0) {
    throw new AgentError(
      'RUNTIME_COMPOSITION_UNAVAILABLE',
      `冻结的 deferred 工具缺失: ${missing.join(', ')}`,
      409,
    )
  }
  return frozenNames.map((name) => definitionsByName.get(name)!)
}

export interface ToolExecutorOptions {
  dataDir: string
  userConfigPath?: string
  validateConfigDocument?: (text: string, scope: 'user' | 'project') => void
  authorizeShell: (invocation: ToolInvocation, signal: AbortSignal) => Promise<PermissionDecision>
  /** Optional Guardian Beta observation; must never block tool execution. */
  observeToolStart?: (invocation: ToolInvocation) => void
  recordToolCall?: (
    invocation: ToolInvocation,
    status: 'running' | 'completed' | 'error' | 'interrupted',
    output?: unknown,
    error?: string | null,
    startedAt?: number,
  ) => void
  completedToolCall?: (
    toolCallID: string,
  ) => { name: string; input: Record<string, unknown>; output: unknown } | null
  hooks?: {
    run(
      event: 'pre_tool_use' | 'post_tool_use' | 'post_tool_error',
      evidence: unknown,
      context?: {
        threadID?: string
        turnID?: string
        toolCallID?: string
        toolName?: string
        workspaceRoot?: string
      },
    ): Promise<
      Array<{
        result: {
          decision: 'continue' | 'ask' | 'deny'
          reason?: string
          narrowedInput?: Record<string, unknown>
        }
      }>
    >
  }
  runHost?: typeof runHostCommand
  resolveTooling?: ToolingResolver
  resolveToolingEnvironment?: ToolingEnvironmentResolver
  resolveShellSecurityLevel?: () => ShellSecurityLevel
  runToolProcess?: ToolProcessRunner
  fileSaved?: (input: { workspaceRoot: string; filePath: string; content: string }) => Promise<void>
  recordMutation?: (batch: TurnPatchMutationBatch) => Promise<void>
  discardMutationEvidence?: (input: { threadID: string; turnID: string }) => Promise<void>
  permissionGrants?: PermissionGrantStore
  /** Host-owned rule facts loaded immediately before the final permission gate. */
  resolvePermissionRules?: (invocation: ToolInvocation) => Promise<PermissionRuleFacts>
  /** Called when a turn ends so stale async authorization state cannot survive it. */
  settleTurn?: (threadID: string, turnID: string) => void
  /** Invalidates in-flight Guardian scores when host evaluation denies an action. */
  onPermissionDenied?: (invocation: ToolInvocation) => void
  logger?: AgentLogger
}

/** The sole host-capability entrypoint. Approval and Hook gates run before host execution. */
export class ToolExecutor {
  private readonly decisions = new PermissionDecisionEngine()
  readonly permissionGrants: PermissionGrantStore
  private readonly readSnapshots = new Map<string, { mtimeMs: number; sha256: string }>()
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options?: ToolExecutorOptions,
  ) {
    this.permissionGrants = options?.permissionGrants ?? new PermissionGrantStore()
  }

  /** Process-wide catalog used only to bind names already frozen in a turn snapshot. */
  catalog(): ToolCatalog {
    return this.registry
  }

  definition(name: string, catalog: ToolCatalog = this.registry) {
    return catalog.get(name)
  }

  exposurePlan(input: ToolExposureInput, catalog: ToolCatalog = this.registry) {
    return createToolExposurePlan(catalog, input)
  }

  deferredDefinitions(
    input: ToolExposureInput & { frozenDeferredToolNames?: readonly string[] },
    catalog: ToolCatalog = this.registry,
  ) {
    const definitions = this.exposurePlan(input, catalog).deferred.map((name) => catalog.get(name))
    const unavailable = new Set(
      catalog
        .all()
        .filter((tool) => tool.available?.() === false)
        .map((tool) => tool.sdkName),
    )
    return frozenDeferredEnvelope(
      definitions,
      input.frozenDeferredToolNames?.filter((name) => !unavailable.has(name)),
    )
  }

  async previewApproval(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    toolCallID: string,
  ) {
    return this.execute<PermissionDecision>(name, input, {
      ...context,
      toolCallID,
      authorizationOnly: true,
    })
  }

  private async recordSkillRead<T>(
    name: string,
    input: Record<string, unknown>,
    output: T,
    context: ToolExecutionContext,
  ): Promise<T> {
    if (
      (name === 'Read' || name === 'workspace.read') &&
      !context.authorizationOnly &&
      context.onSkillDocumentRead
    ) {
      const file = output as {
        path: string
        snapshot: { sha256: string; rawSha256?: string }
        truncated: boolean
      }
      const skill = await context.onSkillDocumentRead(
        file.path,
        file.snapshot.rawSha256 ?? file.snapshot.sha256,
      )
      if (skill) {
        const status = file.truncated || input.offset ? 'partial' : 'loaded'
        context.onProgress?.({
          message: `${status === 'loaded' ? '已加载' : '正在读取'} Skill ${skill.name}`,
        })
        return { ...file, skill: { ...skill, status } } as T
      }
    }
    return output
  }

  async execute<T = unknown>(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<T> {
    if (context.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const requestStartedAt = Date.now()
    context = {
      ...context,
      permissionConfig: resolveEffectivePermissionConfig(
        context.taskMode,
        context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG,
      ),
    }
    const catalog = context.toolCatalog ?? this.registry
    const definition = catalog.get(name)
    if (context.allowedTools && !toolNameMatches(definition, context.allowedTools))
      throw new AgentError(
        'SKILL_TOOL_NOT_ALLOWED',
        `当前 Skill 不允许使用工具 ${definition.sdkName}`,
        403,
      )
    const parsed = definition.schema.safeParse(input)
    if (!parsed.success) {
      const error = new AgentError('INVALID_TOOL_INPUT', parsed.error.message, 400)
      if (isFileMutationTool(definition.sdkName)) {
        this.logFileToolFailure(
          definition.sdkName,
          input,
          context,
          'normalize',
          error,
          requestStartedAt,
        )
      }
      throw error
    }
    const canonicalName = definition.sdkName
    const parsedInput = parsed.data as Record<string, unknown>
    const normalized =
      canonicalName === 'Bash' || canonicalName === 'PowerShell'
        ? {
            command: parsedInput.command,
            ...(parsedInput.cwd === undefined ? {} : { cwd: parsedInput.cwd }),
            ...(parsedInput.timeout === undefined ? {} : { timeoutMs: parsedInput.timeout }),
            ...(parsedInput.description === undefined
              ? {}
              : { justification: parsedInput.description }),
            ...(parsedInput.additionalPermissions === undefined
              ? {}
              : { additionalPermissions: parsedInput.additionalPermissions }),
          }
        : canonicalName === 'request_permissions'
          ? await this.normalizePermissionRequest(parsedInput, context)
          : parsedInput
    if (isReadOnlyTaskMode(context.taskMode) && canonicalName === 'request_permissions') {
      throw new AgentError('TOOL_NOT_ALLOWED_IN_MODE', 'Plan 与 Grill 模式禁止请求或提升权限', 403)
    }
    if (canonicalName === 'request_permissions' && typeof normalized.escalationToken === 'string') {
      throw new AgentError(
        'SANDBOX_ESCALATION_UNAVAILABLE',
        '内置命令沙箱已移除，不再支持 sandbox escalation',
        503,
      )
    }
    if (context.toolCallID && !context.authorizationOnly) {
      const completed = this.options?.completedToolCall?.(context.toolCallID)
      if (completed) {
        const storedInput = Object.fromEntries(
          Object.keys(normalized).map((key) => [key, completed.input[key]]),
        )
        if (
          completed.name !== canonicalName ||
          JSON.stringify(storedInput) !== JSON.stringify(normalized)
        ) {
          throw new AgentError('TOOL_CALL_ID_CONFLICT', 'toolCallId 已被不同的工具调用使用', 409)
        }
        return this.recordSkillRead(canonicalName, normalized, completed.output as T, context)
      }
    }
    const profile = context.profile ?? 'main'
    if (!definition.allowedProfiles.includes(profile))
      throw new AgentError(
        'TOOL_NOT_ALLOWED_FOR_PROFILE',
        `工具 ${canonicalName} 不允许 ${profile} profile 使用`,
        403,
      )
    if (canonicalName === 'Bash' || canonicalName === 'PowerShell') {
      const progress = definition.progress?.(parsed.data, {
        signal: context.signal,
        taskMode: context.taskMode,
        profile,
        workspace: context.workspace,
        permissionConfig: context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG,
        model:
          context.model ??
          Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') }),
        ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      })
      if (progress) context.onProgress?.(progress)
      return (await this.executeShell(canonicalName, normalized, context, catalog)) as T
    }
    return this.executeRegistered<T>(canonicalName, normalized, context, catalog)
  }

  private async executeRegistered<T>(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    catalog: ToolCatalog,
  ) {
    if (!isFileMutationTool(name))
      return this.executeRegisteredCore<T>(name, input, context, catalog)
    const startedAt = Date.now()
    let phase: FileToolFailurePhase = 'normalize'
    try {
      return await this.executeRegisteredCore<T>(name, input, context, catalog, (nextPhase) => {
        phase = nextPhase
      })
    } catch (cause) {
      this.logFileToolFailure(name, input, context, phase, cause, startedAt)
      throw cause
    }
  }

  private async executeRegisteredCore<T>(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    catalog: ToolCatalog,
    setFilePhase?: (phase: FileToolFailurePhase) => void,
  ) {
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const model =
      context.model ??
      Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
    // Call-scoped file access: only this invocation sees the effective policy, so
    // concurrent calls, subagents and later policy switches stay isolated from it.
    let workspace = context.workspace.withFileAccess(
      executionPolicyFromV4(permissionConfig).fileAccess,
    )
    const skipProjectHooks = context.skipHooks || isReadOnlyTaskMode(context.taskMode)
    if (this.options?.userConfigPath) {
      workspace.grantEditorAlias('@pidex/config.json', this.options.userConfigPath)
    }
    const definition = catalog.get(name)
    const rawPaths =
      name === 'apply_patch' && typeof input.patch === 'string'
        ? parseApplyPatch(input.patch).map((operation) => operation.path)
        : definition.capabilities.filesystem !== 'none'
          ? [input.file_path ?? input.path].filter(
              (path): path is string => typeof path === 'string' && !path.startsWith('@'),
            )
          : []
    const canonicalPaths = await Promise.all(
      rawPaths.map((path) => resolveProtectionPath(resolve(workspace.rootPath, path))),
    )
    const externalPaths = canonicalPaths.filter((path) => !workspace.containsPath(path))
    const writesFiles =
      definition.capabilities.filesystem === 'workspace-write' ||
      definition.capabilities.filesystem === 'host-write'
    const fileRequested = {
      readPaths: writesFiles ? [] : externalPaths,
      writePaths: writesFiles ? externalPaths : [],
      networkDomains: [],
    }
    const fileGrantLookup = {
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      requested: fileRequested,
      workspaceRoot: context.workspace.rootPath,
    }
    const fileGrant =
      writesFiles && externalPaths.length && !workspace.allowsOutsideWorkspace()
        ? this.permissionGrants.authorize(fileGrantLookup)
        : null
    if (externalPaths.length) workspace = workspace.withPermissionPaths(fileRequested)
    const fileSnapshots = this.fileSnapshots(context, workspace)
    const baseInvocation: ToolInvocation = {
      id: context.toolCallID ?? crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name,
      input,
      permissionConfig,
      model,
      taskMode: context.taskMode,
    }
    const rawInspection = definition.inspectInput
      ? await definition.inspectInput(input, {
          signal: context.signal,
          taskMode: context.taskMode,
          profile: context.profile ?? 'main',
          workspace,
          permissionConfig,
          model,
          fileSnapshots,
          invocation: {
            threadID: context.threadID,
            turnID: context.turnID,
            agentID: baseInvocation.agentID,
            toolCallID: baseInvocation.id,
          },
          ...(context.computerRecovery ? { computerRecovery: context.computerRecovery } : {}),
          ...(context.approvedComputerGrant
            ? { approvedComputerGrant: context.approvedComputerGrant }
            : {}),
          ...(context.onProgress ? { onProgress: context.onProgress } : {}),
        })
      : undefined
    const inspection = rawInspection
      ? this.validateToolInputInspection(
          rawInspection,
          definition.capabilities.filesystem === 'none',
        )
      : undefined
    for (const configWrite of inspection?.configWrites ?? []) {
      this.options?.validateConfigDocument?.(configWrite.content, configWrite.scope)
    }
    const authorizationScope = inspection?.authorizationScope ?? {
      affectedPaths: [],
      fingerprint: createHash('sha256')
        .update(JSON.stringify({ name, input, canonicalPaths }))
        .digest('hex'),
      ruleRequiresApproval: false,
    }
    const pathValue = typeof input.file_path === 'string' ? input.file_path : input.path
    const fileTool = name === 'Read' || name === 'Write' || name === 'Edit'
    const targetPath = pathValue === '@pidex/config.json' ? this.options?.userConfigPath : pathValue
    const canonicalTarget =
      fileTool && typeof targetPath === 'string' && !targetPath.startsWith('@')
        ? await resolveProtectionPath(resolve(workspace.rootPath, targetPath))
        : undefined
    const protection = canonicalTarget
      ? filePathProtection(canonicalTarget, workspace.displayPath(canonicalTarget))
      : undefined
    const sensitiveEnvironment = protection?.sensitiveEnvironment ?? false
    const protectedGitWrite = (name === 'Write' || name === 'Edit') && protection?.protectedGit
    const configScope = protection?.configScope
    const protectedConfigWrite = (name === 'Write' || name === 'Edit') && configScope
    if (protectedConfigWrite && this.options?.validateConfigDocument) {
      let nextContent = typeof input.content === 'string' ? input.content : undefined
      if (name === 'Edit') {
        const current = await workspace.readEditorFile(String(pathValue))
        nextContent = applyEditsText(current.content, input.edits as EditOperation[])
      }
      if (nextContent !== undefined) {
        this.options.validateConfigDocument(nextContent, configScope)
      }
    }
    const invocation: ToolInvocation = {
      ...baseInvocation,
      toolPolicy: {
        sdkName: definition.sdkName,
        capabilities: definition.capabilities,
        allowedModes: definition.allowedModes,
        approvalStrategy: definition.approvalStrategy,
        ...(definition.origin ? { origin: definition.origin } : {}),
      },
      ...(inspection?.grantsForbidden ? { grantsForbidden: true } : {}),
      permissionFacts: {
        ...(fileTool || name === 'apply_patch'
          ? {
              risk:
                sensitiveEnvironment ||
                protectedGitWrite ||
                protectedConfigWrite ||
                authorizationScope.ruleRequiresApproval
                  ? ('high' as const)
                  : ('low' as const),
            }
          : {}),
        externalWrite: writesFiles && externalPaths.length > 0,
        ...inspection?.permissionFacts,
        workspaceRoot: context.workspace.rootPath,
        ruleRequiresApproval: Boolean(
          inspection?.permissionFacts?.ruleRequiresApproval ||
          sensitiveEnvironment ||
          protectedGitWrite ||
          protectedConfigWrite ||
          authorizationScope?.ruleRequiresApproval,
        ),
        ...(() => {
          const networkDomains = [
            ...requestedPermissions(input).networkDomains.map((domain) =>
              domain.trim().toLowerCase(),
            ),
            ...(authorizationScope?.browserOrigin
              ? [new URL(authorizationScope.browserOrigin).hostname.toLowerCase()]
              : []),
          ].filter(Boolean)
          const observedPaths = canonicalTarget && fileTool ? [canonicalTarget] : canonicalPaths
          if (!observedPaths.length && networkDomains.length === 0) return {}
          return {
            ruleTargets: {
              ...(observedPaths.length
                ? writesFiles
                  ? { writePaths: observedPaths }
                  : { readPaths: observedPaths }
                : {}),
              networkDomains,
            },
          }
        })(),
      },
      ...(authorizationScope ? { authorizationScope } : {}),
      ...(context.authorizationOnly ? { durableApproval: true } : {}),
    }
    setFilePhase?.('authorization')
    let resolved = this.decisions.evaluate(invocation, definition)
    const resumedApproval = context.approvedToolCallID === invocation.id
    if (
      resumedApproval &&
      (inspection?.authorizationScope || context.approvedAuthorizationFingerprint) &&
      invocation.authorizationScope?.fingerprint !== context.approvedAuthorizationFingerprint
    ) {
      throw new AgentError(
        'APPROVAL_SCOPE_CHANGED',
        '工具输入或受影响文件范围已变化，需要重新审批',
        409,
      )
    }
    if (isReadOnlyTaskMode(context.taskMode) && this.options?.hooks) {
      this.options.logger?.info('hook.skipped', {
        context: {
          threadId: context.threadID,
          turnId: context.turnID,
          ...(context.agentID ? { agentId: context.agentID } : {}),
          toolCallId: invocation.id,
        },
        details: {
          tool: name,
          reason: 'plan_mode_host_process_disabled',
        },
      })
    }
    const hookResults =
      skipProjectHooks || resumedApproval
        ? []
        : ((await this.options?.hooks?.run(
            'pre_tool_use',
            {
              input,
              resolved,
              ...(authorizationScope ? { authorizationScope } : {}),
            },
            {
              threadID: context.threadID,
              turnID: context.turnID,
              toolCallID: invocation.id,
              toolName: name,
              workspaceRoot: context.workspace.rootPath,
            },
          )) ?? [])
    const denied = hookResults.find(({ result }) => result.decision === 'deny')
    if (
      denied &&
      !(isFullAccessPermissionConfig(permissionConfig) && !isReadOnlyTaskMode(context.taskMode))
    )
      throw new AgentError('HOOK_DENIED', denied.result.reason ?? 'PreToolUse Hook 拒绝执行', 403)
    const narrowed = hookResults
      .map(({ result }) => result.narrowedInput)
      .filter((value): value is Record<string, unknown> => Boolean(value))
      .at(-1)
    if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
      if ((context.hookDepth ?? 0) >= 2)
        throw new AgentError('HOOK_REWRITE_LIMIT', 'Hook 重写工具输入次数过多', 409)
      return this.execute<T>(
        name,
        { ...input, ...narrowed },
        { ...context, hookDepth: (context.hookDepth ?? 0) + 1 },
      )
    }
    const hookAsked = hookResults.some(({ result }) => result.decision === 'ask')
    if (hookAsked)
      invocation.permissionFacts = {
        ...invocation.permissionFacts,
        hookRequiresApproval: true,
        approvalReason:
          hookResults.find(({ result }) => result.decision === 'ask')?.result.reason ??
          'PreToolUse Hook 要求审批',
      }
    resolved = this.decisions.evaluate(invocation, definition)
    await this.loadPermissionRules(invocation, context.signal)
    if (
      fileGrant &&
      !hookAsked &&
      !invocation.permissionFacts?.ruleRequiresApproval &&
      invocation.permissionFacts?.ruleEffect !== 'deny' &&
      invocation.permissionFacts?.ruleEffect !== 'ask'
    )
      invocation.permissionFacts = { ...invocation.permissionFacts, ruleEffect: 'allow' }
    resolved = this.decisions.evaluate(invocation, definition)
    if (resolved.action === 'deny')
      throw new AgentError('TOOL_PERMISSION_DENIED', resolved.reason, 403, resolved)
    const grant =
      !resumedApproval && !hookAsked && resolved.action === 'review' && !resolved.forceHumanApproval
        ? (fileGrant ?? this.permissionGrantFor(invocation, definition, !context.authorizationOnly))
        : null
    let authorization: PermissionDecision = {
      decision: 'allow',
      risk: resolved.risk,
      reason: grant ? `已使用 ${grant.scope} 临时权限` : '统一权限策略允许',
    }
    if ((resolved.action === 'review' || hookAsked) && !resumedApproval && !grant) {
      if (!this.options)
        throw new AgentError('TOOL_REVIEW_REQUIRED', '工具需要审批但执行器未配置审批服务', 403)
      if (inspection?.fileDiffs) invocation.fileDiffs = inspection.fileDiffs
      else if (
        (name === 'Write' || name === 'Edit') &&
        !sensitiveEnvironment &&
        !protectedConfigWrite &&
        !protectedGitWrite &&
        typeof pathValue === 'string'
      ) {
        try {
          const current = await workspace.readEditorFile(pathValue).catch((cause: unknown) => {
            if (
              cause instanceof AgentError &&
              cause.code === 'WORKSPACE_PATH_NOT_FOUND' &&
              name === 'Write'
            )
              return null
            throw cause
          })
          const afterContent =
            name === 'Edit'
              ? applyEditsText(current!.content, input.edits as EditOperation[])
              : String(input.content)
          invocation.fileDiffs = [
            buildFileDiff({
              path: current?.path ?? workspace.displayPath(resolve(workspace.rootPath, pathValue)),
              operation: current ? 'update' : 'create',
              beforeContent: current?.content ?? null,
              afterContent,
            }),
          ]
        } catch {
          // Existing execution validation remains authoritative when no text preview is available.
        }
      }
      if (context.approvedToolCallID !== invocation.id && !context.authorizationOnly)
        this.options?.observeToolStart?.(invocation)
      authorization = await this.options.authorizeShell(invocation, context.signal)
    }
    if (context.authorizationOnly) {
      return {
        ...authorization,
        ...(authorizationScope ? { authorizationFingerprint: authorizationScope.fingerprint } : {}),
      } as T
    }
    if (authorization.decision !== 'allow')
      throw new AgentError('TOOL_PERMISSION_DENIED', authorization.reason, 403, authorization)
    setFilePhase?.('execute')
    const startedAt = Date.now()
    const auditInvocation = secretScrubber.scrub(invocation)
    this.options?.recordToolCall?.(auditInvocation, 'running', null, null, startedAt)
    try {
      const filePath =
        typeof input.file_path === 'string'
          ? input.file_path
          : name === 'Edit' && typeof input.path === 'string'
            ? input.path
            : null
      const snapshotKey = await this.snapshotKey(context, workspace, filePath)
      const deferredTools = this.deferredDefinitions(
        {
          taskMode: context.taskMode,
          sandboxMode: permissionConfig.sandboxMode,
          approvalPolicy: permissionConfig.approvalPolicy,
          profile: context.profile ?? 'main',
          ...(context.allowedTools ? { allowedTools: context.allowedTools } : {}),
          ...(context.frozenDeferredToolNames
            ? { frozenDeferredToolNames: context.frozenDeferredToolNames }
            : {}),
        },
        catalog,
      )
      for (const configWrite of inspection?.configWrites ?? []) {
        this.options?.validateConfigDocument?.(configWrite.content, configWrite.scope)
      }
      if (
        fileGrant &&
        !this.permissionGrants.authorize({ ...fileGrantLookup, consumeToolCall: true })
      )
        throw new AgentError('TOOL_PERMISSION_DENIED', '临时路径授权已失效，请重新申请权限', 403)
      let output = await catalog.execute(name, input, {
        ...(context.subagentLifecycle ? { subagentLifecycle: context.subagentLifecycle } : {}),
        signal: context.signal,
        taskMode: context.taskMode,
        profile: context.profile ?? 'main',
        workspace,
        permissionConfig,
        ...(resumedApproval && invocation.name === 'ComputerRead' && context.approvedComputerGrant
          ? { computerGrant: context.approvedComputerGrant }
          : {}),
        ...(context.computerRecovery ? { computerRecovery: context.computerRecovery } : {}),
        ...(context.approvedComputerGrant
          ? { approvedComputerGrant: context.approvedComputerGrant }
          : {}),
        ...(context.requestPause ? { requestPause: context.requestPause } : {}),
        model,
        deferredTools,
        fileSnapshots,
        ...(authorizationScope ? { authorizationScope } : {}),
        resolveTooling: this.options?.resolveTooling ?? resolveManagedTool,
        runToolProcess: this.options?.runToolProcess ?? runToolProcess,
        invocation: {
          threadID: context.threadID,
          turnID: context.turnID,
          agentID: context.agentID ?? context.turnID,
          toolCallID: invocation.id,
        },
        ...(this.options?.recordMutation
          ? {
              recordMutation: async (files) => {
                const batch = {
                  threadID: context.threadID,
                  turnID: context.turnID,
                  agentID: context.agentID ?? context.turnID,
                  toolCallID: invocation.id,
                  files,
                }
                if (JSON.stringify(secretScrubber.scrub(files)) !== JSON.stringify(files)) {
                  await this.options?.discardMutationEvidence?.({
                    threadID: context.threadID,
                    turnID: context.turnID,
                  })
                  this.options?.logger?.warn('turn_patch.evidence.rejected', {
                    context: {
                      threadId: context.threadID,
                      turnId: context.turnID,
                      agentId: context.agentID ?? context.turnID,
                      toolCallId: invocation.id,
                    },
                    details: { reason: 'sensitive_content' },
                  })
                  return
                }
                try {
                  await this.options!.recordMutation!(batch)
                } catch {
                  await this.options?.discardMutationEvidence?.({
                    threadID: context.threadID,
                    turnID: context.turnID,
                  })
                  this.options?.logger?.warn('turn_patch.evidence.failed', {
                    context: {
                      threadId: context.threadID,
                      turnId: context.turnID,
                      agentId: context.agentID ?? context.turnID,
                      toolCallId: invocation.id,
                    },
                    details: { reason: 'persistence_failed' },
                  })
                }
              },
            }
          : {}),
        ...(snapshotKey && this.readSnapshots.has(snapshotKey)
          ? { readSnapshot: this.readSnapshots.get(snapshotKey)! }
          : {}),
        ...(this.options?.fileSaved
          ? {
              fileSaved: (saved) =>
                this.options!.fileSaved!({ workspaceRoot: context.workspace.rootPath, ...saved }),
            }
          : {}),
        ...(context.onProgress ? { onProgress: context.onProgress } : {}),
      })
      if (name === 'request_permissions' && !isFullAccessPermissionConfig(permissionConfig)) {
        const grantResult = await this.applyPermissionGrant(
          {
            scope: input.scope,
            requestedPermissions: input,
            grantedPermissions: input,
          },
          context,
        )
        output = {
          ...(output && typeof output === 'object' ? output : {}),
          grant: grantResult,
        }
      }
      if (filePath && ['Read', 'Write', 'Edit'].includes(name)) {
        const savedSnapshotKey = await this.snapshotKey(context, workspace, filePath)
        const revision =
          (
            output as {
              snapshot?: { mtimeMs: number; sha256: string }
              revision?: { mtimeMs: number; sha256: string }
            }
          ).snapshot ??
          (output as { revision?: { mtimeMs: number; sha256: string } }).revision ??
          (await workspace.readEditorFile(filePath)).revision
        if (savedSnapshotKey) this.readSnapshots.set(savedSnapshotKey, revision)
      }
      output = await this.recordSkillRead(name, input, output, context)
      const safeOutput = secretScrubber.scrub(definition.auditResult?.(output) ?? output)
      this.options?.recordToolCall?.(auditInvocation, 'completed', safeOutput, null, startedAt)
      if (!skipProjectHooks) {
        await this.options?.hooks
          ?.run(
            'post_tool_use',
            { input, output: safeOutput },
            {
              threadID: context.threadID,
              turnID: context.turnID,
              toolCallID: invocation.id,
              toolName: name,
              workspaceRoot: context.workspace.rootPath,
            },
          )
          .catch((cause) => {
            if (isFileMutationTool(name))
              this.logFileToolFailure(name, input, context, 'post-hook', cause, startedAt)
          })
      }
      return output as T
    } catch (cause) {
      const error = secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause))
      this.options?.recordToolCall?.(
        auditInvocation,
        context.signal.aborted ? 'interrupted' : 'error',
        null,
        error,
        startedAt,
      )
      if (!skipProjectHooks) {
        await this.options?.hooks
          ?.run(
            'post_tool_error',
            { input, error },
            {
              threadID: context.threadID,
              turnID: context.turnID,
              toolCallID: invocation.id,
              toolName: name,
              workspaceRoot: context.workspace.rootPath,
            },
          )
          .catch((hookCause) => {
            if (isFileMutationTool(name))
              this.logFileToolFailure(name, input, context, 'post-hook', hookCause, startedAt)
          })
      }
      throw cause
    }
  }

  private logFileToolFailure(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    phase: FileToolFailurePhase,
    cause: unknown,
    startedAt: number,
  ) {
    const workspaceRoot = context.workspace.rootPath
    const safePath = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return undefined
      if (isAbsolute(value)) {
        const absolute = resolve(value)
        if (!pathContains(workspaceRoot, absolute)) return '[outside-workspace]'
        const workspaceRelative = relative(workspaceRoot, absolute).replaceAll('\\', '/')
        return workspaceRelative || '.'
      }
      const normalized = normalize(value).replaceAll('\\', '/')
      return normalized === '..' || normalized.startsWith('../')
        ? '[outside-workspace]'
        : normalized.slice(0, 500)
    }
    let inputBytes = 0
    try {
      inputBytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
    } catch {
      // Parsed tool input should be JSON-compatible; retain a safe zero if it is not.
    }
    const details: Record<string, unknown> = {
      tool: name,
      phase,
      code:
        cause instanceof AgentError
          ? cause.code
          : context.signal.aborted
            ? 'RUN_ABORTED'
            : 'FILE_TOOL_FAILED',
      inputBytes,
      durationMs: Math.max(0, Date.now() - startedAt),
    }
    if (name === 'Write' || name === 'Edit') {
      const path = safePath(input.file_path ?? input.path)
      details.fileCount = path ? 1 : 0
      if (path) details.path = path
    } else if (name === 'apply_patch') {
      const patch = typeof input.patch === 'string' ? input.patch : ''
      details.patchBytes = Buffer.byteLength(patch, 'utf8')
      try {
        const operations = parseApplyPatch(patch)
        details.fileCount = operations.length
        details.affectedPaths = operations.map(
          (operation) => safePath(operation.path) ?? '[outside-workspace]',
        )
        details.hunkCount = operations.reduce(
          (sum, operation) => sum + (operation.type === 'update' ? operation.chunks.length : 0),
          0,
        )
        details.additions = operations.reduce((sum, operation) => {
          if (operation.type === 'add') {
            if (!operation.content) return sum
            return (
              sum +
              (operation.content.endsWith('\n')
                ? operation.content.slice(0, -1).split('\n').length
                : operation.content.split('\n').length)
            )
          }
          return sum + operation.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.additions, 0)
        }, 0)
        details.deletions = operations.reduce(
          (sum, operation) =>
            sum +
            (operation.type === 'update'
              ? operation.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.deletions, 0)
              : 0),
          0,
        )
      } catch {
        details.fileCount = 0
      }
    }
    this.options?.logger?.warn('file-tool.execution.failed', {
      context: {
        threadId: context.threadID,
        turnId: context.turnID,
        ...(context.agentID ? { agentId: context.agentID } : {}),
        ...(context.toolCallID ? { toolCallId: context.toolCallID } : {}),
      },
      details,
    })
  }

  private async executeShell(
    shellTool: 'Bash' | 'PowerShell',
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    catalog: ToolCatalog,
  ): Promise<ProcessResult | PermissionDecision> {
    const options = this.options
    if (!options) throw new AgentError('SHELL_EXECUTOR_REQUIRED', 'Shell 执行器未配置', 500)
    const logContext = {
      threadId: context.threadID,
      turnId: context.turnID,
      ...(context.agentID ? { agentId: context.agentID } : {}),
      ...(context.toolCallID ? { toolCallId: context.toolCallID } : {}),
    }
    if (isReadOnlyTaskMode(context.taskMode)) {
      options.logger?.warn('shell.execution.failed', {
        context: logContext,
        details: {
          shellTool,
          backend: 'host-hook',
          phase: 'task-mode',
          code: 'PLAN_SHELL_DISABLED',
          durationMs: 0,
        },
      })
      throw new AgentError('PLAN_SHELL_DISABLED', 'Plan 与 Grill 模式禁止执行 Bash 或 PowerShell', 403)
    }
    const permissionConfig = context.permissionConfig ?? DEFAULT_PERMISSION_CONFIG
    const executionPolicy = executionPolicyFromV4(permissionConfig)
    const model =
      context.model ??
      Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') })
    const parsedShell = this.parseShellInput(input)
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const additionalPermissions = parsedShell.additionalPermissions
      ? {
          ...(parsedShell.additionalPermissions.readPaths
            ? {
                readPaths: await Promise.all(
                  parsedShell.additionalPermissions.readPaths.map((path) =>
                    this.canonicalPath(workspaceRoot, path, false),
                  ),
                ),
              }
            : {}),
          ...(parsedShell.additionalPermissions.writePaths
            ? {
                writePaths: await Promise.all(
                  parsedShell.additionalPermissions.writePaths.map((path) =>
                    this.canonicalPath(workspaceRoot, path, true),
                  ),
                ),
              }
            : {}),
          ...(parsedShell.additionalPermissions.networkDomains
            ? {
                networkDomains: [
                  ...new Set(
                    parsedShell.additionalPermissions.networkDomains.map((domain) =>
                      domain.trim().toLowerCase(),
                    ),
                  ),
                ],
              }
            : {}),
        }
      : undefined
    const shell: ShellInput = {
      ...parsedShell,
      ...(additionalPermissions ? { additionalPermissions } : {}),
    }
    const requestedCwd = shell.cwd
      ? isAbsolute(shell.cwd)
        ? resolve(shell.cwd)
        : resolve(context.defaultCwd ?? workspaceRoot, shell.cwd)
      : resolve(context.defaultCwd ?? workspaceRoot)
    const cwd = await realpath(requestedCwd).catch(() => {
      throw new AgentError('SHELL_CWD_NOT_FOUND', 'Shell cwd 不存在或无法解析', 400)
    })

    const invocation: ToolInvocation = {
      id: context.toolCallID ?? crypto.randomUUID(),
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      name: shellTool,
      input: {
        ...(shell as unknown as Record<string, unknown>),
        __shellTool: shellTool,
        cwd,
        ...(context.taskSummary ? { taskSummary: context.taskSummary.slice(0, 4_000) } : {}),
      },
      permissionConfig,
      model,
      taskMode: context.taskMode,
      toolPolicy: {
        sdkName: catalog.get(shellTool).sdkName,
        capabilities: catalog.get(shellTool).capabilities,
        allowedModes: catalog.get(shellTool).allowedModes,
        approvalStrategy: catalog.get(shellTool).approvalStrategy,
        ...(catalog.get(shellTool).origin ? { origin: catalog.get(shellTool).origin } : {}),
      },
      ...(context.authorizationOnly ? { durableApproval: true } : {}),
    }
    const preflightStartedAt = Date.now()
    const toolStartedAt = Date.now()
    let phase = 'risk'
    let hookDecision: 'continue' | 'ask' | 'deny' | 'skipped' = 'skipped'
    let risk: PermissionDecision['risk'] | undefined
    try {
      const staticRisk = analyzeShellRisk({
        command: shell.command,
        cwd,
        workspaceRoot,
        securityLevel: options.resolveShellSecurityLevel?.() ?? 'balanced',
        ...(shell.additionalPermissions
          ? { additionalPermissions: shell.additionalPermissions }
          : {}),
        ...(shell.justification ? { justification: shell.justification } : {}),
        ...(context.taskSummary ? { taskSummary: context.taskSummary } : {}),
      })
      risk = staticRisk.risk
      if (!staticRisk.requestedScopeValid)
        throw new AgentError('INVALID_TOOL_INPUT', '申请的额外权限范围无效', 400)

      invocation.permissionFacts = {
        workspaceRoot: context.workspace.rootPath,
        riskCategories: staticRisk.categories,
        ruleRequiresApproval:
          staticRisk.hardDenied ||
          (staticRisk.requiresApproval &&
            !staticRisk.categories.every((category) => category === 'scope_escape')),
        networkAccess: staticRisk.categories.includes('network_access'),
        externalCommand:
          !context.workspace.containsPath(cwd) || staticRisk.categories.includes('scope_escape'),
        destructive:
          staticRisk.destructive &&
          !staticRisk.categories.every((category) => category === 'scope_escape'),
        risk:
          staticRisk.categories.length > 0 &&
          staticRisk.categories.every((category) => category === 'scope_escape')
            ? 'low'
            : staticRisk.risk,
        approvalReason: staticRisk.reason,
        ruleTargets: {
          command: shell.command,
          argv: simpleCommandArgv(shell.command),
          networkDomains: [
            ...new Set([
              ...(shell.additionalPermissions?.networkDomains ?? [])
                .map((domain) => domain.trim().toLowerCase())
                .filter(Boolean),
              ...(staticRisk.categories.includes('network_access')
                ? Array.from(shell.command.matchAll(/https?:\/\/[^\s"'`<>|;&)]+/gi)).flatMap(
                    ([url]) => {
                      try {
                        return [new URL(url).hostname.toLowerCase()]
                      } catch {
                        return []
                      }
                    },
                  )
                : []),
            ]),
          ],
          ...(additionalPermissions?.readPaths
            ? { readPaths: additionalPermissions.readPaths }
            : {}),
          ...(additionalPermissions?.writePaths
            ? { writePaths: additionalPermissions.writePaths }
            : {}),
        },
      }
      invocation.authorizationScope = {
        affectedPaths: [],
        fingerprint: createHash('sha256')
          .update(JSON.stringify({ name: shellTool, input: invocation.input }))
          .digest('hex'),
        ruleRequiresApproval: staticRisk.requiresApproval,
      }
      const resumedApproval = context.approvedToolCallID === invocation.id
      if (
        resumedApproval &&
        context.approvedAuthorizationFingerprint &&
        context.approvedAuthorizationFingerprint !== invocation.authorizationScope.fingerprint
      )
        throw new AgentError(
          'APPROVAL_SCOPE_CHANGED',
          'Shell 输入或作用范围已变化，需要重新审批',
          409,
        )
      phase = 'hook'
      const hookResults =
        context.skipHooks || resumedApproval
          ? []
          : ((await this.options.hooks?.run(
              'pre_tool_use',
              { input: invocation.input, staticRisk },
              {
                threadID: context.threadID,
                turnID: context.turnID,
                toolCallID: invocation.id,
                toolName: shellTool,
                workspaceRoot: context.workspace.rootPath,
              },
            )) ?? [])
      const denied = hookResults.find(({ result }) => result.decision === 'deny')
      hookDecision = denied
        ? 'deny'
        : hookResults.some(({ result }) => result.decision === 'ask')
          ? 'ask'
          : hookResults.length > 0
            ? 'continue'
            : 'skipped'
      if (denied && !isFullAccessPermissionConfig(permissionConfig))
        throw new AgentError('HOOK_DENIED', denied.result.reason ?? 'PreToolUse Hook 拒绝执行', 403)
      const narrowed = hookResults
        .map(({ result }) => result.narrowedInput)
        .filter((value): value is Record<string, unknown> => Boolean(value))
        .at(-1)
      if (narrowed && JSON.stringify(narrowed) !== JSON.stringify(input)) {
        if ((context.hookDepth ?? 0) >= 2)
          throw new AgentError('HOOK_REWRITE_LIMIT', 'Hook 重写 Shell 输入次数过多', 409)
        const rewritten = { ...input, ...narrowed }
        const { timeoutMs, justification, ...argumentsInput } = rewritten
        return this.execute(
          shellTool,
          {
            ...argumentsInput,
            ...(rewritten.timeoutMs !== undefined ? { timeout: rewritten.timeoutMs } : {}),
            ...(rewritten.justification !== undefined
              ? { description: rewritten.justification }
              : {}),
          },
          { ...context, hookDepth: (context.hookDepth ?? 0) + 1 },
        )
      }
      if (hookResults.some(({ result }) => result.decision === 'ask'))
        invocation.permissionFacts = {
          ...invocation.permissionFacts,
          hookRequiresApproval: true,
          approvalReason:
            hookResults.find(({ result }) => result.decision === 'ask')?.result.reason ??
            'PreToolUse Hook 要求审批',
        }
      await this.loadPermissionRules(invocation, context.signal)
      if (!resumedApproval && !context.authorizationOnly)
        this.options?.observeToolStart?.(invocation)
      const temporary =
        !invocation.permissionFacts?.hookRequiresApproval &&
        !invocation.permissionFacts?.ruleRequiresApproval &&
        !invocation.permissionFacts?.destructive &&
        !staticRisk.categories.some(
          (category) => category !== 'network_access' && category !== 'scope_escape',
        )
          ? this.permissionGrantFor(invocation, catalog.get(shellTool), false)
          : null
      if (
        temporary &&
        invocation.permissionFacts?.ruleEffect !== 'deny' &&
        invocation.permissionFacts?.ruleEffect !== 'ask'
      )
        invocation.permissionFacts = { ...invocation.permissionFacts, ruleEffect: 'allow' }
      const finalDecision = this.decisions.evaluate(invocation, catalog.get(shellTool))
      phase = 'authorization'
      if (finalDecision.action === 'deny') {
        this.options?.onPermissionDenied?.(invocation)
        throw new AgentError('TOOL_PERMISSION_DENIED', finalDecision.reason, 403, finalDecision)
      }
      const hookAsked = invocation.permissionFacts?.hookRequiresApproval === true
      const grant =
        resumedApproval ||
        hookAsked ||
        (finalDecision.action !== 'review' && !temporary) ||
        (finalDecision.action === 'review' && finalDecision.forceHumanApproval)
          ? null
          : this.permissionGrantFor(invocation, catalog.get(shellTool), !context.authorizationOnly)
      const decision = resumedApproval
        ? ({
            decision: 'allow',
            risk: staticRisk.risk,
            reason: '已恢复并校验一次性审批',
          } satisfies PermissionDecision)
        : grant
          ? ({
              decision: 'allow',
              risk: staticRisk.risk,
              reason: `已使用 ${grant.scope} 临时权限`,
            } satisfies PermissionDecision)
          : await this.options.authorizeShell(invocation, context.signal)
      options.logger?.info('shell.preflight.completed', {
        context: logContext,
        details: {
          shellTool,
          taskMode: context.taskMode,
          fileAccess: executionPolicy.fileAccess,
          risk: staticRisk.risk,
          hookDecision,
          permissionDecision: decision.decision,
          cwdScope: context.workspace.containsPath(cwd) ? 'workspace' : 'outside-workspace',
          commandBytes: Buffer.byteLength(shell.command, 'utf8'),
          durationMs: Date.now() - preflightStartedAt,
        },
      })
      if (context.authorizationOnly)
        return { ...decision, authorizationFingerprint: invocation.authorizationScope.fingerprint }
      if (decision.decision !== 'allow')
        throw new AgentError('SHELL_PERMISSION_DENIED', decision.reason, 403, decision)
      phase = 'runtime'
      const runtime = await this.commandForShell(shellTool, parsedShell.command, context.signal)
      const auditInvocation = secretScrubber.scrub(invocation)
      this.options.recordToolCall?.(auditInvocation, 'running', null, null, toolStartedAt)
      options.logger?.info('shell.execution.started', {
        context: logContext,
        details: {
          shellTool,
          backend: 'host-hook',
          timeoutMs: shell.timeoutMs ?? 120_000,
          managedRuntimeCount: runtime.managedRuntimeCount,
        },
      })
      phase = 'execution'
      const executionStartedAt = Date.now()
      const result = await (this.options.runHost ?? runHostCommand)(
        runtime.command,
        cwd,
        shell.timeoutMs,
        context.signal,
        runtime.env,
      )
      const safeResult = secretScrubber.scrub(result)
      this.options.recordToolCall?.(auditInvocation, 'completed', safeResult, null, toolStartedAt)
      options.logger?.info('shell.execution.completed', {
        context: logContext,
        details: {
          shellTool,
          backend: 'host-hook',
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
          stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
          outputTruncated: result.truncated,
          durationMs: Date.now() - executionStartedAt,
        },
      })
      if (!context.skipHooks)
        await this.options.hooks
          ?.run(
            'post_tool_use',
            { input: invocation.input, output: safeResult },
            {
              threadID: context.threadID,
              turnID: context.turnID,
              toolCallID: invocation.id,
              toolName: shellTool,
              workspaceRoot: context.workspace.rootPath,
            },
          )
          .catch(() => undefined)
      return result
    } catch (cause) {
      options.logger?.warn('shell.execution.failed', {
        context: logContext,
        details: {
          shellTool,
          backend: 'host-hook',
          phase,
          code:
            cause instanceof AgentError
              ? cause.code
              : context.signal.aborted
                ? 'RUN_ABORTED'
                : 'SHELL_EXECUTION_FAILED',
          risk,
          hookDecision,
          timedOut: cause instanceof AgentError && cause.code === 'INVALID_TIMEOUT',
          durationMs: Date.now() - toolStartedAt,
        },
      })
      if (!context.authorizationOnly) {
        this.options.recordToolCall?.(
          secretScrubber.scrub(invocation),
          context.signal.aborted ? 'interrupted' : 'error',
          null,
          secretScrubber.scrubText(cause instanceof Error ? cause.message : String(cause)),
          toolStartedAt,
        )
      }
      if (!context.skipHooks && !context.authorizationOnly)
        await this.options.hooks
          ?.run(
            'post_tool_error',
            {
              input: invocation.input,
              error: secretScrubber.scrubText(
                cause instanceof Error ? cause.message : String(cause),
              ),
            },
            {
              threadID: context.threadID,
              turnID: context.turnID,
              toolCallID: invocation.id,
              toolName: shellTool,
              workspaceRoot: context.workspace.rootPath,
            },
          )
          .catch(() => undefined)
      throw cause
    }
  }

  async applyPermissionGrant(
    input: {
      scope: unknown
      requestedPermissions: Record<string, unknown>
      grantedPermissions: Record<string, unknown>
    },
    context: ToolExecutionContext,
  ) {
    if (isReadOnlyTaskMode(context.taskMode))
      throw new AgentError('TOOL_NOT_ALLOWED_IN_MODE', 'Plan 与 Grill 模式禁止请求或提升权限', 403)
    if (!['tool-call', 'turn', 'session'].includes(String(input.scope))) {
      throw new AgentError('INVALID_TOOL_INPUT', '权限 scope 无效', 400)
    }
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const requested = await this.normalizeAdditionalPermissions(
      input.requestedPermissions,
      workspaceRoot,
    )
    const granted = await this.normalizeAdditionalPermissions(
      input.grantedPermissions,
      workspaceRoot,
    )
    const grant = this.permissionGrants.grant({
      threadID: context.threadID,
      turnID: context.turnID,
      agentID: context.agentID ?? context.turnID,
      scope: input.scope as PermissionGrantScope,
      requested,
      granted,
      workspaceRoot: context.workspace.rootPath,
    })
    return grant
      ? { granted: true, grantId: grant.id, scope: grant.scope, permissions: grant.permissions }
      : {
          granted: false,
          scope: input.scope,
          permissions: { readPaths: [], writePaths: [], networkDomains: [] },
        }
  }

  clearTurnPermissionGrants(threadID: string, turnID: string) {
    this.permissionGrants.clearTurn(threadID, turnID)
    this.options?.settleTurn?.(threadID, turnID)
  }

  /**
   * Loads Allow/Ask/Deny rule facts after Hook rewriting and immediately before
   * the final permission gate. The decision engine stays pure; only the host
   * reads configuration, chat rules and canonical targets.
   */
  private async loadPermissionRules(invocation: ToolInvocation, signal: AbortSignal) {
    if (!this.options?.resolvePermissionRules) return
    if (signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const facts = await this.options.resolvePermissionRules(invocation)
    invocation.permissionFacts = {
      ...invocation.permissionFacts,
      ruleFactsLoaded: true,
      ...(facts.effect ? { ruleEffect: facts.effect } : {}),
      ...(facts.ids.length ? { ruleIDs: facts.ids } : {}),
    }
  }

  clearThreadPermissionGrants(threadID: string) {
    this.permissionGrants.clearThread(threadID)
  }

  private async snapshotKey(
    context: ToolExecutionContext,
    workspace: WorkspaceService,
    path: string | null,
  ) {
    if (!path) return null
    let normalized: string
    try {
      normalized = await workspace.resolveEditorFilePath(path)
    } catch (cause) {
      if (cause instanceof AgentError && cause.code === 'WORKSPACE_PATH_NOT_FOUND') return null
      throw cause
    }
    normalized = normalized.replaceAll('\\', '/')
    return `${context.threadID}:${context.agentID ?? context.turnID}:${process.platform === 'win32' ? normalized.toLowerCase() : normalized}`
  }

  private fileSnapshots(
    context: ToolExecutionContext,
    workspace: WorkspaceService,
  ): ToolFileSnapshots {
    return {
      get: async (path) => {
        const key = await this.snapshotKey(context, workspace, path)
        return key ? this.readSnapshots.get(key) : undefined
      },
      set: async (path, revision) => {
        const key = await this.snapshotKey(context, workspace, path)
        if (key) this.readSnapshots.set(key, revision)
      },
      invalidate: async (paths) => {
        for (const path of paths) {
          const key = await this.snapshotKey(context, workspace, path)
          if (key) this.readSnapshots.delete(key)
        }
      },
    }
  }

  private validateToolInputInspection(
    value: ToolInputInspection,
    nonFileScope = false,
  ): ToolInputInspection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentError('INVALID_TOOL_INSPECTION', '工具输入检查结果无效', 500)
    }
    const scope = value.authorizationScope as ToolAuthorizationScope | undefined
    if (
      !scope ||
      typeof scope !== 'object' ||
      !Array.isArray(scope.affectedPaths) ||
      (!nonFileScope && scope.affectedPaths.length === 0) ||
      scope.affectedPaths.length > 256 ||
      !/^[a-f0-9]{64}$/.test(scope.fingerprint) ||
      typeof scope.ruleRequiresApproval !== 'boolean'
    ) {
      throw new AgentError('INVALID_TOOL_INSPECTION', '工具授权范围无效', 500)
    }
    const affectedPaths = scope.affectedPaths.map((affected) => {
      if (
        !affected ||
        typeof affected !== 'object' ||
        typeof affected.path !== 'string' ||
        !affected.path.trim() ||
        affected.path.length > 1_024 ||
        /[\0\r\n]/.test(affected.path) ||
        (affected.operation !== 'create' && affected.operation !== 'update')
      ) {
        throw new AgentError('INVALID_TOOL_INSPECTION', '工具授权路径无效', 500)
      }
      return { path: affected.path, operation: affected.operation }
    })
    const pathKeys = affectedPaths.map(({ path }) =>
      process.platform === 'win32' ? path.toLowerCase() : path,
    )
    if (new Set(pathKeys).size !== pathKeys.length) {
      throw new AgentError('INVALID_TOOL_INSPECTION', '工具授权路径重复', 500)
    }
    const computerApp = scope.computerApp
    if (
      computerApp &&
      (!nonFileScope ||
        typeof computerApp.name !== 'string' ||
        typeof computerApp.allowPersistentApproval !== 'boolean')
    )
      throw new AgentError('INVALID_TOOL_INSPECTION', '应用授权信息无效', 500)
    const reviewSummary = scope.reviewSummary
    if (reviewSummary) {
      const values = [
        reviewSummary.fileCount,
        reviewSummary.hunkCount,
        reviewSummary.additions,
        reviewSummary.deletions,
      ]
      if (
        values.some((item) => !Number.isSafeInteger(item) || item < 0) ||
        reviewSummary.fileCount !== affectedPaths.length
      ) {
        throw new AgentError('INVALID_TOOL_INSPECTION', '工具变更摘要无效', 500)
      }
    }
    if (value.configWrites !== undefined && !Array.isArray(value.configWrites)) {
      throw new AgentError('INVALID_TOOL_INSPECTION', '配置写入检查结果无效', 500)
    }
    const configWrites = value.configWrites?.map((write) => {
      const pathKey =
        typeof write?.path === 'string'
          ? process.platform === 'win32'
            ? write.path.toLowerCase()
            : write.path
          : ''
      if (
        !write ||
        typeof write.path !== 'string' ||
        !write.path.trim() ||
        write.path.length > 1_024 ||
        /[\0\r\n]/.test(write.path) ||
        typeof write.content !== 'string' ||
        (write.scope !== 'user' && write.scope !== 'project') ||
        !pathKeys.includes(pathKey)
      ) {
        throw new AgentError('INVALID_TOOL_INSPECTION', '配置写入检查结果无效', 500)
      }
      return { path: write.path, content: write.content, scope: write.scope }
    })
    const facts = value.permissionFacts
    if (
      facts &&
      ([
        'ruleRequiresApproval',
        'hookRequiresApproval',
        'skillScript',
        'networkAccess',
        'externalWrite',
        'externalCommand',
      ].some((key) => key in facts && typeof facts[key as keyof typeof facts] !== 'boolean') ||
        (facts.approvalCategories !== undefined &&
          (!Array.isArray(facts.approvalCategories) ||
            facts.approvalCategories.some(
              (category) =>
                ![
                  'sandboxApproval',
                  'rules',
                  'skillApproval',
                  'requestPermissions',
                  'mcpTools',
                  'mcpElicitations',
                ].includes(category),
            ))) ||
        (facts.risk !== undefined && !['low', 'medium', 'high', 'critical'].includes(facts.risk)) ||
        (facts.denyReason !== undefined && typeof facts.denyReason !== 'string') ||
        (facts.approvalReason !== undefined && typeof facts.approvalReason !== 'string'))
    )
      throw new AgentError('INVALID_TOOL_INSPECTION', '工具权限事实无效', 500)
    return {
      ...(facts ? { permissionFacts: { ...facts } } : {}),
      ...(value.grantsForbidden ? { grantsForbidden: true } : {}),
      ...(value.fileDiffs
        ? {
            fileDiffs: value.fileDiffs.filter((diff) =>
              affectedPaths.some((path) => path.path === diff.path),
            ),
          }
        : {}),
      authorizationScope: {
        ...(nonFileScope && scope.browserOrigin ? { browserOrigin: scope.browserOrigin } : {}),
        affectedPaths,
        ...(computerApp ? { computerApp: { ...computerApp } } : {}),
        fingerprint: scope.fingerprint,
        ruleRequiresApproval: scope.ruleRequiresApproval,
        ...(reviewSummary ? { reviewSummary: { ...reviewSummary } } : {}),
      },
      ...(configWrites ? { configWrites } : {}),
    }
  }

  private parseShellInput(input: Record<string, unknown>): ShellInput {
    if (typeof input.command !== 'string' || !input.command.trim())
      throw new AgentError('INVALID_TOOL_INPUT', 'command 必须是非空字符串', 400)
    if (input.command.length > 32_000)
      throw new AgentError('COMMAND_TOO_LONG', 'Shell 命令超过 32000 字符，拒绝审核和执行', 413)
    const additional = input.additionalPermissions
    if (
      additional !== undefined &&
      (!additional || typeof additional !== 'object' || Array.isArray(additional))
    )
      throw new AgentError('INVALID_TOOL_INPUT', 'additionalPermissions 参数无效', 400)
    const value = additional as Record<string, unknown> | undefined
    const list = (name: string) => {
      const candidate = value?.[name]
      if (candidate === undefined) return undefined
      if (
        !Array.isArray(candidate) ||
        candidate.some((item) => typeof item !== 'string' || !item.trim())
      )
        throw new AgentError('INVALID_TOOL_INPUT', `${name} 必须是字符串数组`, 400)
      return candidate
    }
    const timeoutMs = input.timeoutMs === undefined ? undefined : Number(input.timeoutMs)
    if (
      timeoutMs !== undefined &&
      (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600_000)
    )
      throw new AgentError('INVALID_TIMEOUT', 'Shell 超时时间必须在 1 到 600000 毫秒之间', 400)
    return {
      command: input.command,
      ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(value
        ? {
            additionalPermissions: {
              ...(list('readPaths') ? { readPaths: list('readPaths') } : {}),
              ...(list('writePaths') ? { writePaths: list('writePaths') } : {}),
              ...(list('networkDomains') ? { networkDomains: list('networkDomains') } : {}),
            },
          }
        : {}),
      ...(typeof input.justification === 'string' ? { justification: input.justification } : {}),
    }
  }

  private permissionGrantFor(
    invocation: ToolInvocation,
    tool: ReturnType<ToolCatalog['get']>,
    consumeToolCall: boolean,
  ) {
    if (!hasRequestedPermissions(invocation.input)) return null
    const facts = invocation.permissionFacts
    if (
      invocation.grantsForbidden ||
      facts?.hookRequiresApproval ||
      facts?.ruleRequiresApproval ||
      facts?.destructive ||
      facts?.forcedApproval ||
      facts?.ruleEffect === 'deny' ||
      facts?.ruleEffect === 'ask' ||
      facts?.risk === 'high' ||
      facts?.risk === 'critical' ||
      (!facts?.risk && (tool.capabilities.externalState || tool.origin?.kind === 'mcp'))
    )
      return null
    return this.permissionGrants.authorize({
      threadID: invocation.threadID,
      turnID: invocation.turnID,
      agentID: invocation.agentID,
      ...(facts?.workspaceRoot ? { workspaceRoot: facts.workspaceRoot } : {}),
      requested: requestedPermissions(invocation.input),
      consumeToolCall,
    })
  }

  private async normalizePermissionRequest(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ) {
    const workspaceRoot = await realpath(context.workspace.rootPath)
    const permissions = await this.normalizeAdditionalPermissions(input, workspaceRoot)
    return {
      scope: input.scope,
      ...permissions,
      ...(typeof input.escalationToken === 'string'
        ? { escalationToken: input.escalationToken }
        : {}),
      justification: input.justification,
    }
  }

  private async normalizeAdditionalPermissions(
    input: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<AdditionalPermissions> {
    const strings = (name: 'readPaths' | 'writePaths' | 'networkDomains') => {
      const value = input[name]
      if (value === undefined) return []
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new AgentError('INVALID_TOOL_INPUT', `${name} 必须是非空字符串数组`, 400)
      }
      return [...new Set(value.map((item) => String(item).trim()))]
    }
    const readPaths = await Promise.all(
      strings('readPaths').map((path) => this.canonicalPath(workspaceRoot, path, false)),
    )
    const writePaths = await Promise.all(
      strings('writePaths').map((path) => this.canonicalPath(workspaceRoot, path, true)),
    )
    const networkDomains = strings('networkDomains').map((domain) => {
      const normalized = domain.toLowerCase().replace(/\.$/, '')
      if (
        normalized === 'localhost' ||
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
          normalized,
        )
      )
        return normalized
      throw new AgentError('INVALID_TOOL_INPUT', `networkDomains 包含无效域名：${domain}`, 400)
    })
    return {
      ...(readPaths.length ? { readPaths } : {}),
      ...(writePaths.length ? { writePaths } : {}),
      ...(networkDomains.length ? { networkDomains } : {}),
    }
  }

  private async commandForShell(
    shellTool: 'Bash' | 'PowerShell',
    command: string,
    signal: AbortSignal,
  ) {
    const required = shellRuntimeDependencies(command)
    const environment =
      required.length > 0
        ? await (this.options?.resolveToolingEnvironment ?? resolveToolingEnvironment)(required, {
            signal,
          })
        : {
            pathEntries: [] as readonly string[],
            resolutions: new Map<ManagedToolID, ToolingResolution>(),
          }
    for (const id of required) {
      const resolution = environment.resolutions.get(id)
      if (!resolution?.available) {
        throw new AgentError(
          'RUNTIME_DEPENDENCY_UNAVAILABLE',
          resolution?.reason ?? `${id} 运行环境不可用`,
          503,
          {
            toolingID: id,
            reason: resolution?.code ?? 'TOOLING_UNAVAILABLE',
          },
        )
      }
    }
    const env = toolingPathOverride(environment.pathEntries)
    if (process.platform === 'win32' && shellTool === 'Bash') {
      const resolution = await (this.options?.resolveTooling ?? resolveManagedTool)('git-bash', {
        signal,
      })
      if (!resolution.available)
        throw new AgentError('BASH_RUNTIME_UNAVAILABLE', resolution.reason, 503, {
          toolingID: 'git-bash',
          reason: resolution.code,
        })
      const executable = resolution.path.replaceAll("'", "''")
      return {
        command: `& '${executable}' -lc '${command.replaceAll("'", "''")}'`,
        env,
        managedRuntimeCount: required.length + 1,
      }
    }
    if (process.platform !== 'win32' && shellTool === 'PowerShell') {
      return {
        command: `pwsh -NoProfile -NonInteractive -Command '${command.replaceAll("'", "'\\''")}'`,
        env,
        managedRuntimeCount: required.length,
      }
    }
    return { command, env, managedRuntimeCount: required.length }
  }

  private async canonicalPath(workspaceRoot: string, value: string, allowMissingLeaf: boolean) {
    const absolute = isAbsolute(value) ? resolve(value) : resolve(workspaceRoot, value)
    if (!allowMissingLeaf)
      return realpath(absolute).catch(() => {
        throw new AgentError('PERMISSION_PATH_NOT_FOUND', `申请读取的路径不存在：${value}`, 400)
      })
    try {
      return await realpath(absolute)
    } catch {
      const parent = await realpath(dirname(absolute)).catch(() => {
        throw new AgentError(
          'PERMISSION_PATH_NOT_FOUND',
          `申请写入路径的父目录不存在：${value}`,
          400,
        )
      })
      return resolve(parent, absolute.slice(dirname(absolute).length + 1))
    }
  }
}
