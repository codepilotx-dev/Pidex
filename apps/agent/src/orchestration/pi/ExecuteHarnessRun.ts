import { AgentHarness } from '../harness/AgentHarness'
import { DeferredToolCatalog } from '../../tool/harness/DeferredToolCatalog'
import { type AssistantMessage, type ImageContent } from '@earendil-works/pi-ai'
import { AgentError } from '../../Domain'
import type { SubagentResult } from '../../Domain'
import { providerFailureCategory, providerFailureMessage } from '../../provider/ModelHealthService'
import { PromptComposer } from '../../prompt/PromptComposer'
import { inferPromptCacheRuntimePolicy } from '../../prompt/PromptCache'
import {
  buildContextUsageBreakdown,
  contextItemsChars,
  messagesChars,
} from '../../context/ContextUsageBreakdown'
import { secretScrubber } from '../../security/SecretScrubber'
import { PiEventAdapter } from './PiEventAdapter'
import { applyPromptCacheRuntimePolicy } from './PiPromptCacheAdapter'
import { adaptToolDefinition, createPiTools } from './PiToolAdapter'
import { formatStructuredResult, parseStructuredResult } from './StructuredResult'
import type {
  ActiveHarness,
  HarnessRunResult,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
} from './Types'
import type { RuntimeCompactionTrigger } from './Types'
import {
  isProviderContextOverflow,
  REACTIVE_COMPACTION_INSTRUCTIONS,
  REACTIVE_CONTINUATION_PROMPT,
} from './ContextOverflow'

const promptContext = (request: HarnessRuntimeRequest, contextItems: readonly unknown[]) => {
  const attachments =
    request.attachments?.flatMap((attachment) =>
      attachment.kind === 'text'
        ? [`<attachment name=${JSON.stringify(attachment.name)}>${attachment.text}</attachment>`]
        : [],
    ) ?? []
  const contextual = contextItems.flatMap((item) => {
    const content = (item as { content?: Array<{ text?: unknown }> }).content
    return content?.flatMap((part) => (typeof part.text === 'string' ? [part.text] : [])) ?? []
  })
  return [...contextual, ...attachments, request.content].filter(Boolean).join('\n\n')
}

const promptImages = (request: HarnessRuntimeRequest): ImageContent[] =>
  request.attachments?.flatMap((attachment) =>
    attachment.kind === 'image'
      ? [{ type: 'image' as const, data: attachment.base64, mimeType: attachment.mediaType }]
      : [],
  ) ?? []

/**
 * Pi runtime core. SQLite/outbox persistence is supplied through PiRuntimeEventSink;
 * this class never publishes a durable event before the sink's transaction completes.
 */
export async function executeHarnessRun(
  options: HarnessRuntimeOptions,
  request: HarnessRuntimeRequest,
): Promise<HarnessRunResult> {
  if (request.signal.aborted) throw new AgentError('RUN_ABORTED', '任务已停止', 499)
  const dependencies = await options.harnessFactory.resolve(request)
  // A pre-composed bundle is authoritative (frozen by the turn composition);
  // otherwise compose here so this function stays usable as a stateless facade.
  const bundle =
    request.bundle ??
    new PromptComposer().compose({
      threadID: request.threadID,
      mode: request.taskMode,
      profile: request.profile ?? 'main',
      exposedTools: request.exposedTools,
      sections: request.promptSections,
    })
  const initialCachePolicy = inferPromptCacheRuntimePolicy(request.model, bundle.cacheKey)
  await request.onPromptComposed?.(bundle)

  // A successful submission only becomes the delivery of this runtime after
  // validation AND the host callback succeed, and it stays bound to its tool
  // call id. Validation failures, callback errors and blocked calls return
  // tool errors without retaining a candidate or ending the loop.
  let delivery: { toolCallID: string; result: SubagentResult } | undefined
  const lifecycle = {
    ...options.lifecycle,
    ...(options.lifecycle?.finalizeResult
      ? {
          finalizeResult: async (input: SubagentResult, id: string) => {
            const parsed = parseStructuredResult(input)
            const accepted = await options.lifecycle!.finalizeResult!(parsed, id)
            delivery = { toolCallID: id, result: parsed }
            return accepted
          },
        }
      : {}),
  }
  const tools = createPiTools({ executor: options.toolExecutor, request }, lifecycle)
  const deferredDefinitions = options.toolExecutor.deferredDefinitions(
    {
      taskMode: request.taskMode,
      sandboxMode: request.permissionConfig.sandboxMode,
      approvalPolicy: request.permissionConfig.approvalPolicy,
      profile: request.profile ?? 'main',
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
      ...(request.frozenDeferredToolNames
        ? { frozenDeferredToolNames: request.frozenDeferredToolNames }
        : {}),
    },
    request.toolCatalog,
  )
  // The deferred envelope is frozen by the persisted turn snapshot. A resumed
  // turn may only bind those names; tools added to the live registry after the
  // snapshot must not widen it, and missing frozen names fail closed.
  const deferredToolCatalog = new DeferredToolCatalog(
    deferredDefinitions.map((definition) => ({
      name: definition.sdkName,
      label: definition.sdkName,
      description:
        typeof definition.description === 'string' ? definition.description : definition.sdkName,
      load: () => adaptToolDefinition(definition, { executor: options.toolExecutor, request }),
    })),
  )
  const harness = new AgentHarness({
    session: dependencies.session,
    models: dependencies.models,
    ...(dependencies.resources ? { resources: dependencies.resources } : {}),
    model: request.model,
    thinkingLevel: request.thinkingLevel ?? 'off',
    systemPrompt: bundle.instructions,
    tools,
    activeToolNames: tools.map((tool) => tool.name),
    deferredToolCatalog,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    streamOptions: {
      timeoutMs: 600_000,
      maxRetries: 2,
      maxRetryDelayMs: 10_000,
      cacheRetention: initialCachePolicy.cacheRetention,
      metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
    },
  })
  harness.on('before_provider_request', (event) => ({
    streamOptions: {
      cacheRetention: inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey).cacheRetention,
      metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
    },
  }))
  harness.on('context', (event) => {
    const notices = request.collaborationMessages?.() ?? []
    if (!notices.length) return undefined
    return {
      messages: [
        ...event.messages,
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text:
                '<subagent_notices untrusted="true">' +
                JSON.stringify(notices) +
                '</subagent_notices>',
            },
          ],
          timestamp: notices.at(-1)!.created_at,
        },
      ],
    }
  })
  harness.on('before_provider_payload', (event) => {
    const policy = inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey)
    const applied = applyPromptCacheRuntimePolicy(event.payload, policy, bundle.stableContextText)
    return { payload: secretScrubber.scrub(applied.payload) }
  })
  // 上下文字符量统计是给面板看的旁路数据：任何失败都不得影响模型请求，
  // 因此这里吞掉异常，只更新快照。
  const measureContextUsage = (measuredMessagesChars: number) => {
    try {
      request.onContextUsageMeasured?.(
        buildContextUsageBreakdown({
          diagnostics: bundle.diagnostics,
          tools,
          injectedContextChars: contextItemsChars(bundle.contextItems),
          messagesChars: measuredMessagesChars,
        }),
      )
    } catch {
      // 忽略：缺少分类数据时面板退化为只显示总量。
    }
  }
  harness.on('context', (event) => {
    measureContextUsage(messagesChars(event.messages))
    return undefined
  })
  const pausedToolCalls = new Set<string>()
  // Lifecycle tools that only make sense as the sole call of an assistant
  // message. The hook carries the per-message tool call count so the runtime
  // can reject a submission mixed with other tool calls; every other tool in
  // the batch keeps following the existing execution rules.
  const singleToolCallReasons = new Map<string, string>()
  if (options.lifecycle?.finalizeResult) {
    singleToolCallReasons.set(
      'finalize_result',
      'finalize_result 必须是该条回复中唯一的工具调用；先完成并验证其他工作，然后在单独一条回复中提交。',
    )
  }
  if (options.lifecycle?.submitPlan) {
    singleToolCallReasons.set(
      'submit_plan',
      'submit_plan 必须是该条回复中唯一的工具调用；先完成调查，然后在单独一条回复中提交方案。',
    )
  }
  if (singleToolCallReasons.size > 0 || options.beforeToolCall)
    harness.on('tool_call', async (event) => {
      const singleCallReason = singleToolCallReasons.get(event.toolName)
      if (singleCallReason && event.messageToolCallCount > 1) {
        return { block: true, reason: singleCallReason }
      }
      if (!options.beforeToolCall) return undefined
      const result = await options.beforeToolCall!(request, {
        toolCallID: event.toolCallId,
        tool: event.toolName,
        input: event.input,
        messageToolCallCount: event.messageToolCallCount,
      })
      if (result?.pause) pausedToolCalls.add(event.toolCallId)
      return result
        ? {
            ...(result.block === undefined ? {} : { block: result.block }),
            ...(result.reason === undefined ? {} : { reason: result.reason }),
          }
        : undefined
    })
  harness.on('tool_result', (event) =>
    pausedToolCalls.has(event.toolCallId) ? { terminate: true } : undefined,
  )
  let compactionTrigger: RuntimeCompactionTrigger | null = null
  const adapter = new PiEventAdapter(
    { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
    options.eventSink ?? {},
    {
      parseProposedPlan: request.taskMode === 'plan',
      resolveSessionEntryID: () => dependencies.session.getLeafId(),
      resolveCompactionContext: () => ({
        trigger: compactionTrigger ?? 'manual',
        promptText: bundle.instructions,
      }),
    },
  )
  const unsubscribe = harness.subscribe((event) => adapter.handle(event))
  // These hooks are not broadcast by subscribe; forward metadata through the same event sink.
  for (const type of ['before_agent_start', 'context', 'before_provider_request'] as const) {
    harness.on(type, async (event) => {
      await adapter.handle(event)
      return undefined
    })
  }
  const compact = async (trigger: RuntimeCompactionTrigger, instructions?: string) => {
    compactionTrigger = trigger
    try {
      return await harness.compact(instructions)
    } finally {
      compactionTrigger = null
    }
  }
  const active = { harness, unsubscribe, compact } as unknown as ActiveHarness
  options.activated?.(request.threadID, active)
  const onAbort = () => {
    void harness.abort()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const images = promptImages(request)
    let message: AssistantMessage = await harness.prompt(
      promptContext(request, bundle.contextItems),
      images.length > 0 ? { images } : undefined,
    )
    if (message.stopReason === 'error' && isProviderContextOverflow(message.errorMessage)) {
      try {
        await compact('reactive', REACTIVE_COMPACTION_INSTRUCTIONS)
        message = await harness.prompt(REACTIVE_CONTINUATION_PROMPT)
      } catch {
        await options.compaction?.recordFailure(request.threadID, 'reactive')
        throw new AgentError(
          'PI_CONTEXT_WINDOW_EXCEEDED',
          '模型上下文超过窗口限制，自动压缩未能恢复',
          413,
        )
      }
      if (message.stopReason === 'error' && isProviderContextOverflow(message.errorMessage)) {
        await options.compaction?.recordFailure(request.threadID, 'reactive')
        throw new AgentError(
          'PI_CONTEXT_WINDOW_EXCEEDED',
          '模型上下文超过窗口限制，压缩后仍无法继续',
          413,
        )
      }
    }
    if (message.stopReason === 'error') {
      const category = providerFailureCategory(message.errorMessage ?? 'Pi Agent 执行失败')
      throw new AgentError(
        `PI_${category.toUpperCase().replace('-', '_')}_FAILED`,
        providerFailureMessage(category, 'request'),
        502,
      )
    }
    if (message.stopReason === 'aborted' || request.signal.aborted)
      throw new AgentError('RUN_ABORTED', '任务已停止', 499)
    const output = adapter.outputText(message.content)
    const compaction = options.compaction
    if (
      compaction &&
      ((await request.canAutoCompact?.()) ?? true) &&
      (await compaction.shouldAutoCompact(request.threadID))
    ) {
      try {
        await compact('automatic')
      } catch {
        await compaction.recordFailure(request.threadID, 'automatic')
      }
    }
    // The delivery candidate is bound to its tool call: only when the final
    // assistant message is the one that carried the successful submission is
    // it the delivery result of this runtime. Later steering or continued
    // execution must never reuse a candidate from an earlier round.
    const delivered =
      delivery !== undefined &&
      message.content.some((part) => part.type === 'toolCall' && part.id === delivery!.toolCallID)
        ? delivery
        : undefined
    return {
      status: 'completed',
      output: delivered ? formatStructuredResult(delivered.result) : output,
      ...(delivered ? { result: delivered.result } : {}),
    }
  } finally {
    request.signal.removeEventListener('abort', onAbort)
  }
}
