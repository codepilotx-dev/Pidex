import {
  type AssistantMessage,
  type Context,
  contentText,
  type ImageContent,
  type Model,
  type Models,
  type RetryCallbacks,
  type RetryPolicy,
  retryAssistantCall,
  type SimpleStreamOptions,
  type TextContent,
  type Usage,
  uuidv7,
} from '@earendil-works/pi-ai'
import type { AgentMessage, ThinkingLevel } from '../../orchestration/harness/AgentTypes.ts'
import {
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
} from '../../orchestration/harness/Messages.ts'
import { buildSessionContext } from '../../storage/pi-session/Session.ts'
import {
  type CompactionEntry,
  CompactionError,
  err,
  ok,
  type Result,
  type SessionTreeEntry,
} from '../../orchestration/harness/Types.ts'
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from './CompactionUtils.ts'

/** File-operation details stored on generated compaction entries. */
export interface CompactionDetails {
  /** Files read in the compacted history. */
  readFiles: string[]
  /** Files modified in the compacted history. */
  modifiedFiles: string[]
}
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    return '[unserializable]'
  }
}

function extractFileOperations(
  messages: AgentMessage[],
  entries: SessionTreeEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps()
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry
    if (!prevCompaction.fromHook && prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) fileOps.read.add(f)
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) fileOps.edited.add(f)
      }
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps)
  }

  return fileOps
}
function getMessageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
  if (entry.type === 'message') {
    return entry.message as AgentMessage
  }
  if (entry.type === 'custom_message') {
    return createCustomMessage(
      entry.customType,
      entry.content as string | (TextContent | ImageContent)[],
      entry.display,
      entry.details,
      entry.timestamp,
    )
  }
  if (entry.type === 'branch_summary') {
    return createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)
  }
  if (entry.type === 'compaction') {
    return createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)
  }
  return undefined
}

function getMessageFromEntryForCompaction(entry: SessionTreeEntry): AgentMessage | undefined {
  if (entry.type === 'compaction') {
    return undefined
  }
  return getMessageFromEntry(entry)
}

/** Generated compaction data ready to be persisted as a compaction entry. */
export interface CompactionResult<T = unknown> {
  /** Summary text that replaces compacted history in future context. */
  summary: string
  /** Entry id where retained history starts. Optional during Pi 2.0 transition. */
  firstKeptEntryId?: string
  /** Estimated context tokens before compaction. */
  tokensBefore: number
  /** Usage from the LLM call(s) that generated this summary, if available. */
  usage?: Usage
  /** Retained recent messages stored directly on the compaction entry. Optional during Pi 2.0 transition. */
  retainedTail?: AgentMessage[]
  /** Optional implementation-specific details stored with the compaction entry. */
  details?: T
}

export async function completeSimpleWithRetries(
  models: Models,
  model: Model<any>,
  context: Context,
  options: SimpleStreamOptions,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
  // Summaries are standalone requests, so isolate routing and avoid cache writes that cannot be reused.
  const requestOptions: SimpleStreamOptions = {
    ...options,
    cacheRetention: 'none',
    sessionId: uuidv7(),
  }
  return retryAssistantCall(
    () => models.completeSimple(model, context, requestOptions),
    retry,
    requestOptions.signal,
    callbacks,
  )
}

function combineUsage(first: Usage, second: Usage): Usage {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    ...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
      ? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
      : {}),
    ...(first.reasoning !== undefined || second.reasoning !== undefined
      ? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
      : {}),
    totalTokens: first.totalTokens + second.totalTokens,
    cost: {
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total,
    },
  }
}

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic compaction decisions. */
  enabled: boolean
  /** Tokens reserved for summary prompt and output. */
  reserveTokens: number
  /** Approximate recent-context tokens to keep after compaction. */
  keepRecentTokens: number
}

/** Default compaction settings used by the harness. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
}

/** Calculate total context tokens from provider usage. */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite
}
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === 'assistant' && 'usage' in msg) {
    const assistantMsg = msg as AssistantMessage
    if (
      assistantMsg.stopReason !== 'aborted' &&
      assistantMsg.stopReason !== 'error' &&
      assistantMsg.usage &&
      calculateContextTokens(assistantMsg.usage) > 0
    ) {
      return assistantMsg.usage
    }
  }
  return undefined
}

/** Return usage from the last valid assistant message in session entries. */
export function getLastAssistantUsage(entries: SessionTreeEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.type === 'message') {
      const usage = getAssistantUsage(entry.message as AgentMessage)
      if (usage) return usage
    }
  }
  return undefined
}

/** Estimated context-token usage for a message list. */
export interface ContextUsageEstimate {
  /** Estimated total context tokens. */
  tokens: number
  /** Tokens reported by the most recent assistant usage block. */
  usageTokens: number
  /** Estimated tokens after the most recent assistant usage block. */
  trailingTokens: number
  /** Index of the message that provided usage, or null when none exists. */
  lastUsageIndex: number | null
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message) continue
    const usage = getAssistantUsage(message)
    if (usage) return { usage, index: i }
  }
  return undefined
}

/** Estimate context tokens for messages using provider usage when available. */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages)

  if (!usageInfo) {
    let estimated = 0
    for (const message of messages) {
      estimated += estimateTokens(message)
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    }
  }

  const usageTokens = calculateContextTokens(usageInfo.usage)
  let trailingTokens = 0
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    const message = messages[i]
    if (message) trailingTokens += estimateTokens(message)
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  }
}

/** Return whether context usage exceeds the configured compaction threshold. */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) return false
  return contextTokens > contextWindow - settings.reserveTokens
}

const ESTIMATED_IMAGE_CHARS = 4800

function estimateTextAndImageContentChars(
  content: string | Array<{ type: string; text?: string }>,
): number {
  if (typeof content === 'string') {
    return content.length
  }

  let chars = 0
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      chars += block.text.length
    } else if (block.type === 'image') {
      chars += ESTIMATED_IMAGE_CHARS
    }
  }
  return chars
}

/**
 * Count the context-bearing characters of one message. Images count as a fixed
 * budget instead of their base64 length, so they cannot dominate the metric.
 */
export function estimateMessageChars(message: AgentMessage): number {
  switch (message.role) {
    case 'user': {
      return estimateTextAndImageContentChars(
        (message as { content: string | Array<{ type: string; text?: string }> }).content,
      )
    }
    case 'assistant': {
      const assistant = message as AssistantMessage
      let chars = 0
      for (const block of assistant.content) {
        if (block.type === 'text') {
          chars += block.text.length
        } else if (block.type === 'thinking') {
          chars += block.thinking.length
        } else if (block.type === 'toolCall') {
          chars += block.name.length + safeJsonStringify(block.arguments).length
        }
      }
      return chars
    }
    case 'custom':
    case 'toolResult': {
      return estimateTextAndImageContentChars(message.content)
    }
    case 'bashExecution': {
      return message.command.length + message.output.length
    }
    case 'branchSummary':
    case 'compactionSummary': {
      return message.summary.length
    }
  }

  return 0
}

/** Estimate token count for one message using a conservative character heuristic. */
export function estimateTokens(message: AgentMessage): number {
  return Math.ceil(estimateMessageChars(message) / 4)
}
function findValidCutPoints(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = []
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i]
    if (!entry) continue
    switch (entry.type) {
      case 'message': {
        const role = entry.message.role
        switch (role) {
          case 'bashExecution':
          case 'custom':
          case 'branchSummary':
          case 'compactionSummary':
          case 'user':
          case 'assistant':
            cutPoints.push(i)
            break
          case 'toolResult':
            break
        }
        break
      }
      case 'thinking_level_change':
      case 'model_change':
      case 'active_tools_change':
      case 'compaction':
      case 'branch_summary':
      case 'custom':
      case 'custom_message':
      case 'label':
      case 'session_info':
      case 'leaf':
        break
    }
    if (entry.type === 'branch_summary' || entry.type === 'custom_message') {
      cutPoints.push(i)
    }
  }
  return cutPoints
}

/** Find the user-visible message that starts the turn containing an entry. */
export function findTurnStartIndex(
  entries: SessionTreeEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.type === 'branch_summary' || entry.type === 'custom_message') {
      return i
    }
    if (entry.type === 'message') {
      const role = entry.message.role
      if (role === 'user' || role === 'bashExecution') {
        return i
      }
    }
  }
  return -1
}

/** Cut point selected for compaction. */
export interface CutPointResult {
  /** Index of the first entry retained after compaction. */
  firstKeptEntryIndex: number
  /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
  turnStartIndex: number
  /** Whether the selected cut point splits an in-progress turn. */
  isSplitTurn: boolean
}

/** Find the compaction cut point that keeps approximately the requested recent-token budget. */
export function findCutPoint(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex)

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false }
  }
  let accumulatedTokens = 0
  let cutIndex = cutPoints[0]!

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.type !== 'message') continue
    const messageTokens = estimateTokens(entry.message as AgentMessage)
    accumulatedTokens += messageTokens
    if (accumulatedTokens >= keepRecentTokens) {
      for (let c = 0; c < cutPoints.length; c++) {
        const candidate = cutPoints[c]
        if (candidate !== undefined && candidate >= i) {
          cutIndex = candidate
          break
        }
      }
      break
    }
  }
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1]
    if (!prevEntry) break
    if (prevEntry.type === 'compaction') {
      break
    }
    if (prevEntry.type === 'message') {
      break
    }
    cutIndex--
  }
  const cutEntry = entries[cutIndex]
  const isUserMessage = cutEntry?.type === 'message' && cutEntry.message.role === 'user'
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex)

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  }
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

/** Generate or update a conversation summary for compaction. */
export async function generateSummary(
  currentMessages: AgentMessage[],
  models: Models,
  model: Model<any>,
  reserveTokens: number,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
): Promise<Result<string, CompactionError>> {
  const result = await generateSummaryWithUsage(
    currentMessages,
    models,
    model,
    reserveTokens,
    signal,
    customInstructions,
    previousSummary,
    thinkingLevel,
    retry,
    callbacks,
  )
  return result.ok ? ok(result.value.text) : err(result.error)
}

/** Generate or update a conversation summary and return its provider usage. */
export async function generateSummaryWithUsage(
  currentMessages: AgentMessage[],
  models: Models,
  model: Model<any>,
  reserveTokens: number,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
): Promise<Result<{ text: string; usage: Usage }, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  )
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`
  }
  const llmMessages = convertToLlm(currentMessages)
  const conversationText = serializeConversation(llmMessages)
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`
  }
  promptText += basePrompt

  const summarizationMessages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
      timestamp: Date.now(),
    },
  ]

  const completionOptions =
    model.reasoning && thinkingLevel && thinkingLevel !== 'off'
      ? { maxTokens, ...(signal ? { signal } : {}), reasoning: thinkingLevel }
      : { maxTokens, ...(signal ? { signal } : {}) }

  const response = await completeSimpleWithRetries(
    models,
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    completionOptions,
    retry,
    callbacks,
  )
  if (response.stopReason === 'aborted') {
    return err(new CompactionError('aborted', response.errorMessage || 'Summarization aborted'))
  }
  if (response.stopReason === 'error') {
    return err(
      new CompactionError(
        'summarization_failed',
        `Summarization failed: ${response.errorMessage || 'Unknown error'}`,
      ),
    )
  }

  const textContent = contentText(response.content)

  return ok({ text: textContent, usage: response.usage })
}

/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
  /** Entry id where retained history starts. */
  firstKeptEntryId: string
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[]
  /** Prefix messages summarized separately when compaction splits a turn. */
  turnPrefixMessages: AgentMessage[]
  /** Recent messages retained after compaction and stored on the compaction entry. */
  retainedTail: AgentMessage[]
  /** Whether compaction splits a turn. */
  isSplitTurn: boolean
  /** Estimated context tokens before compaction. */
  tokensBefore: number
  /** Previous compaction summary used for iterative updates. */
  previousSummary?: string
  /** File operations extracted from summarized history. */
  fileOps: FileOperations
  /** Settings used to prepare compaction. */
  settings: CompactionSettings
}

/** Prepare session entries for compaction, or return undefined when compaction is not applicable. */
export function prepareCompaction(
  pathEntries: SessionTreeEntry[],
  settings: CompactionSettings,
): Result<CompactionPreparation | undefined, CompactionError> {
  if (pathEntries.length === 0 || pathEntries.at(-1)?.type === 'compaction') {
    return ok(undefined)
  }

  let prevCompactionIndex = -1
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i]?.type === 'compaction') {
      prevCompactionIndex = i
      break
    }
  }

  let previousSummary: string | undefined
  let boundaryStart = 0
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry
    previousSummary = prevCompaction.summary
    const firstKeptEntryIndex = prevCompaction.firstKeptEntryId
      ? pathEntries.findIndex((entry) => entry.id === prevCompaction.firstKeptEntryId)
      : -1
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1
  }
  const boundaryEnd = pathEntries.length

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens

  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens)
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex]
  if (!firstKeptEntry?.id) {
    return err(
      new CompactionError(
        'invalid_session',
        'First kept entry has no UUID - session may need migration',
      ),
    )
  }
  const firstKeptEntryId = firstKeptEntry.id

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex
  const messagesToSummarize: AgentMessage[] = []
  for (let i = boundaryStart; i < historyEnd; i++) {
    const entry = pathEntries[i]
    if (!entry) continue
    const msg = getMessageFromEntryForCompaction(entry)
    if (msg) messagesToSummarize.push(msg)
  }
  const turnPrefixMessages: AgentMessage[] = []
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      const entry = pathEntries[i]
      if (!entry) continue
      const msg = getMessageFromEntryForCompaction(entry)
      if (msg) turnPrefixMessages.push(msg)
    }
  }
  const retainedTail: AgentMessage[] = []
  for (let i = cutPoint.firstKeptEntryIndex; i < boundaryEnd; i++) {
    const entry = pathEntries[i]
    if (!entry) continue
    const msg = getMessageFromEntryForCompaction(entry)
    if (msg) retainedTail.push(msg)
  }
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex)
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps)
    }
  }

  return ok({
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    retainedTail,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    ...(previousSummary !== undefined ? { previousSummary } : {}),
    fileOps,
    settings,
  })
}

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`

export { serializeConversation } from './CompactionUtils.ts'

/** Generate compaction summary data from prepared session history. */
export async function compact(
  preparation: CompactionPreparation,
  models: Models,
  model: Model<any>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
): Promise<Result<CompactionResult, CompactionError>> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    retainedTail,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    fileOps,
    settings,
  } = preparation

  if (!firstKeptEntryId) {
    return err(
      new CompactionError(
        'invalid_session',
        'First kept entry has no UUID - session may need migration',
      ),
    )
  }

  let summary: string
  let summaryUsage: Usage

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    let historyText = 'No prior history.'
    let historyUsage: Usage | undefined
    if (messagesToSummarize.length > 0) {
      const historyResult = await generateSummaryWithUsage(
        messagesToSummarize,
        models,
        model,
        settings.reserveTokens,
        signal,
        customInstructions,
        previousSummary,
        thinkingLevel,
        retry,
        callbacks,
      )
      if (!historyResult.ok) return err(historyResult.error)
      historyText = historyResult.value.text
      historyUsage = historyResult.value.usage
    }
    const turnPrefixResult = await generateTurnPrefixSummary(
      turnPrefixMessages,
      models,
      model,
      settings.reserveTokens,
      signal,
      thinkingLevel,
      retry,
      callbacks,
    )
    if (!turnPrefixResult.ok) return err(turnPrefixResult.error)
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.value.text}`
    summaryUsage = historyUsage
      ? combineUsage(historyUsage, turnPrefixResult.value.usage)
      : turnPrefixResult.value.usage
  } else {
    const summaryResult = await generateSummaryWithUsage(
      messagesToSummarize,
      models,
      model,
      settings.reserveTokens,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      retry,
      callbacks,
    )
    if (!summaryResult.ok) return err(summaryResult.error)
    summary = summaryResult.value.text
    summaryUsage = summaryResult.value.usage
  }

  const { readFiles, modifiedFiles } = computeFileLists(fileOps)
  summary += formatFileOperations(readFiles, modifiedFiles)

  return ok({
    summary,
    firstKeptEntryId,
    tokensBefore,
    usage: summaryUsage,
    retainedTail,
    details: { readFiles, modifiedFiles } as CompactionDetails,
  })
}
async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  models: Models,
  model: Model<any>,
  reserveTokens: number,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  retry?: RetryPolicy,
  callbacks?: RetryCallbacks,
): Promise<Result<{ text: string; usage: Usage }, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.5 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  )
  const llmMessages = convertToLlm(messages)
  const conversationText = serializeConversation(llmMessages)
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`
  const summarizationMessages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: promptText }],
      timestamp: Date.now(),
    },
  ]

  const completionOptions =
    model.reasoning && thinkingLevel && thinkingLevel !== 'off'
      ? { maxTokens, ...(signal ? { signal } : {}), reasoning: thinkingLevel }
      : { maxTokens, ...(signal ? { signal } : {}) }
  const response = await completeSimpleWithRetries(
    models,
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    completionOptions,
    retry,
    callbacks,
  )
  if (response.stopReason === 'aborted') {
    return err(
      new CompactionError('aborted', response.errorMessage || 'Turn prefix summarization aborted'),
    )
  }
  if (response.stopReason === 'error') {
    return err(
      new CompactionError(
        'summarization_failed',
        `Turn prefix summarization failed: ${response.errorMessage || 'Unknown error'}`,
      ),
    )
  }

  return ok({
    text: contentText(response.content),
    usage: response.usage,
  })
}
