import { isProviderContextOverflow } from './ContextOverflow'
import { AgentHarness } from '../harness/AgentHarness'
import { DeferredToolCatalog } from '../../tool/harness/DeferredToolCatalog'
import { type AssistantMessage, type ImageContent } from '@earendil-works/pi-ai'
import { AgentError } from '../../Domain'
import type { SubagentResult } from '../../Domain'
import { providerFailureCategory, providerFailureMessage } from '../../provider/ModelHealthService'
import { normalizePiProviderPayload } from '../../provider/pi/PiProviderPayload'
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
  GoalBudgetStatus,
  HarnessRunResult,
  HarnessRuntimeOptions,
  HarnessRuntimeRequest,
} from './Types'
import type { RuntimeCompactionTrigger } from './Types'
import {
  createDynamicDirectiveMessage,
  createObjectiveUpdatedMessage,
  createGoalWrapupContext,
  GoalBudgetLimitError,
  isDynamicDirectiveMessage,
} from '../../session/GoalDirectiveService'
import { AgentHarnessError } from '../harness/Types'

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
  let pendingBudget: import('./Types').GoalBudgetChange | null = null
  let providerBudget: import('./Types').GoalBudgetChange | null = null
  let seenBudget = ''
  let providerGoal: { goalId: string; revision: number } | undefined
  const lifecycle = {
    ...options.lifecycle,
    ...(options.lifecycle?.updateGoal
      ? {
          updateGoal: (
            input: { status: 'complete' | 'blocked'; blocker?: string | undefined },
            id: string,
            signal?: AbortSignal,
          ) => options.lifecycle!.updateGoal!(input, id, signal, providerGoal),
        }
      : {}),
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
  /**
   * Objective revision injected into the request currently being sent. It is
   * confirmed only if that request succeeds, so a failed or cancelled request
   * keeps the update pending and re-injects it next time.
   */
  let pendingObjective: { goalId: string; revision: number; objectiveRevision: number } | null =
    null
  /**
   * Budget status for the one wrap-up request this control revision is allowed.
   * Claimed before the request is sent; while set, admission marks the turn as a
   * wrap-up and the harness strips tools from it.
   */
  let wrapupStatus: GoalBudgetStatus | null = null
  let deniedGoal: { goalId: string; revision: number } | undefined
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
    ...(request.maxContextTokens !== undefined
      ? { maxContextTokens: request.maxContextTokens }
      : {}),
    systemPrompt: bundle.instructions,
    tools,
    activeToolNames: tools.map((tool) => tool.name),
    deferredToolCatalog,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    ...(options.compaction
      ? {
          contextCompaction: {
            anchor: options.compaction.lifecycle?.anchor(request.threadID),
            pending: () =>
              options.compaction?.lifecycle?.pending(request.threadID)?.status === 'queued',
            canCompact: async () =>
              !request.signal.aborted && ((await request.canAutoCompact?.()) ?? true),
            enabled: () => options.compaction!.shouldAutoCompact(request.threadID),
            start: async (trigger, phase) => {
              compactionTrigger = trigger
              return (
                options.compaction?.lifecycle?.running(
                  request.threadID,
                  trigger,
                  request.sessionID,
                  request.agentID,
                  phase,
                ).signal ?? new AbortController().signal
              )
            },
            finish: (status, reason) => {
              options.compaction?.lifecycle?.finish(request.threadID, status, reason)
              compactionTrigger = null
            },
            onBudget: (budget, anchor) =>
              options.compaction?.lifecycle?.budget(request.threadID, budget, anchor),
            onFailure: (trigger) => options.compaction!.recordFailure(request.threadID, trigger),
          },
        }
      : {}),
    ...(options.goalBudget
      ? {
          goalBudget: {
            prepareWrapupContext: (context) => {
              const status = options.goalBudget!.getBudgetStatus(request.threadID)
              return status
                ? createGoalWrapupContext(context, status.goal, status.tokensUsed)
                : null
            },
            checkAdmission: async (
              estimatedInputTokens: number,
              estimatedOutputTokens: number,
              wrapupInputTokens?: number,
            ) => {
              const latest = options.goalBudget!.getBudgetStatus(request.threadID)
              if (wrapupStatus && latest?.revision !== wrapupStatus.revision) wrapupStatus = null
              const decision = options.goalBudget!.checkAdmission(
                request.threadID,
                estimatedInputTokens,
                request.profile,
                estimatedOutputTokens,
                wrapupInputTokens,
              )
              if (!decision.allowed) {
                if (decision.budgetStatus.revision !== undefined)
                  deniedGoal = {
                    goalId: decision.budgetStatus.goal.id,
                    revision: decision.budgetStatus.revision,
                  }
                if (request.profile && request.profile !== 'main') {
                  return { allowed: false, stopSubagent: true, reason: decision.reason }
                }
                await options.goalBudget!.handleAdmissionDenied(
                  request,
                  decision,
                  estimatedInputTokens,
                )
                return { allowed: false, reason: decision.reason }
              }
              if (decision.wrapup && decision.budgetStatus) wrapupStatus = decision.budgetStatus
              return {
                allowed: true,
                ...(decision.maxTokens === undefined ? {} : { maxTokens: decision.maxTokens }),
                ...(wrapupStatus
                  ? {
                      wrapup: true,
                    }
                  : {}),
              }
            },
          },
        }
      : {}),
    streamOptions: {
      timeoutMs: 600_000,
      maxRetries: 2,
      maxRetryDelayMs: 10_000,
      cacheRetention: initialCachePolicy.cacheRetention,
      metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
    },
  })
  // Consumption requires a complete assistant message, not merely HTTP headers.
  harness.subscribe(async (event) => {
    if (event.type !== 'message_end' || event.message.role !== 'assistant') return
    const message = event.message
    if (
      pendingBudget &&
      !wrapupStatus &&
      !request.signal.aborted &&
      !['error', 'aborted'].includes(message.stopReason)
    ) {
      seenBudget = `${pendingBudget.goalId}:${pendingBudget.budgetRevision}`
      await options.goalBudget?.acknowledgeBudget?.(request, pendingBudget)
      pendingBudget = null
    }
    if (
      !pendingObjective ||
      request.signal.aborted ||
      message.stopReason === 'error' ||
      message.stopReason === 'aborted'
    )
      return
    options.goalBudget?.acknowledgeObjective?.(
      request.threadID,
      pendingObjective.revision,
      pendingObjective.objectiveRevision,
      pendingObjective.goalId,
    )
    pendingObjective = null
  })
  harness.on('before_provider_request', (event) => {
    return {
      streamOptions: {
        cacheRetention: inferPromptCacheRuntimePolicy(event.model, bundle.cacheKey).cacheRetention,
        metadata: { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
      },
    }
  })
  harness.on('context', (event) => {
    const budgetStatus = options.goalBudget?.getBudgetStatus(request.threadID)
    providerGoal =
      budgetStatus?.revision === undefined
        ? undefined
        : { goalId: budgetStatus.goal.id, revision: budgetStatus.revision }
    pendingObjective = null
    pendingBudget = null
    providerBudget = options.goalBudget?.budgetChange?.(request.threadID) ?? null
    if (
      providerBudget &&
      (request.profile && request.profile !== 'main'
        ? seenBudget !== `${providerBudget.goalId}:${providerBudget.budgetRevision}`
        : providerBudget.acknowledged < providerBudget.budgetRevision)
    )
      pendingBudget = providerBudget
    if (!budgetStatus) return undefined
    const filteredMessages = event.messages.filter((msg) => !isDynamicDirectiveMessage(msg))
    const messages = [...filteredMessages]
    // An objective edited mid-turn must reach the next request, so this is read
    // per request rather than once per turn. Consumption is confirmed only after
    // the provider accepts the request (see the response hook below).
    const pending = options.goalBudget?.pendingObjectiveUpdate?.(request.threadID)
    if (pending) {
      messages.push(createObjectiveUpdatedMessage(pending.goal))
      pendingObjective = {
        goalId: pending.goal.id,
        revision: pending.revision,
        objectiveRevision: pending.objectiveRevision ?? pending.acknowledged + 1,
      }
    }
    if (pendingBudget)
      messages.push({
        role: 'user',
        timestamp: Date.now(),
        content: [
          {
            type: 'text',
            text: [
              '<goal_budget_updated>',
              `Budget changed: ${pendingBudget.previousBudget ?? 'none'} -> ${pendingBudget.budget ?? 'none'}; cumulative usage ${pendingBudget.tokensUsed}; remaining ${pendingBudget.budget === null ? 'unlimited' : Math.max(0, pendingBudget.budget - pendingBudget.tokensUsed)}.`,
              'This is a spending ceiling, never a spending target. Check completion first: if all requirements are delivered, finish without inventing work. Otherwise revise only the remaining plan before further tools or delegation. Review running child tasks; use the existing collaboration tools to cancel, steer or add assignments only when useful. Preserve delivered work and cumulative usage. More budget grants no new scope. Do not wait for another turn to respond to this change.',
              '</goal_budget_updated>',
            ].join('\n'),
          },
        ],
      })
    messages.push(createDynamicDirectiveMessage(budgetStatus.goal, budgetStatus.tokensUsed))

    return { messages }
  })
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
    return {
      payload: normalizePiProviderPayload(secretScrubber.scrub(applied.payload), event.model.api),
    }
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
  // Lifecycle tools that only make sense as the sole call of an assistant
  // message. The hook carries the per-message tool call count so the runtime
  // can reject a submission mixed with other tool calls; every other tool in
  // the batch keeps following the existing execution rules.
  const singleToolCallReasons = new Map<string, string>()
  if (options.lifecycle?.finalizeResult && request.exposedTools.includes('finalize_result')) {
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
  if (options.lifecycle?.submitSchedulePlan) {
    singleToolCallReasons.set(
      'submit_schedule_plan',
      'submit_schedule_plan 必须是该条回复中唯一的工具调用；先完成调查与澄清，然后在单独一条回复中提交草案。',
    )
  }
  if (options.lifecycle?.submitTaskSchedule)
    singleToolCallReasons.set(
      'submit_task_schedule',
      '时间安排草案必须在调查和澄清完成后单独提交。',
    )
  if (singleToolCallReasons.size > 0 || options.beforeToolCall || options.goalBudget)
    harness.on('tool_call', async (event) => {
      const latestBudget = options.goalBudget?.budgetChange?.(request.threadID)
      if (
        latestBudget &&
        (latestBudget.goalId !== providerBudget?.goalId ||
          latestBudget.budgetRevision !== providerBudget?.budgetRevision)
      )
        return {
          block: true,
          reason:
            '预算已变更。请先读取下一请求中的新预算通知，检查是否已交付并调整剩余计划及子任务，再执行工具。',
        }
      if (wrapupStatus) return { block: true, reason: '目标预算收尾仅允许文本，工具已关闭。' }
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
      return result
        ? {
            ...(result.block === undefined ? {} : { block: result.block }),
            ...(result.reason === undefined ? {} : { reason: result.reason }),
            ...(result.pause === undefined ? {} : { pause: result.pause }),
          }
        : undefined
    })
  let compactionTrigger: RuntimeCompactionTrigger | null = null
  const adapter = new PiEventAdapter(
    { threadID: request.threadID, turnID: request.turnID, agentID: request.agentID },
    options.eventSink ?? {},
    {
      parseProposedPlan: request.taskMode === 'plan',
      resolveSessionEntryID: () => dependencies.session.getLeafId(),
      resolveCompactionContext: () => ({
        trigger: compactionTrigger ?? 'automatic',
        promptText: bundle.instructions,
        budget: harness.getContextBudget(),
      }),
    },
  )
  const unsubscribe = harness.subscribe((event) => adapter.handle(event))
  // These hooks are not broadcast by subscribe; forward metadata through the same event sink.
  for (const type of [
    'before_agent_start',
    'context',
    'before_provider_request',
    'session_before_compact',
  ] as const) {
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
  // Mailbox delivery needs both the registered harness and its running phase.
  harness.on('before_agent_start', async () => {
    await options.onRuntimeReady?.()
    return undefined
  })
  const onAbort = () => {
    void harness.abort()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  try {
    // The frozen turn owns exposure; session history may belong to another mode.
    const restored = (await dependencies.session.buildContext()).activeToolNames ?? []
    await harness.setActiveTools([
      ...new Set([
        ...tools.map((tool) => tool.name),
        ...restored.filter((name) => deferredToolCatalog.has(name)),
      ]),
    ])
    const images = promptImages(request)
    let message: AssistantMessage = await harness.prompt(
      promptContext(request, bundle.contextItems),
      {
        images,
        media:
          request.attachments?.flatMap((attachment) =>
            attachment.kind === 'audio' || attachment.kind === 'video'
              ? [{ kind: attachment.kind, data: attachment.base64, mimeType: attachment.mediaType }]
              : [],
          ) ?? [],
      },
    )
    if (message.stopReason === 'error' && isProviderContextOverflow(message.errorMessage)) {
      await options.compaction?.recordFailure(request.threadID, 'reactive')
      throw new AgentError(
        'PI_CONTEXT_WINDOW_EXCEEDED',
        '模型上下文超过窗口限制，压缩后仍无法继续',
        413,
      )
    }
    if (message.stopReason === 'error') {
      if (
        message.errorMessage?.includes('目标预算受限') ||
        message.errorMessage?.includes('GOAL_BUDGET_LIMITED')
      ) {
        throw new GoalBudgetLimitError('目标预算受限', deniedGoal)
      }
      const budget = harness.getContextBudget()
      if (budget && budget.usedTokens >= budget.triggerTokens) {
        throw new AgentError(
          'CONTEXT_BUDGET_EXCEEDED',
          '已接近上下文预算，本次请求未发送；自动压缩不可用、压缩请求超预算或压缩后仍过大，请减少输入、新建会话或调整上下文预算',
          413,
        )
      }
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
    // The delivery candidate is bound to its tool call: only when the final
    // assistant message is the one that carried the successful submission is
    // it the delivery result of this runtime. Later steering or continued
    // execution must never reuse a candidate from an earlier round.
    const delivered =
      delivery !== undefined &&
      message.content.some((part) => part.type === 'toolCall' && part.id === delivery!.toolCallID)
        ? delivery
        : undefined
    if (
      !delivered &&
      request.profile &&
      request.profile !== 'main' &&
      message.content.some(
        (part) => part.type === 'text' && part.text.includes('已达到目标 Token 预算限制'),
      )
    ) {
      return {
        status: 'completed',
        output: output || '已达到目标 Token 预算限制，子任务已安全结束当前回合。',
        result: {
          outcome: 'partial',
          summary:
            '已达到目标 Token 预算限制，子任务已安全结束当前回合。已完成进展已汇总，待预算恢复后可继续推进。',
          findings: [],
          changedFiles: [],
          validation: [],
          risks: ['目标 Token 预算不足，子任务提前收尾'],
          references: [],
        },
      }
    }
    return {
      status: 'completed',
      output: delivered ? formatStructuredResult(delivered.result) : output,
      ...(delivered ? { result: delivered.result } : {}),
    }
  } catch (error) {
    if (error instanceof GoalBudgetLimitError) throw error
    if (error instanceof AgentHarnessError && error.code === 'goal_budget') {
      throw new GoalBudgetLimitError('目标预算受限', deniedGoal)
    }
    throw error
  } finally {
    if (wrapupStatus && !request.signal.aborted)
      await options.goalBudget?.finishWrapup?.(request.threadID, wrapupStatus)
    request.signal.removeEventListener('abort', onAbort)
  }
}
