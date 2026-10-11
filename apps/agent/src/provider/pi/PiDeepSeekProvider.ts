import {
  createProvider,
  type Api,
  type Credential,
  type Model,
  type Provider,
  type RefreshModelsContext,
} from '@earendil-works/pi-ai'
import { piProviderApiStreams } from './PiProviderApis'
import { DEEPSEEK_PROTOCOL_ENDPOINTS, type DeepSeekProtocol } from './PiProviderConfig'

const toProtocolModel = (model: Model<Api>, protocol: DeepSeekProtocol): Model<Api> => {
  const { compat, ...rest } = model
  return {
    ...rest,
    api: protocol,
    baseUrl: DEEPSEEK_PROTOCOL_ENDPOINTS[protocol],
    // compat 描述单个 API 的传输细节，切换协议后不能沿用旧协议的取值。
    ...(compat && model.api === protocol ? { compat } : {}),
  }
}

/**
 * Rebuilds the bundled DeepSeek provider on another wire protocol while
 * keeping its catalog, auth resolution, and model metadata intact.
 */
export const createPiDeepSeekProvider = (
  source: Provider<Api>,
  protocol: DeepSeekProtocol,
): Provider<Api> =>
  createProvider({
    id: source.id,
    name: source.name,
    baseUrl: DEEPSEEK_PROTOCOL_ENDPOINTS[protocol],
    ...(source.headers ? { headers: source.headers } : {}),
    auth: source.auth,
    models: source.getModels().map((model) => toProtocolModel(model, protocol)),
    api: piProviderApiStreams[protocol](),
    ...(source.refreshModels
      ? {
          refreshModels: (context: RefreshModelsContext) =>
            source.refreshModels!.call(source, context),
        }
      : {}),
    ...(source.filterModels
      ? {
          filterModels: (models: readonly Model<Api>[], credential: Credential | undefined) =>
            source.filterModels!.call(source, models, credential),
        }
      : {}),
  })
