import type { Api, Context, Model } from '@earendil-works/pi-ai'

export type MediaInput = { kind: 'audio' | 'video'; mimeType: string; data: string }

/** Pi owns transport/auth; the payload hook supplies media parts unsupported by its text/image mapper. */
export function prepareMediaInput(model: Model<Api>, context: Context) {
  const replacements = new Map<string, Record<string, unknown>>()
  const messages = context.messages.map((message) => {
    const media = (message as typeof message & { media?: MediaInput[] }).media
    if (message.role !== 'user' || !media?.length) return message
    const content =
      typeof message.content === 'string'
        ? [{ type: 'text' as const, text: message.content }]
        : [...message.content]
    for (const part of media) {
      if (!(model.input as readonly string[]).includes(part.kind))
        throw new Error(`当前模型不支持${part.kind === 'audio' ? '音频' : '视频'}输入`)
      let wire: Record<string, unknown>
      if (model.api === 'google-generative-ai' || model.api === 'google-vertex') {
        wire = { inlineData: { mimeType: part.mimeType, data: part.data } }
      } else if (
        model.api === 'openai-completions' &&
        part.kind === 'audio' &&
        ['audio/wav', 'audio/mpeg', 'audio/mp3'].includes(part.mimeType)
      ) {
        wire = {
          type: 'input_audio',
          input_audio: { data: part.data, format: part.mimeType === 'audio/wav' ? 'wav' : 'mp3' },
        }
      } else throw new Error('当前协议不支持该媒体输入，请切换到兼容的聊天端点')
      const marker = `pidex-media:${crypto.randomUUID()}`
      replacements.set(marker, wire)
      content.push({ type: 'text', text: marker })
    }
    return { ...message, content }
  })
  return {
    context: { ...context, messages },
    applyPayload(payload: unknown): unknown {
      if (!replacements.size) return payload
      const found = new Set<string>()
      const replace = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(replace)
        if (
          !value ||
          typeof value !== 'object' ||
          Object.getPrototypeOf(value) !== Object.prototype
        )
          return value
        const object = value as Record<string, unknown>
        if (typeof object.text === 'string' && replacements.has(object.text)) {
          found.add(object.text)
          return replacements.get(object.text)
        }
        return Object.fromEntries(
          Object.entries(object).map(([key, child]) => [key, replace(child)]),
        )
      }
      const result = replace(payload)
      if (found.size !== replacements.size)
        throw new Error('媒体内容未能映射到当前协议，请检查端点配置')
      return result
    },
  }
}
