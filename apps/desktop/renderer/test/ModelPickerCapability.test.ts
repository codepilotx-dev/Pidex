import { expect, test } from 'bun:test'
import { sortModelPresetsByName } from '../src/ModelPresets.js'
import {
  formatContextWindowLabel,
  modelCapabilityBadges,
} from '../src/features/session/composer/ModelCapabilitySummary.js'

test('模型选择器按名称 A→Z 排序，忽略大小写并按数字大小比较', () => {
  const presets = [
    { id: 'group/auto-hy3', label: 'group/auto-hy3', value: 'group/auto-hy3' },
    { id: 'Qwen10', label: 'Qwen10', value: 'Qwen10' },
    { id: 'GLM-5.3-Flash', label: 'GLM-5.3-Flash', value: 'GLM-5.3-Flash' },
    { id: 'Qwen3.8', label: 'Qwen3.8', value: 'Qwen3.8' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
  ]

  const sorted = sortModelPresetsByName(presets)

  expect(sorted.map((preset) => preset.id)).toEqual([
    'deepseek-v4-pro',
    'GLM-5.3-Flash',
    'group/auto-hy3',
    'Qwen3.8',
    'Qwen10',
  ])
  // 排序返回新数组，调用方持有的原始顺序不受影响。
  expect(presets[0]?.id).toBe('group/auto-hy3')
})

test('上下文窗口压缩为 M / K 短标签', () => {
  expect(formatContextWindowLabel(1_048_576)).toBe('1M')
  expect(formatContextWindowLabel(2_000_000)).toBe('2M')
  expect(formatContextWindowLabel(262_144)).toBe('256K')
  expect(formatContextWindowLabel(32_768)).toBe('32K')
  expect(formatContextWindowLabel(200_000)).toBe('200K')
  expect(formatContextWindowLabel(undefined)).toBeNull()
  expect(formatContextWindowLabel(0)).toBeNull()
})

test('能力标签固定为 上下文 → 视觉 → 推理，且按类型渲染', () => {
  expect(modelCapabilityBadges(undefined)).toEqual([])
  const badges = modelCapabilityBadges({
    id: 'model',
    contextWindow: 262_144,
    vision: true,
    reasoning: true,
  })
  expect(badges.map((badge) => badge.kind)).toEqual(['context', 'vision', 'reasoning'])
  expect(badges.map((badge) => badge.label)).toEqual(['256K', '视觉', '推理'])
  expect(badges[0]?.title).toBe('上下文窗口 262,144 tokens')
  expect(badges[1]?.title).toBe('支持图片输入')
  expect(badges[2]?.title).toBe('支持推理思考')
  // 只声明思考档位（variants）的模型同样视为支持推理。
  expect(modelCapabilityBadges({ id: 'model', variants: ['high'] })).toEqual([
    { kind: 'reasoning', label: '推理', title: '支持推理思考' },
  ])
})
