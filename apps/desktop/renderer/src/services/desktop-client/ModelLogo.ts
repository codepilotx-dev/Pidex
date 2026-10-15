import { modelsDevLogoURL } from './ProviderLogoBrands.js'

// Specific model families precede broader vendor names; grouping never determines a brand.
const MODEL_BRANDS: readonly [RegExp, string][] = [
  [/claude|anthropic/i, 'anthropic'],
  [/deepseek/i, 'deepseek'],
  [/gemini|gemma|imagen|veo/i, 'google'],
  [/gpt|chatgpt|codex|(?:^|[-_/])o[134](?:[-_.]|$)/i, 'openai'],
  [/qwen|qwq|qvq/i, 'alibaba'],
  [/chatglm|glm/i, 'zai'],
  [/kimi|moonshot/i, 'moonshotai'],
  [/minimax|abab/i, 'minimax'],
  [/grok/i, 'xai'],
  [/llama|meta-/i, 'meta'],
  [/mistral|mixtral|codestral|devstral|magistral|pixtral/i, 'mistral'],
  [/mimo|xiaomi/i, 'xiaomi'],
  [/(?:^|[-_/])step(?:[-_\d]|$)/i, 'stepfun'],
  [/doubao|seedream|seedance/i, 'volcengine'],
  [/command-r|command-a|cohere/i, 'cohere'],
  [/nemotron|nvidia/i, 'nvidia'],
]

export function modelLogoURL(id: string, name?: string): string | undefined {
  for (const value of [id, name]) {
    if (!value) continue
    const base = value.split('/').at(-1)!.replace(/:(free|cloud)$/i, '')
    const brand = MODEL_BRANDS.find(([pattern]) => pattern.test(base))?.[1]
    if (brand) return modelsDevLogoURL(brand)
  }
  return undefined
}
