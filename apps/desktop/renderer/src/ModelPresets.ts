export type ModelPreset = {
  id: string
  label: string
  value: string
}

export const CUSTOM_MODEL_PRESET_ID = '__custom__'

export const MODEL_PRESETS: ModelPreset[] = buildModelPresets([])

export function buildModelPresets(models: string[]): ModelPreset[] {
  return models.map((model) => ({
    id: model,
    label: getModelDisplayLabel(model),
    value: model,
  }))
}

export function getModelDisplayLabel(model: string): string {
  switch (model) {
    case 'deepseek-v4-pro':
      return 'DeepSeek V4 Pro'
    case 'deepseek-v4-flash':
      return 'DeepSeek V4 Flash'
    default:
      return model
  }
}

export function getModelDescription(model: string): string | null {
  switch (model) {
    case 'deepseek-v4-pro':
      return '复杂 Agent / 高质量代码任务'
    case 'deepseek-v4-flash':
      return '快速响应 / 经济使用'
    default:
      return null
  }
}

export function findModelPresetByValue(
  value: string,
  presets = MODEL_PRESETS,
): ModelPreset | undefined {
  return presets.find((preset) => preset.value === value)
}

export function resolveModelPresetId(
  model: string,
  selectedModelPreset: string | undefined,
  presets = MODEL_PRESETS,
): string {
  if (selectedModelPreset && selectedModelPreset !== CUSTOM_MODEL_PRESET_ID) {
    return presets.some((preset) => preset.id === selectedModelPreset) ? selectedModelPreset : ''
  }
  return findModelPresetByValue(model, presets)?.id ?? ''
}
