import type { ModelRecommendation, SmartConfigPinnedField } from '@pidex/agent-protocol'
import type { EditableModel } from './ProviderEditorForm.js'

/** 推荐只填普通草稿字段，保存继续走现有模型配置。 */
export function fillModelDraft(
  model: EditableModel,
  recommended: ModelRecommendation,
  pinned: readonly SmartConfigPinnedField[] = [],
): EditableModel {
  const fixed = new Set<string>(pinned)
  const pick = (field: SmartConfigPinnedField) => (fixed.has(field) ? undefined : true)
  // optionSpecs 没有独立的固定字段：reasoningLevel.* 跟随 `reasoning`，
  // maxOutputTokens.* 跟随 `maxTokens`，与编辑器标题处的「已固定」标记一致。
  const reasoningPinned = fixed.has('reasoning')
  const maxTokensPinned = fixed.has('maxTokens')
  const specs = recommended.optionSpecs
  const optionSpecFields: Partial<EditableModel> = specs
    ? {
        ...(specs.reasoningLevel?.values !== undefined && !reasoningPinned
          ? { reasoningLevelValues: specs.reasoningLevel.values.join('\n') }
          : {}),
        ...(specs.reasoningLevel?.map !== undefined && !reasoningPinned
          ? { reasoningLevelMap: specs.reasoningLevel.map }
          : {}),
        ...(specs.maxOutputTokens?.max !== undefined && !maxTokensPinned
          ? { maxOutputTokensMax: specs.maxOutputTokens.max }
          : {}),
        ...(specs.maxOutputTokens?.map !== undefined && !maxTokensPinned
          ? { maxOutputTokensMap: specs.maxOutputTokens.map }
          : {}),
      }
    : recommended.reasoningLevels !== undefined && !reasoningPinned
      ? { reasoningLevelValues: recommended.reasoningLevels.join('\n') }
      : {}
  return {
    ...model,
    ...optionSpecFields,
    ...(recommended.name !== undefined && pick('name') ? { name: recommended.name } : {}),
    ...(recommended.contextWindow !== undefined && pick('contextWindow')
      ? { contextWindow: recommended.contextWindow }
      : {}),
    ...(recommended.maxInputTokens !== undefined && pick('maxInputTokens')
      ? { maxInputTokens: recommended.maxInputTokens }
      : {}),
    ...(recommended.maxTokens !== undefined && pick('maxTokens')
      ? { maxTokens: recommended.maxTokens }
      : {}),
    ...(recommended.reasoning !== undefined && pick('reasoning')
      ? { reasoning: recommended.reasoning }
      : {}),
    ...(recommended.tools !== undefined && pick('tools') ? { tools: recommended.tools } : {}),
    ...(recommended.input !== undefined
      ? {
          ...(pick('imageInput') ? { imageInput: recommended.input.includes('image') } : {}),
          ...(pick('audioInput') ? { audioInput: recommended.input.includes('audio') } : {}),
          ...(pick('videoInput') ? { videoInput: recommended.input.includes('video') } : {}),
        }
      : {}),
    ...(recommended.cost?.input !== undefined && pick('inputCost')
      ? { inputCost: recommended.cost.input }
      : {}),
    ...(recommended.cost?.output !== undefined && pick('outputCost')
      ? { outputCost: recommended.cost.output }
      : {}),
    ...(recommended.cost?.cacheRead !== undefined && pick('cacheReadCost')
      ? { cacheReadCost: recommended.cost.cacheRead }
      : {}),
    ...(recommended.cost?.cacheWrite !== undefined && pick('cacheWriteCost')
      ? { cacheWriteCost: recommended.cost.cacheWrite }
      : {}),
  }
}
