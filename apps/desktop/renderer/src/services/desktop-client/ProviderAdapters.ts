import type { CatalogProvider } from '@pidex/shared'
import type { DesktopModelMetadata, DesktopModelProviderSummary } from '../../../shared/Types.js'
import { modelsDevLogoURL } from './ProviderLogoBrands.js'

export function catalogProviderToDesktop(
  catalogProvider: CatalogProvider,
): DesktopModelProviderSummary {
  const { provider } = catalogProvider
  const extendedProvider = provider as typeof provider & {
    availability?: DesktopModelProviderSummary['availability']
    catalogOrigin?: DesktopModelProviderSummary['catalogOrigin']
  }
  const models = catalogProvider.models.filter((model) => model.enabled)
  const modelMetadata = Object.fromEntries(
    models.map((model) => {
      const cost = model.cost[0]
      const metadata: DesktopModelMetadata = {
        id: model.id,
        name: model.name,
        contextWindow: model.limit.context,
        outputTokens: model.limit.output,
        inputCost: cost?.input,
        outputCost: cost?.output,
        cacheReadCost: cost?.cache.read,
        cacheWriteCost: cost?.cache.write,
        toolCall: model.capabilities.tools,
        structuredOutput: model.capabilities.output.some(
          (output) => output === 'json' || output === 'structured',
        ),
        vision: model.capabilities.input.includes('image'),
        modalities: {
          input: [...model.capabilities.input],
          output: [...model.capabilities.output],
        },
        modelType: model.family,
        tags: [model.status],
        variants: model.variants.map((variant) => variant.id),
        providerApi: isProviderApi(model.api.name) ? model.api.name : undefined,
      }
      return [model.id, metadata]
    }),
  )
  return {
    providerID: provider.id,
    providerKind: provider.source.kind,
    catalogOrigin: extendedProvider.catalogOrigin,
    availability: extendedProvider.availability,
    logoURL: provider.source.kind === 'builtin' ? modelsDevLogoURL(provider.id) : undefined,
    providerApis: provider.source.apis.filter(isProviderApi),
    enabled: provider.disabled !== true,
    authMethods: [
      provider.auth.apiKey ? ('api-key' as const) : null,
      provider.auth.oauth ? ('oauth' as const) : null,
    ].filter((method): method is 'api-key' | 'oauth' => method !== null),
    kind:
      provider.id === 'github-copilot'
        ? 'github-copilot'
        : provider.source.apis.includes('anthropic-messages')
          ? 'anthropic'
          : 'openai-compatible',
    displayName: provider.name,
    baseURL: provider.source.baseUrl,
    defaultModels: models.map((model) => model.id),
    modelMetadata,
    apiKeyConfigured: provider.disabled !== true && !provider.auth.apiKey && !provider.auth.oauth,
    envVars: [],
    requiresBaseURL: provider.source.kind === 'custom' && !provider.source.baseUrl,
  }
}

export function isExecutableDesktopProvider(provider: DesktopModelProviderSummary): boolean {
  return (
    provider.enabled !== false &&
    provider.availability?.status !== 'unavailable' &&
    (provider.modelCount ?? provider.defaultModels.length) > 0
  )
}

export function desktopProviderExecutionError(
  provider: DesktopModelProviderSummary | undefined,
): string | null {
  if (!provider) return '此 Provider 的状态尚未加载，暂时无法测试连接。'
  if (provider.availability?.status === 'unavailable') {
    return '此 Provider 的协议或 Endpoint 尚未适配，无法测试连接。'
  }
  if (provider.enabled === false) {
    return '此 Provider 已禁用，请先启用后再测试连接。'
  }
  if ((provider.modelCount ?? provider.defaultModels.length) <= 0) {
    return '此 Provider 暂无可用模型，请等待凭据和模型目录同步后重试。'
  }
  return null
}

function isProviderApi(
  value: string,
): value is 'openai-completions' | 'openai-responses' | 'anthropic-messages' {
  return (
    value === 'openai-completions' || value === 'openai-responses' || value === 'anthropic-messages'
  )
}
