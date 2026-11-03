import type { ComputerResult } from '@pidex/agent-protocol'
import { z } from 'zod'
import { AgentError } from '../Domain'
import type { ComputerUseService } from '../computer/ComputerUseService'
import type { PluginManagementService } from '../plugin/PluginManagementService'
import type { ToolContext, ToolDefinition, ToolStructuredResult } from '../tool/ToolRegistry'
import type { ToolExecutionContext, ToolExecutor } from '../tool/ToolExecutor'
import { NODE_REPL_PLUGIN_ID, NODE_REPL_SERVER_NAME, NODE_REPL_TOOL_NAME } from './Association'
import type { ComputerOperationRecovery, NodeReplOperationRequest } from './Protocol'
import type { NodeReplOperationOutcome, NodeReplService } from './NodeReplService'

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

export type NodeReplJsInput = z.infer<typeof jsSchema>

type NodeReplOutput = {
  text: string
  images: Array<{ data: string; mimeType: string }>
  /** Stop the agent loop after a pause; the checkpoint owns the resume. */
  terminated: boolean
}

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
 * `mcp__node_repl__js` is the only model-visible computer-control entry. The
 * three built-in computer tools stay registered as internal operations, so
 * every call still passes host inspection, hooks, decisions and approval.
 */
export function nodeReplToolDefinition(deps: {
  plugins: PluginManagementService
  computer: ComputerUseService
  service: NodeReplService
  executor: ToolExecutor
}): ToolDefinition<NodeReplJsInput, NodeReplOutput> {
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
    description:
      '电脑控制：在独立进程中执行一段 JavaScript，通过 computer API 发现 Windows 应用（computer.apps）、读取窗口界面与截图（computer.read）、执行操作（computer.action）。每次调用都是全新进程，globals 与绑定不跨调用保留；只提供 computer 与 nodeRepl，没有 import、Shell、文件或网络。仅主 Agent、聊天模式可用；每次电脑操作仍走统一权限与审批链。',
    schema: jsSchema,
    inputSchema: z.toJSONSchema(jsSchema),
    origin: {
      kind: 'mcp',
      serverName: NODE_REPL_SERVER_NAME,
      rawToolName: 'js',
      generation: 0,
    },
    capabilities: {
      filesystem: 'none',
      network: 'none',
      process: false,
      externalState: false,
      userInteraction: false,
    },
    allowedModes: ['chat'],
    allowedProfiles: ['main'],
    approvalStrategy: 'never-review',
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
        threadID: invocation.threadID,
        code: input.code,
        timeoutMs: input.timeout_ms,
        signal: context.signal,
        runOperation: (request: NodeReplOperationRequest) =>
          runInternal(request.method, request.args, context, invocation.toolCallID, false),
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
