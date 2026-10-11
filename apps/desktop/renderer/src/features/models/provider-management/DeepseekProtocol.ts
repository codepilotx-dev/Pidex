import type {
  DesktopBuiltinProviderDefinition,
  DesktopModelProviderSummary,
} from '../../../../shared/Types.js'

/** 唯一支持全局协议切换的内置 Provider。 */
export const DEEPSEEK_PROVIDER_ID = 'deepseek'

export type DeepSeekProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export type DeepSeekProtocolOption = {
  value: DeepSeekProtocol
  label: string
  /** 与 Agent 端 PiProviderConfig 的端点表保持一致。 */
  endpoint: string
}

export const DEEPSEEK_PROTOCOL_OPTIONS: readonly DeepSeekProtocolOption[] = [
  {
    value: 'openai-completions',
    label: 'Chat Completions',
    endpoint: 'https://api.deepseek.com',
  },
  {
    value: 'openai-responses',
    label: 'Responses',
    endpoint: 'https://api.deepseek.com',
  },
  {
    value: 'anthropic-messages',
    label: 'Anthropic Messages',
    endpoint: 'https://api.deepseek.com/anthropic',
  },
]

/** 配置缺失时 Agent 按 Chat Completions 执行，UI 显示同一默认值。 */
export const DEFAULT_DEEPSEEK_PROTOCOL: DeepSeekProtocol = 'openai-completions'

export type DeepSeekManagedProvider = {
  provider: DesktopModelProviderSummary
  config: DesktopBuiltinProviderDefinition
}

function isDeepSeekProtocol(value: unknown): value is DeepSeekProtocol {
  return DEEPSEEK_PROTOCOL_OPTIONS.some((option) => option.value === value)
}

/**
 * 只有内置 DeepSeek 走全局协议设置；其他内置 Provider 保持不可编辑。
 */
export function deepSeekManagedProvider(
  provider: DesktopModelProviderSummary | undefined,
  supported = false,
): DeepSeekManagedProvider | null {
  if (!supported) return null
  if (!provider) return null
  if (provider.providerID !== DEEPSEEK_PROVIDER_ID) return null
  if (provider.providerKind !== 'builtin') return null
  const config = provider.config
  if (config?.kind !== 'builtin') return null
  return { provider, config }
}

export function deepSeekProtocolOf(config: DesktopBuiltinProviderDefinition): DeepSeekProtocol {
  return isDeepSeekProtocol(config.protocol) ? config.protocol : DEFAULT_DEEPSEEK_PROTOCOL
}

/**
 * 自定义 Provider 可编辑整份定义；内置 Provider 中只有 DeepSeek 有编辑入口。
 */
export function canEditProviderConfig(
  provider: DesktopModelProviderSummary | undefined,
  deepSeekProtocolSupported = false,
): boolean {
  return (
    provider?.providerKind === 'custom' ||
    deepSeekManagedProvider(provider, deepSeekProtocolSupported) !== null
  )
}

export function deepSeekProtocolOption(protocol: DeepSeekProtocol): DeepSeekProtocolOption {
  return (
    DEEPSEEK_PROTOCOL_OPTIONS.find((option) => option.value === protocol) ??
    DEEPSEEK_PROTOCOL_OPTIONS[0]!
  )
}

/**
 * 只替换全局协议；启用状态、模型筛选和模型开关原样保留，避免保存时
 * 覆盖用户在模型页维护的 DeepSeek 配置。默认协议不写回配置，保持旧配置
 * 文件不变。
 */
export function buildDeepSeekProtocolDefinition(
  config: DesktopBuiltinProviderDefinition,
  protocol: DeepSeekProtocol,
): DesktopBuiltinProviderDefinition {
  return {
    kind: 'builtin',
    id: config.id,
    enabled: config.enabled,
    allowModels: [...config.allowModels],
    denyModels: [...config.denyModels],
    models: config.models.map((model) => ({ ...model })),
    ...(protocol === DEFAULT_DEEPSEEK_PROTOCOL ? {} : { protocol }),
  }
}
