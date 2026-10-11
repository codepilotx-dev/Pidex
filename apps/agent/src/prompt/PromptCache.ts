import { createHash } from 'node:crypto'

export interface PromptCacheModelDescriptor {
  provider: string
  api: string
  id: string
  baseUrl: string
  compat?: unknown
}

export type PromptCacheRuntimeStrategy = 'openai-explicit' | 'openai-automatic' | 'upstream-managed'

export interface PromptCacheRuntimePolicy {
  strategy: PromptCacheRuntimeStrategy
  cacheRetention: 'short' | 'none'
  cacheKey?: string
}

const normalize = (value: string) => value.trim().toLowerCase()
const hostname = (baseUrl: string) => {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const pathname = (baseUrl: string) => {
  try {
    return new URL(baseUrl).pathname.toLowerCase()
  } catch {
    return ''
  }
}
const supportsExplicitPromptCacheMode = (compat: unknown) =>
  typeof compat === 'object' &&
  compat !== null &&
  (compat as { supportsExplicitPromptCacheMode?: unknown }).supportsExplicitPromptCacheMode === true

export const createPromptCacheKey = (threadID: string) =>
  `cpx_${createHash('sha256').update(threadID, 'utf8').digest('hex').slice(0, 60)}`

export const inferPromptCacheRuntimePolicy = (
  model: PromptCacheModelDescriptor,
  cacheKey: string,
): PromptCacheRuntimePolicy => {
  const provider = normalize(model.provider)
  const api = normalize(model.api)
  const modelID = normalize(model.id)
  const host = hostname(model.baseUrl)
  const path = pathname(model.baseUrl)
  const officialOpenAI =
    provider === 'openai' &&
    host === 'api.openai.com' &&
    (api === 'openai-responses' || api === 'openai-completions')
  if (officialOpenAI) {
    return {
      strategy: supportsExplicitPromptCacheMode(model.compat)
        ? 'openai-explicit'
        : 'openai-automatic',
      cacheRetention: 'short',
      cacheKey,
    }
  }

  const officialMiniMaxM3 =
    (provider === 'minimax' || provider === 'minimax-cn') &&
    api === 'anthropic-messages' &&
    modelID.startsWith('minimax-m3') &&
    (host === 'api.minimax.io' || host === 'api.minimaxi.com') &&
    path.startsWith('/anthropic')
  const officialKimiCoding =
    provider === 'kimi-coding' &&
    api === 'anthropic-messages' &&
    host === 'api.kimi.com' &&
    path.startsWith('/coding')

  return {
    strategy: 'upstream-managed',
    cacheRetention: officialMiniMaxM3 || officialKimiCoding ? 'none' : 'short',
  }
}

export type PromptCacheCapability =
  | { provider: 'openai'; strategy: 'prompt-cache-key' }
  | { provider: 'anthropic'; strategy: 'explicit-ephemeral'; maxBreakpoints: 4 }
  | { provider: 'other'; strategy: 'stable-prefix' }

/** UI diagnostic only. Pi owns provider cache options at the Harness boundary. */
export const inferPromptCacheCapability = (providerID: string): PromptCacheCapability => {
  const normalized = providerID.trim().toLowerCase()
  if (/^openai(?:\.|$)/.test(normalized))
    return { provider: 'openai', strategy: 'prompt-cache-key' }
  if (/^anthropic(?:\.|$)/.test(normalized))
    return {
      provider: 'anthropic',
      strategy: 'explicit-ephemeral',
      maxBreakpoints: 4,
    }
  return { provider: 'other', strategy: 'stable-prefix' }
}
