import { Schema } from 'effect'
import { RecommendationPreviewParams } from '@pidex/agent-protocol'
import { AgentError } from '../../../Domain'
import type { RpcHandlerGroup } from './Types'

export const modelRecommendationHandlers = {
  name: 'model-recommendations',
  methods: ['model/recommendation/preview', 'model/recommendation/refresh'],
  async handle(runtime, method, rawParams) {
    const input =
      method === 'model/recommendation/preview'
        ? Schema.decodeUnknownSync(RecommendationPreviewParams)(rawParams)
        : undefined
    try {
      if (input) return await runtime.dependencies.piModels.previewRecommendation(input)
      const result = await runtime.dependencies.piModels.refreshRecommendations()
      return result
    } catch {
      throw new AgentError('PROVIDER_UNAVAILABLE', '模型推荐配置不可用，请稍后重试。', 502)
    }
  },
} as const satisfies RpcHandlerGroup
