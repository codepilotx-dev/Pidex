import { describe, expect, test } from 'bun:test'
import { PROVIDER_PRESETS } from '../src/features/models/provider-management/ProviderEditorPresets.js'

const RESERVED_BUILTIN_IDS = new Set([
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'azure-openai-responses',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'radius',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
])

describe('providerEditorPresets', () => {
  test('all preset defaultValues IDs avoid collision with builtin provider IDs', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(RESERVED_BUILTIN_IDS.has(preset.defaultValues.id)).toBe(false)
      expect(preset.defaultValues.id.length).toBeGreaterThan(0)
      expect(preset.defaultValues.baseUrl.startsWith('http')).toBe(true)
      expect(preset.defaultValues.models.length).toBeGreaterThan(0)
    }
  })
})
