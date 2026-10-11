import type { AgentDatabase } from '../storage/database/AgentDatabase'

export type AgentInputItem = Record<string, any>

export type ContextFragmentKind =
  'mode' | 'permission' | 'settings' | 'project' | 'skill' | 'memory' | 'subagent' | 'plan'

export type ContextFragment = {
  id: string
  kind: ContextFragmentKind
  version: number
  hash: string
  payload: unknown
  createdAt: number
}

export type PromptSessionState = {
  threadID: string
  baselineVersion: number
  promptVersion: string
  baseHash: string
  contextHash: string
  cacheKey: string
  fragments: ContextFragment[]
  contextWindowTokens: number
  usageTokens: number
  usageSource: ContextUsageSource
  usageSampleID: string | null
  needsCompaction: boolean
  autoCompactFailures: number
  autoCompactSuspended: boolean
  createdAt: number
  updatedAt: number
}

export type EstablishBaselineInput = Pick<
  PromptSessionState,
  'threadID' | 'promptVersion' | 'baseHash' | 'contextHash' | 'cacheKey'
> & { fragments?: ContextFragment[] }

export type ContextUsageSource = 'measured' | 'estimated' | 'compaction-estimate'

export type ContextUsageSample = {
  id: string
  threadID: string
  turnID: string | null
  sessionID: string | null
  contextFingerprint: string
  contextWindowTokens: number
  inputTokens: number
  outputTokens: number
  source: ContextUsageSource
  createdAt: number
}

export type ContextBudgetSnapshot = {
  threadID: string
  contextFingerprint: string
  contextWindowTokens: number
  usedTokens: number
  remainingTokens: number
  utilization: number
  triggerTokens: number
  targetTokens: number
  needsCompaction: boolean
  source: ContextUsageSource
  sampleID: string
  sampledAt: number
}

export const CONTEXT_COMPACTION_TRIGGER_RATIO = 0.8
export const CONTEXT_COMPACTION_TARGET_RATIO = 0.55
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

const stableStringify = (value: unknown) => JSON.stringify(canonicalize(value))
const fingerprint = (value: unknown) =>
  new Bun.CryptoHasher('sha256').update(stableStringify(value)).digest('hex')

export const estimateContextTokens = (input: { items: AgentInputItem[]; promptText?: string }) => {
  const bytes = new TextEncoder().encode(
    stableStringify({ items: input.items, promptText: input.promptText ?? '' }),
  ).byteLength
  return Math.max(1, Math.ceil(bytes / 4) + input.items.length * 4)
}

export const contextFingerprint = (input: { items: AgentInputItem[]; promptText?: string }) =>
  fingerprint({ items: input.items, promptText: input.promptText ?? '' })

const thresholds = (contextWindowTokens: number) => ({
  triggerTokens: Math.ceil(contextWindowTokens * CONTEXT_COMPACTION_TRIGGER_RATIO),
  targetTokens: Math.floor(contextWindowTokens * CONTEXT_COMPACTION_TARGET_RATIO),
})

const validateContextWindow = (value: number) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('contextWindowTokens 必须是正整数')
  }
}

export class ContextManager {
  constructor(private readonly db: AgentDatabase) {}

  state(threadID: string) {
    return this.db.repositories.context.state(threadID)
  }

  establishBaseline(input: EstablishBaselineInput) {
    const timestamp = Date.now()
    return this.db.transaction(() => {
      const previous = this.state(input.threadID)
      this.db.repositories.context.establishBaseline({
        threadID: input.threadID,
        baselineVersion: (previous?.baselineVersion ?? 0) + 1,
        promptVersion: input.promptVersion,
        baseHash: input.baseHash,
        contextHash: input.contextHash,
        cacheKey: input.cacheKey,
        fragments: input.fragments ?? [],
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      })
      return this.state(input.threadID)!
    })
  }

  appendFragments(threadID: string, fragments: ContextFragment[], contextHash: string) {
    if (!fragments.length) return this.state(threadID)
    return this.db.transaction(() => {
      const state = this.state(threadID)
      if (!state) throw new Error(`Thread ${threadID} 尚未建立 prompt baseline`)
      const known = new Set(state.fragments.map((fragment) => `${fragment.id}:${fragment.hash}`))
      const added = fragments.filter((fragment) => !known.has(`${fragment.id}:${fragment.hash}`))
      if (!added.length && contextHash === state.contextHash) return state
      // Dynamic prompt diffs do not clear an already scheduled compaction.
      this.db.repositories.context.updateFragments({
        threadID,
        fragments: [...state.fragments, ...added],
        contextHash,
        updatedAt: Date.now(),
      })
      return this.state(threadID)!
    })
  }

  usageSamples(threadID: string, limit = 100) {
    return this.db.repositories.context.usageSamples(threadID, Math.max(1, Math.min(1_000, limit)))
  }

  shouldAutoCompact(threadID: string) {
    const state = this.state(threadID)
    return Boolean(state?.needsCompaction && !state.autoCompactSuspended)
  }

  recordCompactionFailure(threadID: string) {
    return this.db.transaction(() =>
      this.db.repositories.context.recordAutoCompactFailure(threadID, Date.now()),
    )
  }

  private insertUsageSample(input: Omit<ContextUsageSample, 'id' | 'createdAt'>) {
    return this.db.repositories.context.insertUsageSample({
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    })
  }

  private updateBudgetState(
    sample: ContextUsageSample,
    options: { preservePending?: boolean; clearAutoCompactCircuit?: boolean } = {},
  ) {
    const { triggerTokens } = thresholds(sample.contextWindowTokens)
    const pending =
      options.preservePending !== false && Boolean(this.state(sample.threadID)?.needsCompaction)
    const needsCompaction = pending || sample.inputTokens >= triggerTokens
    const changes = this.db.repositories.context.updateBudgetState({
      threadID: sample.threadID,
      contextWindowTokens: sample.contextWindowTokens,
      usageTokens: sample.inputTokens,
      usageSource: sample.source,
      usageSampleID: sample.id,
      needsCompaction,
      clearAutoCompactCircuit: options.clearAutoCompactCircuit ?? false,
      updatedAt: sample.createdAt,
    })
    if (!changes) throw new Error(`Thread ${sample.threadID} 尚未建立 prompt baseline`)
    return needsCompaction
  }

  private budgetSnapshot(sample: ContextUsageSample, needsCompaction: boolean) {
    const { triggerTokens, targetTokens } = thresholds(sample.contextWindowTokens)
    return {
      threadID: sample.threadID,
      contextFingerprint: sample.contextFingerprint,
      contextWindowTokens: sample.contextWindowTokens,
      usedTokens: sample.inputTokens,
      remainingTokens: Math.max(0, sample.contextWindowTokens - sample.inputTokens),
      utilization: sample.inputTokens / sample.contextWindowTokens,
      triggerTokens,
      targetTokens,
      needsCompaction,
      source: sample.source,
      sampleID: sample.id,
      sampledAt: sample.createdAt,
    } satisfies ContextBudgetSnapshot
  }

  recordMeasuredUsage(input: {
    threadID: string
    turnID?: string
    sessionID?: string
    items: AgentInputItem[]
    promptText?: string
    contextWindowTokens: number
    inputTokens: number
    outputTokens?: number
  }) {
    if (!Number.isInteger(input.inputTokens) || input.inputTokens < 0) {
      throw new Error('inputTokens 必须是非负整数')
    }
    if (
      input.outputTokens !== undefined &&
      (!Number.isInteger(input.outputTokens) || input.outputTokens < 0)
    ) {
      throw new Error('outputTokens 必须是非负整数')
    }
    validateContextWindow(input.contextWindowTokens)
    return this.db.transaction(() => {
      const sample = this.insertUsageSample({
        threadID: input.threadID,
        turnID: input.turnID ?? null,
        sessionID: input.sessionID ?? null,
        contextFingerprint: contextFingerprint(input),
        contextWindowTokens: input.contextWindowTokens,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens ?? 0,
        source: 'measured',
      })
      this.updateBudgetState(sample)
      return sample
    })
  }

  recordCompactionEstimate(input: {
    threadID: string
    turnID?: string
    sessionID?: string
    items: AgentInputItem[]
    promptText?: string
    contextWindowTokens?: number
  }): ContextBudgetSnapshot {
    const contextWindowTokens =
      input.contextWindowTokens ??
      this.state(input.threadID)?.contextWindowTokens ??
      DEFAULT_CONTEXT_WINDOW_TOKENS
    const effectiveWindow =
      contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_WINDOW_TOKENS
    validateContextWindow(effectiveWindow)
    return this.db.transaction(() => {
      const sample = this.insertUsageSample({
        threadID: input.threadID,
        turnID: input.turnID ?? null,
        sessionID: input.sessionID ?? null,
        contextFingerprint: contextFingerprint(input),
        contextWindowTokens: effectiveWindow,
        inputTokens: estimateContextTokens(input),
        outputTokens: 0,
        source: 'compaction-estimate',
      })
      const { triggerTokens } = thresholds(effectiveWindow)
      const needsCompaction = this.updateBudgetState(sample, {
        preservePending: false,
        clearAutoCompactCircuit: sample.inputTokens < triggerTokens,
      })
      return this.budgetSnapshot(sample, needsCompaction)
    })
  }

  snapshot(input: {
    threadID: string
    turnID?: string
    sessionID?: string
    items: AgentInputItem[]
    promptText?: string
    contextWindowTokens?: number
  }): ContextBudgetSnapshot {
    const contextWindowTokens =
      input.contextWindowTokens ??
      this.state(input.threadID)?.contextWindowTokens ??
      DEFAULT_CONTEXT_WINDOW_TOKENS
    const effectiveWindow =
      contextWindowTokens > 0 ? contextWindowTokens : DEFAULT_CONTEXT_WINDOW_TOKENS
    validateContextWindow(effectiveWindow)
    const currentFingerprint = contextFingerprint(input)
    return this.db.transaction(() => {
      const measured = this.db.repositories.context.measuredUsage(
        input.threadID,
        currentFingerprint,
      )
      const sample = measured
        ? { ...measured, contextWindowTokens: effectiveWindow }
        : this.insertUsageSample({
            threadID: input.threadID,
            turnID: input.turnID ?? null,
            sessionID: input.sessionID ?? null,
            contextFingerprint: currentFingerprint,
            contextWindowTokens: effectiveWindow,
            inputTokens: estimateContextTokens(input),
            outputTokens: 0,
            source: 'estimated',
          })
      const needsCompaction = this.updateBudgetState(sample)
      return this.budgetSnapshot(sample, needsCompaction)
    })
  }
}
