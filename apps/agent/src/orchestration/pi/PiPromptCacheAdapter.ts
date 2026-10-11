import type { PromptCacheRuntimePolicy } from '../../prompt/PromptCache'
import { isRecord } from '@pidex/shared/guards'

type JsonRecord = Record<string, unknown>

export interface PromptCacheApplyResult {
  payload: unknown
  appliedBreakpoints: number
  fallbackReason?: string
}

const withoutBreakpoint = (value: JsonRecord) => {
  if (!Object.hasOwn(value, 'prompt_cache_breakpoint')) return value
  const next = { ...value }
  delete next.prompt_cache_breakpoint
  return next
}

const clearContentBreakpoints = (content: unknown): unknown => {
  if (!Array.isArray(content)) return content
  let changed = false
  const next = content.map((part) => {
    if (!isRecord(part)) return part
    const cleared = withoutBreakpoint(part)
    if (cleared !== part) changed = true
    return cleared
  })
  return changed ? next : content
}

const clearMessageBreakpoints = (messages: unknown): unknown => {
  if (!Array.isArray(messages)) return messages
  let changed = false
  const next = messages.map((message) => {
    if (!isRecord(message)) return message
    const clearedMessage = withoutBreakpoint(message)
    const content = clearContentBreakpoints(clearedMessage.content)
    if (clearedMessage !== message || content !== clearedMessage.content) {
      changed = true
      return { ...clearedMessage, content }
    }
    return message
  })
  return changed ? next : messages
}

const textBlock = (value: unknown) =>
  isRecord(value) && typeof value.text === 'string'
    ? (value as JsonRecord & { text: string })
    : null

const splitStableText = (
  content: unknown,
  stableText: string,
  defaultType: 'text' | 'input_text',
): unknown | null => {
  const breakpoint = { prompt_cache_breakpoint: { mode: 'explicit' } }
  if (typeof content === 'string') {
    if (!content.startsWith(stableText)) return null
    const suffix = content.slice(stableText.length)
    return [
      { type: defaultType, text: stableText, ...breakpoint },
      ...(suffix ? [{ type: defaultType, text: suffix }] : []),
    ]
  }
  if (!Array.isArray(content)) return null
  const index = content.findIndex((part) => textBlock(part)?.text.startsWith(stableText))
  if (index < 0) return null
  const original = textBlock(content[index])!
  const suffix = original.text.slice(stableText.length)
  const base = withoutBreakpoint(original)
  return [
    ...content.slice(0, index),
    { ...base, text: stableText, ...breakpoint },
    ...(suffix ? [{ ...base, text: suffix }] : []),
    ...content.slice(index + 1),
  ]
}

const markStableContext = (
  messages: unknown,
  stableText: string,
  defaultType: 'text' | 'input_text',
): unknown | null => {
  if (!Array.isArray(messages) || !stableText) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'user') continue
    const content = splitStableText(message.content, stableText, defaultType)
    if (content === null) continue
    return [...messages.slice(0, index), { ...message, content }, ...messages.slice(index + 1)]
  }
  return null
}

const markSystemInstructions = (
  messages: unknown,
  defaultType: 'text' | 'input_text',
): unknown | null => {
  if (!Array.isArray(messages)) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || (message.role !== 'system' && message.role !== 'developer')) {
      continue
    }
    const breakpoint = { prompt_cache_breakpoint: { mode: 'explicit' } }
    let content: unknown = null
    if (typeof message.content === 'string' && message.content.length > 0) {
      content = [{ type: defaultType, text: message.content, ...breakpoint }]
    } else if (Array.isArray(message.content)) {
      let partIndex = -1
      for (let candidate = message.content.length - 1; candidate >= 0; candidate -= 1) {
        if ((textBlock(message.content[candidate])?.text.length ?? 0) > 0) {
          partIndex = candidate
          break
        }
      }
      if (partIndex >= 0) {
        content = [
          ...message.content.slice(0, partIndex),
          { ...textBlock(message.content[partIndex])!, ...breakpoint },
          ...message.content.slice(partIndex + 1),
        ]
      }
    }
    if (content === null) continue
    return [...messages.slice(0, index), { ...message, content }, ...messages.slice(index + 1)]
  }
  return null
}

export const applyPromptCacheRuntimePolicy = (
  payload: unknown,
  policy: PromptCacheRuntimePolicy,
  stableContextText: string,
): PromptCacheApplyResult => {
  if (policy.strategy === 'upstream-managed') {
    return { payload, appliedBreakpoints: 0 }
  }
  if (!isRecord(payload) || !policy.cacheKey) {
    return {
      payload,
      appliedBreakpoints: 0,
      fallbackReason: 'invalid-openai-payload',
    }
  }

  const next: JsonRecord = {
    ...payload,
    prompt_cache_key: policy.cacheKey,
  }
  if (policy.strategy === 'openai-automatic') {
    return { payload: next, appliedBreakpoints: 0 }
  }

  delete next.prompt_cache_retention
  delete next.prompt_cache_options
  const field = Array.isArray(next.input) ? 'input' : 'messages'
  const defaultType = field === 'input' ? 'input_text' : 'text'
  const messages = clearMessageBreakpoints(next[field])
  const marked = stableContextText
    ? markStableContext(messages, stableContextText, defaultType)
    : markSystemInstructions(messages, defaultType)
  if (marked === null) {
    if (messages !== next[field]) next[field] = messages
    return {
      payload: next,
      appliedBreakpoints: 0,
      fallbackReason: 'openai-cache-breakpoint-not-found',
    }
  }

  next[field] = marked
  next.prompt_cache_options = { mode: 'explicit', ttl: '30m' }
  return { payload: next, appliedBreakpoints: 1 }
}
