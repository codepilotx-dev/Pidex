import type { DesktopProviderModelDefinition } from '../../../../shared/Types.js'

export type ProviderPreset = {
  id: string
  label: string
  description: string
  defaultValues: {
    id: string
    name: string
    baseUrl: string
    auth: 'api-key' | 'none'
    models: Array<{
      id: string
      name: string
      api: DesktopProviderModelDefinition['api']
      contextWindow: number
      maxTokens: number
      reasoning: boolean
      imageInput: boolean
    }>
  }
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    description: '本地开源模型（默认 http://localhost:11434/v1）',
    defaultValues: {
      id: 'ollama',
      name: 'Ollama (Local)',
      baseUrl: 'http://localhost:11434/v1',
      auth: 'none',
      models: [
        {
          id: 'llama3.2',
          name: 'Llama 3.2',
          api: 'openai-completions',
          contextWindow: 131_072,
          maxTokens: 8_192,
          reasoning: false,
          imageInput: false,
        },
        {
          id: 'qwen2.5-coder',
          name: 'Qwen 2.5 Coder',
          api: 'openai-completions',
          contextWindow: 32_768,
          maxTokens: 8_192,
          reasoning: false,
          imageInput: false,
        },
        {
          id: 'deepseek-r1',
          name: 'DeepSeek R1',
          api: 'openai-completions',
          contextWindow: 65_536,
          maxTokens: 8_192,
          reasoning: true,
          imageInput: false,
        },
      ],
    },
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek 官方 API（https://api.deepseek.com/v1）',
    defaultValues: {
      id: 'custom-deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      auth: 'api-key',
      models: [
        {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat (V3)',
          api: 'openai-completions',
          contextWindow: 65_536,
          maxTokens: 8_192,
          reasoning: false,
          imageInput: false,
        },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner (R1)',
          api: 'openai-completions',
          contextWindow: 65_536,
          maxTokens: 8_192,
          reasoning: true,
          imageInput: false,
        },
      ],
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '聚合网关（https://openrouter.ai/api/v1）',
    defaultValues: {
      id: 'custom-openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      auth: 'api-key',
      models: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet',
          api: 'openai-completions',
          contextWindow: 200_000,
          maxTokens: 8_192,
          reasoning: false,
          imageInput: true,
        },
        {
          id: 'deepseek/deepseek-r1',
          name: 'DeepSeek R1',
          api: 'openai-completions',
          contextWindow: 128_000,
          maxTokens: 8_192,
          reasoning: true,
          imageInput: false,
        },
      ],
    },
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI 兼容',
    description: '标准 OpenAI 协议服务端点',
    defaultValues: {
      id: 'custom-openai',
      name: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com/v1',
      auth: 'api-key',
      models: [
        {
          id: 'gpt-4o',
          name: 'GPT-4o',
          api: 'openai-completions',
          contextWindow: 128_000,
          maxTokens: 16_384,
          reasoning: false,
          imageInput: true,
        },
      ],
    },
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    description: 'LM Studio 本地端点（http://localhost:1234/v1）',
    defaultValues: {
      id: 'lm-studio',
      name: 'LM Studio',
      baseUrl: 'http://localhost:1234/v1',
      auth: 'none',
      models: [
        {
          id: 'local-model',
          name: 'Local Model',
          api: 'openai-completions',
          contextWindow: 32_768,
          maxTokens: 8_192,
          reasoning: false,
          imageInput: false,
        },
      ],
    },
  },
]
