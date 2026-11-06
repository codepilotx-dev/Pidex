import type { ComputerResult, McpServerDeclaration } from '@pidex/agent-protocol'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { AgentError } from '../Domain'
import type { ComputerUseService } from '../computer/ComputerUseService'
import type { PluginManagementService } from '../plugin/PluginManagementService'
import type { ToolContext, ToolDefinition, ToolStructuredResult } from '../tool/ToolRegistry'
import type { ToolExecutionContext, ToolExecutor } from '../tool/ToolExecutor'
import {
  NODE_REPL_PLUGIN_ID,
  NODE_REPL_RESET_TOOL_NAME,
  NODE_REPL_SERVER_NAME,
  NODE_REPL_TOOL_NAME,
} from './Association'
import type { ComputerOperationRecovery, NodeReplOperationRequest } from './Protocol'
import {
  isBuiltinNodeReplServer,
  type NodeReplOperationOutcome,
  type NodeReplService,
} from './NodeReplService'

const INTERNAL_TOOL_BY_METHOD = {
  apps: 'ComputerApps',
  read: 'ComputerRead',
  action: 'ComputerAction',
} as const

const jsSchema = z
  .object({
    code: z.string().min(1).max(200_000),
    title: z.string().min(1).max(200),
    timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
  })
  .strict()

const resetSchema = z.object({}).strict()

export type NodeReplJsInput = z.infer<typeof jsSchema>
export type NodeReplResetInput = z.infer<typeof resetSchema>

type NodeReplOutput = {
  text: string
  images: Array<{ data: string; mimeType: string }>
  /** Stop the agent loop after a pause; the checkpoint owns the resume. */
  terminated: boolean
}

type NodeReplDefinitionDeps = {
  plugins: PluginManagementService
  computer: ComputerUseService
  service: NodeReplService
  executor: ToolExecutor
  server?: McpServerDeclaration
  validateConfiguration?: () => Promise<void>
}

/** MCP provenance for one raw tool of the node_repl server. */
const mcpOrigin = (deps: NodeReplDefinitionDeps, rawToolName: string) => ({
  kind: 'mcp' as const,
  serverName: NODE_REPL_SERVER_NAME,
  rawToolName,
  generation: 0,
  ...(deps.server
    ? {
        configurationHash: createHash('sha256').update(JSON.stringify(deps.server)).digest('hex'),
      }
    : {}),
})

const isExternalServer = (deps: NodeReplDefinitionDeps) =>
  Boolean(deps.server && !isBuiltinNodeReplServer(deps.server))

/** A built-in server needs no review; an external one keeps its configured policy. */
const approvalStrategyFor = (
  external: boolean,
  approvalMode: string | undefined,
): ToolDefinition['approvalStrategy'] =>
  approvalMode === 'prompt' || approvalMode === 'writes'
    ? 'always-review'
    : approvalMode === 'approve' || !external
      ? 'never-review'
      : 'policy'

const requireHostIdentity = (context: ToolContext) => {
  if (!context.invocation || (context.profile && context.profile !== 'main'))
    throw new AgentError('PERMISSION_DENIED', 'node_repl 只允许具有宿主身份的主 Agent', 403)
  return context.invocation
}

const asComputerResult = (value: unknown): ComputerResult => {
  if (value && typeof value === 'object' && typeof (value as ComputerResult).text === 'string')
    return value as ComputerResult
  return { text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }
}

/**
 * `mcp__node_repl__js` is the only model-visible computer-control entry, and
 * `mcp__node_repl__js_reset` only discards its context. The three built-in
 * computer tools stay registered as internal operations, so every call still
 * passes host inspection, hooks, decisions and approval.
 */
export function nodeReplToolDefinition(
  deps: NodeReplDefinitionDeps,
): ToolDefinition<NodeReplJsInput, NodeReplOutput> {
  const external = isExternalServer(deps)
  const approvalMode = deps.server?.tools?.js?.approvalMode ?? deps.server?.defaultToolsApprovalMode
  const capabilities = {
    filesystem: 'none' as const,
    network: 'none' as const,
    process: external,
    externalState: external,
    userInteraction: false,
  }
  const approvalStrategy = approvalStrategyFor(external, approvalMode)
  const origin = (rawToolName: string) => mcpOrigin(deps, rawToolName)
  const nestedContext = (context: ToolContext, toolCallID: string): ToolExecutionContext => ({
    threadID: context.invocation!.threadID,
    turnID: context.invocation!.turnID,
    agentID: context.invocation!.agentID,
    profile: context.profile ?? 'main',
    taskMode: context.taskMode,
    signal: context.signal,
    workspace: context.workspace,
    permissionConfig: context.permissionConfig,
    model: context.model,
    toolCallID,
  })

  const runInternal = async (
    method: keyof typeof INTERNAL_TOOL_BY_METHOD,
    args: Record<string, unknown>,
    context: ToolContext,
    toolCallID: string,
    resumed: boolean,
  ): Promise<NodeReplOperationOutcome> => {
    await deps.validateConfiguration?.()
    const name = INTERNAL_TOOL_BY_METHOD[method]
    // Audit identity stays distinct from the js call. It is deterministic so a
    // resumed execution is idempotent instead of writing a second row.
    const internalCallID = `${toolCallID}:${name}`
    const nested = nestedContext(context, internalCallID)
    if (resumed) {
      const result = await deps.executor.execute<ComputerResult>(name, args, {
        ...nested,
        approvedToolCallID: internalCallID,
        ...(context.authorizationScope
          ? { approvedAuthorizationFingerprint: context.authorizationScope.fingerprint }
          : {}),
        ...(context.approvedComputerGrant
          ? { approvedComputerGrant: context.approvedComputerGrant }
          : {}),
      })
      return { kind: 'result', result: asComputerResult(result) }
    }
    // The approval checkpoint must be keyed on the js call so the runtime can
    // resume it; only the operation identity is recorded, never the script.
    const decision = await deps.executor.previewApproval(name, args, nested, toolCallID)
    if (decision.decision === 'deny')
      return {
        kind: 'denied',
        code: 'TOOL_PERMISSION_DENIED',
        message: decision.reason ?? '电脑操作被拒绝',
      }
    if (decision.decision !== 'allow') {
      if (!context.requestPause)
        return { kind: 'denied', code: 'TOOL_REVIEW_REQUIRED', message: '当前执行无法暂停等待审批' }
      await context.requestPause({
        kind: 'permission',
        toolCallID,
        checkpoint: {
          state: JSON.stringify({ engine: 'pi', nodeRepl: true }),
          interruption: {
            toolCallID,
            computerOperation: { method, args } satisfies ComputerOperationRecovery,
          },
          toolCallID,
          ...(decision.authorizationFingerprint
            ? { authorizationFingerprint: decision.authorizationFingerprint }
            : {}),
        },
      })
      return { kind: 'paused' }
    }
    const result = await deps.executor.execute<ComputerResult>(name, args, {
      ...nested,
      approvedToolCallID: internalCallID,
      ...(decision.authorizationFingerprint
        ? { approvedAuthorizationFingerprint: decision.authorizationFingerprint }
        : {}),
    })
    return { kind: 'result', result: asComputerResult(result) }
  }

  return {
    sdkName: NODE_REPL_TOOL_NAME,
    name: NODE_REPL_TOOL_NAME,
    description: external
      ? '通过配置的 stdio MCP node_repl 服务执行 JavaScript。使用 computer 桥接时每次操作仍经过 Pidex 判权。外部运行时的可用 API 由该服务决定。'
      : '电脑控制：在独立进程中执行一段 JavaScript，通过 computer API 发现 Windows 应用（computer.apps）、读取窗口界面与截图（computer.read）、执行操作（computer.action）。同一 chat 内的调用共享同一个求值上下文：变量、函数与对象身份跨调用保留，不同 chat 之间（各自独立进程）互不可见；调用 js_reset 清除当前 chat 的上下文。只提供 computer 与 nodeRepl，没有 import、Shell、文件或网络。仅主 Agent、聊天模式可用；每次电脑操作仍走统一权限与审批链。',
    schema: jsSchema,
    inputSchema: z.toJSONSchema(jsSchema),
    origin: origin('js'),
    capabilities,
    allowedModes: ['chat'],
    allowedProfiles: ['main'],
    approvalStrategy,
    visibility: 'deferred',
    executionMode: 'sequential',
    available: () => deps.plugins.isEnabled(NODE_REPL_PLUGIN_ID) && deps.computer.available(),
    inspectInput: (input, context) => {
      const recovery: ComputerOperationRecovery | undefined = context.computerRecovery
      if (!recovery || recovery.method !== 'read') return undefined
      const windowRef = recovery.args.windowRef
      if (typeof windowRef !== 'string') return undefined
      const identity = requireHostIdentity(context)
      return {
        authorizationScope: deps.computer.inspect(
          identity,
          windowRef,
          false,
          undefined,
          context.permissionConfig,
        ),
      }
    },
    execute: async (input, context) => {
      const invocation = requireHostIdentity(context)
      if (!deps.plugins.isEnabled(NODE_REPL_PLUGIN_ID))
        throw new AgentError('PLUGIN_DISABLED', 'Computer Use 插件未启用，无法使用 node_repl', 403)
      await deps.validateConfiguration?.()
      const recovery = context.computerRecovery
      if (recovery) {
        // Resume executes only the saved operation; the original script never runs again.
        if (recovery.method !== 'read')
          throw new AgentError('INVALID_REQUEST', '审批恢复只支持保存的读取操作', 409)
        const outcome = await runInternal(
          recovery.method,
          recovery.args,
          context,
          invocation.toolCallID,
          true,
        )
        if (outcome.kind !== 'result')
          throw new AgentError('NODE_REPL_RECOVERY_FAILED', '保存的读取操作未能执行', 500)
        return {
          text: outcome.result.text,
          images: [...(outcome.result.images ?? [])],
          terminated: false,
        }
      }
      const result = await deps.service.execute({
        ...(deps.server ? { server: deps.server } : {}),
        title: input.title,
        threadID: invocation.threadID,
        code: input.code,
        timeoutMs: input.timeout_ms,
        signal: context.signal,
        runOperation: (request: NodeReplOperationRequest, signal) =>
          runInternal(
            request.method,
            request.args,
            { ...context, signal },
            invocation.toolCallID,
            false,
          ),
      })
      return result.paused
        ? { text: '已暂停等待应用授权，请批准后重新观察。', images: [], terminated: true }
        : { text: result.text, images: result.images, terminated: false }
    },
    formatResult: (output): ToolStructuredResult => ({
      content: output.text,
      details: { text: output.text },
      ...(output.images.length
        ? {
            images: output.images.map((image) => ({
              type: 'image' as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          }
        : {}),
      ...(output.terminated ? { terminate: true } : {}),
    }),
  }
}

/**
 * `mcp__node_repl__js_reset` clears the chat's evaluation context. It runs no
 * script and needs no computer operation, so it declares no process or
 * external-state capability; it still resolves through the same host path and
 * configuration fingerprint as `js` so it can never outlive a config change.
 */
export function nodeReplResetToolDefinition(
  deps: NodeReplDefinitionDeps,
): ToolDefinition<NodeReplResetInput, NodeReplOutput> {
  // An external server may still ask for review of the reset itself.
  const approvalMode =
    deps.server?.tools?.js_reset?.approvalMode ?? deps.server?.defaultToolsApprovalMode
  // 内置服务无需审批；外部服务只按它自己对本工具的审批模式判断。
  const approvalStrategy: ToolDefinition['approvalStrategy'] = isExternalServer(deps)
    ? approvalStrategyFor(true, approvalMode)
    : 'never-review'
  return {
    sdkName: NODE_REPL_RESET_TOOL_NAME,
    name: NODE_REPL_RESET_TOOL_NAME,
    description:
      '清除当前 chat 的 node_repl JavaScript 上下文：变量、函数、对象与全局状态全部丢弃，下一次 js 调用从干净上下文开始。其他 chat 不受影响。',
    schema: resetSchema,
    inputSchema: z.toJSONSchema(resetSchema),
    origin: mcpOrigin(deps, 'js_reset'),
    // No elevation: it neither spawns a process nor touches external state.
    capabilities: {
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    },
    allowedModes: ['chat'],
    allowedProfiles: ['main'],
    approvalStrategy,
    visibility: 'deferred',
    executionMode: 'sequential',
    available: () => deps.plugins.isEnabled(NODE_REPL_PLUGIN_ID) && deps.computer.available(),
    execute: async (_input, context) => {
      const invocation = requireHostIdentity(context)
      if (!deps.plugins.isEnabled(NODE_REPL_PLUGIN_ID))
        throw new AgentError('PLUGIN_DISABLED', 'Computer Use 插件未启用，无法使用 node_repl', 403)
      await deps.validateConfiguration?.()
      await deps.service.reset(invocation.threadID)
      return { text: '已重置当前 chat 的 JavaScript 上下文', images: [], terminated: false }
    },
    formatResult: (output): ToolStructuredResult => ({
      content: output.text,
      details: { text: output.text },
    }),
  }
}
