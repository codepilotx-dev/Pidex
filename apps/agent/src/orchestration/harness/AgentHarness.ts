import {
  type AssistantMessage,
  contentText,
  type ImageContent,
  type Model,
  type Models,
  type RetryCallbacks,
  type RetryPolicy,
  type UserMessage,
} from '@earendil-works/pi-ai'
import { runAgentLoop } from './AgentLoop.ts'
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  QueueMode,
  StreamFn,
  ThinkingLevel,
} from './AgentTypes.ts'
import {
  collectEntriesForBranchSummary,
  generateBranchSummary,
} from '../../context/harness/BranchSummarization.ts'
import {
  compact,
  DEFAULT_COMPACTION_SETTINGS,
  prepareCompaction,
} from '../../context/harness/Compaction.ts'
import { convertToLlm } from './Messages.ts'
import { formatPromptTemplateInvocation } from '../../prompt/harness/PromptTemplates.ts'
import { formatSkillInvocation } from '../../prompt/harness/Skills.ts'
import type {
  AbortResult,
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOptions,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  AgentHarnessStreamOptionsPatch,
  AgentHarnessSystemPrompt,
  AgentHarnessTool,
  AgentHarnessToolContextSource,
  CompactResult,
  NavigateTreeResult,
  PendingSessionWrite,
  PromptTemplate,
  Session,
  Skill,
} from './Types.ts'
import {
  AgentHarnessError,
  BranchSummaryError,
  CompactionError,
  SessionError,
  toError,
} from './Types.ts'
import type { DeferredToolCatalog } from '../../tool/harness/DeferredToolCatalog.ts'
import {
  buildStepContext,
  buildTurnContext,
  buildHarnessTurnComposition,
  validateDeferredActivation,
  type HarnessTurnComposition,
} from './TurnComposition.ts'

function createUserMessage(text: string, images?: ImageContent[]): UserMessage {
  const content: Array<{ type: 'text'; text: string } | ImageContent> = [{ type: 'text', text }]
  if (images) content.push(...images)
  return { role: 'user', content, timestamp: Date.now() }
}

function createFailureMessage(
  model: Model<any>,
  error: unknown,
  aborted: boolean,
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}

function cloneStreamOptions(streamOptions?: AgentHarnessStreamOptions): AgentHarnessStreamOptions {
  return {
    ...streamOptions,
    ...(streamOptions?.headers ? { headers: { ...streamOptions.headers } } : {}),
    ...(streamOptions?.metadata ? { metadata: { ...streamOptions.metadata } } : {}),
  }
}

function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name)
    seen.add(name)
  }
  return [...duplicates]
}

function applyStreamOptionsPatch(
  base: AgentHarnessStreamOptions,
  patch?: AgentHarnessStreamOptionsPatch,
): AgentHarnessStreamOptions {
  const result = cloneStreamOptions(base)
  if (!patch) return result

  if (patch.transport !== undefined) result.transport = patch.transport
  if (patch.timeoutMs !== undefined) result.timeoutMs = patch.timeoutMs
  if (patch.maxRetries !== undefined) result.maxRetries = patch.maxRetries
  if (patch.maxRetryDelayMs !== undefined) result.maxRetryDelayMs = patch.maxRetryDelayMs
  if (patch.cacheRetention !== undefined) result.cacheRetention = patch.cacheRetention

  if (Object.hasOwn(patch, 'headers')) {
    if (patch.headers === undefined) {
      delete result.headers
    } else {
      const headers = { ...(result.headers ?? {}) }
      for (const [key, value] of Object.entries(patch.headers)) {
        if (value === undefined) delete headers[key]
        else headers[key] = value
      }
      if (Object.keys(headers).length > 0) result.headers = headers
      else delete result.headers
    }
  }

  if (Object.hasOwn(patch, 'metadata')) {
    if (patch.metadata === undefined) {
      delete result.metadata
    } else {
      const metadata = { ...(result.metadata ?? {}) }
      for (const [key, value] of Object.entries(patch.metadata)) {
        if (value === undefined) delete metadata[key]
        else metadata[key] = value
      }
      result.metadata = Object.keys(metadata).length > 0 ? metadata : undefined
    }
  }

  return result
}

const SUBSCRIBER_EVENT_TYPE = '*'

type AgentHarnessHandler = (event: any, signal?: AbortSignal) => Promise<any> | any

function normalizeHarnessError(
  error: unknown,
  fallbackCode: AgentHarnessError['code'],
): AgentHarnessError {
  if (error instanceof AgentHarnessError) return error
  const cause = toError(error)
  if (cause instanceof SessionError) return new AgentHarnessError('session', cause.message, cause)
  if (cause instanceof CompactionError)
    return new AgentHarnessError('compaction', cause.message, cause)
  if (cause instanceof BranchSummaryError)
    return new AgentHarnessError('branch_summary', cause.message, cause)
  return new AgentHarnessError(fallbackCode, cause.message, cause)
}

function normalizeHookError(error: unknown): AgentHarnessError {
  return normalizeHarnessError(error, 'hook')
}

interface AgentHarnessTurnState<
  TContext extends object | undefined,
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentHarnessTool<TContext> = AgentHarnessTool<TContext>,
> {
  messages: AgentMessage[]
  resources: AgentHarnessResources<TSkill, TPromptTemplate>
  toolContext: TContext
  streamOptions: AgentHarnessStreamOptions
  sessionId: string
  systemPrompt: string
  model: Model<any>
  thinkingLevel: ThinkingLevel
  tools: TTool[]
  activeTools: TTool[]
  composition: Readonly<HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool>>
}

export class AgentHarness<
  TContext extends object | undefined = undefined,
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
  TTool extends AgentHarnessTool<TContext> = AgentHarnessTool<TContext>,
> {
  private session: Session
  readonly models: Models
  private phase: AgentHarnessPhase = 'idle'
  private runAbortController: AbortController | undefined
  private runPromise: Promise<void> | undefined
  private pendingSessionWrites: PendingSessionWrite[] = []
  private model: Model<any>
  private thinkingLevel: ThinkingLevel
  private activeComposition?: Readonly<
    HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool>
  >
  /** Immutable composition for the current product turn; built once and reused by later provider/tool steps. */
  private currentTurnComposition:
    Readonly<HarnessTurnComposition<TContext, TSkill, TPromptTemplate, TTool>> | undefined
  private systemPrompt:
    AgentHarnessSystemPrompt<TContext, TSkill, TPromptTemplate, TTool> | undefined
  private toolContext: AgentHarnessToolContextSource<TContext> | undefined
  private streamOptions: AgentHarnessStreamOptions
  private retry: RetryPolicy | undefined
  private resources: AgentHarnessResources<TSkill, TPromptTemplate>
  private tools = new Map<string, TTool>()
  private activeToolNames: string[]
  private readonly deferredToolCatalog: DeferredToolCatalog<TTool> | undefined
  private toolExecution: import('./AgentTypes.ts').ToolExecutionMode
  private restoredActiveTools = false
  private activationQueue: Promise<void> = Promise.resolve()
  private steerQueue: UserMessage[] = []
  private steeringQueueMode: QueueMode
  private followUpQueue: UserMessage[] = []
  private followUpQueueMode: QueueMode
  private nextTurnQueue: AgentMessage[] = []
  private readonly queuedInputIds = new WeakMap<AgentMessage, string>()
  private handlers = new Map<string, Set<AgentHarnessHandler>>()

  constructor(options: AgentHarnessOptions<TContext, TSkill, TPromptTemplate, TTool>) {
    this.session = options.session
    this.models = options.models
    this.resources = options.resources ?? {}
    this.streamOptions = cloneStreamOptions(options.streamOptions)
    this.retry = options.retry
    this.systemPrompt = options.systemPrompt
    this.toolContext = options.toolContext
    this.deferredToolCatalog = options.deferredToolCatalog
    this.toolExecution = options.toolExecution ?? 'parallel'
    this.validateUniqueNames(
      (options.tools ?? []).map((tool) => tool.name),
      'Duplicate tool name(s)',
    )
    for (const tool of options.tools ?? []) {
      this.tools.set(tool.name, tool)
    }
    this.model = options.model
    this.thinkingLevel = options.thinkingLevel ?? 'off'
    this.activeToolNames = options.activeToolNames
      ? [...options.activeToolNames]
      : (options.tools ?? []).map((tool) => tool.name)
    this.validateUniqueNames(this.activeToolNames, 'Duplicate active tool name(s)')
    const unknownInitialTools = this.activeToolNames.filter(
      (name) => !this.tools.has(name) && !this.deferredToolCatalog?.has(name),
    )
    if (unknownInitialTools.length > 0) {
      throw new AgentHarnessError(
        'invalid_argument',
        `Unknown tool(s): ${unknownInitialTools.join(', ')}`,
      )
    }
    this.steeringQueueMode = options.steeringMode ?? 'one-at-a-time'
    this.followUpQueueMode = options.followUpMode ?? 'one-at-a-time'
  }

  private getHandlers(type: string): Set<AgentHarnessHandler> | undefined {
    return this.handlers.get(type)
  }

  private async emitOwn(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const listener of this.getHandlers(SUBSCRIBER_EVENT_TYPE) ?? []) {
      try {
        await listener(event, signal)
      } catch (error) {
        throw normalizeHookError(error)
      }
    }
  }

  private async emitAny(
    event: AgentHarnessEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const listener of this.getHandlers(SUBSCRIBER_EVENT_TYPE) ?? []) {
      try {
        await listener(event, signal)
      } catch (error) {
        throw normalizeHookError(error)
      }
    }
  }

  private async emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Promise<AgentHarnessEventResultMap[TType] | undefined> {
    const handlers = this.getHandlers(event.type as TType)
    if (!handlers || handlers.size === 0) return undefined
    let lastResult: AgentHarnessEventResultMap[TType] | undefined
    for (const handler of handlers) {
      try {
        const result = await handler(event)
        if (result !== undefined) {
          lastResult = result
        }
      } catch (error) {
        throw normalizeHookError(error)
      }
    }
    return lastResult
  }

  private retryCallbacks(operation: 'compaction' | 'branch_summary'): RetryCallbacks {
    return {
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) =>
        this.emitOwn({
          type: 'retry_scheduled',
          operation,
          attempt,
          maxAttempts,
          delayMs,
          errorMessage,
        }),
      onRetryAttemptStart: () => this.emitOwn({ type: 'retry_attempt_start', operation }),
      onRetryFinished: () => this.emitOwn({ type: 'retry_finished', operation }),
    }
  }

  private async emitBeforeProviderRequest(
    model: Model<any>,
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<AgentHarnessStreamOptions> {
    const handlers = this.getHandlers('before_provider_request')
    let current = cloneStreamOptions(streamOptions)
    if (!handlers || handlers.size === 0) return current
    for (const handler of handlers) {
      try {
        const result = await handler({
          type: 'before_provider_request',
          model,
          sessionId,
          streamOptions: cloneStreamOptions(current),
        })
        if (result?.streamOptions) {
          current = applyStreamOptionsPatch(current, result.streamOptions)
        }
      } catch (error) {
        throw normalizeHookError(error)
      }
    }
    return current
  }

  private async emitBeforeProviderPayload(model: Model<any>, payload: unknown): Promise<unknown> {
    const handlers = this.getHandlers('before_provider_payload')
    let current = payload
    if (!handlers || handlers.size === 0) return current
    for (const handler of handlers) {
      try {
        const result = await handler({ type: 'before_provider_payload', model, payload: current })
        if (result !== undefined) {
          current = result.payload
        }
      } catch (error) {
        throw normalizeHookError(error)
      }
    }
    return current
  }

  private async emitQueueUpdate(): Promise<void> {
    await this.emitOwn({
      type: 'queue_update',
      steer: [...this.steerQueue],
      followUp: [...this.followUpQueue],
      nextTurn: [...this.nextTurnQueue],
    })
  }

  private startRunPromise(): () => void {
    let finish = () => {}
    this.runPromise = new Promise<void>((resolve) => {
      finish = resolve
    })
    return () => {
      this.runPromise = undefined
      finish()
    }
  }

  private async resolveToolContext(): Promise<TContext> {
    if (typeof this.toolContext === 'function') {
      return await (this.toolContext as () => TContext | Promise<TContext>)()
    }
    return this.toolContext as TContext
  }

  private bindToolContext(tool: TTool, context: TContext): AgentTool {
    return {
      ...tool,
      execute: (toolCallId, params, signal, onUpdate) =>
        tool.execute(toolCallId, params, signal, onUpdate, context),
    }
  }

  private async createTurnState(): Promise<
    AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>
  > {
    const context = await this.session.buildContext()
    if (!this.restoredActiveTools) {
      const restoredNames = context.activeToolNames ?? this.activeToolNames
      await this.loadDeferredTools(restoredNames)
      this.validateToolNames(restoredNames)
      const previousToolNames = [...this.tools.keys()]
      const previousActiveToolNames = [...this.activeToolNames]
      this.activeToolNames = [...restoredNames]
      this.restoredActiveTools = true
      if (context.activeToolNames) {
        await this.emitOwn({
          type: 'tools_update',
          toolNames: [...this.tools.keys()],
          previousToolNames,
          activeToolNames: [...this.activeToolNames],
          previousActiveToolNames,
          source: 'restore',
        })
      }
    }
    const sessionMetadata = await this.session.getMetadata()
    // One immutable composition per product turn: the first step builds it
    // (model, thinking level, frozen system prompt, tool envelope), later
    // provider/tool steps reuse it so composition identity/hash never change
    // within the turn. Deferred activations are reflected per-step via
    // buildStepContext(currentActiveNames), never by recomposing.
    let composition = this.currentTurnComposition
    if (!composition) {
      const resources = this.getResources()
      const toolContext = await this.resolveToolContext()
      const tools = [...this.tools.values()]
      const activeTools = this.activeToolNames
        .map((name) => this.tools.get(name))
        .filter((tool): tool is TTool => tool !== undefined)
      let systemPrompt = 'You are a helpful assistant.'
      if (typeof this.systemPrompt === 'string') {
        systemPrompt = this.systemPrompt
      } else if (this.systemPrompt) {
        systemPrompt = await this.systemPrompt({
          session: this.session,
          model: this.model,
          thinkingLevel: this.thinkingLevel,
          activeTools,
          resources,
        })
      }
      composition = await buildHarnessTurnComposition({
        model: this.model,
        thinkingLevel: this.thinkingLevel,
        systemPrompt,
        tools,
        initialActiveToolNames: this.activeToolNames,
        deferredToolNames: (this.deferredToolCatalog?.names() ?? []).filter(
          (name) => !this.tools.has(name),
        ),
        resources,
        toolContext,
        streamOptions: this.streamOptions,
      })
      this.currentTurnComposition = composition
    }
    const activeTools = this.activeToolNames
      .map((name) => this.tools.get(name))
      .filter((tool): tool is TTool => tool !== undefined)
    return {
      messages: context.messages,
      resources: composition.resources,
      toolContext: composition.toolContext,
      streamOptions: cloneStreamOptions(composition.streamOptions),
      sessionId: sessionMetadata.id,
      systemPrompt: composition.systemPrompt,
      model: composition.model,
      thinkingLevel: composition.thinkingLevel,
      tools: [...composition.tools],
      activeTools,
      composition,
    }
  }

  private createContext(
    turnState: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    systemPrompt?: string,
  ): AgentContext {
    return {
      systemPrompt: systemPrompt ?? turnState.systemPrompt,
      messages: turnState.messages.slice(),
      tools: turnState.activeTools.map((tool) => this.bindToolContext(tool, turnState.toolContext)),
    }
  }

  private createStreamFn(
    getTurnState: () => AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
  ): StreamFn {
    return async (model, context, streamOptions) => {
      const turnState = getTurnState()
      const snapshotOptions: AgentHarnessStreamOptions = { ...turnState.streamOptions }
      const requestOptions = await this.emitBeforeProviderRequest(
        model,
        turnState.sessionId,
        snapshotOptions,
      )
      return this.models.streamSimple(model, context, {
        ...(requestOptions.cacheRetention !== undefined
          ? { cacheRetention: requestOptions.cacheRetention }
          : {}),
        ...(requestOptions.headers !== undefined ? { headers: requestOptions.headers } : {}),
        ...(requestOptions.maxRetries !== undefined
          ? { maxRetries: requestOptions.maxRetries }
          : {}),
        ...(requestOptions.maxRetryDelayMs !== undefined
          ? { maxRetryDelayMs: requestOptions.maxRetryDelayMs }
          : {}),
        ...(requestOptions.metadata !== undefined ? { metadata: requestOptions.metadata } : {}),
        onPayload: async (payload) => await this.emitBeforeProviderPayload(model, payload),
        onResponse: async (response) => {
          const headers = { ...(response.headers as Record<string, string>) }
          await this.emitOwn(
            { type: 'after_provider_response', status: response.status, headers },
            streamOptions?.signal,
          )
        },
        ...(streamOptions?.reasoning !== undefined ? { reasoning: streamOptions.reasoning } : {}),
        ...(streamOptions?.signal !== undefined ? { signal: streamOptions.signal } : {}),
        sessionId: turnState.sessionId,
        ...(requestOptions.timeoutMs !== undefined ? { timeoutMs: requestOptions.timeoutMs } : {}),
        ...(requestOptions.transport !== undefined ? { transport: requestOptions.transport } : {}),
      })
    }
  }

  private async drainQueuedMessages(
    queue: AgentMessage[],
    mode: QueueMode,
    delivery: 'steer' | 'follow-up' | 'next-turn',
  ): Promise<AgentMessage[]> {
    const messages = mode === 'all' ? queue.splice(0) : queue.splice(0, 1)
    if (messages.length === 0) return messages
    try {
      await this.emitQueueUpdate()
      const inputIds = messages.flatMap((message) => {
        const inputId = this.queuedInputIds.get(message)
        return inputId ? [inputId] : []
      })
      if (inputIds.length > 0) await this.emitOwn({ type: 'queue_consumed', delivery, inputIds })
      return messages
    } catch (error) {
      queue.unshift(...messages)
      throw normalizeHookError(error)
    }
  }

  private createLoopConfig(
    getTurnState: () => AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    setTurnState: (
      turnState: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    ) => void,
    onTurnStatePrepared: (
      turnState: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    ) => Promise<void>,
  ): AgentLoopConfig {
    const turnState = getTurnState()
    return {
      model: turnState.model,
      toolExecution: this.toolExecution,
      ...(turnState.thinkingLevel === 'off' ? {} : { reasoning: turnState.thinkingLevel }),
      convertToLlm,
      transformContext: async (messages) => {
        const result = await this.emitHook({ type: 'context', messages: [...messages] })
        return result?.messages ?? messages
      },
      beforeToolCall: async ({ assistantMessage, toolCall, args }) => {
        const messageToolCallCount = assistantMessage.content.filter(
          (part) => part.type === 'toolCall',
        ).length
        const result = await this.emitHook({
          type: 'tool_call',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
          messageToolCallCount,
        })
        return result
          ? {
              ...(result.block !== undefined ? { block: result.block } : {}),
              ...(result.reason !== undefined ? { reason: result.reason } : {}),
            }
          : undefined
      },
      afterToolCall: async ({ toolCall, args, result, isError }) => {
        const patch = await this.emitHook({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: args as Record<string, unknown>,
          content: result.content ?? [],
          details: result.details,
          isError,
          usage: result.usage,
          structuredContent: result.structuredContent,
          progress: result.progress,
        })
        return patch
          ? {
              content: patch.content,
              details: patch.details,
              isError: patch.isError,
              usage: patch.usage,
              structuredContent: patch.structuredContent,
              progress: patch.progress,
              terminate: patch.terminate,
            }
          : undefined
      },
      prepareNextTurn: async () => {
        await this.flushPendingSessionWrites()
        const nextTurnState = await this.createTurnState()
        setTurnState(nextTurnState)
        await onTurnStatePrepared(nextTurnState)
        return {
          context: this.createContext(nextTurnState),
          model: nextTurnState.model,
          thinkingLevel: nextTurnState.thinkingLevel,
        }
      },
      getSteeringMessages: async () =>
        this.drainQueuedMessages(this.steerQueue, this.steeringQueueMode, 'steer'),
      getFollowUpMessages: async () =>
        this.drainQueuedMessages(this.followUpQueue, this.followUpQueueMode, 'follow-up'),
    }
  }

  private validateUniqueNames(names: string[], message: string): void {
    const duplicates = findDuplicateNames(names)
    if (duplicates.length > 0)
      throw new AgentHarnessError('invalid_argument', `${message}: ${duplicates.join(', ')}`)
  }

  private validateToolNames(toolNames: string[], tools: Map<string, TTool> = this.tools): void {
    this.validateUniqueNames(toolNames, 'Duplicate active tool name(s)')
    const missing = toolNames.filter((name) => !tools.has(name))
    if (missing.length > 0)
      throw new AgentHarnessError('invalid_argument', `Unknown tool(s): ${missing.join(', ')}`)
  }

  private async loadDeferredTools(toolNames: readonly string[]): Promise<void> {
    const missing = [...new Set(toolNames)].filter((name) => !this.tools.has(name))
    if (missing.length === 0) return
    if (!this.deferredToolCatalog) {
      throw new AgentHarnessError('invalid_argument', `Unknown tool(s): ${missing.join(', ')}`)
    }
    let resolved: TTool[]
    try {
      resolved = await this.deferredToolCatalog.activate(missing)
    } catch (error) {
      throw new AgentHarnessError('invalid_argument', toError(error).message, toError(error))
    }
    this.validateUniqueNames(
      [...this.tools.keys(), ...resolved.map((tool) => tool.name)],
      'Duplicate tool name(s)',
    )
    for (const tool of resolved) this.tools.set(tool.name, tool)
  }

  private async flushPendingSessionWrites(): Promise<void> {
    while (this.pendingSessionWrites.length > 0) {
      const write = this.pendingSessionWrites[0]!
      if (write.type === 'message') {
        await this.session.appendMessage(write.message)
      } else if (write.type === 'model_change') {
        await this.session.appendModelChange(write.provider, write.modelId)
      } else if (write.type === 'thinking_level_change') {
        await this.session.appendThinkingLevelChange(write.thinkingLevel)
      } else if (write.type === 'active_tools_change') {
        await this.session.appendActiveToolsChange(write.activeToolNames)
      } else if (write.type === 'custom') {
        await this.session.appendCustomEntry(write.customType, write.data)
      } else if (write.type === 'custom_message') {
        await this.session.appendCustomMessageEntry(
          write.customType,
          write.content,
          write.display,
          write.details,
        )
      } else if (write.type === 'label') {
        await this.session.appendLabel(write.targetId, write.label)
      } else if (write.type === 'session_info') {
        await this.session.appendSessionName(write.name ?? '')
      } else if (write.type === 'leaf') {
        await this.session.getStorage().setLeafId(write.targetId)
      }
      this.pendingSessionWrites.shift()
    }
  }

  private async handleAgentEvent(event: AgentEvent, signal?: AbortSignal): Promise<void> {
    if (event.type === 'tool_execution_end' && !event.isError) {
      const addedToolNames = (event.result as { addedToolNames?: string[] }).addedToolNames
      if (addedToolNames?.length) {
        const newToolNames = addedToolNames.filter((name) => !this.activeToolNames.includes(name))
        if (newToolNames.length === 0) return
        if (!this.activeComposition)
          throw new AgentHarnessError('invalid_state', 'Missing active turn composition')
        validateDeferredActivation(newToolNames, this.activeComposition.toolPolicy)
        await this.activateTools(newToolNames)
      }
    }
    if (event.type === 'message_end') {
      await this.session.appendMessage(event.message)
      await this.emitAny(event, signal)
      return
    }
    if (event.type === 'turn_end') {
      let eventError: unknown
      try {
        await this.emitAny(event, signal)
      } catch (error) {
        eventError = error
      }
      const hadPendingMutations = this.pendingSessionWrites.length > 0
      await this.flushPendingSessionWrites()
      if (eventError) throw eventError
      await this.emitOwn({
        type: 'save_point',
        hadPendingMutations,
        activeToolNames: [...this.activeToolNames],
      })
      return
    }
    if (event.type === 'agent_end') {
      await this.flushPendingSessionWrites()
      this.phase = 'idle'
      await this.emitAny(event, signal)
      await this.emitOwn({ type: 'settled', nextTurnCount: this.nextTurnQueue.length }, signal)
      return
    }
    await this.emitAny(event, signal)
  }

  private async emitRunFailure(
    model: Model<any>,
    error: unknown,
    aborted: boolean,
    signal: AbortSignal,
  ): Promise<AgentMessage[]> {
    const failureMessage = createFailureMessage(model, error, aborted)
    await this.handleAgentEvent({ type: 'message_start', message: failureMessage }, signal)
    await this.handleAgentEvent({ type: 'message_end', message: failureMessage }, signal)
    await this.handleAgentEvent(
      { type: 'turn_end', message: failureMessage, toolResults: [] },
      signal,
    )
    await this.handleAgentEvent({ type: 'agent_end', messages: [failureMessage] }, signal)
    return [failureMessage]
  }

  private async executeTurn(
    turnState: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    text: string,
    options?: { images?: ImageContent[] },
  ): Promise<AssistantMessage> {
    let activeTurnState = turnState
    this.activeComposition = turnState.composition
    let stepIndex = 0
    const emitComposition = async (
      state: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    ) => {
      const turnContext = buildTurnContext({
        composition: state.composition,
        stepIndex,
        currentActiveToolNames: this.activeToolNames,
      })
      const stepContext = buildStepContext({
        stepIndex,
        currentActiveNames: this.activeToolNames,
        toolPolicy: state.composition.toolPolicy,
      })
      await this.emitOwn({
        type: 'turn_composition',
        compositionId: turnContext.compositionId,
        compositionHash: turnContext.compositionHash,
        stepIndex: stepContext.stepIndex,
        activeToolNames: [...stepContext.currentActiveNames],
      })
    }
    await emitComposition(turnState)
    let messages: AgentMessage[] = [createUserMessage(text, options?.images)]
    if (this.nextTurnQueue.length > 0) {
      const queuedMessages = this.nextTurnQueue.splice(0)
      try {
        await this.emitQueueUpdate()
      } catch (error) {
        this.nextTurnQueue.unshift(...queuedMessages)
        throw normalizeHookError(error)
      }
      messages = [...queuedMessages, messages[0]!]
    }
    const beforeResult = await this.emitHook({
      type: 'before_agent_start',
      prompt: text,
      images: options?.images,
      systemPrompt: turnState.systemPrompt,
      resources: turnState.resources,
    })
    if (beforeResult?.messages) messages = [...messages, ...beforeResult.messages]

    const abortController = new AbortController()
    const getTurnState = () => activeTurnState
    const setTurnState = (
      nextTurnState: AgentHarnessTurnState<TContext, TSkill, TPromptTemplate, TTool>,
    ) => {
      activeTurnState = nextTurnState
      this.activeComposition = nextTurnState.composition
    }
    this.runAbortController = abortController
    const runResultPromise = (async () => {
      try {
        return await runAgentLoop(
          messages,
          this.createContext(turnState, beforeResult?.systemPrompt),
          this.createLoopConfig(getTurnState, setTurnState, async (nextTurnState) => {
            stepIndex += 1
            await emitComposition(nextTurnState)
          }),
          (event) => this.handleAgentEvent(event, abortController.signal),
          abortController.signal,
          this.createStreamFn(getTurnState),
        )
      } catch (error) {
        try {
          return await this.emitRunFailure(
            activeTurnState.model,
            error,
            abortController.signal.aborted,
            abortController.signal,
          )
        } catch (failureError) {
          const cause = new AggregateError(
            [toError(error), toError(failureError)],
            'Agent run failed and failure reporting failed',
          )
          throw new AgentHarnessError('unknown', cause.message, cause)
        }
      }
    })()
    try {
      const newMessages = await runResultPromise
      for (let i = newMessages.length - 1; i >= 0; i--) {
        const message = newMessages[i]!
        if (message.role === 'assistant') {
          return message
        }
      }
      throw new AgentHarnessError(
        'invalid_state',
        'AgentHarness prompt completed without an assistant message',
      )
    } finally {
      try {
        await this.flushPendingSessionWrites()
      } finally {
        this.runAbortController = undefined
      }
    }
  }

  async prompt(text: string, options?: { images?: ImageContent[] }): Promise<AssistantMessage> {
    if (this.phase !== 'idle') throw new AgentHarnessError('busy', 'AgentHarness is busy')
    this.phase = 'turn'
    const finishRunPromise = this.startRunPromise()
    try {
      this.currentTurnComposition = undefined
      const turnState = await this.createTurnState()
      return await this.executeTurn(turnState, text, options)
    } catch (error) {
      this.phase = 'idle'
      throw normalizeHarnessError(error, 'unknown')
    } finally {
      finishRunPromise()
    }
  }

  async skill(name: string, additionalInstructions?: string): Promise<AssistantMessage> {
    if (this.phase !== 'idle') throw new AgentHarnessError('busy', 'AgentHarness is busy')
    this.phase = 'turn'
    const finishRunPromise = this.startRunPromise()
    try {
      this.currentTurnComposition = undefined
      const turnState = await this.createTurnState()
      const skill = (turnState.resources.skills ?? []).find((candidate) => candidate.name === name)
      if (!skill) throw new AgentHarnessError('invalid_argument', `Unknown skill: ${name}`)
      return await this.executeTurn(turnState, formatSkillInvocation(skill, additionalInstructions))
    } catch (error) {
      this.phase = 'idle'
      throw normalizeHarnessError(error, 'unknown')
    } finally {
      finishRunPromise()
    }
  }

  async promptFromTemplate(name: string, args: string[] = []): Promise<AssistantMessage> {
    if (this.phase !== 'idle') throw new AgentHarnessError('busy', 'AgentHarness is busy')
    this.phase = 'turn'
    const finishRunPromise = this.startRunPromise()
    try {
      this.currentTurnComposition = undefined
      const turnState = await this.createTurnState()
      const template = (turnState.resources.promptTemplates ?? []).find(
        (candidate) => candidate.name === name,
      )
      if (!template)
        throw new AgentHarnessError('invalid_argument', `Unknown prompt template: ${name}`)
      return await this.executeTurn(turnState, formatPromptTemplateInvocation(template, args))
    } catch (error) {
      this.phase = 'idle'
      throw normalizeHarnessError(error, 'unknown')
    } finally {
      finishRunPromise()
    }
  }

  async steer(
    text: string,
    options?: { images?: ImageContent[]; inputId?: string },
  ): Promise<void> {
    if (this.phase === 'idle')
      throw new AgentHarnessError('invalid_state', 'Cannot steer while idle')
    const message = createUserMessage(text, options?.images)
    if (options?.inputId) this.queuedInputIds.set(message, options.inputId)
    this.steerQueue.push(message)
    await this.emitQueueUpdate()
  }

  async followUp(
    text: string,
    options?: { images?: ImageContent[]; inputId?: string },
  ): Promise<void> {
    if (this.phase === 'idle')
      throw new AgentHarnessError('invalid_state', 'Cannot follow up while idle')
    const message = createUserMessage(text, options?.images)
    if (options?.inputId) this.queuedInputIds.set(message, options.inputId)
    this.followUpQueue.push(message)
    await this.emitQueueUpdate()
  }

  async nextTurn(
    text: string,
    options?: { images?: ImageContent[]; inputId?: string },
  ): Promise<void> {
    const message = createUserMessage(text, options?.images)
    if (options?.inputId) this.queuedInputIds.set(message, options.inputId)
    this.nextTurnQueue.push(message)
    await this.emitQueueUpdate()
  }

  async appendMessage(message: AgentMessage): Promise<void> {
    try {
      if (this.phase === 'idle') {
        await this.session.appendMessage(message)
      } else {
        this.pendingSessionWrites.push({ type: 'message', message })
      }
    } catch (error) {
      throw normalizeHarnessError(error, 'session')
    }
  }

  async compact(customInstructions?: string): Promise<CompactResult> {
    if (this.phase !== 'idle')
      throw new AgentHarnessError('busy', 'compact() requires idle harness')
    this.phase = 'compaction'
    try {
      const model = this.model
      if (!model) throw new AgentHarnessError('invalid_state', 'No model set for compaction')
      const branchEntries = await this.session.getBranch()
      const preparationResult = prepareCompaction(branchEntries, DEFAULT_COMPACTION_SETTINGS)
      if (!preparationResult.ok) throw preparationResult.error
      const preparation = preparationResult.value
      if (!preparation) throw new AgentHarnessError('compaction', 'Nothing to compact')
      const hookResult = await this.emitHook({
        type: 'session_before_compact',
        preparation,
        branchEntries,
        customInstructions,
        signal: new AbortController().signal,
      })
      if (hookResult?.cancel) throw new AgentHarnessError('compaction', 'Compaction cancelled')
      const provided = hookResult?.compaction
      const compactResult = provided
        ? { ok: true as const, value: provided }
        : await compact(
            preparation,
            this.models,
            model,
            customInstructions,
            undefined,
            this.thinkingLevel,
            this.retry,
            this.retryCallbacks('compaction'),
          )
      if (!compactResult.ok) throw compactResult.error
      const result = compactResult.value
      const entryId = await this.session.appendCompaction(
        result.summary,
        result.firstKeptEntryId,
        result.tokensBefore,
        result.details,
        provided !== undefined,
        result.usage,
        result.retainedTail,
      )
      const entry = await this.session.getEntry(entryId)
      if (entry?.type === 'compaction') {
        await this.emitOwn({
          type: 'session_compact',
          compactionEntry: entry,
          fromHook: provided !== undefined,
        })
      }
      return result
    } catch (error) {
      throw normalizeHarnessError(error, 'compaction')
    } finally {
      this.phase = 'idle'
    }
  }

  async navigateTree(
    targetId: string,
    options?: {
      summarize?: boolean
      customInstructions?: string
      replaceInstructions?: boolean
      label?: string
    },
  ): Promise<NavigateTreeResult> {
    if (this.phase !== 'idle')
      throw new AgentHarnessError('busy', 'navigateTree() requires idle harness')
    this.phase = 'branch_summary'
    try {
      const oldLeafId = await this.session.getLeafId()
      if (oldLeafId === targetId) return { cancelled: false }
      const targetEntry = await this.session.getEntry(targetId)
      if (!targetEntry)
        throw new AgentHarnessError('invalid_argument', `Entry ${targetId} not found`)
      const { entries, commonAncestorId } = await collectEntriesForBranchSummary(
        this.session,
        oldLeafId,
        targetId,
      )
      const preparation = {
        targetId,
        oldLeafId,
        commonAncestorId,
        entriesToSummarize: entries,
        userWantsSummary: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      }
      const signal = new AbortController().signal
      const hookResult = await this.emitHook({ type: 'session_before_tree', preparation, signal })
      if (hookResult?.cancel) return { cancelled: true }
      let summaryEntry: NavigateTreeResult['summaryEntry']
      let summaryText: string | undefined = hookResult?.summary?.summary
      let summaryDetails: unknown = hookResult?.summary?.details
      let summaryUsage = hookResult?.summary?.usage
      if (!summaryText && options?.summarize && entries.length > 0) {
        const model = this.model
        if (!model) throw new AgentHarnessError('invalid_state', 'No model set for branch summary')
        const customInstructions = hookResult?.customInstructions ?? options?.customInstructions
        const replaceInstructions = hookResult?.replaceInstructions ?? options?.replaceInstructions
        const branchSummary = await generateBranchSummary(entries, {
          models: this.models,
          model,
          signal: new AbortController().signal,
          ...(customInstructions !== undefined ? { customInstructions } : {}),
          ...(replaceInstructions !== undefined ? { replaceInstructions } : {}),
          ...(this.retry !== undefined ? { retry: this.retry } : {}),
          callbacks: this.retryCallbacks('branch_summary'),
        })
        if (!branchSummary.ok) {
          if (branchSummary.error.code === 'aborted') return { cancelled: true }
          throw new AgentHarnessError(
            'branch_summary',
            branchSummary.error.message,
            branchSummary.error,
          )
        }
        summaryText = branchSummary.value.summary
        summaryUsage = branchSummary.value.usage
        summaryDetails = {
          readFiles: branchSummary.value.readFiles,
          modifiedFiles: branchSummary.value.modifiedFiles,
        }
      }
      let editorText: string | undefined
      let newLeafId: string | null
      if (targetEntry.type === 'message' && targetEntry.message.role === 'user') {
        newLeafId = targetEntry.parentId
        editorText = contentText(targetEntry.message.content, '')
      } else if (targetEntry.type === 'custom_message') {
        newLeafId = targetEntry.parentId
        editorText = contentText(targetEntry.content, '')
      } else {
        newLeafId = targetId
      }
      const summaryId = await this.session.moveTo(
        newLeafId,
        summaryText
          ? {
              summary: summaryText,
              details: summaryDetails,
              ...(summaryUsage !== undefined ? { usage: summaryUsage } : {}),
              fromHook: hookResult?.summary !== undefined,
            }
          : undefined,
      )
      // The selected branch may carry a different active_tools_change state.
      // Re-resolve it before the next provider request.
      this.restoredActiveTools = false
      if (summaryId) {
        const entry = await this.session.getEntry(summaryId)
        if (entry?.type === 'branch_summary') summaryEntry = entry
      }
      await this.emitOwn({
        type: 'session_tree',
        newLeafId: await this.session.getLeafId(),
        oldLeafId,
        summaryEntry,
        fromHook: hookResult?.summary !== undefined,
      })
      return { cancelled: false, editorText, summaryEntry }
    } catch (error) {
      throw normalizeHarnessError(error, 'branch_summary')
    } finally {
      this.phase = 'idle'
    }
  }

  getModel(): Model<any> {
    return this.model
  }

  async setModel(model: Model<any>): Promise<void> {
    try {
      const previousModel = this.model
      if (this.phase === 'idle') {
        await this.session.appendModelChange(model.provider, model.id)
      } else {
        this.pendingSessionWrites.push({
          type: 'model_change',
          provider: model.provider,
          modelId: model.id,
        })
      }
      this.model = model
      await this.emitOwn({ type: 'model_update', model, previousModel, source: 'set' })
    } catch (error) {
      throw normalizeHarnessError(error, 'session')
    }
  }

  getThinkingLevel(): ThinkingLevel {
    return this.thinkingLevel
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    try {
      const previousLevel = this.thinkingLevel
      if (this.phase === 'idle') {
        await this.session.appendThinkingLevelChange(level)
      } else {
        this.pendingSessionWrites.push({ type: 'thinking_level_change', thinkingLevel: level })
      }
      this.thinkingLevel = level
      await this.emitOwn({ type: 'thinking_level_update', level, previousLevel })
    } catch (error) {
      throw normalizeHarnessError(error, 'session')
    }
  }

  getTools(): TTool[] {
    return [...this.tools.values()]
  }

  async setTools(tools: TTool[], activeToolNames?: string[]): Promise<void> {
    try {
      this.validateUniqueNames(
        tools.map((tool) => tool.name),
        'Duplicate tool name(s)',
      )
      const nextTools = new Map(tools.map((tool) => [tool.name, tool]))
      const nextActiveToolNames = activeToolNames ? [...activeToolNames] : this.activeToolNames
      const missing = nextActiveToolNames.filter((name) => !nextTools.has(name))
      if (missing.length > 0) {
        if (!this.deferredToolCatalog)
          throw new AgentHarnessError('invalid_argument', `Unknown tool(s): ${missing.join(', ')}`)
        for (const tool of await this.deferredToolCatalog.activate(missing))
          nextTools.set(tool.name, tool)
      }
      this.validateToolNames(nextActiveToolNames, nextTools)
      const previousToolNames = [...this.tools.keys()]
      const previousActiveToolNames = [...this.activeToolNames]
      if (this.phase === 'idle') {
        await this.session.appendActiveToolsChange(nextActiveToolNames)
      } else {
        this.pendingSessionWrites.push({
          type: 'active_tools_change',
          activeToolNames: [...nextActiveToolNames],
        })
      }
      this.tools = nextTools
      this.activeToolNames = [...nextActiveToolNames]
      await this.emitOwn({
        type: 'tools_update',
        toolNames: [...this.tools.keys()],
        previousToolNames,
        activeToolNames: [...this.activeToolNames],
        previousActiveToolNames,
        source: 'set',
      })
    } catch (error) {
      throw normalizeHarnessError(error, 'invalid_argument')
    }
  }

  getActiveTools(): TTool[] {
    return this.activeToolNames
      .map((name) => this.tools.get(name))
      .filter((tool): tool is TTool => tool !== undefined)
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    try {
      await this.loadDeferredTools(toolNames)
      this.validateToolNames(toolNames)
      const previousToolNames = [...this.tools.keys()]
      const previousActiveToolNames = [...this.activeToolNames]
      if (this.phase === 'idle') {
        await this.session.appendActiveToolsChange(toolNames)
      } else {
        this.pendingSessionWrites.push({
          type: 'active_tools_change',
          activeToolNames: [...toolNames],
        })
      }
      this.activeToolNames = [...toolNames]
      await this.emitOwn({
        type: 'tools_update',
        toolNames: [...this.tools.keys()],
        previousToolNames,
        activeToolNames: [...this.activeToolNames],
        previousActiveToolNames,
        source: 'set',
      })
    } catch (error) {
      throw normalizeHarnessError(error, 'invalid_argument')
    }
  }

  /** Resolve deferred tools by exact name and add them to the active set. */
  async activateTools(toolNames: string[]): Promise<void> {
    const activation = this.activationQueue.then(async () => {
      const nextActiveToolNames = [...this.activeToolNames]
      let changed = false
      for (const name of toolNames) {
        if (!nextActiveToolNames.includes(name)) {
          nextActiveToolNames.push(name)
          changed = true
        }
      }
      if (!changed) return
      await this.setActiveTools(nextActiveToolNames)
    })
    this.activationQueue = activation.catch(() => undefined)
    await activation
  }

  getActiveToolNames(): string[] {
    return [...this.activeToolNames]
  }

  setToolExecution(mode: import('./AgentTypes.ts').ToolExecutionMode): void {
    this.toolExecution = mode
  }

  getSteeringMode(): QueueMode {
    return this.steeringQueueMode
  }

  async setSteeringMode(mode: QueueMode): Promise<void> {
    this.steeringQueueMode = mode
  }

  getFollowUpMode(): QueueMode {
    return this.followUpQueueMode
  }

  async setFollowUpMode(mode: QueueMode): Promise<void> {
    this.followUpQueueMode = mode
  }

  getResources(): AgentHarnessResources<TSkill, TPromptTemplate> {
    return {
      ...(this.resources.skills ? { skills: this.resources.skills.slice() } : {}),
      ...(this.resources.promptTemplates
        ? { promptTemplates: this.resources.promptTemplates.slice() }
        : {}),
    }
  }

  async setResources(resources: AgentHarnessResources<TSkill, TPromptTemplate>): Promise<void> {
    const previousResources = this.getResources()
    this.resources = {
      ...(resources.skills ? { skills: resources.skills.slice() } : {}),
      ...(resources.promptTemplates ? { promptTemplates: resources.promptTemplates.slice() } : {}),
    }
    await this.emitOwn({
      type: 'resources_update',
      resources: this.getResources(),
      previousResources,
    })
  }

  getStreamOptions(): AgentHarnessStreamOptions {
    return cloneStreamOptions(this.streamOptions)
  }

  async setStreamOptions(streamOptions: AgentHarnessStreamOptions): Promise<void> {
    this.streamOptions = cloneStreamOptions(streamOptions)
  }

  async abort(): Promise<AbortResult> {
    const clearedSteer = [...this.steerQueue]
    const clearedFollowUp = [...this.followUpQueue]
    this.steerQueue = []
    this.followUpQueue = []
    this.runAbortController?.abort()
    const errors: Error[] = []
    try {
      await this.emitQueueUpdate()
    } catch (error) {
      errors.push(toError(error))
    }
    try {
      await this.waitForIdle()
    } catch (error) {
      errors.push(toError(error))
    }
    try {
      await this.emitOwn({ type: 'abort', clearedSteer, clearedFollowUp })
    } catch (error) {
      errors.push(toError(error))
    }
    if (errors.length > 0) {
      const cause =
        errors.length === 1 ? errors[0]! : new AggregateError(errors, 'Abort completed with errors')
      throw normalizeHarnessError(cause, 'hook')
    }
    return { clearedSteer, clearedFollowUp }
  }

  async waitForIdle(): Promise<void> {
    await this.runPromise
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent<TSkill, TPromptTemplate>,
      signal?: AbortSignal,
    ) => Promise<void> | void,
  ): () => void {
    let handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE)
    if (!handlers) {
      handlers = new Set()
      this.handlers.set(SUBSCRIBER_EVENT_TYPE, handlers)
    }
    handlers.add(listener as AgentHarnessHandler)
    return () => handlers!.delete(listener as AgentHarnessHandler)
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>,
    ) => Promise<AgentHarnessEventResultMap[TType]> | AgentHarnessEventResultMap[TType],
  ): () => void {
    let handlers = this.handlers.get(type)
    if (!handlers) {
      handlers = new Set()
      this.handlers.set(type, handlers)
    }
    handlers.add(handler as AgentHarnessHandler)
    return () => handlers!.delete(handler as AgentHarnessHandler)
  }
}
