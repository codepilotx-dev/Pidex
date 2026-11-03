import { describe, expect, test } from 'bun:test'
import {
  buildVariantOptions,
  resolveVariantLabel,
} from '../src/features/models/ReasoningVariantLabels.js'

describe('buildVariantOptions', () => {
  test('严格按 variants 数组顺序生成选项，并使用实际值作为 value', () => {
    const options = buildVariantOptions(['disabled', 'enabled', 'none', 'high', 'max'])
    expect(options?.map((option) => option.value)).toEqual([
      'disabled',
      'enabled',
      'none',
      'high',
      'max',
    ])
  })

  test('已知值用标签映射，未知值原样展示，不猜测语义', () => {
    expect(resolveVariantLabel('high')).toBe('高')
    expect(resolveVariantLabel('none')).toBe('关闭')
    expect(resolveVariantLabel('turbo')).toBe('turbo')
    expect(resolveVariantLabel('custom-effort')).toBe('custom-effort')

    const options = buildVariantOptions(['turbo', 'high'])
    expect(options).toEqual([
      { value: 'turbo', label: 'turbo' },
      { value: 'high', label: '高' },
    ])
  })

  test('没有 variants 时返回 undefined，调用方继续使用默认思考档位回退', () => {
    expect(buildVariantOptions(undefined)).toBeUndefined()
    expect(buildVariantOptions([])).toBeUndefined()
  })
})
