import type { AgentHarnessEvent } from '../harness/Types'
import type { ToolResultBlock } from '@pidex/shared/thread'
import { decodeResultCardEnvelope } from '@pidex/shared/thread-result-card'
import { ProposedPlanStreamParser, type ProposedPlanChunk } from '../plan/ProposedPlanStreamParser'
import type {
  PiRuntimeEventContext,
  PiRuntimeEventSink,
  PiToolArtifactInput,
  RuntimeCompactionTrigger,
} from './Types'

type ToolResultLike = {
  content?: unknown
  details?: unknown
}

const textContent = (content: unknown): string => {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    })
    .join('\n')
    .trim()
}

const detailText = (details: unknown, key: string): string => {
  if (!details || typeof details !== 'object') return ''
  const value = (details as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

const resultDetails = (value: unknown): unknown =>
  value && typeof value === 'object' ? (value as ToolResultLike).details : undefined

const MAX_BLOCK_TEXT_CHARS = 100_000

/** Safe JSON round-trip used to avoid leaking non-JSON values into blocks. */
const safeJsonValue = (value: unknown): unknown => {
  if (value === undefined) return undefined
  try {
    const text = JSON.stringify(value)
    if (typeof text !== 'string' || text.length > 1_000_000) return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const citationBlocks = (value: unknown): ToolResultBlock[] => {
  if (!Array.isArray(value)) return []
  const blocks: ToolResultBlock[] = []
  for (const citation of value) {
    if (!citation || typeof citation !== 'object' || Array.isArray(citation)) continue
    const record = citation as Record<string, unknown>
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!url) continue
    const title =
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : typeof record.name === 'string' && record.name.trim()
          ? record.name.trim()
          : undefined
    blocks.push({ type: 'citation', ...(title ? { title } : {}), url })
  }
  return blocks
}

const clampTextBlock = (text: string): string =>
  text.length > MAX_BLOCK_TEXT_CHARS ? text.slice(0, MAX_BLOCK_TEXT_CHARS) : text

const jsonBlock = (value: unknown): ToolResultBlock | null => {
  const safe = safeJsonValue(value)
  if (safe === undefined) return null
  return {
    type: 'json',
    value: safe as ToolResultBlock extends { type: 'json' } ? ToolResultBlock['value'] : never,
  }
}

const fallbackTextBlock = (value: unknown): ToolResultBlock | null => {
  if (typeof value === 'string') return { type: 'text', text: clampTextBlock(value) }
  const safe = safeJsonValue(value)
  if (safe === undefined) return null
  return {
    type: 'text',
    text: clampTextBlock(typeof safe === 'string' ? safe : JSON.stringify(safe)),
  }
}

/**
 * Projects Pi's normalized tool result into canonical rich result blocks.
 * Unknown or non-serializable parts degrade to a bounded text block (or are
 * dropped) instead of throwing. Image content becomes an artifact block and a
 * base64 artifact input for the sink to persist under a controlled store.
 */
export const piToolResultBlocks = (
  value: unknown,
): { blocks: ToolResultBlock[]; artifacts: PiToolArtifactInput[] } => {
  const blocks: ToolResultBlock[] = []
  const artifacts: PiToolArtifactInput[] = []
  if (typeof value === 'string') {
    return { blocks: [{ type: 'text', text: clampTextBlock(value) }], artifacts }
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    const fallback = fallbackTextBlock(value)
    return { blocks: fallback ? [fallback] : [], artifacts }
  }
  const result = value as ToolResultLike
  const content = Array.isArray(result.content) ? result.content : []
  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    const record = part as Record<string, unknown>
    const kind = record.type
    if (kind === 'text' && typeof record.text === 'string') {
      blocks.push({ type: 'text', text: clampTextBlock(record.text) })
      const citations = citationBlocks(record.citations)
      if (citations.length) blocks.push(...citations)
      continue
    }
    if (kind === 'image') {
      const mimeType =
        typeof record.mimeType === 'string' && record.mimeType.trim()
          ? record.mimeType.trim()
          : 'application/octet-stream'
      const data = typeof record.data === 'string' ? record.data : ''
      if (!data) continue
      const artifactId = crypto.randomUUID()
      blocks.push({
        type: 'artifact',
        artifactId,
        name:
          typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : `artifact-${artifactId.slice(0, 8)}`,
        mimeType,
        ...(typeof record.size === 'number' && Number.isFinite(record.size) && record.size >= 0
          ? { size: Math.trunc(record.size) }
          : {}),
      })
      artifacts.push({
        artifactId,
        name: `${mimeType.split('/')[0] ?? 'artifact'}-artifact`,
        mimeType,
        data,
      })
      continue
    }
    // Unknown part types degrade safely instead of throwing.
    const fallback = fallbackTextBlock(record)
    if (fallback) blocks.push(fallback)
  }
  // MCP-style structured results are projected as JSON blocks. Mutation
  // `details` stays on the tool item for the existing patch timeline, so it is
  // never duplicated as a JSON block here. A payload carrying the explicit
  // result-card envelope is normalized to its bounded card form; every other
  // payload (including a forged or invalid envelope) keeps the raw JSON value.
  const structured = (result as unknown as { structuredContent?: unknown }).structuredContent
  if (structured !== undefined) {
    const card = decodeResultCardEnvelope(structured)
    const block = jsonBlock(card ?? structured)
    if (block) blocks.push(block)
  }
  return { blocks, artifacts }
}

const usageNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

const assistantMessagePlacement = (content: unknown) =>
  Array.isArray(content) &&
  content.some(
    (part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'toolCall',
  )
    ? ('process' as const)
    : ('result' as const)

/**
 * A tag plan in the same assistant message as a successful structured
 * submission is not authoritative: its buffered chunks are dropped so the
 * turn keeps exactly one plan source.
 */
const hasStructuredPlanSubmission = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some(
    (part) =>
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'toolCall' &&
      (part as { name?: unknown }).name === 'submit_plan',
  )

/** Converts Pi's AgentToolResult wrapper into user-facing semantic text. */
export const piToolResultText = (
  value: unknown,
  options: { tool: string; progress?: boolean },
): string => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (!value || typeof value !== 'object') return String(value)
  const result = value as ToolResultLike
  const message = detailText(result.details, 'message')
  if (options.progress && message) return message
  if (/^(shell|bash|powershell|pwsh|command|exec)/i.test(options.tool)) {
    const output = [detailText(result.details, 'stdout'), detailText(result.details, 'stderr')]
      .filter(Boolean)
      .join('\n')
      .trim()
    if (output) return output
  }
  const content = textContent(result.content)
  if (content) return content
  if (message) return message
  return ''
}

/** Converts Pi's protocol into stable semantic callbacks used by the Agent persistence layer. */
export class PiEventAdapter {
  private beforeCompactionCount: number | undefined
  private assistantItems: {
    textItemID: string
    reasoningItemID: string
    planItemID: string
  } | null = null
  private parser: ProposedPlanStreamParser | null = null
  private receivedTextDelta = false
  private textStarted = false
  private planStarted = false
  private pendingText = ''
  private pendingPlan = ''
  private deferredPlan = ''
  private completedText = ''

  constructor(
    private readonly context: PiRuntimeEventContext,
    private readonly sink: PiRuntimeEventSink,
    private readonly options: {
      parseProposedPlan?: boolean
      resolveSessionEntryID?: () => string | null | Promise<string | null>
      resolveCompactionContext?: () => {
        trigger: RuntimeCompactionTrigger
        promptText: string
      }
    } = {},
  ) {}

  private newAssistantItems() {
    const segmentID = crypto.randomUUID()
    return {
      textItemID: `${this.context.turnID}:pi:text:${segmentID}`,
      reasoningItemID: `${this.context.turnID}:pi:reasoning:${segmentID}`,
      planItemID: `${this.context.turnID}:pi:text:${segmentID}:plan`,
    }
  }

  private resetAssistantMessage() {
    const items = this.newAssistantItems()
    this.assistantItems = items
    this.parser = this.options.parseProposedPlan ? new ProposedPlanStreamParser() : null
    this.receivedTextDelta = false
    this.textStarted = false
    this.planStarted = false
    this.pendingText = ''
    this.pendingPlan = ''
    this.deferredPlan = ''
    return items
  }

  private async ensureAssistantItems(startText = !this.options.parseProposedPlan) {
    if (this.assistantItems) return this.assistantItems
    const items = this.resetAssistantMessage()
    if (startText) await this.startText()
    return items
  }

  private async startText() {
    const items = this.assistantItems ?? this.resetAssistantMessage()
    if (this.textStarted) return
    this.textStarted = true
    await this.sink.assistantMessageStarted?.(this.context, {
      ...items,
      placement: 'process',
    })
  }

  private async routeChunks(chunks: readonly ProposedPlanChunk[], deferPlan = false) {
    const items = await this.ensureAssistantItems(false)
    for (const chunk of chunks) {
      if (chunk.kind === 'text') {
        this.pendingText += chunk.delta
        if (!this.textStarted && /\S/.test(this.pendingText)) await this.startText()
        if (this.textStarted && this.pendingText) {
          await this.sink.textDelta?.(this.context, {
            itemID: items.textItemID,
            delta: this.pendingText,
          })
          this.pendingText = ''
        }
        continue
      }
      // A structured submission in this message decides the plan; the tag block
      // stays buffered until the message ends so it can be dropped entirely.
      if (deferPlan) {
        this.deferredPlan += chunk.delta
        continue
      }
      this.pendingPlan += chunk.delta
      if (!this.planStarted && /\S/.test(this.pendingPlan)) {
        this.planStarted = true
        await this.sink.planStarted?.(this.context, { itemID: items.planItemID })
      }
      if (this.planStarted && this.pendingPlan) {
        await this.sink.planDelta?.(this.context, {
          itemID: items.planItemID,
          delta: this.pendingPlan,
        })
        this.pendingPlan = ''
      }
    }
  }

  /** Emits any buffered tag plan once the message is known not to carry a structured submission. */
  private async flushDeferredPlan() {
    if (!this.deferredPlan) return
    const delta = this.deferredPlan
    this.deferredPlan = ''
    await this.routeChunks([{ kind: 'plan', delta }])
  }

  outputText(content: unknown) {
    return this.options.parseProposedPlan ? this.completedText : textContent(content)
  }

  private completionMetadata(message: unknown) {
    if (!message || typeof message !== 'object') return undefined
    const record = message as Record<string, unknown>
    const stopReason =
      typeof record.stopReason === 'string' && record.stopReason ? record.stopReason : undefined
    if (!stopReason && record.usage == null) return undefined
    const usage =
      record.usage && typeof record.usage === 'object'
        ? (record.usage as unknown as Record<string, unknown>)
        : {}
    const input = usageNumber(usage.input)
    const output = usageNumber(usage.output)
    const total =
      typeof usage.totalTokens === 'number' &&
      Number.isFinite(usage.totalTokens) &&
      usage.totalTokens >= 0
        ? Math.trunc(usage.totalTokens)
        : input + output
    return {
      ...(stopReason ? { stopReason } : {}),
      ...(input > 0 ? { inputTokens: input } : {}),
      ...(output > 0 ? { outputTokens: output } : {}),
      ...(total > 0 ? { totalTokens: total } : {}),
    }
  }

  async handle(event: AgentHarnessEvent) {
    await this.sink.event?.(this.context, event)
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          this.resetAssistantMessage()
          if (!this.options.parseProposedPlan) await this.startText()
        }
        break
      case 'session_before_compact':
        this.beforeCompactionCount =
          event.preparation.messagesToSummarize.length +
          event.preparation.turnPrefixMessages.length +
          event.preparation.retainedTail.length +
          (event.preparation.previousSummary ? 1 : 0)
        break
      case 'message_update': {
        const update = event.assistantMessageEvent
        const items = await this.ensureAssistantItems()
        if (update.type === 'text_delta') {
          this.receivedTextDelta = true
          if (this.parser) await this.routeChunks(this.parser.push(update.delta), true)
          else
            await this.sink.textDelta?.(this.context, {
              itemID: items.textItemID,
              delta: update.delta,
            })
        }
        if (update.type === 'thinking_delta')
          await this.sink.reasoningDelta?.(this.context, {
            itemID: items.reasoningItemID,
            delta: update.delta,
          })
        break
      }
      case 'message_end':
        if (event.message.role === 'assistant') {
          const items = await this.ensureAssistantItems(false)
          const usage =
            event.message.usage && typeof event.message.usage === 'object'
              ? (event.message.usage as unknown as Record<string, unknown>)
              : {}
          const completion = {
            placement: assistantMessagePlacement(event.message.content),
            provider: typeof event.message.provider === 'string' ? event.message.provider : '',
            api: typeof event.message.api === 'string' ? event.message.api : '',
            model:
              typeof event.message.responseModel === 'string'
                ? event.message.responseModel
                : typeof event.message.model === 'string'
                  ? event.message.model
                  : '',
            usage: {
              input: usageNumber(usage.input),
              output: usageNumber(usage.output),
              cacheRead: usageNumber(usage.cacheRead),
              cacheWrite: usageNumber(usage.cacheWrite),
              reasoning: usageNumber(usage.reasoning),
            },
          }
          const safeCompletion = this.completionMetadata(event.message)
          const resolvedEntryID =
            completion.placement === 'result' ? await this.options.resolveSessionEntryID?.() : null
          const sessionEntry =
            typeof resolvedEntryID === 'string' && resolvedEntryID
              ? { sessionEntryID: resolvedEntryID }
              : {}
          if (this.parser) {
            if (!this.receivedTextDelta)
              await this.routeChunks(this.parser.push(textContent(event.message.content)), true)
            const parsed = this.parser.finish()
            await this.routeChunks(parsed.chunks, true)
            // A successful structured submission makes the tag block redundant:
            // drop the buffered tag plan instead of persisting a second source.
            const structuredSubmission = hasStructuredPlanSubmission(event.message.content)
            if (!structuredSubmission) await this.flushDeferredPlan()
            this.completedText = parsed.text
            await this.sink.assistantMessageCompleted?.(this.context, {
              ...items,
              content: event.message.content,
              text: parsed.text,
              plan: structuredSubmission ? null : parsed.plan,
              ...(safeCompletion ? { completion: safeCompletion } : {}),
              ...sessionEntry,
              ...completion,
            })
          } else {
            this.completedText = textContent(event.message.content)
            await this.sink.assistantMessageCompleted?.(this.context, {
              ...items,
              content: event.message.content,
              ...(safeCompletion ? { completion: safeCompletion } : {}),
              ...sessionEntry,
              ...completion,
            })
          }
          this.assistantItems = null
          this.parser = null
        }
        break
      case 'tool_execution_start':
        await this.sink.toolStarted?.(this.context, {
          toolCallID: event.toolCallId,
          tool: event.toolName,
          input: event.args,
        })
        break
      case 'tool_execution_update':
        await this.sink.toolUpdated?.(this.context, {
          toolCallID: event.toolCallId,
          tool: event.toolName,
          update: piToolResultText(event.partialResult, { tool: event.toolName, progress: true }),
        })
        break
      case 'tool_execution_end': {
        const { blocks, artifacts } = piToolResultBlocks(event.result)
        await this.sink.toolFinished?.(this.context, {
          toolCallID: event.toolCallId,
          tool: event.toolName,
          result: piToolResultText(event.result, { tool: event.toolName }),
          details: resultDetails(event.result),
          isError: event.isError,
          ...(blocks.length ? { resultBlocks: blocks } : {}),
          ...(artifacts.length ? { artifactInputs: artifacts } : {}),
        })
        break
      }
      case 'queue_update':
        await this.sink.queueUpdated?.(this.context, {
          steer: event.steer.length,
          followUp: event.followUp.length,
          nextTurn: event.nextTurn.length,
        })
        break
      case 'queue_consumed':
        await this.sink.queueConsumed?.(this.context, {
          delivery: event.delivery,
          inputIDs: event.inputIds,
        })
        break
      case 'session_compact': {
        const compaction = this.options.resolveCompactionContext?.() ?? {
          trigger: 'manual' as const,
          promptText: '',
        }
        await this.sink.compacted?.(this.context, {
          entryID: event.compactionEntry.id,
          summary: event.compactionEntry.summary,
          firstKeptEntryID: event.compactionEntry.firstKeptEntryId ?? null,
          tokensBefore: event.compactionEntry.tokensBefore,
          beforeCount: this.beforeCompactionCount ?? 0,
          trigger: compaction.trigger,
          promptText: compaction.promptText,
        })
        this.beforeCompactionCount = undefined
        break
      }
      case 'save_point':
        await this.sink.savePoint?.(this.context, {
          hadPendingMutations: event.hadPendingMutations,
        })
        break
      case 'settled':
        await this.sink.settled?.(this.context, { nextTurnCount: event.nextTurnCount })
        break
      case 'abort':
        await this.sink.aborted?.(this.context)
        break
    }
  }
}
