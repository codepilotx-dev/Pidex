import { isRecord } from '@pidex/shared/guards'

const EMPTY_MESSAGE_PLACEHOLDER = '[System: Empty message content sanitised to satisfy protocol]'

// LiteLLM rewrites empty text into visible protocol filler; tool-only messages need no text.
export const normalizePiProviderPayload = (payload: unknown, api: string): unknown => {
  if (!isRecord(payload)) return payload
  const field = api === 'openai-responses' ? 'input' : 'messages'
  if (
    !['openai-responses', 'openai-completions', 'anthropic-messages'].includes(api) ||
    !Array.isArray(payload[field])
  )
    return payload

  const messages = payload[field].flatMap((message: unknown) => {
    if (
      !isRecord(message) ||
      !['user', 'assistant', 'system', 'developer'].includes(String(message.role))
    ) {
      return [message]
    }
    const emptyText = (text: string) =>
      !text.trim() || (message.role === 'assistant' && text.trim() === EMPTY_MESSAGE_PLACEHOLDER)
    const content = message.content
    if (typeof content === 'string') {
      if (!emptyText(content)) return [message]
    } else if (Array.isArray(content)) {
      const blocks = content.filter(
        (block) =>
          !isRecord(block) ||
          !['text', 'input_text', 'output_text'].includes(String(block.type)) ||
          typeof block.text !== 'string' ||
          !emptyText(block.text),
      )
      if (blocks.length > 0) return [{ ...message, content: blocks }]
    } else if (content != null) {
      return [message]
    }
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      return [{ ...message, content: null }]
    }
    // Signed reasoning can accompany an otherwise textless Chat Completions message.
    if (message.reasoning_content || message.reasoning || message.reasoning_details) {
      return [{ ...message, content: null }]
    }
    return []
  })
  return { ...payload, [field]: messages }
}
