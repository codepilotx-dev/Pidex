import type { ContextBudget } from '@pidex/shared/thread'
import type { Context, Model } from '@earendil-works/pi-ai'
import { estimateTokens, calculateContextTokens } from './harness/Compaction'

export const CONTEXT_SAFETY_TOKENS = 4096
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000

export function contextBudget(
  model: Pick<Model<any>, 'contextWindow' | 'maxTokens'> & { maxInputTokens?: number },
) {
  const contextWindowTokens = model.contextWindow || DEFAULT_CONTEXT_WINDOW_TOKENS
  const outputReserveTokens = model.maxTokens
  const inputBudgetTokens = Math.min(
    model.maxInputTokens ?? contextWindowTokens,
    contextWindowTokens - outputReserveTokens - CONTEXT_SAFETY_TOKENS,
  )
  if (
    ![contextWindowTokens, outputReserveTokens, inputBudgetTokens].every(
      (n) => Number.isInteger(n) && n > 0,
    )
  ) {
    throw new Error('模型输入与输出额度没有可用的上下文空间，请检查模型配置')
  }
  const triggerTokens = Math.min(Math.ceil(contextWindowTokens * 0.8), inputBudgetTokens)
  return {
    contextWindowTokens,
    outputReserveTokens,
    inputBudgetTokens,
    triggerTokens,
    targetTokens: Math.min(Math.floor(contextWindowTokens * 0.55), triggerTokens - 1),
  }
}

const hash = (value: unknown) =>
  new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
export type ContextUsageAnchor = {
  identity: string
  messageHashes: string[]
  tokens: number
}

/** Only hashes and counters cross the storage boundary; no prompt or media payloads. */
export class RequestContextUsage {
  private anchor: ContextUsageAnchor | null
  constructor(anchor: ContextUsageAnchor | null = null) {
    this.anchor = anchor
  }
  invalidate() {
    this.anchor = null
  }
  fixedTokens(context: Context) {
    return Math.ceil(
      new TextEncoder().encode(JSON.stringify([context.systemPrompt, context.tools])).length / 4,
    )
  }
  identity(model: Model<any>, context: Context, generation: string) {
    return hash([model.provider, model.id, generation, context.systemPrompt, context.tools])
  }
  estimate(context: Context, identity: string): number {
    const anchor = this.anchor
    if (
      anchor?.identity === identity &&
      anchor.messageHashes.length <= context.messages.length &&
      anchor.messageHashes.every((h, i) => h === hash(context.messages[i]))
    ) {
      return (
        anchor.tokens +
        context.messages
          .slice(anchor.messageHashes.length)
          .reduce((sum, message) => sum + estimateTokens(message), 0)
      )
    }
    return Math.max(
      1,
      this.fixedTokens(context) +
        context.messages.reduce((sum, message) => sum + estimateTokens(message), 0),
    )
  }
  measured(
    context: Context,
    identity: string,
    message: Extract<Context['messages'][number], { role: 'assistant' }>,
  ): ContextUsageAnchor | null {
    if (
      message.stopReason === 'error' ||
      message.stopReason === 'aborted' ||
      calculateContextTokens(message.usage) <= 0
    )
      return null
    this.anchor = {
      identity,
      messageHashes: [...context.messages, message].map(hash),
      tokens: calculateContextTokens(message.usage),
    }
    return this.anchor
  }
  snapshot(
    model: Model<any>,
    context: Context,
    generation: string,
    source: ContextBudget['source'] = 'estimated',
  ): ContextBudget {
    return {
      ...contextBudget(model),
      fixedTokens: this.fixedTokens(context),
      usedTokens: this.estimate(context, this.identity(model, context, generation)),
      source,
      sampledAt: Date.now(),
    }
  }
}
