import type { ModelProviderID } from '../../../../shared/Types.js'
import type { ModelPreset } from '../../../ModelPresets.js'

type ProviderModelOption = {
  providerID: ModelProviderID
  modelPresets: ModelPreset[]
}

export function resolveAvailableCodingModel(
  codingModel: string | undefined,
  providerOptions: readonly ProviderModelOption[],
): string | undefined {
  if (!codingModel) return undefined
  const slashIndex = codingModel.indexOf('/')
  if (slashIndex <= 0 || slashIndex >= codingModel.length - 1) return undefined
  const providerID = codingModel.slice(0, slashIndex)
  const modelID = codingModel.slice(slashIndex + 1)
  const provider = providerOptions.find((option) => option.providerID === providerID)
  return provider?.modelPresets.some((preset) => preset.id === modelID) ? codingModel : undefined
}
