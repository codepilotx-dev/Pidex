import type { ModelRecommendation } from '@pidex/agent-protocol'
import type { EditableModel } from './ProviderEditorForm.js'

/** 推荐只填普通草稿字段，保存继续走现有模型配置。 */
export function fillModelDraft(
  model: EditableModel,
  recommended: ModelRecommendation,
): EditableModel {
  return {
    ...model,
    ...(recommended.name !== undefined ? { name: recommended.name } : {}),
    ...(recommended.contextWindow !== undefined
      ? { contextWindow: recommended.contextWindow }
      : {}),
    ...(recommended.maxInputTokens !== undefined
      ? { maxInputTokens: recommended.maxInputTokens }
      : {}),
    ...(recommended.maxTokens !== undefined ? { maxTokens: recommended.maxTokens } : {}),
    ...(recommended.reasoning !== undefined ? { reasoning: recommended.reasoning } : {}),
    ...(recommended.tools !== undefined ? { tools: recommended.tools } : {}),
    ...(recommended.input !== undefined
      ? {
          imageInput: recommended.input.includes('image'),
          audioInput: recommended.input.includes('audio'),
          videoInput: recommended.input.includes('video'),
        }
      : {}),
    ...(recommended.cost?.input !== undefined ? { inputCost: recommended.cost.input } : {}),
    ...(recommended.cost?.output !== undefined ? { outputCost: recommended.cost.output } : {}),
    ...(recommended.cost?.cacheRead !== undefined
      ? { cacheReadCost: recommended.cost.cacheRead }
      : {}),
    ...(recommended.cost?.cacheWrite !== undefined
      ? { cacheWriteCost: recommended.cost.cacheWrite }
      : {}),
  }
}
