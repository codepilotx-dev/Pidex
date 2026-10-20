import { describe, expect, it } from 'bun:test'
import type { DesktopModelProviderSummary, DesktopProviderModelDefinition } from '../shared/Types.js'
import {
  resolveModelCapabilities,
  resolveModelContextWindow,
  resolveModelVendor,
} from '../src/features/models/provider-management/ProviderModelsSection.js'

describe('DiscoveredModelCard helpers', () => {
  const mockProvider: DesktopModelProviderSummary = {
    providerID: 'custom-provider',
    kind: 'custom',
    displayName: 'My Custom Provider',
    defaultModels: [],
    apiKeyConfigured: true,
  }

  describe('resolveModelVendor', () => {
    it('resolves vendor from model group when present', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'some-model',
        group: 'Anthropic',
        api: 'openai-completions',
      }
      expect(resolveModelVendor(model, mockProvider)).toBe('Anthropic')
    })

    it('resolves vendor from model id prefix with slash', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'anthropic/claude-3-5-sonnet',
        api: 'openai-completions',
      }
      expect(resolveModelVendor(model, mockProvider)).toBe('Anthropic')
    })

    it('resolves vendor from known model naming patterns', () => {
      expect(
        resolveModelVendor({ id: 'DeepSeek-V4-Flash', api: 'openai-completions' }, mockProvider),
      ).toBe('DeepSeek')

      expect(
        resolveModelVendor({ id: 'Qwen3.8-27B', api: 'openai-completions' }, mockProvider),
      ).toBe('通义千问')

      expect(
        resolveModelVendor({ id: 'GLM-5.3-Flash', api: 'openai-completions' }, mockProvider),
      ).toBe('智谱 AI')

      expect(
        resolveModelVendor({ id: 'Gemma 4 31B', api: 'openai-completions' }, mockProvider),
      ).toBe('Google Gemma')

      expect(
        resolveModelVendor({ id: 'MiMo-V2.6-Flash', api: 'openai-completions' }, mockProvider),
      ).toBe('小米 (Xiaomi)')

      expect(
        resolveModelVendor({ id: 'MinerU2.5-Pro', api: 'openai-completions' }, mockProvider),
      ).toBe('MinerU')

      expect(
        resolveModelVendor({ id: 'MiniCPM-V-4.7-1B', api: 'openai-completions' }, mockProvider),
      ).toBe('面壁智能 (OpenBMB)')
    })

    it('falls back to provider displayName when vendor cannot be inferred', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'Clef',
        api: 'openai-completions',
      }
      expect(resolveModelVendor(model, mockProvider)).toBe('My Custom Provider')
    })
  })

  describe('resolveModelCapabilities', () => {
    it('detects reasoning capability', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'deepseek-r1',
        api: 'openai-completions',
      }
      const caps = resolveModelCapabilities(model)
      expect(caps.some((c) => c.key === 'reasoning')).toBe(true)
    })

    it('detects vision capability from name or input', () => {
      const modelWithName: DesktopProviderModelDefinition = {
        id: 'DeepSeek-V4-Flash-Vision-Exp',
        api: 'openai-completions',
      }
      expect(resolveModelCapabilities(modelWithName).some((c) => c.key === 'vision')).toBe(true)

      const modelWithInput: DesktopProviderModelDefinition = {
        id: 'custom-model',
        api: 'openai-completions',
        input: ['text', 'image'],
      }
      expect(resolveModelCapabilities(modelWithInput).some((c) => c.key === 'vision')).toBe(true)
    })

    it('detects audio capability', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'OmniVoice',
        api: 'openai-completions',
      }
      expect(resolveModelCapabilities(model).some((c) => c.key === 'audio')).toBe(true)
    })

    it('detects embedding capability', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'text-embedding-3-small',
        modelType: 'embedding',
        api: 'openai-completions',
      }
      const caps = resolveModelCapabilities(model)
      expect(caps.some((c) => c.key === 'embedding')).toBe(true)
      expect(caps.some((c) => c.key === 'tools')).toBe(false)
    })

    it('falls back to general chat when no specific capability matched', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'simple-model',
        tools: false,
        api: 'openai-completions',
      }
      const caps = resolveModelCapabilities(model)
      expect(caps.some((c) => c.key === 'chat')).toBe(true)
    })
  })

  describe('resolveModelContextWindow', () => {
    it('uses explicit model contextWindow', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'model-1',
        contextWindow: 65536,
        api: 'openai-completions',
      }
      expect(resolveModelContextWindow(model)).toBe(65536)
    })

    it('parses context length from model id pattern', () => {
      const modelK: DesktopProviderModelDefinition = {
        id: 'model-128k',
        api: 'openai-completions',
      }
      expect(resolveModelContextWindow(modelK)).toBe(128 * 1024)

      const modelM: DesktopProviderModelDefinition = {
        id: 'model-1m',
        api: 'openai-completions',
      }
      expect(resolveModelContextWindow(modelM)).toBe(1024 * 1024)
    })

    it('falls back to default 32768', () => {
      const model: DesktopProviderModelDefinition = {
        id: 'unknown-context',
        api: 'openai-completions',
      }
      expect(resolveModelContextWindow(model)).toBe(32768)
    })
  })
})
