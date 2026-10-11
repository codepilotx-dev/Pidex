import { describe, expect, test } from 'bun:test'
import type {
  DesktopBuiltinProviderDefinition,
  DesktopModelProviderSummary,
} from '../shared/Types.js'
import {
  DEEPSEEK_PROTOCOL_OPTIONS,
  DEFAULT_DEEPSEEK_PROTOCOL,
  buildDeepSeekProtocolDefinition,
  canEditProviderConfig,
  deepSeekManagedProvider,
  deepSeekProtocolOf,
  deepSeekProtocolOption,
} from '../src/features/models/provider-management/DeepseekProtocol.js'

describe('DeepSeek global protocol settings', () => {
  test('offers the three protocols with their managed endpoints', () => {
    expect(DEEPSEEK_PROTOCOL_OPTIONS.map((option) => option.value)).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
    ])
    expect(DEEPSEEK_PROTOCOL_OPTIONS.map((option) => option.endpoint)).toEqual([
      'https://api.deepseek.com',
      'https://api.deepseek.com',
      'https://api.deepseek.com/anthropic',
    ])
    expect(DEFAULT_DEEPSEEK_PROTOCOL).toBe('openai-completions')
    expect(deepSeekProtocolOption('anthropic-messages').endpoint).toBe(
      'https://api.deepseek.com/anthropic',
    )
    expect(deepSeekProtocolOption('openai-responses').label).toBe('Responses')
  })

  test('persists the selection while preserving the rest of the builtin config', () => {
    const config = builtinConfig({
      allowModels: ['deepseek-v4-pro'] as never,
      denyModels: ['deepseek-v4-flash'] as never,
      models: [{ id: 'deepseek-v4-pro' as never, enabled: false }],
    })

    expect(buildDeepSeekProtocolDefinition(config, 'anthropic-messages')).toEqual({
      kind: 'builtin',
      id: 'deepseek',
      enabled: true,
      allowModels: ['deepseek-v4-pro'],
      denyModels: ['deepseek-v4-flash'],
      models: [{ id: 'deepseek-v4-pro', enabled: false }],
      protocol: 'anthropic-messages',
    })
    // 默认协议不写回配置，旧配置文件保持原样。
    expect(buildDeepSeekProtocolDefinition(config, 'openai-completions')).not.toHaveProperty(
      'protocol',
    )
  })

  test('reads the configured protocol with a Chat Completions fallback', () => {
    expect(deepSeekProtocolOf(builtinConfig())).toBe('openai-completions')
    expect(deepSeekProtocolOf(builtinConfig({ protocol: 'openai-responses' }))).toBe(
      'openai-responses',
    )
  })

  test('limits the builtin edit entry to DeepSeek', () => {
    const deepseek = provider('deepseek', 'builtin', builtinConfig())
    expect(deepSeekManagedProvider(deepseek, true)?.config.kind).toBe('builtin')
    expect(canEditProviderConfig(deepseek, true)).toBe(true)
    expect(deepSeekManagedProvider(deepseek)).toBeNull()
    expect(canEditProviderConfig(deepseek)).toBe(false)

    // 其他内置 Provider 仍不可编辑，自定义 Provider 保持可编辑。
    expect(
      canEditProviderConfig(
        provider('openai', 'builtin', builtinConfig({ id: 'openai' as never })),
      ),
    ).toBe(false)
    // 自定义 Provider 走原有逐模型协议编辑，不进入全局协议设置。
    expect(deepSeekManagedProvider(provider('deepseek', 'custom', undefined), true)).toBeNull()
    expect(canEditProviderConfig(provider('deepseek', 'custom', undefined))).toBe(true)
    expect(canEditProviderConfig(provider('deepseek', 'builtin', undefined))).toBe(false)
    expect(canEditProviderConfig(undefined)).toBe(false)
    expect(canEditProviderConfig(provider('custom-ollama', 'custom', undefined))).toBe(true)
  })
})

function builtinConfig(
  overrides: Partial<DesktopBuiltinProviderDefinition> = {},
): DesktopBuiltinProviderDefinition {
  return {
    kind: 'builtin',
    id: 'deepseek' as never,
    enabled: true,
    allowModels: [],
    denyModels: [],
    models: [],
    ...overrides,
  }
}

function provider(
  providerID: string,
  providerKind: 'builtin' | 'custom',
  config: DesktopBuiltinProviderDefinition | undefined,
): DesktopModelProviderSummary {
  return {
    providerID,
    displayName: providerID,
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: true,
    providerKind,
    ...(config ? { config } : {}),
  } as DesktopModelProviderSummary
}
