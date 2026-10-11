export type ThinkingOption = {
  value: string
  label: string
}

const DEEPSEEK_THINKING_OPTIONS: ThinkingOption[] = [
  { value: 'disabled', label: '关闭' },
  { value: 'default', label: '高' },
  { value: 'enabled', label: '超高' },
]

export function resolveThinkingOptions(
  deepSeekThinkingControls: boolean,
  thinkingOptions: ThinkingOption[],
): ThinkingOption[] {
  return deepSeekThinkingControls ? DEEPSEEK_THINKING_OPTIONS : thinkingOptions
}

export function resolveThinkingLabel(options: ThinkingOption[], thinkingMode: string): string {
  return options.find((option) => option.value === thinkingMode)?.label ?? '默认'
}
